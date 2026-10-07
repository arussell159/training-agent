import { readWorkoutLibrary, saveLibraryWorkout } from "./lib/workout-library.mjs";
import { previewConfig } from './lib/local-preview.mjs';
import { createFatSecretDiary } from './lib/fatsecret-diary.mjs';
import { createFatSecretDiaryStore } from './lib/fatsecret-diary-store.mjs';
import { createFoodCatalog } from './lib/nutrition-fatsecret.mjs';
import {athleteLocalDate} from './lib/athlete-date.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createWebhookSync, freshWebhookState, secretMatches } from './lib/intervals-webhook.mjs';
import { createIntervalsOAuth, freshIntervalsOAuth, intervalsOrigin } from './lib/intervals-oauth.mjs';
import { cachedTrainingUpdates } from './lib/cached-training-updates.mjs';
import { createTrainingLive } from './lib/training-live.mjs';
import { createCoachHttp } from './lib/coach-http.mjs';
import { createNutritionHttp } from './lib/nutrition-http.mjs';
import { createNutritionStore } from './lib/nutrition-model.mjs';
import { localNutritionRecords } from './lib/nutrition-local-store.mjs';
import { createCoachCalendar } from './lib/coach-calendar.mjs';
import { createEncryptedRecordStore } from './lib/app-auth-store.mjs';
import { createAppAuth } from './lib/app-auth.mjs';
import { coachConfig, createCoach } from './lib/github-coach.mjs';
import { createGithubCoachSource } from './lib/github-coach-source.mjs';
import { createWorkoutSync, freshWorkoutSync } from './lib/coach-workout-sync.mjs';
import { waitUntil } from '@vercel/functions';
import { runSection11DirectSync, section11WorkerOrigin } from './lib/section11-direct-sync.mjs';
import { createSection11Sync, freshSection11Sync } from './lib/section11-sync.mjs';
import { createCoachReports, createReportSnapshotCache, freshReport } from './lib/coach-reports.mjs';
import { createReportsHttp } from './lib/coach-reports-http.mjs';
import { createCoachReportStore } from './lib/coach-report-store.mjs';
import { createCoachReportCatalog } from './lib/coach-report-migration.mjs';
import { fetchIntervalsReportCatalog } from './lib/intervals-report-catalog.mjs';
import { fileURLToPath } from 'node:url';
import { createContextStore } from './lib/supabase-context.mjs';
import {createCompletedWorkoutStore,providerConnection,mergeTrainingSnapshot,snapshotCoversRange} from './lib/completed-workout-store.mjs';
import { createSettingsService, publicSettings, STORED_SETTINGS } from './lib/settings-store.mjs';
import { resolveApiRoute } from './lib/api-routing.mjs';
import {intervalsOnlyContext} from './lib/intervals-only-context.mjs';
import {readDurableState,writeDurableState} from './lib/durable-state.mjs';
import {loadActivityBundle,loadActivityView} from './lib/activity-bundle.mjs';
import {saveFastView,fastViewId,projectTrainingContext} from './lib/fast-context.mjs';
import {retainRecentTrainingContext,twelveWeekStart} from './lib/training-retention.mjs';
import {buildTwelveWeekTrainingHistory} from './lib/training-history.mjs';
import {fetchHistoricalCalendar,fetchWorkoutHistoryPage,fetchHistoricalWorkout} from './lib/intervals-history.mjs';
import {createMutationQueue,validateMutation} from './lib/mutation-queue.mjs';
import {createMutationProjection} from './lib/mutation-projection.mjs';
import {withDirectWorkoutWrite,reconcileDirectWorkoutWrite} from './lib/direct-workout-write.mjs';
import {preserveQueuedSnapshot} from './lib/queued-snapshot.mjs';
import {createRequestCache} from './lib/request-cache.mjs';
import {compressAsset} from './lib/asset-compression.mjs';
import {createTrainingUpdates} from './lib/training-updates.mjs';
import {contentFingerprint} from './lib/content-fingerprint.mjs';
import {updateWorkoutDescription,DEFINITION_MARKER} from './lib/workout-description.mjs';
import {loadWorkoutEditor,saveWorkoutEditor,loadNewWorkoutEditor,createWorkoutEditor,workoutRevision} from './lib/workout-editor.mjs';
import {expandSteps,stepMetrics,workoutTotals,serializeWorkout,validateWorkout,distanceFactors} from './lib/workout-editor-model.mjs';
import {applyCompletionConfirmation} from './lib/completion-confirmation.mjs';
import {duplicateAnnualPlan,generateAnnualPlan,mergeRegeneratedPlan,recordPlanRevision,rollAnnualPlan} from './lib/annual-plan.mjs';
import {
  addLocalComment,
  deleteAnnualPlanRecord,
  listAnnualPlans,
  readLocalContext,
  saveAnnualPlanRecord,
  updateTrainingPreferences,
} from './lib/local-context.mjs';
import { createIntervalsClient, fetchIntervalsContext, moveIntervalsEvent, changeIntervalsEvent, createIntervalsRaceEvent, updateIntervalsRaceEvent, updateIntervalsTrainingZones, mapIntervalsWorkout, validDate } from './lib/intervals.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'config.json');
const localNutrition = createNutritionStore(localNutritionRecords(path.join(__dirname, 'nutrition-preview')));
const nutritionCatalog = createFoodCatalog();
const fatSecretDiary = createFatSecretDiary({catalog:nutritionCatalog});
const localFatSecretNutrition = createFatSecretDiaryStore({local:localNutrition,diary:fatSecretDiary,record:localNutritionRecords(path.join(__dirname,'nutrition-preview','fatsecret-sync'))});
const handleNutrition = createNutritionHttp({ catalog:nutritionCatalog, getStore: async req => {
  if (process.env.NUTRITION_LOCAL_PREVIEW === 'true' && !process.env.VERCEL) return fatSecretDiary.configured() ? localFatSecretNutrition : localNutrition;
  const bootstrap = await readBootstrapConfig();
  return createNutritionStore((key, fresh) => createEncryptedRecordStore(bootstrap, `${req.headers.host}/nutrition/${key}`, {
    namespace: 'nutrition', name: 'NUTRITION', fresh, timestampCas: true, readCacheMs: 15_000,
  }));
} });
const handleCoach = createCoachHttp({ getCalendar: async (req, config) => createCoachCalendar({
  config,
  store: createEncryptedRecordStore(await readBootstrapConfig(), `${req.headers.host}/${config.repo}@${config.branch}`, {
    namespace: 'coach-calendar', name: 'COACH_CALENDAR', fresh: () => ({ proposals: [] }), timestampCas: true,
  }),
}) });
const handleAuth = createAppAuth({ readBootstrap: readBootstrapConfig });
let reportServices;
let reportSweep;
function triggerDueReports(config) {
  if (reportSweep) return reportSweep;
  reportSweep = getReportServices(config).then((services) => services?.reports.generateDue()).catch(() => {}).finally(() => { reportSweep = null; });
  return reportSweep;
}
async function getReportServices(config = coachConfig()) {
  if (!config.githubToken || !config.repo) return null;
  const bootstrap = await readBootstrapConfig();
  const identity = `${config.repo}@${config.branch}`;
  const signature = createHash('sha256').update(JSON.stringify([config,bootstrap])).digest('hex');
  if (reportServices?.signature === signature) return reportServices;
  const storage = (namespace, name, fresh, key = '') => createEncryptedRecordStore(bootstrap, `${identity}/${key}`, { namespace, name, fresh, timestampCas: true });
  const source = createGithubCoachSource();
  const snapshotCache = createReportSnapshotCache(source, config);
  const sync = createWorkoutSync({
    config,
    store: storage('coach-sync', 'COACH_WORKOUT_SYNC', freshWorkoutSync),
    onFinished: async () => {
      snapshotCache.invalidate();
      if (reportServices?.reports) await reportServices.reports.generateDue().catch(() => {});
    },
  });
  const reports = createCoachReports({ config, source, snapshotCache,
    record: key => storage('coach-report', 'COACH_REPORT', freshReport, key),
    index: storage('coach-report-index', 'COACH_REPORT_INDEX', () => ({ reports: [] })),
    readContext: async () => loadSupabaseTrainingSnapshot(await readConfig()), readPlans: listAnnualPlans,
    saveReport: input => createCoachReportStore(bootstrap).upsert(input),
    answer: createCoach({ source }),
  });
  reportServices = { signature, sync, reports, snapshotCache };
  return reportServices;
}
async function appReportStore() {
  return createCoachReportStore(await readBootstrapConfig());
}
async function appReportCatalog() {
  const bootstrap = await readBootstrapConfig();
  const config = coachConfig();
  const marker = createEncryptedRecordStore(bootstrap, `${config.repo}@${config.branch}`, {
    namespace: 'coach-report-migration', name: 'COACH_REPORT_MIGRATION',
    fresh: () => ({ complete: false }), timestampCas: true,
  });
  const catalog = createCoachReportCatalog({
    store: createCoachReportStore(bootstrap), marker,
    legacySaved: async () => {
      const services = await getReportServices(config);
      if (!services) throw Error('The legacy report connection is unavailable.');
      return services.reports.savedReports();
    },
    legacyNotes: async () => fetchIntervalsReportCatalog(intervalsClient(await readConfig())),
  });
  return catalog.list();
}
const handleReports = createReportsHttp({
  getReports: async config => (await getReportServices(config)).reports,
  getCatalog: appReportCatalog,
  getStore: appReportStore,
});
const uiDistPath = path.resolve(__dirname, '..', 'ui', 'dist');
const intervalsCachePath = path.join(process.env.VERCEL ? '/tmp' : __dirname, 'intervals.cache');
const localEditCacheFlagPath = path.join(__dirname, 'local-edit-cache.enabled');
let completionConfirmation=null;
let completionConfirmationPromise;
let localEditCacheOnDisk = false;
try { await fs.access(localEditCacheFlagPath); localEditCacheOnDisk = !process.env.VERCEL; } catch {}
async function loadCompletionConfirmation() {
  if (localEditCacheOnDisk) return;
  // Static assets, sign-in and prepared startup views must never wait on a
  // separate database request while the server module is loading.
  completionConfirmationPromise ||= readDurableState('COMPLETION_CONFIRMATION',path.join(__dirname,'completion-confirmation.cache'),null)
    .then(value=>{completionConfirmation=value;})
    .catch(error=>{updateLogs(`Completion confirmation unavailable: ${error.message}`);});
  await completionConfirmationPromise;
}

const serverState = {
  child: null,
  logs: [],
  pid: null,
};

let intervalsMemoryCache = null;
const providerReads=createRequestCache({ttl:60000,maxEntries:32});
const historicalReads=createRequestCache({ttl:15*60_000,maxEntries:96});
let recentActivityStatsCache = null;
let personalActivityStatsCache = null;
function sendJson(req,res,value,cacheControl='no-store'){
 const payload=compressAsset(Buffer.from(JSON.stringify(value)),'.js',req.headers['accept-encoding']);
 res.writeHead(200,{'Content-Type':'application/json','Cache-Control':cacheControl,...payload.headers});res.end(payload.body);
}
function sendWebhookJson(res,status,value) {
 res.writeHead(status,{
  'Content-Type':'application/json',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
 });
 res.end(JSON.stringify(value));
}
async function handleIntervalsWebhook(req,res) {
 if(req.method!=='POST') {
  sendWebhookJson(res,405,{error:'Method not allowed'});
  return;
 }
 const config=await readConfig();
 const expectedSecret=config.INTERVALS_WEBHOOK_SECRET;
 if(!expectedSecret) {
  sendWebhookJson(res,503,{error:'Intervals.icu webhook is not configured.'});
  return;
 }
 const payload=await readBody(req);
 if(!secretMatches(payload?.secret,expectedSecret) || (config.INTERVALS_WEBHOOK_AUTHORIZATION && !secretMatches(req.headers.authorization,config.INTERVALS_WEBHOOK_AUTHORIZATION))) {
  sendWebhookJson(res,401,{error:'Invalid webhook secret'});
  return;
 }
 if(!Array.isArray(payload?.events) || payload.events.length>100) {
  sendWebhookJson(res,400,{error:'Invalid webhook events'});
  return;
 }
 try {
  if(!config.INTERVALS_API_KEY) {
   sendWebhookJson(res,503,{error:'Connect Intervals.icu in app Settings before enabling webhook refreshes.'});
   return;
  }
  const view=await createContextStore(config).getSyncRecord(fastViewId(config));
  const athleteId=view?.athlete?.id || (await createIntervalsClient(config)('/athlete/0')).id;
  const sync=webhookSync(config);
  const accepted=await sync.accept(payload.events,athleteId);
  if(accepted.accepted || accepted.duplicate)scheduleTrainingReconciliation(config);
  sendWebhookJson(res,202,{ok:true,...accepted});
 } catch(error) {
  updateLogs(`Intervals.icu webhook refresh failed: ${error.message}`);
  sendWebhookJson(res,500,{error:'Webhook refresh failed; Intervals.icu can retry this delivery.'});
 }
}
function intervalsClient(config){
 const account=createHash('sha256').update(config.INTERVALS_API_KEY || '').digest('hex');
 return providerReads.wrap(createIntervalsClient(config),account);
}

