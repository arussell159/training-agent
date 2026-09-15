import {test} from 'node:test';
import assert from 'node:assert/strict';
import {athleteLocalDate,coachTrainingContext} from './coach-training-context.mjs';
import {generateCoachResponse} from './coach-response.mjs';

test('today includes every scheduled workout and retains exact prescriptions', () => {
  const today = {id:'1',workout_date:'2026-09-15',title:'Bike Over-Unders',planned:{duration_minutes:75,power_watts:220},structure:'original steps'};
  const context=coachTrainingContext({history:[today],planned:[today,{id:'2',workout_date:'2026-09-15',title:'Brick Run'},{id:'3',workout_date:'2026-09-16',title:'Tomorrow'}],metrics:{fatigue:91}},'2026-09-15');
  assert.equal(context.today_workouts.length,2);
  assert.equal(context.today_workouts[0].planned.power_watts,220);
  assert.equal(context.today_workouts[0].structure,'original steps');
  assert.equal(context.metrics.fatigue,91);
  assert.equal(context.tomorrow_workouts.length,1);
});
test('today follows the athlete timezone across a UTC date boundary', () => {
  assert.equal(athleteLocalDate(new Date('2026-09-16T01:00:00Z'),'America/Chicago'),'2026-09-15');
});

test('session context includes only today, tomorrow, and the previous eight days', () => {
  const context=coachTrainingContext({
    history:['2026-09-06','2026-09-07','2026-09-14','2026-09-15'].map(workout_date => ({workout_date})),
    planned:['2026-09-15','2026-09-16','2026-09-17'].map(workout_date => ({workout_date})),
  },'2026-09-15');
  assert.deepEqual(context.recent_training_history.map(workout => workout.workout_date),['2026-09-07','2026-09-14']);
  assert.deepEqual(context.tomorrow_workouts.map(workout => workout.workout_date),['2026-09-16']);
  assert.deepEqual(context.history_window,{start:'2026-09-07',end:'2026-09-14'});
  assert.equal(context.upcoming_workouts,undefined);
});

