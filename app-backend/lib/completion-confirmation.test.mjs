import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCompletionConfirmation} from './completion-confirmation.mjs';
test('athlete-confirmed historical completions are green; future and uncompleted workouts are untouched',()=>{
  const history=[{id:'old',status:'completed',workout_date:'2026-09-14'},{id:'future',status:'completed',workout_date:'2026-09-16'},{id:'planned',status:'today',workout_date:'2026-09-15'}];
  const result=applyCompletionConfirmation({history,planned:history},{through:'2026-09-15'});
  assert.equal(result.history[0].completion_grade,'good');
  assert.equal(result.history[0].completion_grade_source,'athlete-confirmed');
  assert.equal(result.history[1].completion_grade,undefined);assert.equal(result.history[2].completion_grade,undefined);
  assert.equal(history[0].completion_grade,undefined);
});
