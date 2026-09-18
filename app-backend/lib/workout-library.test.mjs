import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLibraryWorkout, readWorkoutLibrary } from './workout-library.mjs';
test('library creation reconciles uncertain writes and retries without duplicates', async () => {
  let workouts=[], writes=0;
  const event={id:24,name:'Intervals',type:'Ride',description:'- 10m 100w'};
  const request=async (path, options) => {
    if(path.endsWith('/folders')) return [{id:1,name:'AR Performance',type:'FOLDER'}];
    if(options) {writes++; workouts.push({id:2,...JSON.parse(options.body)}); throw new Error('Timeout');}
    return path.endsWith('/workouts') ? workouts : workouts[0];
  };
  await saveLibraryWorkout(request,event);
  await saveLibraryWorkout(request,event);
  assert.equal(writes,1);
  const previews=await readWorkoutLibrary(request);
  assert.equal(previews[0].id,'library:2');
  assert.equal(previews[0].editable,false);
});
