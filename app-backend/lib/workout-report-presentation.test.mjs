import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkoutReport } from './workout-report-presentation.mjs';

test('pre presentation preserves exact readiness, missing data and priority', () => {
  const report = parseWorkoutReport('Recommendation: Modify\nDecision Level: P1\nHRV: Unavailable (baseline 49.25 ms)\nSleep: 7.13 h\nInterpretation:\nMissing current HRV; do not increase intensity.', 'pre');
  assert.deepEqual(report.verdict, [['Recommendation','Modify'],['Decision Level','P1']]);
  assert.deepEqual(report.sections[0].rows[0], ['HRV','Unavailable','baseline 49.25 ms']);
  assert.equal(report.sections.at(-1).prose[0], 'Missing current HRV; do not increase intensity.');
});
test('post presentation keeps separate sessions and exact actual/planned values', () => {
  const report = parseWorkoutReport('Completed workout: Ride A\nDuration: 1h03m (planned 1h00m)\nTSS: 53.49\nCompleted workout: Walk B\nDuration: 10m\nWeekly totals (rolling 7d):\nTSS: 333\nTomorrow: Easy run', 'post');
  assert.deepEqual(report.sections.map(s => s.title), ['Ride A','Walk B','Rolling 7-Day Context','Next Up']);
  assert.deepEqual(report.sections[0].rows[0], ['Duration','1h03m','1h00m']);
  assert.deepEqual(report.sections[0].rows[1], ['TSS','53.49','—']);
});

test('source summary leads the post report without converting it to a metric', () => {
  const report=parseWorkoutReport('Data (last_updated UTC: 2026-09-18T11:36:32)\nTwo same-day sessions completed: the swim was truncated versus plan.\nCompleted workout: Swim CSS\nDuration: 32m57s (planned 47m21s)\nHR zones: 10% Zone 1, 90% Zone 2', 'post');
  assert.deepEqual(report.verdict,[['Session Result','Two same-day sessions completed: the swim was truncated versus plan.']]);
  assert.equal(report.sections[0].title,'Swim CSS');
  assert.deepEqual(report.sections[0].tables[0].rows,[['Zone 1','10%'],['Zone 2','90%']]);
  assert.equal(report.sections.at(-1).prose[0],'Data (last_updated UTC: 2026-09-18T11:36:32)');
});
