import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moveTrainingPeaksWorkout} from './move-workout.mjs';

test('moving a workout preserves its prescription and verifies the date', async () => {
  let stored = {workoutDay:'2026-09-15T00:00:00', title:'Workout', structure:'unchanged', totalTimePlanned:1, startTimePlanned:'2026-09-15T08:00:00', completed:true};
  const result = await moveTrainingPeaksWorkout({workoutId:'123', date:'2026-09-17', getSession:async () => ({token:'test',athleteId:1}), request:async (path, token, options) => {
    assert.equal(path,'/fitness/v6/athletes/1/workouts/123');
    if (options?.method === 'PUT') stored = JSON.parse(options.body);
    return stored;
  }});
  assert.equal(result.verified,true);
  assert.equal(stored.workoutDay,'2026-09-17T00:00:00');
  assert.equal(stored.startTimePlanned,'2026-09-17T08:00:00');
  assert.equal(stored.structure,'unchanged');
  assert.equal(stored.totalTimePlanned,1);
  assert.equal(stored.completed,true);
});
test('invalid dates cannot write and unconfirmed changes fail', async () => {
  await assert.rejects(moveTrainingPeaksWorkout({workoutId:'123',date:'2026-02-30',getSession:() => {throw new Error('should not authenticate');}}), /valid workout date/);
  await assert.rejects(moveTrainingPeaksWorkout({workoutId:'123',date:'2026-09-17',getSession:async () => ({token:'test',athleteId:1}),request:async () => ({workoutDay:'2026-09-15T00:00:00'})}), /did not confirm/);
});
