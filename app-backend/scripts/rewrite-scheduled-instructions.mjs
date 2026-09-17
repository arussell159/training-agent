import fs from 'node:fs/promises';
import {athleteLocalDate} from '../lib/athlete-date.mjs';
import {expandFitWorkoutSteps,readFitWorkoutSteps} from '../lib/fit-workout-verification.mjs';
import {createIntervalsClient} from '../lib/intervals.mjs';
import {DEVICE_DEFINITION_MARKER,deviceWorkoutSteps,nativeWorkoutDefinition,racePlan} from '../lib/race-plan-import.mjs';
import {createSupabaseSettingsStore} from '../lib/settings-store.mjs';

const apply=process.argv.includes('--apply');
const bootstrap=JSON.parse(await fs.readFile('app-backend/config.json','utf8'));
const config={...bootstrap,...await createSupabaseSettingsStore(bootstrap).read()};
const request=createIntervalsClient(config);
const athlete=await request('/athlete/0');
const today=athleteLocalDate(new Date(),athlete.timezone || 'America/Chicago');
const newest='2026-10-04';
const events=await request(`/athlete/0/events?oldest=${today}&newest=${newest}`);
const plansById=new Map(racePlan.map(plan=>[plan.external_id,plan]));
const scheduled=events.filter(event=>plansById.has(event.external_id)&&!event.paired_activity_id);
const expand=steps=>steps.flatMap(step=>step.steps?Array.from({length:step.reps || 1},()=>expand(step.steps)).flat():[step]);
const repeatOutline=steps=>(steps || []).flatMap((step,index)=>step.steps?[{index,reps:step.reps || 1,steps:expand(step.steps).length}]:[]);
const results=[];

for(const event of scheduled){
 const plan=plansById.get(event.external_id);
 const original=String(event.description || '');
 const description=plan.description+DEVICE_DEFINITION_MARKER+nativeWorkoutDefinition(plan);
 const expectedTree=deviceWorkoutSteps(plan),expected=expand(expectedTree),expectedRepeats=repeatOutline(expectedTree);
 if(!apply){
  results.push({id:event.id,date:String(event.start_date_local).slice(0,10),type:plan.type,name:event.name,steps:expected.length,repeats:expectedRepeats.map(group=>group.reps),changed:description!==original});
  continue;
 }

 await request(`/athlete/0/events/${event.id}`,{method:'PUT',body:JSON.stringify({description})});
 const verified=await request(`/athlete/0/events/${event.id}`);
 const actualTree=verified.workout_doc?.steps || [],actual=expand(actualTree),actualRepeats=repeatOutline(actualTree);
 if(verified.description!==description)throw new Error(`Description verification failed: ${event.name}`);
 if(JSON.stringify(actualRepeats)!==JSON.stringify(expectedRepeats))throw new Error(`Repeat structure verification failed: ${event.name}`);
 if(actual.length!==expected.length)throw new Error(`Step count verification failed: ${event.name}`);
 for(let index=0;index<expected.length;index++){
  const source=expected[index],parsed=actual[index];
  if(source.intensity==='rest'){
   if(parsed.intensity!=='rest' || parsed.duration!==source.duration)throw new Error(`Rest verification failed: ${event.name} step ${index+1}`);
   continue;
  }
  if(plan.type==='Swim'){
   const yards=Math.round(source.distance/.9144),pace=Math.round(source.duration*100/yards);
   if(Math.abs(parsed.distance-yards)>.001 || parsed.pace?.units!=='secs' || parsed.pace?.value!==pace)throw new Error(`Swim target verification failed: ${event.name} step ${index+1}`);
  }else{
   if(parsed.duration!==source.duration)throw new Error(`Duration verification failed: ${event.name} step ${index+1}`);
   for(const key of ['pace','power'])if(source[key]){
    const wanted=source[key],received=parsed[key];
    if(received?.units!==wanted.units || (wanted.value!=null?received.value!==wanted.value:received?.start!==wanted.start||received?.end!==wanted.end))throw new Error(`Target verification failed: ${event.name} step ${index+1}`);
   }
   if(source.cadence?.value!=null&&parsed.cadence?.value!==source.cadence.value)throw new Error(`Cadence verification failed: ${event.name} step ${index+1}`);
  }
 }
 const human=verified.description.split(DEVICE_DEFINITION_MARKER)[0];
 if(!/^Warm Up:\n[\s\S]+\n\nMain Set:\n[\s\S]+\n\nWarm Down:\n/.test(human) || /\*\*/.test(human))throw new Error(`Human instruction format verification failed: ${event.name}`);
 let fitRepeatValues=[];
 if(expectedRepeats.length){
  const response=await fetch(`https://intervals.icu/api/v1/athlete/0/events/${event.id}/download.fit`,{
   headers:{Authorization:`Basic ${Buffer.from(`API_KEY:${config.INTERVALS_API_KEY}`).toString('base64')}`},
   signal:AbortSignal.timeout(30000),
  });
  if(!response.ok)throw new Error(`FIT export failed: ${event.name} (${response.status})`);
  const rawFitSteps=readFitWorkoutSteps(Buffer.from(await response.arrayBuffer()));
  fitRepeatValues=rawFitSteps.filter(step=>step.durationType===6).map(step=>step.targetValue);
  if(JSON.stringify(fitRepeatValues)!==JSON.stringify(expectedRepeats.map(group=>group.reps)) || expandFitWorkoutSteps(rawFitSteps).length!==expected.length)throw new Error(`FIT repeat verification failed: ${event.name}`);
 }
 results.push({id:event.id,date:String(event.start_date_local).slice(0,10),type:plan.type,name:event.name,steps:actual.length,repeats:actualRepeats.map(group=>group.reps),fitRepeats:fitRepeatValues,changed:description!==original});
}

console.log(JSON.stringify({apply,today,count:results.length,results},null,2));
