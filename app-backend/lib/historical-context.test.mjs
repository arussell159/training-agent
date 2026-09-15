import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeHistoricalContext} from './historical-context.mjs';

test('TrainingPeaks archive remains visible without an Intervals connection and is read-only', () => {
  const past = {id:12,workout_date:'2026-09-14',sport:'Run',title:'Easy run',details:'Original prescription'};
  const archive = {source:'trainingpeaks',history:[past],planned:[past,{...past,id:13,workout_date:'2026-09-17'}]};
  const result = mergeHistoricalContext({source:'not-connected',history:[],planned:[]},archive,'2026-09-15');
  assert.equal(result.history.length,1);
  assert.equal(result.history[0].id,'tp-history:12');
  assert.equal(result.history[0].details,past.details);
  assert.equal(result.history[0].read_only,true);
  assert.equal(result.source,'trainingpeaks-archive');
  assert.deepEqual(result.planned,[]);
  assert.equal(past.id,12);
});

test('Intervals history wins exact matches without hiding other same-day workouts', () => {
  const old = {id:12,workout_date:'2026-09-14',sport:'Run',title:'Easy run'};
  const live = {...old,id:'activity:42',source:'intervals'};
  const result = mergeHistoricalContext({source:'intervals',history:[live],planned:[]},{source:'trainingpeaks',history:[old,{...old,id:13,title:'Evening run'}]},'2026-09-15');
  assert.deepEqual(result.history.map(w => w.id),['activity:42','tp-history:13']);
  assert.equal(result.source,'intervals');
});

test('Wellness archive preserves details while newer Intervals fields override values', () => {
  const details = [{label:'Sleep Hours',value:5.63}];
  const result = mergeHistoricalContext({history:[],planned:[],wellness_history:[{date:'2026-09-15',hrv:64}]},
    {source:'trainingpeaks',wellness_history:[{timeStamp:'2026-09-15T00:00:00',details}]},'2026-09-15');
  assert.equal(result.wellness_history.length,1);
  assert.equal(result.wellness_history[0].date,'2026-09-15');
  assert.equal(result.wellness_history[0].hrv,64);
  assert.deepEqual(result.wellness_history[0].details,details);
});
