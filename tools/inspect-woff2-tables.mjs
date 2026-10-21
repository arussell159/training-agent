// Static table/provenance comparison, not a font renderer or full WOFF2 decoder.
// Directory format: https://www.w3.org/TR/WOFF2/#table_dir_format
import fs from 'node:fs/promises';
import {brotliDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const tags=['cmap','head','hhea','hmtx','maxp','name','OS/2','post','cvt ','fpgm','glyf','loca','prep','CFF ','VORG','EBDT','EBLC','gasp','hdmx','kern','LTSH','PCLT','VDMX','vhea','vmtx','BASE','GDEF','GPOS','GSUB','EBSC','JSTF','MATH','CBDT','CBLC','COLR','CPAL','SVG ','sbix','acnt','avar','bdat','bloc','bsln','cvar','fdsc','feat','fmtx','fvar','gvar','hsty','just','lcar','mort','morx','opbd','prop','trak','Zapf','Silf','Glat','Gloc','Feat','Sill'];
const hash=data=>createHash('sha256').update(data).digest('hex');
async function inspect(file){
  const input=await fs.readFile(file);assert.ok(input.length<=8_000_000);assert.equal(input.toString('ascii',0,4),'wOF2');
  assert.notEqual(input.toString('ascii',4,8),'ttcf','Collections are outside this inspector');assert.equal(input.readUInt32BE(8),input.length);
  let offset=48;
  const variable=()=>{let result=0;for(let i=0;i<5;i++){const byte=input[offset++];assert.ok(byte!==undefined && !(i===0&&byte===128));result=result*128+(byte&127);assert.ok(result<=0xffffffff);if(!(byte&128))return result;}throw Error('Invalid UIntBase128');};
  const tables=[];
  for(let i=0;i<input.readUInt16BE(12);i++){
    const flag=input[offset++],index=flag&63,version=flag>>6;
    const tag=index===63?input.toString('ascii',offset,offset+=4):tags[index];
    const originalLength=variable(),transformed=['glyf','loca'].includes(tag)?version!==3:version!==0;
    assert.ok(['glyf','loca'].includes(tag)?[0,3].includes(version):tag==='hmtx'?[0,1].includes(version):version===0,'Unsupported transform');
    tables.push({tag,originalLength,storedLength:transformed?variable():originalLength,transformed,version});
  }
  const raw=brotliDecompressSync(input.subarray(offset,offset+input.readUInt32BE(20)),{maxOutputLength:32_000_000});
  let at=0;const records=[];
  for(const table of tables){
    const data=raw.subarray(at,at+table.storedLength);at+=table.storedLength;assert.equal(data.length,table.storedLength);table.sha256=hash(data);
    if(table.tag==='name'){
      assert.equal(table.transformed,false);const count=data.readUInt16BE(2),strings=data.readUInt16BE(4);
      for(let i=0;i<count;i++){
        const p=6+i*12,platform=data.readUInt16BE(p),id=data.readUInt16BE(p+6),length=data.readUInt16BE(p+8),start=strings+data.readUInt16BE(p+10);
        const bytes=Buffer.from(data.subarray(start,start+length));assert.equal(bytes.length,length);
        if(platform!==0&&platform!==3)continue;assert.equal(length%2,0);
        const value=bytes.swap16().toString('utf16le');
        if([0,1,2,3,4,5,6,8,9,11,13,14,16,17].includes(id)&&!records.some(x=>x.id===id&&x.value===value))records.push({id,value});
      }
    }
  }
  assert.equal(at,raw.length);
  return{file,bytes:input.length,sha256:hash(input),names:records,tables};
}
const files=process.argv.slice(2);assert.ok(files.length>0,'Pass observed local WOFF2 file paths');
console.log(JSON.stringify({formatReference:'https://www.w3.org/TR/WOFF2/#table_dir_format',limitation:'Raw stored table hashes; transformed glyph tables are not reconstructed or rendered.',files:await Promise.all(files.map(inspect))},null,2));