const CONFIG_ENV_KEYS = [
  'INTERVALS_API_KEY',
  'INTERVALS_CLIENT_ID',
  'INTERVALS_CLIENT_SECRET',
  'INTERVALS_WEBHOOK_SECRET',
  'INTERVALS_WEBHOOK_AUTHORIZATION',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SETTINGS_ENCRYPTION_KEY',
  'SETTINGS_SCOPE',
];

const settingsService = createSettingsService({
  readBootstrap:readBootstrapConfig,
  writeBootstrap:writeBootstrapConfig,
  hosted:Boolean(process.env.VERCEL),
});

function mergeEnvironmentConfig(config = {}) {
  const environment = Object.fromEntries(
    CONFIG_ENV_KEYS.filter(key => typeof process.env[key] === 'string' && process.env[key]).map(key => [key, process.env[key]])
  );
  // Local Settings edits must survive inherited stale environment credentials.
  // Hosted deployments still use their explicitly configured environment.
  return previewConfig(process.env.VERCEL ? { ...config, ...environment } : { ...environment, ...config });
}

function stableUuid(value) {
  const hex = createHash('sha256').update(String(value)).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;
}

const checkTrainingUpdates = createTrainingUpdates({
  readSnapshot: (config,options)=>loadSupabaseTrainingSnapshot(config,null,options),
  // These few small reads must see a workout uploaded just before app open.
  request: config => createIntervalsClient(config),
  persist: (config, context) => {providerReads.clear();historicalReads.clear();return persistTrainingContext(config, context, {archiveActivities:false});},
  warm: warmRecentActivities,
  exportGithub: ensureSection11Export,
  waitUntil,
  log: updateLogs,
});
function webhookSync(config) {
  return createWebhookSync({
    store:createEncryptedRecordStore(config,providerConnection(config),{
      namespace:'intervals-webhook',name:'INTERVALS_WEBHOOK',fresh:freshWebhookState,timestampCas:true,
    }),
    refresh:({hints}={})=>checkTrainingUpdates(config,{durable:true,full:true,hints}),
  });
}
const reconciliationTasks=new Map();
function scheduleTrainingReconciliation(config) {
  if(!config.INTERVALS_API_KEY || !config.SUPABASE_URL || !config.SUPABASE_SECRET_KEY)return;
  const key=providerConnection(config);
  if(reconciliationTasks.has(key))return;
  const task=Promise.resolve().then(async()=>{
    // Short transient failures retry within the same durable server invocation,
    // even if the browser is closed. Bound retries well below Vercel's deadline.
    const sync=webhookSync(config);
    for(let attempt=0;attempt<3;attempt++) {
      const result=await sync.drain();
      if(!result?.retryAt || attempt===2)break;
      const delay=Math.max(0,result.retryAt-Date.now());
      if(delay>30_000)break;
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  })
    .catch(()=>updateLogs('Background Intervals.icu reconciliation will retry on the next app check.'))
    .finally(()=>reconciliationTasks.delete(key));
  reconciliationTasks.set(key,task);
  waitUntil(task);
}
function intervalsOAuth(config,req) {
  const origin=intervalsOrigin(process.env,req);
  return createIntervalsOAuth({config,origin,
    store:createEncryptedRecordStore(config,`${origin}:${providerConnection(config)}:${config.INTERVALS_CLIENT_ID || ''}`,{
      namespace:'intervals-oauth',name:'INTERVALS_OAUTH',fresh:freshIntervalsOAuth,timestampCas:true,
    }),
    athlete:()=>createIntervalsClient(config)('/athlete/0'),
  });
}
const warmedActivities=new Map();
async function warmRecentActivities(config, context) {
  const archive=createCompletedWorkoutStore(config,createContextStore(config));
  const workouts=[...new Map([...context.history,...context.planned]
    .filter(w=>w.completed && w.activity_id).map(w=>[String(w.activity_id),w])).values()]
    .sort((a,b)=>b.workout_date.localeCompare(a.workout_date)).slice(0,4);
  for(let i=0;i<workouts.length;i+=2)await Promise.all(workouts.slice(i,i+2).map(async workout=>{
    const key=`${providerConnection(config)}:${workout.activity_id}:${valueFingerprint(workout.raw_activity || {})}`;
    if(warmedActivities.has(key))return;
    try {await loadActivityView(archive,config,intervalsClient(config),String(workout.activity_id),'analysis',{revision:valueFingerprint(workout.raw_activity || {})});warmedActivities.set(key,true);if(warmedActivities.size>32)warmedActivities.delete(warmedActivities.keys().next().value);}
    catch(error){updateLogs(`Recording preparation pending: ${error.message}`);}
  }));
}

function valueFingerprint(value) {
  return contentFingerprint(value);
}

function trainingContextFingerprint(context) {
  const { synced_at, sync_started_at, source, ...stable } = context || {};
  return valueFingerprint(stable);
}

function trainingSourceFingerprint(context) {
  return valueFingerprint(Object.fromEntries(
    ['athlete','metrics','wellness','history','planned','wellness_history','performance']
      .map(key=>[key,context?.[key] || null])
  ));
}

function withZoneHistory(previous,incoming) {
  const keys=['bike_ftp','run_threshold_pace','swim_css','threshold_hr'];
  const clean=zones=>Object.fromEntries(keys.map(key=>[key,zones?.[key] ?? null]));
  const present=zones=>keys.some(key=>zones[key]!=null && zones[key]!=='');
  const same=(a,b)=>keys.every(key=>(a?.[key] ?? null)===(b?.[key] ?? null));
  const current=clean(incoming.athlete?.zones);
  if(!present(current))return incoming;
  const history=[...(previous?.athlete?.zone_history || [])];
  const add=(zones,recordedAt)=>{
    const value=clean(zones);
    if(!present(value)||same(history.at(-1),value))return;
    history.push({...value,recorded_at:recordedAt || new Date().toISOString()});
  };
  if(!history.length&&previous?.athlete?.zones)add(previous.athlete.zones,previous.synced_at);
  add(current,incoming.synced_at);
  return {...incoming,athlete:{...incoming.athlete,zone_history:history.slice(-50)}};
}

export async function persistTrainingContext(config, context, {archiveActivities=true} = {}) {
  const store = createContextStore(config, updateLogs);
  if (!store.ready) return {contextChanged:false};
  const previous=await loadSupabaseTrainingSnapshot(config,context.athlete?.id);
  context=withZoneHistory(previous,context);
  context=retainRecentTrainingContext(mergeTrainingSnapshot(previous,context));
  const contextChanged = !previous || trainingContextFingerprint(previous) !== trainingContextFingerprint(context);
  const sourceChanged = !previous || trainingSourceFingerprint(previous) !== trainingSourceFingerprint(context);
  const archive=createCompletedWorkoutStore(config,store);
  await archive.saveWorkouts(context,{previousContext:previous});
  const activeActivityIds=new Set([...context.history,...context.planned].map(workout=>String(workout.activity_id || '')).filter(Boolean));
  const archivedVersions=Object.fromEntries(Object.entries({...(previous?.archived_activity_versions || {}),...(context.archived_activity_versions || {})}).filter(([id])=>activeActivityIds.has(id)));
  if(archiveActivities){
    const completed=[...new Map([...(context.history || []),...(context.planned || [])].filter(w=>w.completed && w.activity_id).map(w=>[String(w.activity_id),w])).values()];
    const pending=completed.filter(w=>archivedVersions[String(w.activity_id)]!==contentFingerprint(w.raw_activity || w.completed_data || {}));
    for(let offset=0;offset<pending.length;offset+=2)await Promise.all(pending.slice(offset,offset+2).map(async workout=>{
      const id=String(workout.activity_id);
      try{
        await archive.invalidateViews(id);
        await loadActivityBundle(archive,config,intervalsClient(config),id);
        archivedVersions[id]=contentFingerprint(workout.raw_activity || workout.completed_data || {});
      }catch(error){updateLogs(`Completed workout archive pending ${id}: ${error.message}`);}
    }));
  }
  const archiveStateChanged = valueFingerprint(archivedVersions) !== valueFingerprint(previous?.archived_activity_versions || {});
  const athleteId = String(context.athlete?.id || 'default');
  const workouts = [...(context.history || context.workouts || []), ...(context.planned || [])];
  const uniqueWorkouts = [...new Map(workouts.filter(item => item?.id && item?.workout_date).map(item => [String(item.id), item])).values()];
  const workoutRows = uniqueWorkouts.map(workout => ({
    id:String(workout.id), athlete_id:athleteId,
    workout_date:`${String(workout.workout_date).slice(0,10)}T12:00:00Z`,
    sport:workout.sport || null, title:workout.title || null,
    planned:workout.planned || { duration_minutes:workout.plannedDurationMinutes || 0, tss:workout.load || 0, description:workout.details || workout.goal || '' },
    completed:workout.completed_data || workout.completed || { duration_minutes:workout.actualDurationMinutes || 0 },
    recovery:workout.recovery || {}, compliance:workout.compliance ?? null,
    risk_level:workout.risk_level || null, failure_signals:workout.failure_signals || [],
    source_updated_at:workout.updated_at || context.synced_at || new Date().toISOString(),
    synced_at:new Date().toISOString(),
  }));
  const commentRows = (context.comments || []).filter(item => item?.body && ['pre','post'].includes(item.comment_type || item.type || 'post')).map(item => ({
    id:stableUuid(`comment:${item.id || `${item.workout_id}:${item.created_at}:${item.body}`}`),
    athlete_id:athleteId, workout_id:item.workout_id ? String(item.workout_id) : null,
    comment_type:['pre','post'].includes(item.comment_type || item.type) ? (item.comment_type || item.type) : 'post',
    body:String(item.body), created_at:item.created_at || new Date().toISOString(),
  }));
  const previousWorkouts = new Map(
    [...(previous?.history || []), ...(previous?.planned || [])]
      .filter(item => item?.id)
      .map(item => [String(item.id), valueFingerprint(item)])
  );
  const changedWorkoutRows = workoutRows.filter(row => {
    const workout = uniqueWorkouts.find(item => String(item.id) === row.id);
    return previousWorkouts.get(row.id) !== valueFingerprint(workout);
  });
  const previousComments = new Map(
    (previous?.comments || []).map(item => {
      const id = stableUuid(`comment:${item.id || `${item.workout_id}:${item.created_at}:${item.body}`}`);
      return [id, valueFingerprint({
        id,
        workout_id: item.workout_id ? String(item.workout_id) : null,
        comment_type: ['pre','post'].includes(item.comment_type || item.type) ? (item.comment_type || item.type) : 'post',
        body: String(item.body),
        created_at: item.created_at || null,
      })];
    })
  );
  const changedCommentRows = commentRows.filter(row => previousComments.get(row.id) !== valueFingerprint({
    id: row.id,
    workout_id: row.workout_id,
    comment_type: row.comment_type,
    body: row.body,
    created_at: row.created_at,
  }));
  if (changedWorkoutRows.length) await store.upsert('workout_context', changedWorkoutRows);
  if (changedCommentRows.length) await store.upsert('athlete_comments', changedCommentRows);
  const syncedAt = context.synced_at || new Date().toISOString();
  if (contextChanged || archiveStateChanged) {
    const savedSnapshot=await store.updateSyncRecord(athleteId,(current,revision)=>({
      athlete_id:athleteId,
      last_backfill_at:new Date().toISOString(),
      cursor:{
        context:{...preserveQueuedSnapshot(current?.cursor?.context?.provider_connection===providerConnection(config)?current.cursor.context:null,{
          provider:'intervals',
          provider_connection:providerConnection(config),
          queue_snapshot_revision:context.queue_snapshot_revision,
          cached_ranges:context.cached_ranges || [],
          history_revision:context.history_revision,
          history_revision_source_at:context.history_revision_source_at,
          archived_activity_versions:archivedVersions,
          app_deleted_workouts:context.app_deleted_workouts || {},
          sync_started_at:context.sync_started_at,
          athlete:context.athlete,
          metrics:context.metrics,
          wellness:context.wellness,
          wellness_history:context.wellness_history || [],
          performance:context.performance || [],
          history:context.history || context.workouts || [],
          planned:context.planned || [],
          comments:context.comments || [],
          library:context.library || [],
          synced_at:syncedAt,
          retention_days:90,
        }),queue_snapshot_revision:revision},
      },
      status:'ready',
      error:null,
      updated_at:new Date().toISOString(),
    }));
    context=savedSnapshot.cursor.context;
  }
  // Heal a partially failed earlier sync even when the provider content has not
  // changed. Equal snapshot revisions make existing view writes a no-op.
  await saveFastView(config,store,context);
  // Retention maintenance is throttled; unchanged checks should not issue writes.
  if (contextChanged && Date.now()-lastTrainingPruneAt>86400000) {
    lastTrainingPruneAt=Date.now();await store.prune();
  }
  return {contextChanged,sourceChanged};
}

async function loadSupabaseTrainingSnapshot(config, athleteId = null, {fresh=false}={}) {
  const store = createContextStore(config, updateLogs);
  if (!store.ready) return null;
  try {
    const preferredId = athleteId && athleteId !== 'default' ? String(athleteId) : null;
    const state = await store.getLatestSyncState(preferredId,{fresh});
    const snapshot = state?.cursor?.context;
    if (!snapshot || snapshot.provider !== 'intervals' || !Array.isArray(snapshot.history) || !Array.isArray(snapshot.planned)) return null;
    if (snapshot.provider_connection !== providerConnection(config)) return null;
    return { ...snapshot, source:'supabase-cache' };
  } catch (error) {
    updateLogs(`Supabase training snapshot read failed: ${error.message}`);
    return null;
  }
}

async function saveVerifiedSnapshot(config,context,{verifiedIds=[]}={}) {
  if(!context)throw Error('The workout was verified in Intervals.icu but the saved calendar is unavailable. Refresh before retrying.');
  const store=createContextStore(config,updateLogs);
  context=retainRecentTrainingContext({...context,provider_connection:providerConnection(config)});
  const saved=await store.updateSyncRecord(String(context.athlete.id),(current,revision)=>({
    status:'ready',cursor:{context:{...preserveQueuedSnapshot(current?.cursor?.context?.provider_connection===providerConnection(config)?current.cursor.context:null,context,{verifiedIds}),queue_snapshot_revision:revision}},
  }));
  return saveFastView(config,store,saved.cursor.context);
}

function applyVerifiedEvent(context,id,result,action) {
  const today=athleteLocalDate(new Date(),context.athlete?.time_zone || 'America/Chicago');
  const all=new Map([...context.history,...context.planned].map(w=>[w.id,w]));
  if(action==='delete'){all.delete(id);context={...context,app_deleted_workouts:{...context.app_deleted_workouts,[id]:new Date().toISOString()}};}
  else {
    const prior=action==='move'||action==='edit'?all.get(id):null;
    all.set(result.workoutId,{...mapIntervalsWorkout(result.event,today,prior?.raw_activity || null,false,context.athlete?.sport_settings || []),app_updated_at:new Date().toISOString()});
  }
  const sessions=[...all.values()].sort((a,b)=>a.workout_date.localeCompare(b.workout_date));
  return {...context,history:sessions.filter(w=>w.workout_date<=today),planned:sessions.filter(w=>w.workout_date>=today)};
}

const syncRequests=new Map();
const manualSyncProgress=new Map();
const section11DirectAvailable=()=>Boolean(process.env.VERCEL || process.env.SECTION11_DIRECT_SYNC_ORIGIN);
function setManualSyncProgress(id,progress) {
  if(!id)return;
  const now=Date.now();
  for(const [key,value] of manualSyncProgress)if(now-value.updatedAt>15*60_000)manualSyncProgress.delete(key);
  manualSyncProgress.set(id,{...progress,updatedAt:now});
}
let lastTrainingPruneAt=0;
async function syncSection11Files(config,athleteId,syncId,reportProgress) {
  reportProgress({phase:'github',requestId:syncId,status:'running',label:'Generating Section 11 files and committing them to GitHub',completed:0,total:1});
  let section11Sync;
  try {
    if(!section11DirectAvailable())throw Error('Section 11 direct sync requires the deployed Python function.');
    const github=coachConfig();
    const origin=section11WorkerOrigin();
    if(!origin)throw Error('Section 11 direct sync needs the deployed app URL.');
    section11Sync=await runSection11DirectSync({
        repo:github.repo,branch:github.branch,githubToken:github.githubToken,
        intervalsKey:config.INTERVALS_API_KEY,athleteId,
        weekStart:process.env.WEEK_START,zonePreference:process.env.ZONE_PREFERENCE,
        origin,
      });
    reportServices?.snapshotCache.invalidate();
    section11Sync={...section11Sync,requestId:syncId,label:'Section 11 files committed to GitHub'};
  } catch(error) {section11Sync={requestId:syncId,status:'failed',error:error.message};}
  reportProgress({phase:'github',requestId:syncId,status:section11Sync.status,label:section11Sync.status==='complete'?'Section 11 files committed to GitHub':'Section 11 direct sync failed',completed:section11Sync.status==='complete'?1:0,total:1,error:section11Sync.error || undefined});
  return section11Sync;
}
function section11SyncService(config) {
  const github=coachConfig();
  return createSection11Sync({
    store:createEncryptedRecordStore(config,`${providerConnection(config)}:${github.repo}@${github.branch}`,{
      namespace:'section11-export',name:'SECTION11_EXPORT',fresh:freshSection11Sync,timestampCas:true,
    }),
    run:async claim=>{
      const result=await syncSection11Files(config,claim.athleteId,claim.requestId,()=>{});
      if(result.status==='complete')void triggerDueReports(config);
      return result;
    },
    waitUntil,
  });
}
async function ensureSection11Export(config,context,{force=false,requestId=''}={}) {
  if(!section11DirectAvailable())return {status:'failed',error:'GitHub export requires the deployed sync worker.'};
  try {
    return await section11SyncService(config).ensure({
      version:context.version || trainingSourceFingerprint(context),athleteId:context.athlete.id,
      force,requestId:requestId || randomUUID(),
    });
  }catch(error){return {status:'failed',error:error.message};}
}
async function syncRecentTraining(config,{force=false,onProgress}={}) {
  const key=providerConnection(config);
  while(syncRequests.has(key)) {
    const current=syncRequests.get(key);
    if(!force)return current;
    onProgress?.({phase:'intervals',label:'Waiting for the current refresh to finish',completed:0,total:0});
    try{await current;}catch{}
  }
  const operation=(async()=>{
    const saved=await loadSupabaseTrainingSnapshot(config);
    const zone=saved?.athlete?.time_zone || 'America/Chicago';
    const today=athleteLocalDate(new Date(),zone),date=new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
    const shift=days=>new Date(date.getTime()+days*86400000).toISOString().slice(0,10);
    const historyRange={start:twelveWeekStart(new Date(),zone),end:today};
    const hasTwelveWeeks=saved && snapshotCoversRange(saved,historyRange);
    if(!force && hasTwelveWeeks && Date.now()-Date.parse(saved.synced_at)<60000){
      // Reuse the same content version as the fetch path. Projecting the raw
      // snapshot alone falls back to its timestamp and requests a duplicate export.
      const full=await createContextStore(config).getSyncRecord(fastViewId(config));
      return {context:projectTrainingContext(full || {...saved,provider_connection:key}),sourceChanged:false};
    }
    const range=saved?{start:hasTwelveWeeks?shift(-14):historyRange.start,end:shift(13)}:undefined;
    const incoming=await fetchIntervalsTrainingContext(config,{force:true,timeZone:zone,range,includeFutureRaces:true,repairWorkoutLinks:true,onProgress});
    onProgress?.({phase:'saving',label:'Saving refreshed training data',completed:0,total:1});
    const persisted=await persistTrainingContext(config,mergeTrainingSnapshot(saved,incoming,range),{archiveActivities:false});
    onProgress?.({phase:'saving',label:'Training data saved',completed:1,total:1});
    const full=await createContextStore(config).getSyncRecord(fastViewId(config));
    return {context:projectTrainingContext(full),sourceChanged:Boolean(persisted?.sourceChanged)};
  })();
  syncRequests.set(key,operation);
  try{return await operation;}finally{syncRequests.delete(key);}
}

async function flushMutations(config,retryFailed=false) {
  const store=createContextStore(config);
  const queue=createMutationQueue(config,store);
  const projection=createMutationProjection(config,store);
  const saveState=(mutation,status,result={},sequence)=>projection.status(mutation,status,result,sequence);
  return queue.drain(async(mutation,job)=>{
    const source=intervalsClient(config);
    let writeAttempted=false;
    const request=async(path,options={})=>{
      const writing=(options.method || 'GET').toUpperCase()!=='GET';
      if(writing)writeAttempted=true;
      try{return await source(path,options);}catch(error){
        if(!writeAttempted)error.beforeWrite=true;
        else if(writing && error.status>=400 && error.status<500)error.writeRejected=true;
        throw error;
      }
    };
    try {
      // A claim cannot reach the provider before its durable projection exists.
      try{await projection.pending(job);}catch(error){error.beforeWrite=true;throw error;}
      const result=mutation.type==='move'?await moveIntervalsEvent(request,mutation.id,mutation.date):await updateWorkoutDescription(request,mutation.id,mutation.description);
      await saveState(mutation,'synced',result,job.sequence);
    }catch(error){
      // Keep the durable optimistic edit visible while an uncertain outcome is
      // reconciled. An older claim never changes the status of a newer edit.
      await saveState(mutation,error.beforeWrite || error.writeRejected?'failed':'pending',{},job.sequence).catch(()=>{});
      throw error;
    }
  },{retryFailed,reconcileDirect:claim=>reconcileDirectWorkoutWrite(claim,createIntervalsClient(config)),reconcile:async(mutation,job)=>{
    // Manual refresh can confirm a timed-out edit; it cannot replay its write.
    const [kind,id]=mutation.id.split(':');
    const event=await createIntervalsClient(config)(kind==='event'?`/athlete/0/events/${id}`:`/activity/${id}`);
    const confirmed=mutation.type==='move'
      ?String(event.start_date_local || '').slice(0,10)===mutation.date
      :String(event.description || '').split(DEFINITION_MARKER)[0]===mutation.description;
    if(confirmed)await saveState(mutation,'synced',{event},job.sequence);
    return confirmed;
  }});
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function currentWeekRange(timeZone){
 const today=athleteLocalDate(new Date(),timeZone),date=new Date(`${today}T12:00:00Z`);
 date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));const start=date.toISOString().slice(0,10);
 date.setUTCDate(date.getUTCDate()+6);return {start,end:date.toISOString().slice(0,10)};
}

