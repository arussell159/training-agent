import fs from 'node:fs/promises';
import {createSupabaseSettingsStore} from './settings-store.mjs';
import {createIntervalsClient} from './intervals.mjs';
import {athleteLocalDate} from './coach-training-context.mjs';
import {DEVICE_DEFINITION_MARKER} from './race-plan-import.mjs';
import {readFitWorkoutSteps,expandFitWorkoutSteps} from './fit-workout-verification.mjs';

export const swimDescription=`**Warm Up:**
1 x (300 yd freestyle Z1–Z2 + 0 secs rest)
2 x (50 yd drill Z2 + 50 yd swim Z2 + 0 secs rest)

**Main Set:**
4 x (50 yd freestyle build Z2–Z4 + 15 secs rest)
3 x (400 yd freestyle Z3 + 30 secs rest)
8 x (100 yd freestyle Z4 + 15 secs rest)

**Warm Down:**
1 x (200 yd freestyle Z1–Z2 + 0 secs rest)

Rest is seconds on the wall, not a send-off. Unlisted pauses remain continuous. Total: 2,900 yd. Source planned duration: 54:25; source planned TSS: 63.`;

export const swimDefinition=`Pool length: 25y

Warm Up
- Freestyle 300y Z1-Z2 Pace intensity=warmup

2x
- Drill 50y Z2 Pace
- Swim 50y Z2 Pace

Main Set 4x
- Freestyle build 50y Z2-Z4 Pace
- Rest 15s intensity=rest

Main Set 3x
- Freestyle 400y Z3 Pace
- Rest 30s intensity=rest

Main Set 8x
- Freestyle 100y Z4 Pace
- Rest 15s intensity=rest

Warm Down
- Freestyle 200y Z1-Z2 Pace intensity=cooldown`;

export async function buildTodaysSwim(){
 const bootstrap=JSON.parse(await fs.readFile('app-backend/config.json','utf8'));
 const store=createSupabaseSettingsStore(bootstrap),config={...bootstrap,...await store.read()},request=createIntervalsClient(config);
 const athlete=await request('/athlete/0'),today=athleteLocalDate(new Date(),athlete.timezone || 'America/Chicago');
 const external_id=`alex-waco-plan:${today}:Swim:2900-aerobic-css`;
 const events=await request(`/athlete/0/events?oldest=${today}&newest=${today}`),existing=events.find(e=>e.external_id===external_id);
 const payload={category:'WORKOUT',type:'Swim',name:'Aerobic Swim with Strong Repeats',start_date_local:today+'T00:00:00',external_id,description:swimDescription+DEVICE_DEFINITION_MARKER+swimDefinition};
 const created=await request(existing?`/athlete/0/events/${existing.id}`:'/athlete/0/events',{method:existing?'PUT':'POST',body:JSON.stringify(payload)});
 const verified=await request(`/athlete/0/events/${created.id}`);
 const expand=steps=>steps.flatMap(s=>s.steps?Array.from({length:s.reps},()=>expand(s.steps)).flat():[s]);
 const steps=expand(verified.workout_doc?.steps || []);
 const distance=steps.reduce((sum,s)=>sum+(s.distance || 0),0),rests=steps.filter(s=>s.intensity==='rest');
 if(Math.abs(distance-2900*.9144)>.01 || rests.length!==15 || rests.reduce((sum,s)=>sum+s.duration,0)!==270)throw new Error('Swim structure verification failed');
 if(steps.filter(s=>s.distance).some(s=>!s.pace))throw new Error('Swim pace targets missing');
 await request(`/athlete/0/events/${created.id}`,{method:'PUT',body:JSON.stringify({moving_time:3265,icu_training_load:63})});
 const response=await fetch(`https://intervals.icu/api/v1/athlete/0/events/${created.id}/download.fit`,{headers:{Authorization:`Basic ${Buffer.from('API_KEY:'+config.INTERVALS_API_KEY).toString('base64')}`},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Swim FIT export failed (${response.status})`);
 const fitSteps=expandFitWorkoutSteps(readFitWorkoutSteps(Buffer.from(await response.arrayBuffer())));
 const fitDistance=fitSteps.filter(s=>s.durationType===1).reduce((sum,s)=>sum+s.durationValue/100,0);
 const fitRest=fitSteps.filter(s=>s.intensity===1);
 if(Math.abs(fitDistance-distance)>.01 || fitRest.length!==15 || fitRest.some(s=>s.durationType!==0) || fitSteps.filter(s=>s.durationType===1).some(s=>s.targetType===2))throw new Error('Swim FIT units/targets verification failed');
 const report=JSON.parse((await store.read()).RACE_PLAN_IMPORT_REPORT || '{}');
 await store.save({RACE_PLAN_IMPORT_REPORT:JSON.stringify({...report,additional_workouts:[...(report.additional_workouts || []).filter(w=>w.id!==created.id),{id:created.id,date:today,name:payload.name,yards:2900,fit_steps:fitSteps.length}]})});
 return {id:created.id,date:today,name:payload.name,yards:2900,restSeconds:270,fitSteps:fitSteps.length};
}
