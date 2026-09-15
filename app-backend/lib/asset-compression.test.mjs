import {test} from 'node:test';import assert from 'node:assert/strict';import {gunzipSync} from 'node:zlib';import {compressAsset} from './asset-compression.mjs';
test('large text assets compress, binary and disabled encodings do not',()=>{
 const file=Buffer.from('example script content '.repeat(1000));const asset=compressAsset(file,'.js','gzip, br');assert.equal(asset.headers['Content-Encoding'],'gzip');assert.deepEqual(gunzipSync(asset.body),file);assert.ok(asset.body.length<file.length/4);assert.equal(compressAsset(file,'.woff2','gzip').body,file);assert.equal(compressAsset(file,'.js','gzip;q=0').body,file);
});