async function fetchIntervalsTrainingContext(config, {force = false, timeZone = 'America/Chicago', range, includeFutureRaces = false, repairWorkoutLinks = false, onProgress} = {}) {
  if (!config.INTERVALS_API_KEY) throw new Error('Connect Intervals.icu in Settings first');
  if(force)providerReads.clear();
  if (!range && !force && intervalsMemoryCache?.key === config.INTERVALS_API_KEY && Date.now() - intervalsMemoryCache.savedAt < 60_000) return intervalsMemoryCache.data;
  const context = await fetchIntervalsContext(intervalsClient(config), {timeZone,range,includeFutureRaces,repairWorkoutLinks,onProgress,withWorkoutWrite:(id,write)=>withDirectWorkoutWrite(config,id,write)});
  if(range)return context;
  intervalsMemoryCache = {savedAt:Date.now(),key:config.INTERVALS_API_KEY,data:context};
  try {await fs.writeFile(intervalsCachePath,JSON.stringify(context));}
  catch(error) {updateLogs(`Intervals.icu cache write skipped: ${error.message}`);}
  return context;
}

async function scopedTrainingContext(context, scope, today = new Date()) {
  await loadCompletionConfirmation();
  context = intervalsOnlyContext(context);
  context = applyCompletionConfirmation(context,completionConfirmation);
  if(context.source === 'supabase-cache') {
    const localToday=athleteLocalDate(today,context.athlete?.time_zone || 'America/Chicago');
    const sessions=[...new Map([...(context.history || []),...(context.planned || [])].map(w=>[String(w.id),w])).values()];
    context={...context,history:sessions.filter(w=>w.workout_date<=localToday),planned:sessions.filter(w=>w.workout_date>=localToday)};
  }
  const compact=w=>{const {raw,raw_activity,...mapped}=w;return mapped};
  context={...context,history:(context.history || []).map(compact),planned:(context.planned || []).map(compact),...(context.workouts?{workouts:context.workouts.map(compact)}:{})};
  if (scope && typeof scope === 'object') {
    const within = w => w.workout_date >= scope.start && w.workout_date <= scope.end;
    const trendStart = isoDate(shiftDate(new Date(`${scope.start}T12:00:00Z`),-29));
    return {...context,display_range:scope,history:(context.history || []).filter(within),workouts:(context.workouts || context.history || []).filter(within),planned:(context.planned || []).filter(within),wellness_history:(context.wellness_history || []).filter(w => w.date >= trendStart && w.date <= scope.end),context_scope:'range',full_history_available:true};
  }
  if (scope !== 'week') return {...context,context_scope:'full',full_history_available:true};
  const todayDate = isoDate(today);
  const monday = shiftDate(today, -((today.getUTCDay() + 6) % 7));
  const historyStart = isoDate(shiftDate(monday, -7));
  const plannedEnd = isoDate(shiftDate(monday, 13));
  return {
    ...context,
    history:(context.history || []).filter(item => item.workout_date >= historyStart && item.workout_date <= todayDate),
    workouts:(context.workouts || context.history || []).filter(item => item.workout_date >= historyStart && item.workout_date <= todayDate),
    planned:(context.planned || []).filter(item => item.workout_date >= historyStart && item.workout_date <= plannedEnd),
    performance:(context.performance || []).slice(-14),
    context_scope:'week',
    full_history_available:true,
  };
}

