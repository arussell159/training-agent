import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createSupabaseSettingsStore} from '../lib/settings-store.mjs';
import {createIntervalsClient} from '../lib/intervals.mjs';

export const plannedWorkoutNames=new Map([
 [136493892,'Bike 3x5min Race Power'],[136494149,'Brick Run 5min Race Pace'],
 [136494156,'Run 3x6min Threshold'],[136494162,'Swim 12x100 CSS'],
 [136494173,'Bike Race Rehearsal'],[136494178,'Brick Run 20min Race Pace'],
 [136494180,'Run 3x15min Race Pace'],[136494189,'Swim 2x800 Race Rhythm'],
 [136494192,'Bike 4x3min Race Power Surges'],[136494199,'Brick Run 8min Race Pace'],
 [136494203,'Run 6-5-4-3min Progression'],[136494210,'Swim 6x150 Sighting'],
 [136494214,'Aerobic Run'],[136494222,'Bike Progressive Race Power'],
 [136494231,'Brick Run 12min Race Pace'],[136494236,'Run 2x20min Progressive Race Pace'],
 [136494247,'Swim 6x100 Strong'],[136494254,'Bike Race-Week Openers'],
 [136494264,'Brick Run 4min Race Pace'],[136494276,'Run 3x3min Race Pace'],
 [136494286,'Swim 6x50 CSS Openers'],[136494294,'Bike 3x1min Race-Week Openers'],
 [136494306,'Run 3x20s Race-Week Openers'],
]);

const fingerprint=event=>JSON.stringify({description:event.description,workout_doc:event.workout_doc,moving_time:event.moving_time,distance:event.distance,start_date_local:event.start_date_local,type:event.type});
export async function renamePlannedWorkouts(request,now='2026-09-16'){
 const events=await request(`/athlete/0/events?oldest=${now}&newest=2027-09-16`);
 const planned=events.filter(event=>event.category==='WORKOUT');
 const unknown=planned.filter(event=>!plannedWorkoutNames.has(event.id));
 if(unknown.length)throw Error(`Unclassified planned workouts: ${unknown.map(event=>event.id).join(', ')}`);
 const missing=[...plannedWorkoutNames.keys()].filter(id=>!planned.some(event=>event.id===id));
 if(missing.length)throw Error(`Expected planned workouts not found: ${missing.join(', ')}`);
 const changed=[];
 for(const event of planned){
  const name=plannedWorkoutNames.get(event.id);if(event.name===name)continue;
  const before=fingerprint(event);
  await request(`/athlete/0/events/${event.id}`,{method:'PUT',body:JSON.stringify({name})});
  const verified=await request(`/athlete/0/events/${event.id}`);
  if(verified.name!==name)throw Error(`Intervals.icu did not confirm name for ${event.id}`);
  if(fingerprint(verified)!==before)throw Error(`Workout content changed while renaming ${event.id}`);
  changed.push({id:event.id,date:String(event.start_date_local).slice(0,10),from:event.name,to:name});
 }
 return {planned:planned.length,changed};
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const bootstrap=JSON.parse(await fs.readFile('app-backend/config.json','utf8'));
 const config={...bootstrap,...await createSupabaseSettingsStore(bootstrap).read()};
 console.log(JSON.stringify(await renamePlannedWorkouts(createIntervalsClient(config)),null,2));
}
