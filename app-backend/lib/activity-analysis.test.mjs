import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {normalizeAnalysis,readFitLaps} from './activity-analysis.mjs';
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