async function readBootstrapConfig() {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return mergeEnvironmentConfig(JSON.parse(raw));
  } catch {
    return mergeEnvironmentConfig();
  }
}

async function writeBootstrapConfig(data) {
  let local = {};
  try {local = JSON.parse(await fs.readFile(configPath,'utf8'));} catch {}
  await fs.mkdir(__dirname, { recursive: true });
  const combined = {...local,...data};
  const bootstrapOnly = Object.fromEntries(['SUPABASE_URL','SUPABASE_SECRET_KEY','SETTINGS_ENCRYPTION_KEY','SETTINGS_SCOPE'].filter(k => combined[k]).map(k => [k,combined[k]]));
  await fs.writeFile(configPath, JSON.stringify(bootstrapOnly, null, 2));
}

async function readConfig() {
  return settingsService.read(STORED_SETTINGS.filter(name=>!['APP_DATA','HISTORICAL_ARCHIVE','TRAININGPEAKS_IMPORT_REPORT','RACE_PLAN_IMPORT_REPORT','COMPLETION_CONFIRMATION'].includes(name)));
}

async function writeConfig(data) {
  return settingsService.save(data);
}

function buildConfigResponse(config) {
  return publicSettings(config);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const maxBytes = 1_000_000;
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        chunks.length = 0;
        fail(Object.assign(new Error('Request too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(buffer);
    });
    req.on('error', fail);
    req.on('aborted', () => fail(Object.assign(new Error('Request was interrupted'), { statusCode: 400 })));
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks, size).toString('utf8') || '{}'));
      } catch (error) {
        reject(Object.assign(new Error('Invalid JSON request'), { statusCode: 400 }));
      }
    });
  });
}

async function readIntervalsCache() {
  try {
    return JSON.parse(await fs.readFile(intervalsCachePath, 'utf8'));
  } catch {
    return null;
  }
}

async function localEditCacheEnabled(req) {
  if(process.env.LOCAL_LIVE_DATA==='true' && !process.env.VERCEL)return false;
  if (process.env.VERCEL) return false;
  const host = String(req.headers.host || '').replace(/^\[|\]$/g, '').split(':')[0].toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) return false;
  try {
    await fs.access(localEditCacheFlagPath);
    return true;
  } catch {
    return false;
  }
}

function localWorkoutDoc(model) {
  const expanded = expandSteps(model.steps);
  const steps = expanded.map(({ step }) => {
    const result = {};
    const metrics = stepMetrics(step, model.thresholds);
    if (step.end.kind === 'distance') {
      result.distance = /swim/i.test(model.sport) && ['yd', 'm'].includes(step.end.unit)
        ? step.end.value
        : step.end.value * distanceFactors[step.end.unit];
    } else {
      result.duration = step.end.value;
      if (step.end.kind === 'lap' || step.end.pressLap) result.press_lap = true;
    }
    const target = step.target;
    if (target?.kind && target.kind !== 'none') {
      const units = ['%ftp', '%hr', '%pace'].includes(target.unit) ? '%' :
        /^(?:secs\/100y|secs\/100m)$/.test(target.unit) ? 'secs' : target.unit;
      result[target.kind] = {
        units,
        ...(target.mode === 'single' ? { value: target.value } : { start: target.start, end: target.end }),
      };
      if (target.mode === 'ramp') result.ramp = true;
    }
    if (step.cadence) result.cadence = {
      units: 'rpm',
      ...(step.cadence.start === step.cadence.end
        ? { value: step.cadence.start }
        : { start: step.cadence.start, end: step.cadence.end }),
    };
    result.intensity = step.role === 'other' ? 'active' : step.role;
    if (step.end.kind === 'distance' && metrics.seconds != null) result.duration = metrics.seconds;
    return result;
  });
  const totals = workoutTotals(model);
  return {
    steps,
    duration: totals.seconds,
    distance: steps.reduce((sum, step) => sum + Number(step.distance || 0), 0),
    options: { pool_length: model.poolLength || undefined },
  };
}

function findCachedWorkout(context, id) {
  const row = [...(context?.planned || []), ...(context?.history || [])].find(item => item.id === id);
  return row?.raw && row.id.startsWith('event:') ? row : null;
}

async function saveLocalWorkoutMutation(mutation) {
  const context = await readIntervalsCache();
  const row = findCachedWorkout(context, mutation.id);
  if (!row) throw Object.assign(new Error('Workout is not in the local cache. Refresh the local example data.'), { status: 404 });
  const event = { ...row.raw };
  if (mutation.type === 'description') {
    event.description = mutation.description;
    row.details = mutation.description;
    row.goal = mutation.description;
  } else {
    const oldDate = String(event.start_date_local || '').slice(0, 10);
    const time = String(event.start_date_local || '').slice(10);
    event.start_date_local = mutation.date + time;
    if (event.end_date_local) {
      const endDate = String(event.end_date_local).slice(0, 10);
      const dayDelta = (Date.parse(`${mutation.date}T00:00:00Z`) - Date.parse(`${oldDate}T00:00:00Z`)) / 86400000;
      const shiftedEnd = new Date(Date.parse(`${endDate}T00:00:00Z`) + dayDelta * 86400000).toISOString().slice(0, 10);
      event.end_date_local = shiftedEnd + String(event.end_date_local).slice(10);
    }
  }
  event.updated = new Date().toISOString();
  const mapped = mapIntervalsWorkout(event, athleteLocalDate(new Date(), context.athlete?.time_zone || 'America/Chicago'));
  const sessions = new Map([...(context.history || []), ...(context.planned || [])].map(item => [item.id, item]));
  sessions.set(mutation.id, { ...row, ...mapped, raw: event, source: 'local-edit-cache', sync_status: undefined, sync_operation: undefined, app_updated_at: event.updated });
  const today = athleteLocalDate(new Date(), context.athlete?.time_zone || 'America/Chicago');
  context.history = [...sessions.values()].filter(item => item.workout_date < today);
  context.planned = [...sessions.values()].filter(item => item.workout_date >= today);
  context.source = 'local-edit-cache';
  await persistLocalEditCache(context);
  return await scopedTrainingContext({ ...context, sync_error: null, retention_days: 90 }, 'full');
}

