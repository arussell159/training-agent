import {createHash} from 'node:crypto';
import {providerConnection} from './completed-workout-store.mjs';
import {athleteLocalDate} from './coach-training-context.mjs';
import {intervalsOnlyContext} from './intervals-only-context.mjs';
import {elapsedSummary} from './elapsed-summary.mjs';

export const fastViewId = (config,scope='full') => `view:v1:${providerConnection(config)}:${scope==='week'?'startup':'training'}`;
export function projectTrainingContext(context,scope='week',now=new Date()) {
  context=intervalsOnlyContext(context);
  const today=athleteLocalDate(now,context.athlete?.time_zone || 'America/Chicago');
  const date=new Date(`${today}T12:00:00Z`);date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
  const shift=days=>new Date(date.getTime()+days*86400000).toISOString().slice(0,10);
  const sessions=[...new Map([...(context.history || []),...(context.planned || [])].map(w=>[String(w.id),w])).values()]
    .map(({raw,raw_activity,...workout})=>({...workout,
      ...(workout.workout_summary?{workout_summary:{...workout.workout_summary,
        planned:workout.workout_summary.planned?{...workout.workout_summary.planned,elapsed_time_seconds:workout.workout_summary.planned.duration_seconds,elapsed_speed:workout.workout_summary.planned.average_speed}:null,
        completed:workout.workout_summary.completed?{...workout.workout_summary.completed,...(raw_activity?elapsedSummary(raw_activity):{})}:null}}:{}),
      recorded_start_local:raw_activity?.start_date_local || workout.recorded_start_local || null,
      device_name:typeof raw_activity?.device_name==='string'?raw_activity.device_name:workout.device_name || null,
      activity_revision:raw_activity?createHash('sha256').update(JSON.stringify(raw_activity)).digest('hex'):workout.activity_revision,...(!workout.completed?{status:workout.workout_date===today?'today':'upcoming'}:{})}));
  const history=sessions.filter(w=>w.workout_date<=today && (scope==='full'||w.workout_date>=shift(-14)));
  const planned=sessions.filter(w=>w.workout_date>=today && (scope==='full'||w.workout_date<=shift(13)));
  const athlete=Object.fromEntries(Object.entries(context.athlete || {}).filter(([key])=>!['sport_settings','thresholds'].includes(key)));
  return {athlete,metrics:context.metrics,wellness:context.wellness,
    history,planned,wellness_history:(context.wellness_history || []).filter(w=>scope==='full'||w.date>=shift(-30)).map(row=>Object.fromEntries(Object.entries(row).filter(([key,value])=>value!=null && (typeof value!=='object'||key==='details')))),
    performance:(context.performance || []).filter(w=>scope==='full'||w.workoutDay>=shift(-30)).map(w=>({workoutDay:w.workoutDay,ctl:w.ctl,atl:w.atl,tsb:w.tsb})),
    cached_ranges:context.cached_ranges || [],synced_at:context.synced_at,source:'supabase-cache',
    display_range:scope==='week'?{start:shift(-14),end:shift(13)}:{start:'0000-01-01',end:'9999-12-31'},
    cache_scope:context.cache_scope || context.provider_connection || '',version:context.version || context.synced_at,
  };
}
export async function saveFastView(config,store,context) {
  const full=projectTrainingContext({...context,provider_connection:providerConnection(config)},'full');
  full.version=createHash('sha256').update(JSON.stringify({...full,synced_at:undefined,version:undefined})).digest('hex');
  const week=projectTrainingContext(full,'week');week.version=full.version;
  await store.upsert('sync_state',[
    {athlete_id:fastViewId(config),status:'view',cursor:full,updated_at:new Date().toISOString()},
    {athlete_id:fastViewId(config,'week'),status:'view',cursor:week,updated_at:new Date().toISOString()},
  ]);
  return full;
}
