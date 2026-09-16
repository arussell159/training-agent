import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deviceWorkoutSteps,nativeWorkoutDefinition,racePlan} from './race-plan-import.mjs';
const leaves=steps=>steps.flatMap(s=>s.steps?leaves(s.steps):[s]);
test('race plan imports only remaining dated sessions with unique source identifiers',()=>{
 assert.equal(racePlan.length,24);
 assert.equal(new Set(racePlan.map(p=>p.external_id)).size,24);
 for(const p of racePlan){
  assert.ok(p.start_date_local>='2026-09-15' && p.start_date_local<'2026-10-04');
  assert.match(p.description,/^Warm Up:\n[\s\S]+\n\nMain Set:\n[\s\S]+\n\nWarm Down:\n/);
  assert.doesNotMatch(p.description,/\*\*/);
 }
});
test('app instructions use discipline-specific human-readable formatting',()=>{
 const swim=racePlan.find(p=>p.name==='CSS Swim Repeats').description;
 assert.match(swim,/Warm Up:\n1 x \(300 FS with fins in Z1\),\n4 x \(50 Drill in Z1 \+ 10 sec rests\),/);
 assert.match(swim,/Main Set:\n4 x \(3 x \(100 FS in Z5 \+ 20 sec rests\) \+ 50 FS in Z1 \+ 30 sec rests\)\./);
 const bike=racePlan.find(p=>p.name==='Race-Course Bike Rehearsal').description;
 assert.match(bike,/Warm Up:\n15 mins at 112 → 132 W\./);
 assert.match(bike,/Main Set:\n4 x \(8 mins at 154 W \+ 2 mins at 146 W\),/);
 const run=racePlan.find(p=>p.name==='Threshold and Steady Run').description;
 assert.match(run,/Warm Up:\n15 mins easy jog at 10:30–11:00 min\/mile\./);
 assert.match(run,/3 x \(6 mins at 8:50–9:00 min\/mile \+ 2 mins recovery at 10:30–11:00 min\/mile\),/);
});
test('swim work uses yards converted to meters, zone targets, and seconds-only rests',()=>{
 for(const p of racePlan.filter(p=>p.type==='Swim'))for(const s of leaves(p.workout_doc.steps)){
  if(s.intensity==='rest'){assert.ok(s.duration>0);assert.equal(s.distance,undefined);assert.equal(s.pace,undefined);}
  else {assert.ok(Math.abs(s.distance/.9144-Math.round(s.distance/.9144))<1e-8);assert.equal(s.pace.units,'pace_zone');assert.ok(Number.isInteger(s.pace.value)&&s.pace.value>=1&&s.pace.value<=5);}
 }
 assert.equal(Math.round(racePlan.find(p=>p.name==='CSS Swim Repeats').workout_doc.distance/.9144),2200);
});
test('Garmin swim definitions use yard amounts with the Intervals mtr parser workaround and explicit yard paces',()=>{
 for(const p of racePlan.filter(p=>p.type==='Swim')){
  const definition=nativeWorkoutDefinition(p);
  assert.match(definition,/^Pool length: 25y\n\n/);
  assert.doesNotMatch(definition,/\\n|\bZ[1-5] Pace/);
  assert.doesNotMatch(definition.split('\n\n')[1],/\d+y\b/);
  assert.ok(deviceWorkoutSteps(p).some(step=>step.steps&&step.reps>1));
  const work=definition.split('\n').filter(line=>line.startsWith('- ')&&!line.startsWith('- Rest'));
  assert.ok(work.length>0);
  for(const line of work)assert.match(line,/^- \d+mtr \d+:\d{2} Pace(?: |$)/);
 }
 const css=nativeWorkoutDefinition(racePlan.find(p=>p.name==='CSS Swim Repeats'));
 assert.equal((css.match(/^- 50mtr 1:50 Pace drill$/gm) || []).length,1);
 assert.match(css,/4x\n- 50mtr 1:50 Pace drill\n- Rest 10s intensity=rest/);
 assert.match(css,/4x\n(?:- 100mtr 1:32 Pace\n- Rest 20s intensity=rest\n){3}- 50mtr 1:50 Pace\n- Rest 30s intensity=rest/);
 assert.match(css,/- 100mtr 1:32 Pace/);
 assert.match(css,/- Rest 20s intensity=rest/);
});
test('run and bike targets are absolute athlete-specific values, with accurate total durations',()=>{
 for(const p of racePlan.filter(p=>p.type!=='Swim'))for(const s of leaves(p.workout_doc.steps)){
  assert.ok(s.duration>0);assert.equal(s.distance,undefined);
  assert.equal(p.type==='Run'?s.pace.units:s.power.units,p.type==='Run'?'secs/mi':'w');
 }
 assert.equal(racePlan.find(p=>p.name==='Race-Power Over-Unders').workout_doc.duration,75*60);
 assert.equal(racePlan.find(p=>p.name==='Race-Course Bike Rehearsal').workout_doc.duration,180*60);
 assert.match(nativeWorkoutDefinition(racePlan.find(p=>p.name==='Race-Power Over-Unders')),/3x\n- 30s 173w\n- 30s 106w/);
 assert.match(nativeWorkoutDefinition(racePlan.find(p=>p.name==='Threshold and Steady Run')),/3x\n- 360s 8:50-9:00\/mi Pace\n- 120s 10:30-11:00\/mi Pace/);
});