async function persistLocalEditCache(context) {
  const temporaryPath = `${intervalsCachePath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(context));
  await fs.rename(temporaryPath, intervalsCachePath);
}

function updateLogs(message) {
  serverState.logs.push(message);
  if (serverState.logs.length > 200) {
    serverState.logs.shift();
  }
}

function stopProcess() {
  if (!serverState.child) return;

  try {
    serverState.child.kill('SIGTERM');
  } catch {
    // ignore
  }

  serverState.child = null;
  serverState.pid = null;
}

function startServer() {
  throw new Error('The standalone MCP process has been removed. Use the app connection in Settings.');
}

export async function handleRequest(req, res) {
  try {
    req.url = resolveApiRoute(req.url || '/');
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;
    if(pathname==='/api/intervals/webhook') {
      await handleIntervalsWebhook(req,res);
      return;
    }
    // OAuth returns cross-site, where the app's Strict session cookie is absent.
    // The one-use state plus its separate Lax HttpOnly cookie bind the callback
    // to a flow initiated by an authenticated POST below.
    if(pathname==='/api/intervals/oauth/callback' && req.method==='GET') {
      try {
        const config=await readConfig();
        const result=await intervalsOAuth(config,req).callback(requestUrl.searchParams,req.headers.cookie);
        scheduleTrainingReconciliation(config);
        res.writeHead(303,{Location:`/settings?intervals=${result.scopesComplete?'connected':'permissions'}`,'Set-Cookie':result.cookie,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();
      } catch(error) {
        sendWebhookJson(res,400,{error:error.message});
      }
      return;
    }
    if (await handleAuth(req, res, pathname)) return;
    if(pathname==='/api/intervals/oauth/start' && req.method==='POST') {
      const result=await intervalsOAuth(await readConfig(),req).start();
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':result.cookie});
      res.end(JSON.stringify({url:result.url}));return;
    }
    if(pathname==='/api/intervals/status' && req.method==='GET') {
      const config=await readConfig(),oauth=intervalsOAuth(config,req);
      const [connection,sync]=await Promise.all([oauth.status(),webhookSync(config).status()]);
      sendJson(req,res,{...connection,...sync,apiConnected:Boolean(config.INTERVALS_API_KEY),clientId:config.INTERVALS_CLIENT_ID || '',oauthConfigured:Boolean(config.INTERVALS_CLIENT_ID && config.INTERVALS_CLIENT_SECRET),webhookConfigured:Boolean(config.INTERVALS_WEBHOOK_SECRET),webhookUrl:`${intervalsOrigin(process.env,req)}/api/intervals/webhook`});return;
    }
    if (await handleNutrition(req, res, pathname)) return;
    if (await handleReports(req, res, pathname)) return;
    if (await handleCoach(req, res, pathname)) return;
    if(pathname==='/api/training-zones' && req.method==='POST') {
      const config=await readConfig(),request=intervalsClient(config),payload=await readBody(req);
      const result=await updateIntervalsTrainingZones(request,payload);
      let snapshot=await loadSupabaseTrainingSnapshot(config);
      if(!snapshot) snapshot=await fetchIntervalsTrainingContext(config,{force:true,includeFutureRaces:true});
      const incoming={...snapshot,athlete:{...snapshot.athlete,zones:result.zones,sport_settings:result.sport_settings},synced_at:new Date().toISOString()};
      const context=await saveVerifiedSnapshot(config,withZoneHistory(snapshot,incoming));
      intervalsMemoryCache=null;providerReads.clear();
      sendJson(req,res,{context,zones:result.zones});return;
    }
    if(pathname==='/api/race-events' && req.method==='GET') {
      const config=await readConfig(),request=intervalsClient(config),today=athleteLocalDate(new Date(),config.time_zone || 'America/Chicago');
      const oldest=new Date(`${today}T12:00:00Z`),newest=new Date(`${today}T12:00:00Z`);
      oldest.setUTCFullYear(oldest.getUTCFullYear()-10);newest.setUTCFullYear(newest.getUTCFullYear()+10);
      const events=await request(`/athlete/0/events?oldest=${oldest.toISOString().slice(0,10)}&newest=${newest.toISOString().slice(0,10)}`);
      const races=(Array.isArray(events)?events:[]).filter(event=>/^RACE(?:_[ABC])?$/.test(String(event.category || ''))).map(event=>({
        id:String(event.id),name:String(event.name || 'Race'),date:String(event.start_date_local || '').slice(0,10),
        priority:String(event.category || 'RACE').match(/^RACE_([ABC])$/)?.[1] || '',
      })).filter(event=>/^\d{4}-\d{2}-\d{2}$/.test(event.date)).sort((a,b)=>a.date.localeCompare(b.date));
      sendJson(req,res,{events:races});return;
    }
    if(pathname==='/api/race-events' && req.method==='POST') {
      const payload=await readBody(req),name=String(payload.name || '').trim(),eventDate=validDate(payload.date),priority=String(payload.priority || '').toUpperCase();
      const config=await readConfig(),request=intervalsClient(config);
      const externalId=`training-agent-settings-race:${createHash('sha256').update(`${priority}|${eventDate}|${name}`).digest('hex').slice(0,24)}`;
      const providerEvent=await createIntervalsRaceEvent(request,{name,date:eventDate,priority,externalId});
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      let context=null,plan=null;
      if(snapshot) {
        const today=athleteLocalDate(new Date(),snapshot.athlete?.time_zone || 'America/Chicago');
        const workout=mapIntervalsWorkout(providerEvent,today);
        context=await saveVerifiedSnapshot(config,applyVerifiedEvent(snapshot,workout.id,{event:providerEvent},'copy'));
      }
      const plans=await listAnnualPlans(),local=await readLocalContext();
      const active=plans.find(item=>item.id===(local.active_annual_plan_id || plans[0]?.id));
      if(active && !active.events.some(event=>event.date===eventDate&&event.name.toLowerCase()===name.toLowerCase())) {
        const event={id:`event:${providerEvent.id}`,name,date:eventDate,sport:'Other',distance:'',priority,goal:'',targetCtl:null,source:'intervals-calendar'};
        const today=athleteLocalDate(new Date(),snapshot?.athlete?.time_zone || local.athlete?.time_zone || 'America/Chicago');
        const current=rollAnnualPlan(active,today,snapshot?.metrics || {});
        const events=[...current.events,event];
        const generated=generateAnnualPlan({...current,mode:'automatic',methodology:'hours',events},snapshot?.metrics || {});
        plan=await saveAnnualPlanRecord({...mergeRegeneratedPlan(current,generated),events,updatedAt:new Date().toISOString()});
      }
      intervalsMemoryCache=null;providerReads.clear();
      res.writeHead(201,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({event:{id:String(providerEvent.id),name:providerEvent.name,date:eventDate,priority},context,plan}));return;
    }
    if(pathname==='/api/annual-plans' && req.method==='GET') {
      const local=await readLocalContext(),plans=Array.isArray(local.annual_plans)?local.annual_plans:[];
      const activeId=local.active_annual_plan_id || plans[0]?.id || null;
      const today=athleteLocalDate(new Date(),local.athlete?.time_zone || 'America/Chicago');
      sendJson(req,res,{plans:plans.map(plan=>rollAnnualPlan(plan,today)),activeId});return;
    }
    if(pathname==='/api/annual-plans/preview' && req.method==='POST') {
      const payload=await readBody(req);
      const generated=generateAnnualPlan(payload.settings || {},payload.athlete || {});
      const plan=payload.existing?.id?mergeRegeneratedPlan(payload.existing,generated,Array.isArray(payload.selectedWeekIds)?payload.selectedWeekIds:null):generated;
      sendJson(req,res,{plan});return;
    }
    if(pathname==='/api/annual-plans/duplicate' && req.method==='POST') {
      const payload=await readBody(req),plans=await listAnnualPlans();
      const source=plans.find(plan=>plan.id===payload.id);
      if(!source)throw Error('Annual plan not found.');
      const plan=await saveAnnualPlanRecord(duplicateAnnualPlan(source));
      res.writeHead(201,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({plan}));return;
    }
    if(pathname==='/api/annual-plans' && req.method==='POST') {
      const payload=await readBody(req);
      const plan=await saveAnnualPlanRecord(recordPlanRevision(payload.plan,payload.reason || 'Saved changes'));
      sendJson(req,res,{plan});return;
    }
    const annualPlanEventMatch=pathname.match(/^\/api\/annual-plans\/([^/]+)\/events$/);
    if(annualPlanEventMatch && req.method==='POST') {
      const planId=decodeURIComponent(annualPlanEventMatch[1]),payload=await readBody(req),plans=await listAnnualPlans();
      const existing=plans.find(plan=>plan.id===planId);
      if(!existing)throw Error('Annual plan not found.');
      const priority=String(payload.priority || '').toUpperCase(),name=String(payload.name || '').trim(),eventDate=validDate(payload.date);
      if(existing.events.some(event=>event.date===eventDate&&event.priority===priority&&event.name.toLowerCase()===name.toLowerCase()))throw Error('That race is already in this plan.');
      const config=await readConfig(),request=intervalsClient(config);
      const externalId=`training-agent-atp:${createHash('sha256').update(`${planId}|${priority}|${eventDate}|${name}`).digest('hex').slice(0,24)}`;
      const providerEvent=await createIntervalsRaceEvent(request,{name,date:eventDate,priority,externalId});
      const planEvent={id:`event:${providerEvent.id}`,name,date:eventDate,sport:'Other',distance:'',priority,goal:'',targetCtl:null,source:'intervals-calendar'};
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      const today=athleteLocalDate(new Date(),snapshot?.athlete?.time_zone || 'America/Chicago');
      const current=rollAnnualPlan(existing,today,snapshot?.metrics || {});
      const events=[...current.events,planEvent];
      const generated=generateAnnualPlan({...current,mode:'automatic',methodology:'hours',events},snapshot?.metrics || {});
      const plan=await saveAnnualPlanRecord({...mergeRegeneratedPlan(current,generated),events,updatedAt:new Date().toISOString()});
      const workout=mapIntervalsWorkout(providerEvent,today);
      const context=snapshot?await saveVerifiedSnapshot(config,applyVerifiedEvent(snapshot,workout.id,{event:providerEvent},'copy')):null;
      sendJson(req,res,{plan,event:planEvent,workout,context});return;
    }
    const annualPlanEventItemMatch=pathname.match(/^\/api\/annual-plans\/([^/]+)\/events\/([^/]+)$/);
    if(annualPlanEventItemMatch && (req.method==='PATCH' || req.method==='DELETE')) {
      const planId=decodeURIComponent(annualPlanEventItemMatch[1]),eventIdValue=decodeURIComponent(annualPlanEventItemMatch[2]),plans=await listAnnualPlans();
      const existing=plans.find(plan=>plan.id===planId);
      if(!existing)throw Error('Annual plan not found.');
      const planEvent=existing.events.find(event=>event.id===eventIdValue);
      if(!planEvent)throw Error('Race event not found in this plan.');
      const config=await readConfig(),request=intervalsClient(config);
      let providerEvent=null,result=null,nextEvents=[],deletedResults=[];
      if(req.method==='DELETE') {
        const sameDay=await request(`/athlete/0/events?oldest=${planEvent.date}&newest=${planEvent.date}`);
        const category=`RACE_${String(planEvent.priority || '').toUpperCase()}`;
        const matching=Array.isArray(sameDay)?sameDay.filter(event=>String(event.category || '')===category):[];
        const ids=[...new Set([eventIdValue,...matching.map(event=>`event:${event.id}`)])];
        for(const id of ids)deletedResults.push(await withDirectWorkoutWrite(config,id,async(claimed)=>{
          const deleted=await changeIntervalsEvent(claimed,id,'delete');
          const saved=await loadSupabaseTrainingSnapshot(config);
          if(saved)await saveVerifiedSnapshot(config,applyVerifiedEvent(saved,id,deleted,'delete'),{verifiedIds:[id]});
          return deleted;
        }));
        result=deletedResults.find(item=>item.workoutId===eventIdValue) || deletedResults[0];
        nextEvents=existing.events.filter(event=>event.id!==eventIdValue);
      } else {
        const payload=await readBody(req),priority=String(payload.priority || '').toUpperCase(),name=String(payload.name || '').trim(),eventDate=validDate(payload.date);
        providerEvent=await withDirectWorkoutWrite(config,eventIdValue,async(claimed)=>{
          const event=await updateIntervalsRaceEvent(claimed,eventIdValue,{name,date:eventDate,priority});
          const saved=await loadSupabaseTrainingSnapshot(config);
          if(saved)await saveVerifiedSnapshot(config,applyVerifiedEvent(saved,eventIdValue,{event},'update'),{verifiedIds:[eventIdValue]});
          return event;
        });
        result={workoutId:eventIdValue,verified:true,action:'update',event:providerEvent};
        nextEvents=existing.events.map(event=>event.id===eventIdValue?{...event,name,date:eventDate,priority}:event);
      }
      intervalsMemoryCache=null;
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      const current=rollAnnualPlan(existing,athleteLocalDate(new Date(),snapshot?.athlete?.time_zone || 'America/Chicago'),snapshot?.metrics || {});
      const generated=generateAnnualPlan({...current,mode:'automatic',methodology:'hours',events:nextEvents},snapshot?.metrics || {});
      const plan=await saveAnnualPlanRecord({...mergeRegeneratedPlan(current,generated),events:nextEvents,updatedAt:new Date().toISOString()});
      const verifiedSnapshot=req.method==='DELETE'
        ? snapshot?deletedResults.reduce((current,item)=>applyVerifiedEvent(current,item.workoutId,item,'delete'),snapshot):null
        : snapshot?applyVerifiedEvent(snapshot,eventIdValue,result,'update'):null;
      const context=verifiedSnapshot?await saveVerifiedSnapshot(config,verifiedSnapshot):null;
      const workout=providerEvent?mapIntervalsWorkout(providerEvent,athleteLocalDate(new Date(),snapshot?.athlete?.time_zone || 'America/Chicago')):null;
      sendJson(req,res,{plan,event:nextEvents.find(event=>event.id===eventIdValue) || null,workout,context});return;
    }
    const annualPlanMatch=pathname.match(/^\/api\/annual-plans\/([^/]+)$/);
    if(annualPlanMatch && req.method==='PATCH') {
      const id=decodeURIComponent(annualPlanMatch[1]),payload=await readBody(req);
      if(!payload.plan || payload.plan.id!==id)throw Error('Annual plan ID does not match the saved plan.');
      const plan=await saveAnnualPlanRecord({...payload.plan,updatedAt:new Date().toISOString()});
      sendJson(req,res,{plan});return;
    }
    if(annualPlanMatch && req.method==='DELETE') {
      await deleteAnnualPlanRecord(decodeURIComponent(annualPlanMatch[1]));
      res.writeHead(204,{'Cache-Control':'no-store'});res.end();return;
    }
    if(pathname==='/api/mutations' && req.method==='POST') {
      const mutation=validateMutation(await readBody(req));
      if (await localEditCacheEnabled(req)) {
        const context = await saveLocalWorkoutMutation(mutation);
        sendJson(req, res, { queued: false, verified: true, context, operationId: mutation.operationId, localEditCache: true });
        return;
      }
      const config=await readConfig();
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      if(!snapshot)throw Error('Load the saved calendar before editing');
      const store=createContextStore(config);
      const job=await createMutationQueue(config,store).enqueue(mutation);
      if(job.state==='superseded')throw Object.assign(Error('This edit was replaced by a newer saved edit.'),{status:409});
      const context=job.state==='synced'?projectTrainingContext(snapshot,'full'):await createMutationProjection(config,store).pending(job);
      sendJson(req,res,{queued:job.state!=='synced',verified:job.state==='synced',state:job.state,context,operationId:mutation.operationId});return;
    }
    if(pathname==='/api/training-live' && req.method==='POST') {
      const config=await readConfig();
      sendJson(req,res,await createTrainingLive(config,createContextStore(config),{sessionExpiresAt:req.appSession?.expires}));return;
    }
    if(pathname==='/api/training-updates' && req.method==='GET') {
      if(await localEditCacheEnabled(req)) {
        const cached=await readIntervalsCache();
        sendJson(req,res,{context:await scopedTrainingContext(cached,'full'),sourceChanged:false});return;
      }
      const config=await readConfig();
      const store=createContextStore(config);
      sendJson(req,res,await cachedTrainingUpdates({
        readVersion:()=>store.getSyncVersion(fastViewId(config)),
        readView:()=>store.getSyncRecord(fastViewId(config),{fresh:true}),
        refresh:()=>scheduleTrainingReconciliation(config),schedule:task=>task(),
        version:requestUrl.searchParams.get('version'),
      }));return;
    }
    if(pathname==='/api/sync/progress' && req.method==='GET') {
      const id=requestUrl.searchParams.get('id') || '';
      if(!/^[a-zA-Z0-9-]{16,80}$/.test(id))throw Error('Invalid sync progress ID.');
      let progress=manualSyncProgress.get(id);
      const services=await getReportServices();
      progress=services ? await services.sync.getManualProgress(id) || progress : progress;
      if(!progress) {
        progress={phase:'starting',requestId:id,status:'waiting',label:'Waiting for refresh status',completed:0,total:1};
      }
      sendJson(req,res,progress || {phase:'starting',label:'Starting manual refresh',completed:0,total:1});return;
    }
    if(pathname==='/api/section11-sync' && req.method==='GET') {
      const revision=Number(requestUrl.searchParams.get('revision')) || undefined;
      if(revision!==undefined && (!Number.isSafeInteger(revision) || revision<1))throw Error('Invalid GitHub sync revision.');
      const config=await readConfig();
      sendJson(req,res,await section11SyncService(config).progress(revision));return;
    }
    if(pathname==='/api/sync' && req.method==='POST') {
      recentActivityStatsCache = null;
      personalActivityStatsCache = null;
      if (await localEditCacheEnabled(req)) {
        const local = await readLocalContext();
        const cached = await readIntervalsCache();
        if (cached) {
          sendJson(req, res, {
            context:await scopedTrainingContext({ ...local, ...cached, comments:local.comments, library:local.library, source:'local-edit-cache', sync_error:null, retention_days:90 }, 'week'),
            queue:{ failed:0 }, sourceChanged:false, checked_at:new Date().toISOString(), localEditCache:true,
          });
          return;
        }
        res.writeHead(503, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
        res.end(JSON.stringify({ error:'Local editing cache is enabled, but app-backend/intervals.cache is missing.' }));
        return;
      }
      const config=await readConfig();
      const syncId=requestUrl.searchParams.get('syncId') || '';
      const manualRefresh=requestUrl.searchParams.get('force')==='1';
      const trainingOnly=requestUrl.searchParams.get('trainingOnly')==='1' && !manualRefresh;
      const section11Only=requestUrl.searchParams.get('section11Only')==='1' && !manualRefresh;
      const forceIntervals=manualRefresh || requestUrl.searchParams.get('forceIntervals')==='1';
      if(syncId && !/^[a-zA-Z0-9-]{16,80}$/.test(syncId))throw Error('Invalid sync progress ID.');
      let progressWrites=Promise.resolve();
      const reportProgress=progress=>{
        setManualSyncProgress(syncId,progress);
        if(syncId) progressWrites=progressWrites.then(async()=>{
          const services=await getReportServices();
          await services?.sync.setManualProgress(syncId,progress);
        }).catch(()=>{});
      };
      if(section11Only){
        const view=await createContextStore(config).getSyncRecord(fastViewId(config));
        if(!view?.athlete?.id)throw Error('Refresh Intervals.icu before syncing Section 11 files.');
        const section11Sync=await ensureSection11Export(config,view,{force:true,requestId:syncId});
        await progressWrites;
        sendJson(req,res,{section11Sync,checked_at:new Date().toISOString()});return;
      }
      reportProgress({phase:'intervals',label:'Preparing manual refresh',completed:0,total:6});
      const queue=await flushMutations(config,requestUrl.searchParams.get('retry')==='1');
      try {
        const {context,sourceChanged}=await syncRecentTraining(config,{force:forceIntervals,onProgress:reportProgress});
        const remaining=await createMutationQueue(config,createContextStore(config)).summary();
        Object.assign(queue,remaining,{synced:queue.synced});
        // Compare with the last exported version, not just this request's source
        // delta: another page may already have saved the new Intervals data.
        const section11Sync=await ensureSection11Export(config,context,{force:forceIntervals,requestId:syncId});
        if(trainingOnly){
          if(section11Sync.status==='complete')void triggerDueReports(config);
          await progressWrites;
          sendJson(req,res,{context,queue,sourceChanged,section11Sync,checked_at:new Date().toISOString()});return;
        }
        void triggerDueReports(config);
        await progressWrites;
        sendJson(req,res,{context,queue,section11Sync,checked_at:new Date().toISOString()});
      }catch(error){
        reportProgress({phase:'error',label:'Intervals.icu refresh failed',error:error.message,completed:0,total:0});
        await progressWrites;
        const view=await createContextStore(config).getSyncRecord(fastViewId(config));
        if(!view)throw error;
        sendJson(req,res,{context:projectTrainingContext(view),queue,sync_error:error.message});
      }
      return;
    }
    if(pathname==='/api/training-context' && req.method==='GET' && (requestUrl.searchParams.get('refresh')!=='1' || requestUrl.searchParams.get('scope')==='range')) {
      if (await localEditCacheEnabled(req)) {
        const local = await readLocalContext();
        const cached = await readIntervalsCache();
        if (!cached) {
          res.writeHead(503, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
          res.end(JSON.stringify({ error:'Local editing cache is enabled, but app-backend/intervals.cache is missing.' }));
          return;
        }
        const requestedScope = requestUrl.searchParams.get('scope') || 'week';
        let scope = requestedScope === 'full' ? 'full' : 'week';
        if (requestedScope === 'range') {
          const start = validDate(requestUrl.searchParams.get('start'));
          const end = validDate(requestUrl.searchParams.get('end'));
          if (end < start || new Date(end) - new Date(start) > 31 * 86400000) throw new Error('Calendar range must be between 1 and 32 days.');
          scope = { start, end };
        }
        sendJson(req, res, await scopedTrainingContext({ ...local, ...cached, comments:local.comments, library:local.library, source:'local-edit-cache', sync_error:null, retention_days:90 }, scope));
        return;
      }
      const config=await readConfig(),store=createContextStore(config);
      const requestedScope=requestUrl.searchParams.get('scope') || 'week';
      const scope=requestUrl.searchParams.get('scope') || 'week';
      let range;
      if(scope==='range') {
        const start=validDate(requestUrl.searchParams.get('start')),end=validDate(requestUrl.searchParams.get('end'));
        if(end<start || new Date(end)-new Date(start)>31*86400000)throw Error('Calendar range must be between 1 and 32 days.');
        range={start,end};
      }
      if(range && range.end < twelveWeekStart(new Date(),'America/Chicago')) {
        // These dates cannot be in the retained view. Go straight to the
        // provider cache instead of downloading a full database snapshot.
        const historyRequest=historicalReads.wrap(createIntervalsClient(config),`${providerConnection(config)}:${requestUrl.searchParams.get('version') || ''}`);
        sendJson(req,res,await fetchHistoricalCalendar(historyRequest,range));
        return;
      }
      let view=store.ready?await store.getSyncRecord(fastViewId(config,requestedScope)):null;
      if(!view){const saved=await loadSupabaseTrainingSnapshot(config);if(saved)view=await saveFastView(config,store,saved);}
      if(range) {
        if(view && snapshotCoversRange(view,range)) {
          const projected=projectTrainingContext(view,'full');
          const {version,queue_snapshot_revision,...historical}=projected;
          sendJson(req,res,{...historical,context_scope:'range',display_range:range,cached_ranges:[range],history:projected.history.filter(w=>w.workout_date>=range.start && w.workout_date<=range.end),planned:projected.planned.filter(w=>w.workout_date>=range.start && w.workout_date<=range.end),wellness_history:(projected.wellness_history || []).filter(w=>w.date>=range.start && w.date<=range.end)});
        } else {
          const historyRequest=historicalReads.wrap(createIntervalsClient(config),`${providerConnection(config)}:${requestUrl.searchParams.get('version') || view?.version || ''}`);
          sendJson(req,res,await fetchHistoricalCalendar(historyRequest,range,{context:view}));
        }
        return;
      }
      if(view && snapshotCoversRange(view,range)) {
        let projected=projectTrainingContext(view,scope==='week'?'week':'full');
        if(range)projected={...projected,display_range:range,history:projected.history.filter(w=>w.workout_date>=range.start && w.workout_date<=range.end),planned:projected.planned.filter(w=>w.workout_date>=range.start && w.workout_date<=range.end)};
        scheduleTrainingReconciliation(config);
        sendJson(req,res,projected);return;
      }
    }
    const historicalWorkoutRoute=pathname.match(/^\/api\/workout-history\/([^/]+)$/);
    if(historicalWorkoutRoute && req.method==='GET') {
      const config=await readConfig();
      const request=historicalReads.wrap(createIntervalsClient(config),`${providerConnection(config)}:${requestUrl.searchParams.get('version') || ''}`);
      try { sendJson(req,res,{workout:await fetchHistoricalWorkout(request,decodeURIComponent(historicalWorkoutRoute[1]))}); }
      catch(error) {
        if(![400,404].includes(error.status))throw error;
        res.writeHead(error.status,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify({error:error.status===404?'This workout is unavailable from Intervals.icu.':error.message}));
      }
      return;
    }
    if(pathname==='/api/workout-history' && req.method==='GET') {
      const config=await readConfig();
      const options={start:requestUrl.searchParams.get('start') || undefined,end:requestUrl.searchParams.get('end') || undefined,before:requestUrl.searchParams.get('before') || undefined};
      if(await localEditCacheEnabled(req)) {
        const cached=await readIntervalsCache();
        const rows=(cached?.history || []).filter(w=>w.completed && (!options.start || w.workout_date>=options.start) && (!options.end || w.workout_date<=options.end) && (!options.before || w.workout_date<=options.before));
        sendJson(req,res,{workouts:rows.map(({raw,raw_activity,...w})=>w),next_before:null,complete:true,range:options});
      } else {
        const historyRequest=historicalReads.wrap(createIntervalsClient(config),`${providerConnection(config)}:${requestUrl.searchParams.get('version') || ''}`);
        sendJson(req,res,await fetchWorkoutHistoryPage(historyRequest,options));
      }
      return;
    }
    if(pathname==='/api/training-history' && req.method==='GET') {
      const config=await readConfig(),store=createContextStore(config);
      const view=store.ready?await store.getSyncRecord(fastViewId(config)):null;
      const source=view?.history?.length?view:await loadSupabaseTrainingSnapshot(config);
      if(!source){
        res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify({error:'Training history is unavailable.'}));
        return;
      }
      sendJson(req,res,{weeks:buildTwelveWeekTrainingHistory(source),synced_at:source.synced_at});
      return;
    }
    if(pathname==='/api/training-stats' && req.method==='GET') {
      const cachedIntervals = await readIntervalsCache();
      const timeZone = cachedIntervals?.athlete?.time_zone || 'America/Chicago';
      const newest = athleteLocalDate(new Date(), timeZone);
      const oldestDate = new Date(`${newest}T12:00:00Z`);
      oldestDate.setUTCDate(oldestDate.getUTCDate() - 27);
      const oldest = oldestDate.toISOString().slice(0,10);
      if (await localEditCacheEnabled(req)) {
        if (!cachedIntervals) throw Error('The local activity cache is unavailable.');
        const records = (cachedIntervals.history || []).filter(item => item.completed && item.workout_date >= oldest && item.workout_date <= newest).map(item => {
          const raw = item.raw_activity || {};
          const summary = item.workout_summary?.completed || {};
          return {
            date: item.workout_date,
            sport: raw.type || item.sport || 'Other',
            name: raw.name || item.title || '',
            subtype: raw.sub_type || '',
            distance_meters: raw.distance ?? summary.distance_meters ?? item.distance_meters ?? 0,
            duration_seconds: raw.moving_time ?? summary.duration_seconds ?? 0,
            elevation_meters: raw.total_elevation_gain ?? summary.elevation_gain ?? 0,
            achievements: Array.isArray(raw.icu_achievements) ? raw.icu_achievements : [],
          };
        });
        sendJson(req,res,{records,source:'local-edit-cache',synced_at:cachedIntervals.synced_at || null});
        return;
      }
      const config = await readConfig();
      const account = createHash('sha256').update(config.INTERVALS_API_KEY || '').digest('hex');
      if (recentActivityStatsCache?.account === account && recentActivityStatsCache.expiresAt > Date.now()) {
        sendJson(req,res,recentActivityStatsCache.value,'private,max-age=300');
        return;
      }
      const activities = await intervalsClient(config)(`/athlete/0/activities?oldest=${oldest}&newest=${newest}&fields=id,type,start_date_local,name,sub_type,distance,moving_time,total_elevation_gain,icu_achievements`);
      const records = (Array.isArray(activities) ? activities : []).filter(item => item?.start_date_local && Number(item.moving_time) > 0).map(item => ({
        date: String(item.start_date_local).slice(0,10),
        sport: item.type || 'Other',
        name: item.name || '',
        subtype: item.sub_type || '',
        distance_meters: Number(item.distance) || 0,
        duration_seconds: Number(item.moving_time) || 0,
        elevation_meters: Number(item.total_elevation_gain) || 0,
        achievements: Array.isArray(item.icu_achievements) ? item.icu_achievements : [],
      }));
      const value = {records,source:'intervals',synced_at:new Date().toISOString()};
      recentActivityStatsCache = {account,expiresAt:Date.now()+30*60_000,value};
      sendJson(req,res,value,'private,max-age=300');
      return;
    }
    if(pathname==='/api/personal-statistics' && req.method==='GET') {
      const config = await readConfig();
      const account = createHash('sha256').update(config.INTERVALS_API_KEY || '').digest('hex');
      if (personalActivityStatsCache?.account === account && personalActivityStatsCache.expiresAt > Date.now()) {
        sendJson(req,res,personalActivityStatsCache.value,'private,max-age=900');
        return;
      }
      const cachedIntervals = await readIntervalsCache();
      const timeZone = cachedIntervals?.athlete?.time_zone || 'America/Chicago';
      const today = athleteLocalDate(new Date(), timeZone);
      const firstYear = 2000;
      const currentYear = Number(today.slice(0, 4));
      const ranges = [];
      for (let year = firstYear; year <= currentYear; year += 5) {
        const startYear = year;
        const endYear = Math.min(year + 4, currentYear);
        ranges.push({
          oldest: `${startYear}-01-01`,
          newest: endYear === currentYear ? today : `${endYear}-12-31`,
        });
      }
      const fields = 'id,type,start_date_local,name,sub_type,distance,moving_time,elapsed_time,total_elevation_gain,icu_achievements';
      const request = intervalsClient(config);
      const batches = [];
      for (let index = 0; index < ranges.length; index += 3) {
        batches.push(await Promise.all(ranges.slice(index, index + 3).map(({ oldest, newest }) =>
          request(`/athlete/0/activities?oldest=${oldest}&newest=${newest}&fields=${fields}`)
        )));
      }
      const activities = batches.flat(2);
      const seen = new Set();
      const records = activities.filter(item => {
        const id = String(item?.id ?? '');
        if (!id || seen.has(id) || !item?.start_date_local || !(Number(item.moving_time || item.elapsed_time) > 0)) return false;
        seen.add(id);
        return true;
      }).map(item => ({
        id: String(item.id),
        date: String(item.start_date_local).slice(0, 10),
        sport: item.type || 'Other',
        name: item.name || '',
        subtype: item.sub_type || '',
        distance_meters: Number(item.distance) || 0,
        duration_seconds: Number(item.moving_time || item.elapsed_time) || 0,
        elevation_meters: Number(item.total_elevation_gain) || 0,
        achievements: (Array.isArray(item.icu_achievements) ? item.icu_achievements : []).map(achievement => ({
          type: achievement.type,
          distance: achievement.distance,
          secs: achievement.secs,
          watts: achievement.watts,
          pace: achievement.pace,
          value: achievement.value,
        })),
      })).sort((a, b) => a.date.localeCompare(b.date));
      const value = { records, today, source: 'intervals', synced_at: new Date().toISOString() };
      personalActivityStatsCache = { account, expiresAt: Date.now() + 30 * 60_000, value };
      sendJson(req,res,value,'private,max-age=900');
      return;
    }
    if (pathname === '/api/config') {
      if (req.method === 'GET') {
        const config = await readConfig();
        res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify(buildConfigResponse(config)));
        return;
      }
      if (req.method === 'POST') {
        try {
          const payload = await readBody(req);
          const allowed = [...STORED_SETTINGS,'SUPABASE_URL','SUPABASE_SECRET_KEY'];
          const patch = Object.fromEntries(allowed.filter(name => Object.hasOwn(payload,name)).map(name => {
            if (typeof payload[name] !== 'string' || !payload[name].trim()) throw new Error('Settings values must be non-empty text.');
            return [name,payload[name].trim()];
          }));
          if (!Object.keys(patch).length) throw new Error('Enter an updated setting first.');
          if (patch.APP_THEME && !['light','dark','system'].includes(patch.APP_THEME)) throw new Error('Invalid appearance setting.');
          if (patch.METRICS_LAYOUT) {
            const layout = JSON.parse(patch.METRICS_LAYOUT);
            if (!Array.isArray(layout.graphs) || layout.graphs.length !== 3 || !layout.graphs.every(x => typeof x === 'string') || !Array.isArray(layout.cards) || !layout.cards.every(x => typeof x === 'string')) throw new Error('Invalid metrics layout.');
          }
          const current = await readBootstrapConfig();
          if (patch.INTERVALS_API_KEY) await createIntervalsClient({...current,...patch})('/athlete/0');
          const saved = await writeConfig(patch);
          if (patch.INTERVALS_API_KEY) {
            intervalsMemoryCache = null;
            try {await fs.rm(intervalsCachePath,{force:true});} catch {}
          }
          res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});
          res.end(JSON.stringify(buildConfigResponse(saved)));
        } catch(error) {
          res.writeHead(400, {'Content-Type':'application/json','Cache-Control':'no-store'});
          res.end(JSON.stringify({error:error.message}));
        }
        return;
      }
      res.writeHead(405,{'Content-Type':'application/json',Allow:'GET, POST','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:'Method not allowed'}));
      return;
    }

    if (req.url === '/api/training-preferences' && req.method === 'GET') {
      const local=await readLocalContext();sendJson(req,res,{training_preferences:local.training_preferences || {}});return;
    }
    if (req.url === '/api/training-preferences' && req.method === 'POST') {
      const payload=await readBody(req),training_preferences=await updateTrainingPreferences(payload?.training_preferences);
      sendJson(req,res,{training_preferences});return;
    }

    if (req.url === '/api/context/status') {
      if (await localEditCacheEnabled(req)) {
        const config = await readBootstrapConfig();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ready:Boolean(config.SUPABASE_URL && config.SUPABASE_SECRET_KEY), retentionDays:90, localEditCache:true }));
        return;
      }
      const config = await readConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready:Boolean(config.SUPABASE_URL && config.SUPABASE_SECRET_KEY), retentionDays:90, needsProjectUrl:Boolean(config.SUPABASE_SECRET_KEY && !config.SUPABASE_URL) }));
      return;
    }

    if (req.url?.startsWith('/api/training-context') && req.method === 'GET') {
      if (await localEditCacheEnabled(req)) {
        const local = await readLocalContext();
        const requestUrl = new URL(req.url, 'http://localhost');
        const cached = await readIntervalsCache();
        if (cached) {
          let scope = requestUrl.searchParams.get('scope') === 'full' ? 'full' : 'week';
          if (requestUrl.searchParams.get('scope') === 'range') {
            const start = validDate(requestUrl.searchParams.get('start'));
            const end = validDate(requestUrl.searchParams.get('end'));
            if (end < start || new Date(end) - new Date(start) > 31 * 86400000) throw new Error('Calendar range must be between 1 and 32 days.');
            scope = { start, end };
          }
          sendJson(req, res, await scopedTrainingContext({ ...local, ...cached, comments:local.comments, library:local.library, source:'local-edit-cache', sync_error:null, retention_days:90 }, scope));
          return;
        }
        res.writeHead(503, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
        res.end(JSON.stringify({ error:'Local editing cache is enabled, but app-backend/intervals.cache is missing.' }));
        return;
      }
      const config = await readConfig();
      const local = await readLocalContext();
      const timeZone = local.athlete?.time_zone || 'America/Chicago';
      const athleteWithRace = athlete => ({...(athlete || {})});
      const requestUrl = new URL(req.url, 'http://localhost');
      const forceRefresh = requestUrl.searchParams.get('refresh') === '1';
      if(forceRefresh)providerReads.clear();
      let contextScope = requestUrl.searchParams.get('scope') === 'full' ? 'full' : 'week';
      if (requestUrl.searchParams.get('scope') === 'range') {
        const start=requestUrl.searchParams.get('start'),end=requestUrl.searchParams.get('end');
        validDate(start);validDate(end);
        if (end < start || new Date(end)-new Date(start) > 31*86400000) throw new Error('Calendar range must be between 1 and 32 days.');
        contextScope={start,end};
      }
      if (config.INTERVALS_API_KEY) {
        const saved = await loadSupabaseTrainingSnapshot(config,local.athlete?.id);
        if (saved && !forceRefresh && snapshotCoversRange(saved,typeof contextScope === 'object' ? contextScope : null)) {
          sendJson(req,res,await scopedTrainingContext({...local,...saved,athlete:athleteWithRace(saved.athlete),comments:local.comments,library:local.library},contextScope));
          return;
        }
        try {
          const range = saved && contextScope !== 'full' ? typeof contextScope === 'object' ? contextScope : currentWeekRange(timeZone) : undefined;
          const live = await fetchIntervalsTrainingContext(config, { force:forceRefresh, timeZone, range });
          const liveContext = {
            ...local,
            ...live,
            athlete:athleteWithRace(live.athlete),
            metrics:{ ...local.metrics, ...live.metrics },
            comments:local.comments,
            library:local.library,
          };
          try {
            await persistTrainingContext(config, mergeTrainingSnapshot(saved,liveContext,range),{archiveActivities:false});
            void triggerDueReports(config);
          } catch (error) {
            updateLogs(`context write failed: ${error.message}`);
          }
          sendJson(req,res,await scopedTrainingContext(liveContext, contextScope));
          return;
        } catch (error) {
          updateLogs(`Intervals.icu sync failed: ${error.message}`);
          const remote = await loadSupabaseTrainingSnapshot(config, local.athlete?.id);
          if (remote) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control':'no-store' });
            res.end(JSON.stringify(await scopedTrainingContext({ ...local, ...remote, athlete:athleteWithRace(remote.athlete), sync_error:error.message }, contextScope)));
            return;
          }
          try {
            const cached = JSON.parse(await fs.readFile(intervalsCachePath, 'utf8'));
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control':'no-store' });
            res.end(JSON.stringify(await scopedTrainingContext({ ...local, ...cached, athlete:athleteWithRace(cached.athlete), comments:local.comments, library:local.library, source:'intervals-cache', sync_error:error.message }, contextScope)));
            return;
          } catch {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control':'no-store' });
            res.end(JSON.stringify(await scopedTrainingContext({ ...local, athlete:athleteWithRace(local.athlete), source:'local-fallback', sync_error:error.message, retention_days:90 }, contextScope)));
            return;
          }
        }
      }
      // A local development session may temporarily be unable to reach the
      // settings store. Keep the last verified Intervals snapshot visible so
      // the app is usable offline instead of appearing completely empty.
      const remote = await loadSupabaseTrainingSnapshot(config, local.athlete?.id);
      if (remote) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control':'no-store' });
        res.end(JSON.stringify(await scopedTrainingContext({ ...local, ...remote, athlete:athleteWithRace(remote.athlete) }, contextScope)));
        return;
      }
      const cachedIntervals = await readIntervalsCache();
      if (cachedIntervals) {
        res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
        res.end(JSON.stringify(await scopedTrainingContext({ ...local, ...cachedIntervals, athlete:athleteWithRace(cachedIntervals.athlete), comments:local.comments, library:local.library, source:'intervals-cache', sync_error:null }, contextScope)));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(await scopedTrainingContext({ ...local, athlete:{...athleteWithRace(local.athlete),zones:{}}, history:[],planned:[],metrics:{fitness:null,fatigue:null,form:null},wellness:{},source:'not-connected',sync_error:'Connect Intervals.icu in Settings to load your training.', retention_days:90 }, contextScope)));
      return;
    }

    if(pathname==='/api/workout-library' && req.method==='GET') {
      const config=await readConfig();
      sendJson(req,res,{workouts:await readWorkoutLibrary(createIntervalsClient(config))});return;
    }
    if(pathname==='/api/workouts/new/editor' && req.method==='GET') {
      const config=await readConfig();
      try { sendJson(req,res,await loadNewWorkoutEditor(createIntervalsClient(config),requestUrl.searchParams.get('date'))); }
      catch(error) {res.writeHead(error.status || 400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
      return;
    }
    if(pathname==='/api/workouts/editor' && req.method==='POST') {
      const config=await readConfig();
      try {
        const result=await createWorkoutEditor(createIntervalsClient(config),await readBody(req),providerConnection(config));
        try { result.libraryWorkout=await saveLibraryWorkout(createIntervalsClient(config),result.event); }
        catch(error) { result.refreshWarning='The calendar workout was saved, but the library save could not be verified. Retry saving this same workout to reconcile the library copy.'; }
        intervalsMemoryCache=null;providerReads.clear();
        result.workout=mapIntervalsWorkout(result.event,athleteLocalDate(new Date(),config.TIME_ZONE || 'America/Chicago'));
        try {
          const snapshot=await loadSupabaseTrainingSnapshot(config) || await fetchIntervalsTrainingContext(config,{force:true});
          if(snapshot){
            const context={...applyVerifiedEvent(snapshot,result.workoutId,result,'create'),provider:'intervals',provider_connection:providerConnection(config)};
            result.workout=[...context.history,...context.planned].find(w=>w.id===result.workoutId);
            result.context=await saveVerifiedSnapshot(config,context);
            await fs.writeFile(intervalsCachePath,JSON.stringify(context));
          }
        } catch(error) {result.refreshWarning='Created and verified. Refresh the calendar to complete its local update.';updateLogs('Workout creation context refresh pending: '+error.message);}
        sendJson(req,res,result);
      } catch(error) {res.writeHead(error.status || 500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.message,code:error.code || 'CREATE_UNCONFIRMED'}));}
      return;
    }

    const editorRoute=pathname.match(/^\/api\/workouts\/(event%3A\d+|event:\d+)\/editor$/i);
    if(editorRoute && (req.method==='GET'||req.method==='PUT')) {
      const id=decodeURIComponent(editorRoute[1]);
      if (await localEditCacheEnabled(req)) {
        try {
          const cache = await readIntervalsCache();
          const row = findCachedWorkout(cache, id);
          if (!row) throw Object.assign(new Error('Workout is not in the local cache.'), { status: 404 });
          if (req.method === 'GET') {
            const request = async (path) => {
              if (path === '/athlete/0') return { sportSettings: cache.athlete?.sport_settings || [] };
              if (path === `/athlete/0/events/${id.replace(/^event:/, '')}`) return structuredClone(row.raw);
              throw Error('The local workout cache cannot make provider requests.');
            };
            sendJson(req, res, await loadWorkoutEditor(request, id));
            return;
          }

          const { model, revision } = await readBody(req);
          const errors = validateWorkout(model);
          if (errors.length) throw Object.assign(new Error(errors.join('. ')), { status: 400, code: 'INVALID_WORKOUT' });
          if (!revision || workoutRevision(row.raw) !== revision)
            throw Object.assign(new Error('This local example changed after you opened it. Reload the editor before saving.'), { status: 409, code: 'CONFLICT' });
          if (row.raw.category !== 'WORKOUT' || row.raw.read_only || row.raw.readonly || row.raw.editable === false || row.raw.athlete_cannot_edit || row.raw.structure_read_only)
            throw Object.assign(new Error('Only editable planned workouts can be changed in local cache mode.'), { status: 403, code: 'READ_ONLY' });

          const event = { ...row.raw };
          const oldDate = String(event.start_date_local || '').slice(0, 10);
          const oldTime = String(event.start_date_local || '').slice(10);
          event.name = model.name.trim();
          event.type = model.sport;
          event.description = serializeWorkout(model);
          event.start_date_local = model.date + oldTime;
          if (event.end_date_local && model.date !== oldDate) {
            const endDate = String(event.end_date_local).slice(0, 10);
            const days = (Date.parse(`${model.date}T00:00:00Z`) - Date.parse(`${oldDate}T00:00:00Z`)) / 86400000;
            event.end_date_local = new Date(Date.parse(`${endDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10) + String(event.end_date_local).slice(10);
          }
          event.workout_doc = localWorkoutDoc(model);
          event.moving_time = event.workout_doc.duration;
          event.distance = event.workout_doc.distance;
          event.updated = new Date().toISOString();
          const timeZone = cache.athlete?.time_zone || 'America/Chicago';
          const today = athleteLocalDate(new Date(), timeZone);
          const workout = mapIntervalsWorkout(event, today);
          const sessions = new Map([...(cache.history || []), ...(cache.planned || [])].map(item => [item.id, item]));
          sessions.set(id, { ...row, ...workout, raw: event, source: 'local-edit-cache', app_updated_at: event.updated });
          cache.history = [...sessions.values()].filter(item => item.workout_date < today);
          cache.planned = [...sessions.values()].filter(item => item.workout_date >= today);
          cache.source = 'local-edit-cache';
          cache.synced_at = event.updated;
          await persistLocalEditCache(cache);
          const context = await scopedTrainingContext({ ...cache, sync_error: null, retention_days: 90 }, 'full');
          sendJson(req, res, {
            workoutId: id,
            event,
            revision: workoutRevision(event),
            verified: true,
            workout,
            context,
            localEditCache: true,
          });
        } catch(error) {
          res.writeHead(error.status || 500, {'Content-Type':'application/json','Cache-Control':'no-store'});
          res.end(JSON.stringify({error:error.message,code:error.code || 'LOCAL_EDIT_FAILED'}));
        }
        return;
      }
      const config=await readConfig(),request=createIntervalsClient(config);
      try {
        if(req.method==='GET'){sendJson(req,res,await loadWorkoutEditor(request,id));return;}
        const input=await readBody(req);
        const result=await withDirectWorkoutWrite(config,id,async(request)=>{
        const result=await saveWorkoutEditor(request,id,input,providerConnection(config));
        if (String(result.event.external_id || '').startsWith('training-agent:editor:')) {
          try { result.libraryWorkout=await saveLibraryWorkout(request,result.event); }
          catch(error) { result.refreshWarning='The calendar workout is saved. Its library copy could not be verified; save again to retry.'; }
        }
        intervalsMemoryCache=null;
        providerReads.clear();
        const today=athleteLocalDate(new Date(),config.TIME_ZONE || 'America/Chicago');
        result.workout=mapIntervalsWorkout(result.event,today);
        try {
          const snapshot=await loadSupabaseTrainingSnapshot(config) || await fetchIntervalsTrainingContext(config,{force:true});
          if(snapshot){
            const context={...applyVerifiedEvent(snapshot,id,result,'edit'),provider:'intervals',provider_connection:providerConnection(config)};
            result.workout=[...context.history,...context.planned].find(w=>w.id===id);
            result.context=await saveVerifiedSnapshot(config,context,{verifiedIds:[id]});
            await fs.writeFile(intervalsCachePath,JSON.stringify(context));
          }
        } catch(error) { result.refreshWarning='Saved and verified in Intervals.icu; the durable calendar refresh is pending. Refresh the calendar to retry.';updateLogs(`Workout editor context refresh pending: ${error.message}`); }
        return result;
        });
        sendJson(req,res,result);return;
      } catch(error) {res.writeHead(error.status || 500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.message,code:error.code || 'PROVIDER_ERROR'}));return;}
    }

    if(pathname==='/api/calendar/workout-description' && req.method==='POST'){
      const config=await readConfig(),{id,description}=await readBody(req);
      const result=await withDirectWorkoutWrite(config,id,async(request)=>{
      const result=await updateWorkoutDescription(request,id,description);
      intervalsMemoryCache=null;
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      if(snapshot){
        const map=w=>w.id===id?{...w,details:description,goal:description,app_updated_at:new Date().toISOString()}:w;
        result.context=await saveVerifiedSnapshot(config,{...snapshot,history:snapshot.history.map(map),planned:snapshot.planned.map(map)},{verifiedIds:[id]});
      }
      return result;
      });
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
    }
    const routeMap=pathname.match(/^\/api\/activities\/(i\d+|\d+)\/route$/);
    if(routeMap && req.method==='GET'){
      const config=await readConfig();
      const archive=createCompletedWorkoutStore(config,createContextStore(config,updateLogs));
      const points=await loadActivityView(archive,config,intervalsClient(config),routeMap[1],'route',{revision:requestUrl.searchParams.get('v') || undefined});
      sendJson(req,res,{points},'private,max-age=300');return;
    }

    const summaryRoute=pathname.match(/^\/api\/activities\/(i\d+|\d+)\/summary$/);
    if(summaryRoute && req.method==='GET'){
      const config=await readConfig();
      const request=intervalsClient(config);
      const archive=createCompletedWorkoutStore(config,createContextStore(config,updateLogs));
      const summary=await loadActivityView(archive,config,request,summaryRoute[1],'summary',{revision:requestUrl.searchParams.get('v') || undefined});
      sendJson(req,res,summary);return;
    }

    const analysisRoute=pathname.match(/^\/api\/activities\/(i\d+|\d+)\/analysis$/);
    if(analysisRoute && req.method==='GET'){
      const config=await readConfig(),id=analysisRoute[1],request=intervalsClient(config);
      const archive=createCompletedWorkoutStore(config,createContextStore(config,updateLogs));
      const analysis=await loadActivityView(archive,config,request,id,'analysis',{revision:requestUrl.searchParams.get('v') || undefined});
      sendJson(req,res,analysis,'private,max-age=300');return;
    }

    if (pathname === '/api/calendar/day-actions' && req.method === 'POST') {
      const config = await readConfig();
      const {date,action} = await readBody(req);
      validDate(date);
      if (!['copy','delete'].includes(action)) throw new Error('Invalid calendar day action');
      const request = intervalsClient(config);
      const events = (await request(`/athlete/0/events?oldest=${date}&newest=${date}`) || []).filter(e => String(e.start_date_local).slice(0,10) === date);
      const results = [], failures = [];
      for (const event of events) {
        try {results.push(await (action==='delete'?withDirectWorkoutWrite(config,`event:${event.id}`,async(claimed)=>{
          const result=await changeIntervalsEvent(claimed,`event:${event.id}`,action);
          const saved=await loadSupabaseTrainingSnapshot(config);
          if(saved)await saveVerifiedSnapshot(config,applyVerifiedEvent(saved,result.workoutId,result,action),{verifiedIds:[result.workoutId]});
          return result;
        }):changeIntervalsEvent(request,`event:${event.id}`,action)));}
        catch(error) {failures.push({workoutId:`event:${event.id}`,error:error.message});break;}
      }
      intervalsMemoryCache = null;
      let snapshot=await loadSupabaseTrainingSnapshot(config);
      if(snapshot)for(const result of results)snapshot=applyVerifiedEvent(snapshot,result.workoutId,result,action);
      const context=snapshot?await saveVerifiedSnapshot(config,snapshot):null;
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify({results,failures,total:events.length,context}));
      return;
    }

    const calendarAction = pathname.match(/^\/api\/workouts\/(event%3A\d+|event:\d+)\/(move|copy)$/i);
    const calendarDelete = pathname.match(/^\/api\/workouts\/(event%3A\d+|event:\d+)$/i);
    if ((calendarAction && req.method === 'POST') || (calendarDelete && req.method === 'DELETE')) {
      const config = await readConfig();
      const id = decodeURIComponent((calendarAction || calendarDelete)[1]);
      const request = intervalsClient(config);
      const action = calendarAction?.[2] || 'delete';
      const payload = action === 'move' ? await readBody(req) : {};
      const apply=async(request)=>{
      const result = action === 'move'
        ? await moveIntervalsEvent(request,id,payload.date)
        : await changeIntervalsEvent(request,id,action);
      intervalsMemoryCache = null;
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      const context=snapshot?await saveVerifiedSnapshot(config,applyVerifiedEvent(snapshot,id,result,action),{verifiedIds:action==='copy'?[]:[id]}):null;
      return {...result,context};
      };
      const result=action==='copy'?await apply(request):await withDirectWorkoutWrite(config,id,apply);
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify(result));
      return;
    }

    if (req.url === '/api/comments' && req.method === 'POST') {
      const payload = await readBody(req);
      const comment = await addLocalComment(String(payload.workoutId || ''), String(payload.body || ''));
      const config = await readConfig();
      const store = createContextStore(config, updateLogs);
      if (store.ready) {
        await store.upsert('athlete_comments', [{
          id:stableUuid(`comment:${comment.id}`), athlete_id:'default',
          workout_id:comment.workout_id || null, comment_type:'post',
          body:comment.body, created_at:comment.created_at,
        }]);
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(comment));
      return;
    }

    if (req.url === '/api/start') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      const result = startServer();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.url === '/api/stop') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      stopProcess();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: false, pid: null, message: 'Server stopped.' }));
      return;
    }

    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: !!serverState.child, pid: serverState.pid, logs: serverState.logs }));
      return;
    }

    if (pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
      res.end(JSON.stringify({ error:'Not found' }));
      return;
    }

    const cleanUrl = decodeURIComponent((req.url || '/').split('?')[0]);
    const requested = cleanUrl === '/' ? 'index.html' : cleanUrl.slice(1);
    const candidate = path.resolve(uiDistPath, requested);
    const safePath = candidate.startsWith(uiDistPath + path.sep)
      ? candidate
      : path.join(uiDistPath, 'index.html');
    let filePath = safePath;
    try {
      await fs.access(filePath);
    } catch {
      filePath = path.join(uiDistPath, 'index.html');
    }
    try {
      const file = await fs.readFile(filePath);
      const ext = path.extname(filePath);
      const contentTypes = {
        '.html':'text/html; charset=utf-8',
        '.js':'text/javascript; charset=utf-8',
        '.css':'text/css; charset=utf-8',
        '.svg':'image/svg+xml',
        '.woff2':'font/woff2',
      };
      const asset=compressAsset(file,ext,req.headers['accept-encoding']);
      res.writeHead(200, {
        ...asset.headers,
        'Content-Type': contentTypes[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      });
      res.end(asset.body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', message: 'Build the UI with npm run ui:build.' }));
    }
    return;
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = error.statusCode || error.status;
    res.writeHead(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT || 4173);
  const server = http.createServer(handleRequest);
  server.listen(port, () => {
    console.log(`Application service listening on http://localhost:${port}`);
  });
}
