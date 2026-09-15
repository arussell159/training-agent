import {test} from 'node:test';
import assert from 'node:assert/strict';
import {swimDefinition,swimDescription} from './todays-swim.mjs';
import {expandFitWorkoutSteps,readFitWorkoutMetadata} from './fit-workout-verification.mjs';

test('FIT pool metadata distinguishes yards from meters while storing pool length in meters',()=>{
 const payload=Buffer.from([0x40,0,0,26,0,3,4,1,0,14,2,0x84,15,1,0,0,5,0xee,0x08,1]);
 const header=Buffer.alloc(14);header[0]=14;header.writeUInt32LE(payload.length,4);header.write('.FIT',8);
 const fit=Buffer.concat([header,payload]);
 assert.deepEqual(readFitWorkoutMetadata(fit),[{sport:5,poolLengthMeters:22.86,poolLengthUnit:'yards'}]);
 fit[fit.length-1]=0;
 assert.equal(readFitWorkoutMetadata(fit)[0].poolLengthUnit,'meters');
});
test('requested swim uses explicit repetitions with rest after the last work step and exact yards',()=>{
 assert.doesNotMatch(swimDefinition,/\d+x/);
 assert.equal((swimDefinition.match(/- Freestyle 400y/g) || []).length,3);
 assert.equal((swimDefinition.match(/- Rest 30s/g) || []).length,3);
 assert.equal((swimDefinition.match(/- Rest 15s/g) || []).length,12);
 assert.match(swimDefinition,/- Freestyle 400y Z3 Pace\n- Rest 30s intensity=rest\n\nMain Set/);
 assert.match(swimDefinition,/- Freestyle 100y Z4 Pace\n- Rest 15s intensity=rest\n\nWarm Down/);
 assert.match(swimDefinition,/Pool length: 25y/);
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
