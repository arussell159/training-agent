import fs from 'node:fs/promises';
import {athleteLocalDate} from '../lib/athlete-date.mjs';
import {expandFitWorkoutSteps,readFitWorkoutMetadata,readFitWorkoutSteps} from '../lib/fit-workout-verification.mjs';
import {createIntervalsClient} from '../lib/intervals.mjs';
import {DEVICE_DEFINITION_MARKER,deviceWorkoutSteps,nativeWorkoutDefinition,racePlan} from '../lib/race-plan-import.mjs';
import {createSupabaseSettingsStore} from '../lib/settings-store.mjs';

const apply=process.argv.includes('--apply');
const bootstrap=JSON.parse(await fs.readFile('app-backend/config.json','utf8'));
const config={...bootstrap,...await createSupabaseSettingsStore(bootstrap).read()};
const request=createIntervalsClient(config);
const athlete=await request('/athlete/0');
const today=athleteLocalDate(new Date(),athlete.timezone || 'America/Chicago');
const plans=racePlan.filter(plan=>plan.type==='Swim' && plan.start_date_local.slice(0,10)>=today);
const newest=plans.map(plan=>plan.start_date_local.slice(0,10)).sort().at(-1);
const events=await request(`/athlete/0/events?oldest=${today}&newest=${newest}`);
const expand=steps=>steps.flatMap(step=>step.steps?Array.from({length:step.reps || 1},()=>expand(step.steps)).flat():[step]);
const repeatOutline=steps=>(steps || []).flatMap((step,index)=>step.steps?[{index,reps:step.reps || 1,steps:expand(step.steps).length}]:[]);
const results=[];

for(const plan of plans){
 const event=events.find(item=>item.external_id===plan.external_id);
 if(!event)throw new Error(`Scheduled swim not found: ${plan.start_date_local.slice(0,10)} ${plan.name}`);
 if(event.paired_activity_id)throw new Error(`Scheduled swim is already completed: ${event.name}`);
 const description=plan.description+DEVICE_DEFINITION_MARKER+nativeWorkoutDefinition(plan);
 const expectedTree=deviceWorkoutSteps(plan),expected=expand(expectedTree),expectedRepeats=repeatOutline(expectedTree);
 if(!apply){
  results.push({id:event.id,date:String(event.start_date_local).slice(0,10),name:event.name,steps:expected.length,repeats:expectedRepeats.map(group=>group.reps),description});
  continue;
 }

 await request(`/athlete/0/events/${event.id}`,{method:'PUT',body:JSON.stringify({description})});
 const verified=await request(`/athlete/0/events/${event.id}`);
 const actualTree=verified.workout_doc?.steps || [],actual=expand(actualTree),actualRepeats=repeatOutline(actualTree);
 if(verified.description!==description)throw new Error(`Description verification failed: ${event.name}`);
 if(verified.workout_doc?.options?.pool_length!=='25y')throw new Error(`Pool verification failed: ${event.name}`);
 if(JSON.stringify(actualRepeats)!==JSON.stringify(expectedRepeats))throw new Error(`Repeat structure verification failed: ${event.name}`);
 if(actual.length!==expected.length)throw new Error(`Step count verification failed: ${event.name}`);
 for(let index=0;index<expected.length;index++){
  const source=expected[index],parsed=actual[index];
  if(source.intensity==='rest'){
   if(parsed.intensity!=='rest' || parsed.duration!==source.duration)throw new Error(`Rest verification failed: ${event.name} step ${index+1}`);
   continue;
  }
  const yards=Math.round(source.distance/.9144);
  const pace=Math.round(source.duration*100/yards);
  if(Math.abs(parsed.distance-yards)>.001)throw new Error(`Yard amount verification failed: ${event.name} step ${index+1}`);
  if(parsed.pace?.units!=='secs' || parsed.pace?.value!==pace)throw new Error(`Yard pace verification failed: ${event.name} step ${index+1}`);
 }

 const response=await fetch(`https://intervals.icu/api/v1/athlete/0/events/${event.id}/download.fit`,{
  headers:{Authorization:`Basic ${Buffer.from(`API_KEY:${config.INTERVALS_API_KEY}`).toString('base64')}`},
  signal:AbortSignal.timeout(30000),
 });
 if(!response.ok)throw new Error(`FIT export failed for ${event.name} (${response.status})`);
 const fit=Buffer.from(await response.arrayBuffer());
 const pool=readFitWorkoutMetadata(fit)[0];
 const rawFitSteps=readFitWorkoutSteps(fit);
 const fitSteps=expandFitWorkoutSteps(rawFitSteps);
 const fitRepeats=rawFitSteps.filter(step=>step.durationType===6);
 if(pool?.poolLengthUnit!=='yards' || Math.abs(pool.poolLengthMeters-25*.9144)>.01)throw new Error(`FIT pool verification failed: ${event.name}`);
 if(fitSteps.length!==expected.length || JSON.stringify(fitRepeats.map(step=>step.targetValue))!==JSON.stringify(expectedRepeats.map(group=>group.reps)))throw new Error(`FIT repeat verification failed: ${event.name}`);
 const work=fitSteps.filter(step=>step.durationType===1),rests=fitSteps.filter(step=>step.intensity===1);
 if(work.length!==expected.filter(step=>step.intensity!=='rest').length || rests.length!==expected.filter(step=>step.intensity==='rest').length)throw new Error(`FIT work/rest verification failed: ${event.name}`);
 if(work.some(step=>step.targetType!==0) || rests.some(step=>step.durationType!==0))throw new Error(`FIT target verification failed: ${event.name}`);
 results.push({id:event.id,date:String(event.start_date_local).slice(0,10),name:event.name,steps:actual.length,repeats:actualRepeats.map(group=>group.reps),yards:actual.reduce((sum,step)=>sum+(step.distance || 0),0),fitSteps:fitSteps.length});
}

console.log(JSON.stringify({apply,today,count:results.length,results},null,2));
