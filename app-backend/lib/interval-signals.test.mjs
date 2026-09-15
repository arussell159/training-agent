import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatSignalClock,intervalSignals,tooltipPosition} from '../../ui/src/lib/interval-signals.ts';

test('pace seconds format as minutes and seconds, including minute rollover',()=>{
 assert.equal(formatSignalClock(103),'1:43');
 assert.equal(formatSignalClock(63),'1:03');
 assert.equal(formatSignalClock(119.6),'2:00');
});

test('swim pace and stroke rate are constant across each full recorded interval',()=>{
 const points=[
  {time:0,speed:1,cadence:20,power:null,heartRate:120,distance:0},
  {time:100,speed:2,cadence:28,power:null,heartRate:140,distance:100},
  {time:400,speed:0,cadence:0,power:null,heartRate:130,distance:365.76},
  {time:430,speed:1,cadence:30,power:null,heartRate:150,distance:365.76},
  {time:530,speed:0,cadence:0,power:null,heartRate:140,distance:457.2},
 ];
 const result=intervalSignals(points,[{id:'a',label:'400 yd',start:0,end:400,distance:365.76},{id:'b',label:'100 yd',start:430,end:530,distance:91.44}]);
 assert.equal(91.44/result[0].point.speed,100);
 assert.equal(result[0].point.cadence,26);
 assert.equal(result[1].point.cadence,30);
 assert.equal(result[0].lap.end-result[0].lap.start,4*(result[1].lap.end-result[1].lap.start));
 assert.equal(result.find(i=>415>=i.lap.start&&415<i.lap.end),undefined);
});
test('tooltip follows the inspection time horizontally and stays within the chart edges',()=>{
 assert.match(tooltipPosition(0,100),/10%/);assert.match(tooltipPosition(50,100),/53%/);assert.match(tooltipPosition(100,100),/96%/);
 assert.match(tooltipPosition(0,0),/clamp/);assert.equal(tooltipPosition(200,100),tooltipPosition(100,100));
});
