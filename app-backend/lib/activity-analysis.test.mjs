import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {normalizeAnalysis,readFitLaps} from './activity-analysis.mjs';
test('swim selects whole recorded work repeats, not individual lengths or recovery',()=>{
 const start='2026-09-15T21:22:49Z',timestamp=Date.parse(start)/1000-Date.UTC(1989,11,31)/1000;
 const result=normalizeAnalysis({id:'i1',type:'Swim',start_date:start,icu_intervals:[
  {start_time:0,end_time:400,type:'WORK',distance:365.76},
  {start_time:400,end_time:430,type:'RECOVERY',distance:0},
  {start_time:430,end_time:850,type:'WORK',distance:365.76},
 ]},[{type:'time',data:[0,400,430,850]}],Array.from({length:32},(_,i)=>({timestamp:timestamp+i*25,duration:25,distance:22.86})));
 assert.equal(result.laps.length,2);
 assert.equal(result.laps[0].label,'400 yd · Interval 1');
 assert.equal(result.laps[0].end,400);
 assert.equal(91.44/result.laps[0].speed,100);
 assert.equal(91.44/result.laps[1].speed,105);
});
test('analysis keeps zero watts, gaps and real sample times; laps align to activity start',()=>{
  const start='2026-09-14T12:00:00Z',timestamp=Date.parse(start)/1000-Date.UTC(1989,11,31)/1000;
  const result=normalizeAnalysis({id:'i1',start_date:start,icu_intervals:[{start_time:0,end_time:40,type:'WORK'}]},[{type:'time',data:[0,2,5]},{type:'watts',data:[0,null,240]},{type:'heartrate',data:[100,101,102]}],[{timestamp:timestamp+2,duration:3,power:200,heartRate:102}]);
  assert.equal(result.points[0].power,0);assert.equal(result.points[1].power,null);assert.equal(result.points[2].speed,null);
  assert.equal(result.laps[0].start,2);assert.equal(result.laps[0].end,5);assert.equal(result.intervals[0].kind,'interval');
});
test('reads recorded FIT lap fields from gzipped binary',()=>{
  const payload=Buffer.from([0x40,0,0,19,0,4,2,4,0x86,7,4,0x86,15,1,2,19,2,0x84,0,0,0,0,0,0,0,0,0,150,200,0]);
  payload.writeUInt32LE(1000,19);payload.writeUInt32LE(30000,23);
  const header=Buffer.alloc(14);header[0]=14;header.writeUInt32LE(payload.length,4);header.write('.FIT',8);
  const laps=readFitLaps(gzipSync(Buffer.concat([header,payload])));
  assert.deepEqual(laps,[{timestamp:1000,duration:30,power:200,heartRate:150,distance:null}]);
});
