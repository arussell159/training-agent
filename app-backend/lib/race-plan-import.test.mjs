import {test} from 'node:test';
import assert from 'node:assert/strict';
import {racePlan} from './race-plan-import.mjs';
const leaves=steps=>steps.flatMap(s=>s.steps?leaves(s.steps):[s]);
test('race plan imports only remaining dated sessions with unique source identifiers',()=>{
 assert.equal(racePlan.length,24);
 assert.equal(new Set(racePlan.map(p=>p.external_id)).size,24);
 for(const p of racePlan){assert.ok(p.start_date_local>='2026-09-15' && p.start_date_local<'2026-10-04');assert.match(p.description,/\*\*Warm Up:\*\*/);assert.match(p.description,/\*\*Main Set:\*\*/);assert.match(p.description,/\*\*Warm Down:\*\*/);}
});
test('swim work uses yards converted to meters, zone targets, and seconds-only rests',()=>{
 for(const p of racePlan.filter(p=>p.type==='Swim'))for(const s of leaves(p.workout_doc.steps)){
  if(s.intensity==='rest'){assert.ok(s.duration>0);assert.equal(s.distance,undefined);assert.equal(s.pace,undefined);}
  else {assert.ok(Math.abs(s.distance/.9144-Math.round(s.distance/.9144))<1e-8);assert.equal(s.pace.units,'pace_zone');assert.ok(Number.isInteger(s.pace.value)&&s.pace.value>=1&&s.pace.value<=5);}
 }
 assert.equal(Math.round(racePlan.find(p=>p.name==='CSS Swim Repeats').workout_doc.distance/.9144),2200);
});
test('run and bike targets are absolute athlete-specific values, with accurate total durations',()=>{
 for(const p of racePlan.filter(p=>p.type!=='Swim'))for(const s of leaves(p.workout_doc.steps)){
  assert.ok(s.duration>0);assert.equal(s.distance,undefined);
  assert.equal(p.type==='Run'?s.pace.units:s.power.units,p.type==='Run'?'secs/mi':'w');
 }
 assert.equal(racePlan.find(p=>p.name==='Race-Power Over-Unders').workout_doc.duration,75*60);
 assert.equal(racePlan.find(p=>p.name==='Race-Course Bike Rehearsal').workout_doc.duration,180*60);
});
