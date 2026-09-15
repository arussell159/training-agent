import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changeTrainingPeaksWorkout} from './workout-actions.mjs';

const getSession = async () => ({token:'test',athleteId:1});
test('copy retains planned fields and excludes completion data', async () => {
  const original = {workoutId:123,title:'Intervals',workoutDay:'2026-09-15T00:00:00',workoutTypeValueId:2,structure:'steps',totalTimePlanned:1,totalTime:1.2,powerAverage:200,completed:true};
  let body;
  const result = await changeTrainingPeaksWorkout({workoutId:'123',action:'copy',getSession,request:async (path, token, options) => {
    if (options?.method === 'POST') {body=JSON.parse(options.body);return {workoutId:456};}
    return path.endsWith('/456') ? {...body,workoutId:456} : original;
  }});
  assert.equal(result.workoutId,'456');
  assert.equal(body.structure,'steps');
  assert.equal(body.totalTimePlanned,1);
  assert.equal(body.completed,false);
  assert.equal(body.totalTime,undefined);
  assert.equal(body.powerAverage,undefined);
  assert.equal(body.workoutId,undefined);
});
test('delete requires a verified 404 and does not treat other errors as success', async () => {
  let deleted=false;
  const result=await changeTrainingPeaksWorkout({workoutId:'123',action:'delete',getSession,request:async (path,token,options) => {
    if (options?.method === 'DELETE') {deleted=true;return null;}
    if (deleted) throw Object.assign(new Error('Not found'),{status:404});
    return {workoutId:123};
  }});
  assert.equal(result.verified,true);
  await assert.rejects(changeTrainingPeaksWorkout({workoutId:'123',action:'delete',getSession,request:async () => ({workoutId:123})}), /did not confirm/);
});
test('copy without a new ID is rejected', async () => {
  await assert.rejects(changeTrainingPeaksWorkout({workoutId:'123',action:'copy',getSession,request:async () => ({workoutId:123})}), /new workout ID/);
});
