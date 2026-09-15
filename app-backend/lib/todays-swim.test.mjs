import {test} from 'node:test';
import assert from 'node:assert/strict';
import {swimDefinition,swimDescription} from './todays-swim.mjs';
import {expandFitWorkoutSteps} from './fit-workout-verification.mjs';
test('requested swim uses separated native repeat blocks and normalized yard/rest descriptions',()=>{
 assert.match(swimDefinition,/intensity=warmup\n\n2x/);
 assert.match(swimDefinition,/Main Set 4x\n- Freestyle build 50y Z2-Z4 Pace\n- Rest 15s/);
 assert.match(swimDefinition,/Main Set 3x\n- Freestyle 400y Z3 Pace\n- Rest 30s/);
 assert.match(swimDefinition,/Main Set 8x\n- Freestyle 100y Z4 Pace\n- Rest 15s/);
 assert.match(swimDescription,/2,900 yd/);
});
test('FIT repetition control records expand work and rest the correct number of times',()=>{
 const work={index:0,durationType:1,durationValue:9144};
 const rest={index:1,durationType:0,durationValue:15000,intensity:1};
 const result=expandFitWorkoutSteps([work,rest,{index:2,durationType:6,durationValue:0,targetValue:8}]);
 assert.equal(result.length,16);
 assert.equal(result.filter(s=>s.intensity===1).length,8);
 assert.equal(result.filter(s=>s.durationType===1).reduce((sum,s)=>sum+s.durationValue,0),8*9144);
});
