import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createSupabaseSettingsStore} from '../lib/settings-store.mjs';
import {createIntervalsClient,fetchIntervalsContext} from '../lib/intervals.mjs';
import {createContextStore} from '../lib/supabase-context.mjs';
import {createCompletedWorkoutStore} from '../lib/completed-workout-store.mjs';
import {loadActivityBundle} from '../lib/activity-bundle.mjs';
import {athleteLocalDate} from '../lib/coach-training-context.mjs';
import {persistTrainingContext} from '../server.mjs';

const bootstrap=JSON.parse(await fs.readFile(new URL('../config.json',import.meta.url),'utf8'));
const config={...bootstrap,...await createSupabaseSettingsStore(bootstrap).read()};
const request=createIntervalsClient(config),store=createContextStore(config);
if(!store.ready)throw new Error('Supabase must be configured before backfilling');
const athlete=await request('/athlete/0');
const today=athleteLocalDate(new Date(),athlete.timezone || 'America/Chicago');
const newest=new Date(Date.parse(`${today}T12:00:00Z`)+60*86400000).toISOString().slice(0,10);
const context=await fetchIntervalsContext(request,{range:{start:'1900-01-01',end:newest}});
const archive=createCompletedWorkoutStore(config,store);
await archive.saveWorkouts(context);
const completed=[...new Map([...(context.history || []),...(context.planned || [])].filter(w=>w.completed && w.activity_id).map(w=>[String(w.activity_id),w])).values()];
const report={completed:completed.length,archived:0,originalFiles:0,fitFiles:0,originalBytes:0,compressedBundleBytes:0,wellnessDays:context.wellness_history.length,unavailableStreams:[],unavailableFiles:[],failures:[]};
context.archived_activity_versions={};
console.log(JSON.stringify({step:'start',completed:completed.length,wellnessDays:report.wellnessDays}));
for(let offset=0;offset<completed.length;offset+=2){
  await Promise.all(completed.slice(offset,offset+2).map(async workout=>{
    const id=String(workout.activity_id);
    try{
      const bundle=await loadActivityBundle(archive,config,request,id);
      report.archived++;
      report.compressedBundleBytes+=gzipSync(JSON.stringify(bundle)).length;
      if(bundle.original_file){report.originalFiles++;report.originalBytes+=bundle.original_file.bytes;if(bundle.original_file.type==='fit')report.fitFiles++;}
      else report.unavailableFiles.push(id);
      if(!bundle.availability.streams)report.unavailableStreams.push(id);
      context.archived_activity_versions[id]=createHash('sha256').update(JSON.stringify(workout.raw_activity || workout.completed_data || {})).digest('hex');
    }catch(error){report.failures.push({id,error:error.message});}
  }));
  console.log(JSON.stringify({step:'progress',processed:Math.min(offset+2,completed.length),archived:report.archived,failures:report.failures.length}));
}
await persistTrainingContext(config,context,{archiveActivities:false});
console.log(JSON.stringify({step:'complete',...report}));
if(report.failures.length)process.exitCode=1;
