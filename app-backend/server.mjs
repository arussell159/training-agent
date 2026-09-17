import { generateCoachResponse } from './lib/coach-response.mjs';
import { createSection11Adapter } from './lib/section-11-adapter.mjs';
import {loadSection11Artifacts,section11SyncStatus} from './lib/section-11-sync.mjs';
import {section11UpstreamStatus} from './lib/section-11-upstream.mjs';
import {athleteLocalDate} from './lib/coach-training-context.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createContextStore } from './lib/supabase-context.mjs';
import {createCompletedWorkoutStore,providerConnection,mergeTrainingSnapshot,snapshotCoversRange} from './lib/completed-workout-store.mjs';
import { createSettingsService, publicSettings, STORED_SETTINGS } from './lib/settings-store.mjs';
import { resolveApiRoute } from './lib/api-routing.mjs';
import {intervalsOnlyContext} from './lib/intervals-only-context.mjs';
import {readDurableState,writeDurableState} from './lib/durable-state.mjs';
import {loadActivityBundle,loadActivityView} from './lib/activity-bundle.mjs';
import {saveFastView,fastViewId,projectTrainingContext} from './lib/fast-context.mjs';
import {createMutationQueue,validateMutation,pendingMutationContext} from './lib/mutation-queue.mjs';
import {createRequestCache} from './lib/request-cache.mjs';
import {compressAsset} from './lib/asset-compression.mjs';
import {updateWorkoutDescription} from './lib/workout-description.mjs';
import {loadWorkoutEditor,saveWorkoutEditor,loadNewWorkoutEditor,createWorkoutEditor} from './lib/workout-editor.mjs';
import {applyCompletionConfirmation} from './lib/completion-confirmation.mjs';
import {duplicateAnnualPlan,generateAnnualPlan,mergeRegeneratedPlan,recordPlanRevision} from './lib/annual-plan.mjs';
import {
  addLocalComment,
  deleteAnnualPlanRecord,
  deleteLocalCoachConversation,
  getDailyReview,
  getDailyReviewByDate,
  getNotificationPreferences as getLocalNotificationPreferences,
  getLocalCoachConversation,
  listDailyReviews,
  listAnnualPlans,
  listLocalCoachConversations,
  readLocalContext,
  removePushSubscription as removeLocalPushSubscription,
  saveDailyReview,
  saveAnnualPlanRecord,
  saveLocalCoachConversation,
  updateDailyReview,
  updateNotificationPreferences as updateLocalNotificationPreferences,
  updateTrainingPreferences,
  updateLocalWorkout,
  upsertPushSubscription as upsertLocalPushSubscription,
} from './lib/local-context.mjs';
import { createDailyReviewService } from './lib/daily-review-service.mjs';
import { loadCoachingInstructions } from './lib/coaching-policy.mjs';
import { createConversationTitle } from './lib/conversation-title.mjs';
import { createIntervalsClient, fetchIntervalsContext, moveIntervalsEvent, changeIntervalsEvent, createIntervalsRaceEvent, updateIntervalsRaceEvent, createIntervalsWorkoutEvent, applyIntervalsPatch, mapIntervalsWorkout, validDate } from './lib/intervals.mjs';
import { activeConversations, conversationContext, conversationSummary, normalizeConversation } from './lib/conversation-history.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'config.json');
const uiDistPath = path.resolve(__dirname, '..', 'ui', 'dist');
const SECTION_11_CONFIG = Object.freeze({version:11.69,coach_name:'Section 11',protocol:'section-11',rules:[],retention_days:90});
const intervalsCachePath = path.join(process.env.VERCEL ? '/tmp' : __dirname, 'intervals.cache');
let completionConfirmation=null;
try{completionConfirmation=await readDurableState('COMPLETION_CONFIRMATION',path.join(__dirname,'completion-confirmation.cache'),null);}catch(error){console.error('Completion confirmation unavailable:',error.message);}

const serverState = {
  child: null,
  logs: [],
  pid: null,
};

let intervalsMemoryCache = null;
const coachCommentJobs=new Map();
const providerReads=createRequestCache({ttl:60000,maxEntries:32});
function sendJson(req,res,value,cacheControl='no-store'){
 const payload=compressAsset(Buffer.from(JSON.stringify(value)),'.js',req.headers['accept-encoding']);
 res.writeHead(200,{'Content-Type':'application/json','Cache-Control':cacheControl,...payload.headers});res.end(payload.body);
}
function intervalsClient(config){
 const account=createHash('sha256').update(config.INTERVALS_API_KEY || '').digest('hex');
 return providerReads.wrap(createIntervalsClient(config),account);
}

const CONFIG_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'INTERVALS_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
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
  return process.env.VERCEL ? { ...config, ...environment } : { ...environment, ...config };
}

function stableUuid(value) {
  const hex = createHash('sha256').update(String(value)).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

const CONVERSATION_METADATA_TYPE = 'coach_conversation_metadata';

function decodeDatabaseConversation(row) {
  const storedMessages = Array.isArray(row?.messages) ? row.messages : [];
  const metadata = storedMessages.find(message => message?.type === CONVERSATION_METADATA_TYPE) || {};
  return normalizeConversation({
    ...row,
    kind:row.kind || metadata.kind || (String(row.title || '').startsWith('Daily workout review') ? 'daily_review' : 'conversation'),
    review_id:row.review_id || metadata.review_id || null,
    pinned:row.pinned ?? metadata.pinned ?? false,
    deleted_at:row.deleted_at || metadata.deleted_at || null,
    messages:storedMessages.filter(message => message?.type !== CONVERSATION_METADATA_TYPE),
  });
}

function databaseConversation(conversation) {
  return {
    id:conversation.id,
    athlete_id:conversation.athlete_id,
    title:conversation.title,
    kind:conversation.kind,
    review_id:conversation.review_id,
    pinned:conversation.pinned,
    messages:conversation.messages,
    created_at:conversation.created_at,
    updated_at:conversation.updated_at,
    deleted_at:conversation.deleted_at,
  };
}

function legacyDatabaseConversation(conversation) {
  return {
    id:conversation.id,
    athlete_id:conversation.athlete_id,
    title:conversation.title,
    messages:[
      {
        type:CONVERSATION_METADATA_TYPE,
        kind:conversation.kind,
        review_id:conversation.review_id,
        pinned:conversation.pinned,
        deleted_at:conversation.deleted_at,
      },
      ...conversation.messages,
    ],
    created_at:conversation.created_at,
    updated_at:conversation.updated_at,
  };
}

async function upsertSupabaseConversation(store, conversation) {
  try {
    await store.upsert('coach_conversations', [databaseConversation(conversation)]);
  } catch (error) {
    if (!/column|schema cache|PGRST204/i.test(error.message)) throw error;
    await store.upsert('coach_conversations', [legacyDatabaseConversation(conversation)]);
  }
}

async function remoteConversations(config, limit = 500) {
  const store = createContextStore(config, updateLogs);
  if (!store.ready) return null;
  try {
    return await store.listConversations(null, limit);
  } catch (error) {
    updateLogs(`conversation read failed: ${error.message}`);
    return null;
  }
}

async function listCoachConversations(config, limit = 500) {
  const remote = await remoteConversations(config, limit);
  const source = remote === null ? await listLocalCoachConversations(null) : remote;
  return activeConversations(source.map(decodeDatabaseConversation)).slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
}

async function getCoachConversation(config, id) {
  const store = createContextStore(config, updateLogs);
  if (store.ready) {
    try {
      const remote = await store.getConversation(id);
      if (remote) {
        const conversation = decodeDatabaseConversation(remote);
        return conversation.deleted_at ? null : conversation;
      }
    } catch (error) {
      updateLogs(`conversation read failed: ${error.message}`);
    }
  }
  return getLocalCoachConversation(id);
}

async function persistCoachConversation(config, input) {
  const conversation = await saveLocalCoachConversation(input);
  const store = createContextStore(config, updateLogs);
  if (store.ready) {
    try {
      await upsertSupabaseConversation(store, conversation);
    } catch (error) {
      updateLogs(`conversation write failed: ${error.message}`);
      throw new Error('The conversation was saved on this device, but Supabase could not confirm the durable save.');
    }
  }
  return conversation;
}

async function syncDailyReviewToSupabase(review) {
  if (!review) return null;
  if (!isUuid(review.conversation_id)) {
    review = { ...review, conversation_id:stableUuid(`daily-review-conversation:${review.conversation_id || review.id}`) };
    await saveDailyReview(review);
  }
  const config = await readConfig();
  const store = createContextStore(config, updateLogs);
  if (!store.ready) return review;
  const conversation = await getLocalCoachConversation(review.conversation_id);
  try {
    await store.upsert('daily_workout_reviews', [{
      id:review.id,
      athlete_id:review.athlete_id || 'default',
      local_date:review.local_date,
      conversation_id:review.conversation_id,
      revision:review.revision || 1,
      status:review.status,
      review,
      notification:review.notification || {},
      created_at:review.created_at,
      updated_at:review.updated_at || review.created_at,
    }]);
    if (conversation) await upsertSupabaseConversation(store, conversation);
    await store.prune();
  } catch (error) {
    updateLogs(`daily review persistence failed: ${error.message}`);
  }
  return review;
}

async function loadDailyReviewFromSupabase(id) {
  const config = await readConfig();
  const store = createContextStore(config, updateLogs);
  if (!store.ready) return null;
  try {
    const row = await store.getDailyReview(id);
    return row?.review ? { ...row.review, status:row.status, notification:row.notification } : null;
  } catch (error) {
    updateLogs(`daily review read failed: ${error.message}`);
    return null;
  }
}

async function loadDailyReviewFromSupabaseByDate(athleteId, localDate) {
  const config = await readConfig();
  const store = createContextStore(config, updateLogs);
  if (!store.ready) return null;
  try {
    const row = await store.getDailyReviewByDate(athleteId, localDate);
    return row?.review ? { ...row.review, status:row.status, notification:row.notification } : null;
  } catch (error) {
    updateLogs(`daily review date read failed: ${error.message}`);
    return null;
  }
}

async function recentConversationMemory(config, excludeId = null) {
  const conversations = await listCoachConversations(config, 100);
  return conversationContext(conversations, { excludeId, maxMessages:60 });
}

async function currentConversationAthleteId() {
  const reviews = await dailyReviews.listReviews(1);
  if (reviews[0]?.athlete_id) return String(reviews[0].athlete_id);
  const local = await readLocalContext();
  return String(local.athlete?.id || 'default');
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
  if (!store.ready) return;
  const previous=await loadSupabaseTrainingSnapshot(config,context.athlete?.id);
  context=withZoneHistory(previous,context);
  context=mergeTrainingSnapshot(previous,context);
  const archive=createCompletedWorkoutStore(config,store);
  await archive.saveWorkouts(context);
  const archivedVersions={...(previous?.archived_activity_versions || {}),...(context.archived_activity_versions || {})};
  if(archiveActivities){
    const completed=[...new Map([...(context.history || []),...(context.planned || [])].filter(w=>w.completed && w.activity_id).map(w=>[String(w.activity_id),w])).values()];
    const pending=completed.filter(w=>archivedVersions[String(w.activity_id)]!==createHash('sha256').update(JSON.stringify(w.raw_activity || w.completed_data || {})).digest('hex'));
    for(let offset=0;offset<pending.length;offset+=2)await Promise.all(pending.slice(offset,offset+2).map(async workout=>{
      const id=String(workout.activity_id);
      try{
        await archive.invalidateViews(id);
        await loadActivityBundle(archive,config,intervalsClient(config),id);
        archivedVersions[id]=createHash('sha256').update(JSON.stringify(workout.raw_activity || workout.completed_data || {})).digest('hex');
      }catch(error){updateLogs(`Completed workout archive pending ${id}: ${error.message}`);}
    }));
  }
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
  const commentRows = (context.comments || []).filter(item => item?.body).map(item => ({
    id:stableUuid(`comment:${item.id || `${item.workout_id}:${item.created_at}:${item.body}`}`),
    athlete_id:athleteId, workout_id:item.workout_id ? String(item.workout_id) : null,
    comment_type:['pre','post','chat','coach_note'].includes(item.comment_type || item.type) ? (item.comment_type || item.type) : 'post',
    body:String(item.body), created_at:item.created_at || new Date().toISOString(),
  }));
  if (workoutRows.length) await store.upsert('workout_context', workoutRows);
  if (commentRows.length) await store.upsert('athlete_comments', commentRows);
  const syncedAt = context.synced_at || new Date().toISOString();
  await store.upsert('sync_state', [{
    athlete_id:athleteId,
    last_backfill_at:new Date().toISOString(),
    cursor:{
      context:{
        provider:'intervals',
        provider_connection:providerConnection(config),
        cached_ranges:context.cached_ranges || [],
        archived_activity_versions:archivedVersions,
        app_deleted_workouts:context.app_deleted_workouts || {},
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
      },
    },
    status:'ready',
    error:null,
    updated_at:new Date().toISOString(),
  }]);
  await saveFastView(config,store,context);
  await store.prune();
}

async function loadSupabaseTrainingSnapshot(config, athleteId = null) {
  const store = createContextStore(config, updateLogs);
  if (!store.ready) return null;
  try {
    const preferredId = athleteId && athleteId !== 'default' ? String(athleteId) : null;
    const state = await store.getLatestSyncState(preferredId);
    const snapshot = state?.cursor?.context;
    if (!snapshot || snapshot.provider !== 'intervals' || !Array.isArray(snapshot.history) || !Array.isArray(snapshot.planned)) return null;
    if (snapshot.provider_connection !== providerConnection(config)) return null;
    return { ...snapshot, source:'supabase-cache' };
  } catch (error) {
    updateLogs(`Supabase training snapshot read failed: ${error.message}`);
    return null;
  }
}

async function invalidateTrainingSnapshot(config) {
  const snapshot=await loadSupabaseTrainingSnapshot(config);
  if(snapshot)await createContextStore(config,updateLogs).invalidateSyncState(String(snapshot.athlete.id));
}

async function saveVerifiedSnapshot(config,context) {
  if(!context)throw Error('The workout was verified in Intervals.icu but the saved calendar is unavailable. Refresh before retrying.');
  const store=createContextStore(config,updateLogs);
  context={...context,provider_connection:providerConnection(config)};
  await store.upsert('sync_state',[{athlete_id:String(context.athlete.id),status:'ready',cursor:{context},updated_at:new Date().toISOString()}]);
  await saveFastView(config,store,context);
  return projectTrainingContext(context,'full');
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
async function syncRecentTraining(config,{force=false}={}) {
  const key=providerConnection(config);
  if(syncRequests.has(key))return syncRequests.get(key);
  const operation=(async()=>{
    const saved=await loadSupabaseTrainingSnapshot(config);
    if(!force && saved && Date.now()-Date.parse(saved.synced_at)<60000)return projectTrainingContext({...saved,provider_connection:key});
    const zone=saved?.athlete?.time_zone || 'America/Chicago';
    const today=athleteLocalDate(new Date(),zone),date=new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
    const shift=days=>new Date(date.getTime()+days*86400000).toISOString().slice(0,10);
    const range=saved?{start:shift(-14),end:shift(13)}:undefined;
    const incoming=await fetchIntervalsTrainingContext(config,{force:true,timeZone:zone,range});
    await persistTrainingContext(config,mergeTrainingSnapshot(saved,incoming,range));
    const full=await createContextStore(config).getSyncRecord(fastViewId(config));
    return projectTrainingContext(full);
  })();
  syncRequests.set(key,operation);
  try{return await operation;}finally{syncRequests.delete(key);}
}

async function flushMutations(config,retryFailed=false) {
  const queue=createMutationQueue(config,createContextStore(config));
  return queue.drain(async mutation=>{
    const request=intervalsClient(config);
    try {
      const result=mutation.type==='move'?await moveIntervalsEvent(request,mutation.id,mutation.date):await updateWorkoutDescription(request,mutation.id,mutation.description);
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      const map=workout=>{
        if(workout.sync_operation!==mutation.operationId)return workout;
        return {...workout,...(mutation.type==='move'?{raw:result.event}:{}),sync_status:'synced',sync_operation:null,app_updated_at:new Date().toISOString()};
      };
      await saveVerifiedSnapshot(config,{...snapshot,history:snapshot.history.map(map),planned:snapshot.planned.map(map)});
    }catch(error){
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      if(snapshot){const map=w=>w.sync_operation===mutation.operationId?{...w,sync_status:'failed'}:w;await saveVerifiedSnapshot(config,{...snapshot,history:snapshot.history.map(map),planned:snapshot.planned.map(map)});}
      throw error;
    }
  },{retryFailed});
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatDuration(hours) {
  const minutes = Math.max(0, Math.round(Number(hours || 0) * 60));
  if (!minutes) return '—';
  const wholeHours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return wholeHours ? `${wholeHours}h${remainder ? ` ${String(remainder).padStart(2, '0')}m` : ''}` : `${minutes} min`;
}

function sportName(type) {
  return ({ 1:'Swim', 2:'Bike', 3:'Run', 4:'Bike', 6:'Run' })[Number(type)] || 'Recovery';
}

function metricValue(days, type, label) {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const detail = days[index]?.details?.find(item => Number(item.type) === type || String(item.label || '').toLowerCase() === label);
    if (detail && Number.isFinite(Number(detail.value))) return Number(detail.value);
  }
  return null;
}



function zonedDateTimeIso(date, time, timeZone) {
  const target = Date.parse(`${date}T${time}Z`);
  let guess = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const rendered = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    guess += target - rendered;
  }
  return new Date(guess).toISOString();
}

function assessRaceTiming(raceDate, timeZone, now = new Date()) {
  const localParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  const localDate = `${localParts.year}-${localParts.month}-${localParts.day}`;
  const raceDay = Date.parse(`${raceDate}T12:00:00Z`);
  const currentDay = Date.parse(`${localDate}T12:00:00Z`);
  const daysToRace = Number.isFinite(raceDay) ? Math.round((raceDay - currentDay) / 86_400_000) : null;
  let phase = 'general preparation';
  if (daysToRace != null && daysToRace < 0) phase = 'post-race recovery';
  else if (daysToRace != null && daysToRace <= 7) phase = 'race week';
  else if (daysToRace != null && daysToRace <= 14) phase = 'taper';
  else if (daysToRace != null && daysToRace <= 28) phase = 'race-specific';
  else if (daysToRace != null && daysToRace <= 56) phase = 'race preparation';
  else if (daysToRace != null && daysToRace <= 84) phase = 'build';
  return { localDate, daysToRace, phase };
}

function scheduledStart(workout, workoutDate, timeZone) {
  const value = workout.startTimePlanned || null;
  if (!value) return null;
  if (/^\d{1,2}:\d{2}/.test(value)) return zonedDateTimeIso(workoutDate, value, timeZone);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function currentWeekRange(timeZone){
 const today=athleteLocalDate(new Date(),timeZone),date=new Date(`${today}T12:00:00Z`);
 date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));const start=date.toISOString().slice(0,10);
 date.setUTCDate(date.getUTCDate()+6);return {start,end:date.toISOString().slice(0,10)};
}

async function fetchIntervalsTrainingContext(config, {force = false, timeZone = 'America/Chicago', range} = {}) {
  if (!config.INTERVALS_API_KEY) throw new Error('Connect Intervals.icu in Settings first');
  if(force)providerReads.clear();
  if (!range && !force && intervalsMemoryCache?.key === config.INTERVALS_API_KEY && Date.now() - intervalsMemoryCache.savedAt < 60_000) return intervalsMemoryCache.data;
  const context = await fetchIntervalsContext(intervalsClient(config), {timeZone,range});
  if(range)return context;
  intervalsMemoryCache = {savedAt:Date.now(),key:config.INTERVALS_API_KEY,data:context};
  try {await fs.writeFile(intervalsCachePath,JSON.stringify(context));}
  catch(error) {updateLogs(`Intervals.icu cache write skipped: ${error.message}`);}
  return context;
}

function scopedTrainingContext(context, scope, today = new Date()) {
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
    return {...context,history:(context.history || []).filter(within),workouts:(context.workouts || context.history || []).filter(within),planned:(context.planned || []).filter(within),wellness_history:(context.wellness_history || []).filter(w => w.date >= trendStart && w.date <= scope.end),context_scope:'range',full_history_available:true};
  }
  if (scope !== 'week') return context;
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

function sameField(actual, expected) {
  if (typeof expected === 'number') return Math.abs(Number(actual) - expected) < 0.0001;
  if (expected === null) return actual == null;
  if (typeof expected === 'string' && actual && typeof actual === 'object') return JSON.stringify(actual) === expected;
  return actual === expected;
}

async function applyIntervalsWorkoutPatch(config, workoutId, requestedPatch) {
  const result = await applyIntervalsPatch(intervalsClient(config),workoutId,requestedPatch);
  intervalsMemoryCache = null;
  await invalidateTrainingSnapshot(config);
  await syncRecentTraining(config,{force:true});
  return result;
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
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1_000_000) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); } });
  });
}

async function readIntervalsCache() {
  try {
    return JSON.parse(await fs.readFile(intervalsCachePath, 'utf8'));
  } catch {
    return null;
  }
}

async function boundedContextRead(promise, milliseconds, fallback) {
  let timer
  try {
    return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(fallback),milliseconds)})])
  } finally { clearTimeout(timer) }
}

async function buildCoachContext(config, { force = false, strict = false, cacheOnly = false } = {}) {
  const contextStore = createContextStore(config, updateLogs);
  if(cacheOnly) {
    const fallback={athlete:{id:'default',time_zone:'America/Chicago'},metrics:{},wellness:{},history:[],planned:[],comments:[],annual_plans:[],notification_preferences:{time_zone:'America/Chicago'}}
    const [local,fastView,fileCache]=await Promise.all([
      boundedContextRead(readLocalContext(),2500,fallback),
      contextStore.ready?boundedContextRead(contextStore.getSyncRecord(fastViewId(config)),3000,null):null,
      readIntervalsCache(),
    ])
    const cached=fastView || (intervalsMemoryCache?.key===config.INTERVALS_API_KEY?intervalsMemoryCache.data:null) || fileCache || {}
    return intervalsOnlyContext({...fallback,...local,...cached,coaching:SECTION_11_CONFIG,
      athlete:{...fallback.athlete,...local.athlete,...cached.athlete},metrics:{...local.metrics,...cached.metrics},
      comments:local.comments || [],annual_plans:local.annual_plans || [],history:cached.history || [],planned:cached.planned || [],workouts:cached.history || []})
  }
  const local = await readLocalContext();
  const timeZone = local.notification_preferences?.time_zone || local.athlete?.time_zone || 'America/Chicago';
  let context = {
    ...local,
    coaching:SECTION_11_CONFIG,
    history:[],planned:[],workouts:[],
  };

  if (contextStore.ready) {
    try {
      const snapshot = await loadSupabaseTrainingSnapshot(config,local.athlete?.id);
      if (snapshot) context = {...context,...snapshot,coaching:SECTION_11_CONFIG,athlete:{...context.athlete,...snapshot.athlete},workouts:snapshot.history};
    } catch (error) {
      updateLogs(`context read failed: ${error.message}`);
    }
  }

  if (config.INTERVALS_API_KEY) {
    let intervals = null;
    try {
      intervals = await fetchIntervalsTrainingContext(config, { force, timeZone });
    } catch (error) {
      updateLogs(`coach Intervals.icu sync failed: ${error.message}`);
      if (strict) throw error;
      intervals = await readIntervalsCache();
      if (intervals) intervals = { ...intervals, source:'intervals-cache', sync_error:error.message };
    }

    if (intervals) {
      context = {
        ...context,
        ...intervals,
        athlete:{...intervals.athlete},
        metrics:{ ...context.metrics, ...intervals.metrics },
        workouts:intervals.history,
        history:intervals.history,
        planned:intervals.planned,
        comments:context.comments || local.comments,
        library:[],
      };
      try {
        await persistTrainingContext(config, context);
      } catch (error) {
        updateLogs(`context write failed: ${error.message}`);
      }
    }
  }

  context.coaching = SECTION_11_CONFIG;

  return intervalsOnlyContext(context);
}

async function createCoachWorkout(config,workout,conversationId,currentDate) {
    const request=intervalsClient(config);
    const stable=JSON.stringify({conversationId,date:workout.date,type:workout.type,name:workout.name,moving_time:workout.moving_time,description:workout.description,workout_doc:workout.workout_doc || null});
    const event=await createIntervalsWorkoutEvent(request,{...workout,external_id:workout.external_id || `training-agent-coach:${createHash('sha256').update(stable).digest('hex').slice(0,32)}`});
    intervalsMemoryCache=null;
    const snapshot=await loadSupabaseTrainingSnapshot(config);
    if(snapshot) {
      const mapped=mapIntervalsWorkout(event,currentDate);
      await saveVerifiedSnapshot(config,applyVerifiedEvent(snapshot,mapped.id,{event},'copy'));
    }
    return event;
}
async function applyCoachAnnualPlan(args) {
    const plans=await listAnnualPlans(),existing=plans.find(plan=>plan.id===args.plan_id);
    if(!existing)throw new Error('Annual plan not found');
    const phases=new Set(['Not Set','Preparation','Base 1','Base 2','Base 3','Build 1','Build 2','Peak','Race','Transition']);
    const byWeek=new Map((args.changes || []).map(change=>[String(change.week_id),change]));
    if(!byWeek.size)throw new Error('At least one annual-plan week change is required');
    validDate(args.range_start);validDate(args.range_end);
    if(args.range_end<args.range_start)throw new Error('Annual-plan range end must not precede its start');
    const affected=existing.weeks.filter(week=>week.endDate>=args.range_start&&week.startDate<=args.range_end);
    if(!affected.length)throw new Error('The requested annual-plan range does not overlap the plan');
    const missing=affected.filter(week=>!byWeek.has(week.id));
    if(missing.length)throw new Error(`The preview must include every week in the requested range: ${missing.map(week=>week.id).join(', ')}`);
    for(const id of byWeek.keys())if(!existing.weeks.some(week=>week.id===id))throw new Error(`Annual-plan week not found: ${id}`);
    const weeks=existing.weeks.map(week=>{
      const change=byWeek.get(week.id);if(!change)return week;
      if(week.locked)throw new Error(`Week ${week.id} is locked and was not changed`);
      if(!phases.has(change.phase))throw new Error(`Invalid or missing phase for ${week.id}`);
      if(!Number.isFinite(Number(change.target_hours))||Number(change.target_hours)<0)throw new Error(`Invalid or missing planned hours for ${week.id}`);
      if(typeof change.notes!=='string'||!change.notes.trim())throw new Error(`Week details are required for ${week.id}`);
      const allocation=change.allocation?Object.fromEntries(['swim','bike','run','strength'].map(key=>[key,Math.max(0,Number(change.allocation[key] ?? week.allocation?.[key] ?? 0))])):week.allocation;
      return {...week,
        ...(change.phase!=null?{phase:change.phase}:{}),...(Object.hasOwn(change,'phase_week')?{phaseWeek:change.phase_week}:{}),
        ...(change.recovery!=null?{recovery:Boolean(change.recovery)}:{}),...(Object.hasOwn(change,'target_hours')?{targetHours:change.target_hours}:{}),
        ...(Object.hasOwn(change,'target_tss')?{targetTss:change.target_tss}:{}),...(change.focus!=null?{focus:String(change.focus)}:{}),
        ...(change.notes!=null?{notes:String(change.notes)}:{}),allocation,manual:true};
    });
    return saveAnnualPlanRecord(recordPlanRevision({...existing,weeks},String(args.reason || 'Section 11 coach update')));
}

async function runCoach(message, history = [], conversationId = null, onDelta = null, options = {}) {
  const config = await readConfig();
  if (!config.OPENAI_API_KEY) throw new Error('OpenAI is not configured');
  if (!config.INTERVALS_API_KEY) throw new Error('Connect Intervals.icu in Settings before using live coaching');
  const actionMode=options.actionMode || null;
  options.onStatus?.({message:actionMode?'Loading the current application data…':'Reading current Intervals.icu training data…',progress:15});
  const baseContext = options.context || await buildCoachContext(config, {cacheOnly:true});
  options.onStatus?.({message:'Reading official Section 11 metric artifacts…',progress:32});
  const section11Artifacts=await loadSection11Artifacts(config,baseContext.athlete?.id);
  const context={...baseContext,section11_artifacts:section11Artifacts};
  const coachIntent=[...history.slice(-4).map(item=>String(item.content || '')),message].join('\n');
  options.onStatus?.({message:actionMode?'Loading the selected Section 11 feedback…':'Loading the fresh official Section 11 installation…',progress:50});
  const guide=actionMode?'':await loadCoachingInstructions(coachIntent);
  const currentDate = athleteLocalDate(new Date(),context.notification_preferences?.time_zone || context.athlete?.time_zone || 'America/Chicago');
  return generateCoachResponse(config, {
    guide, currentDate,
    context,
    history, message, onDelta, onStatus:options.onStatus, actionMode, sourceFeedback:options.sourceFeedback,
    executeTool:createSection11Adapter({request:intervalsClient(config),context,currentDate,userMessage:message,createWorkout:workout=>createCoachWorkout(config,workout,conversationId,currentDate),getAnnualPlans:async()=>({plans:await listAnnualPlans()}),updateAnnualPlan:applyCoachAnnualPlan,onPreview:options.onPreview,allowConfirmedWrites:false}),

  });
}
async function streamCoach(message, history, res, conversationId = null, options = {}) {
  res.writeHead(200, {
    'Content-Type':'text/event-stream; charset=utf-8',
    'Cache-Control':'no-cache, no-transform',
    'Connection':'keep-alive',
    'X-Accel-Buffering':'no',
  });
  res.flushHeaders?.();
  const sendStatus=status=>{if(!res.writableEnded)res.write(`data: ${JSON.stringify({type:'coach.status',...status})}\n\n`)};
  sendStatus({message:options.actionMode?'Starting the application formatter…':'Starting the official Section 11 coach…',progress:5});
  const heartbeat=setInterval(()=>{if(!res.writableEnded)res.write(': keepalive\n\n')},15_000);
  let streamed=false;
  try {
    const content = await runCoach(message, history, conversationId,delta=>{streamed=true;if(!res.writableEnded)res.write(`data: ${JSON.stringify({type:'response.output_text.delta',delta})}\n\n`)},{...options,onStatus:sendStatus,onPreview:proposal=>{if(!res.writableEnded)res.write(`data: ${JSON.stringify({type:'coach.action.preview',proposal})}\n\n`)}});
    if(!streamed)res.write(`data: ${JSON.stringify({ type:'response.output_text.delta', delta:content })}\n\n`);
  } catch(error) {
    // A late provider timeout must not erase a response the athlete has already read.
    if(!streamed)res.write(`data: ${JSON.stringify({type:'error',message:error instanceof Error?error.message:'The coach is unavailable right now.'})}\n\n`);
  } finally {
    clearInterval(heartbeat);
    if(!res.writableEnded){res.write('data: [DONE]\n\n');res.end();}
  }
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

async function buildDailyReviewContext(config, options = {}) {
  return buildCoachContext(config, options);
}

async function notificationContextStore() {
  const store = createContextStore(await readConfig(), updateLogs);
  return store.ready ? store : null;
}

const dailyReviewStorage = {
  getDailyReview,
  getDailyReviewByDate,
  listDailyReviews,
  saveDailyReview,
  updateDailyReview,
  async getNotificationPreferences() {
    const store = await notificationContextStore();
    return store ? store.getNotificationPreferences('default') : getLocalNotificationPreferences();
  },
  async updateNotificationPreferences(patch) {
    const store = await notificationContextStore();
    return store ? store.updateNotificationPreferences('default', patch) : updateLocalNotificationPreferences(patch);
  },
  async upsertPushSubscription(subscription) {
    const store = await notificationContextStore();
    return store ? store.upsertPushSubscription('default', subscription) : upsertLocalPushSubscription(subscription);
  },
  async removePushSubscription(endpoint) {
    const store = await notificationContextStore();
    return store ? store.removePushSubscription('default', endpoint) : removeLocalPushSubscription(endpoint);
  },
};

const dailyReviews = createDailyReviewService({
  advisoryOnly:true,
  readConfig,
  writeConfig,
  getContext:buildDailyReviewContext,
  applyWorkoutPatch:applyIntervalsWorkoutPatch,
  hydrateDailyReviewByDate:loadDailyReviewFromSupabaseByDate,
  log:updateLogs,
  storage:dailyReviewStorage,
});

async function getPersistentDailyReview(id) {
  const local = await dailyReviews.getReview(id);
  if (local) return local;
  const remote = await loadDailyReviewFromSupabase(id);
  if (!remote) return null;
  await saveDailyReview(remote);
  return remote;
}

async function listPersistentDailyReviews(limit = 30) {
  const local = await dailyReviews.listReviews(limit);
  const config = await readConfig();
  const store = createContextStore(config, updateLogs);
  if (!store.ready) return local;
  try {
    const rows = await store.listDailyReviews('default', limit);
    const combined = new Map(local.map(review => [review.id, review]));
    for (const row of rows || []) {
      if (row.review) combined.set(row.id, { ...row.review, status:row.status, notification:row.notification });
    }
    return [...combined.values()]
      .sort((left, right) => String(right.updated_at || right.created_at).localeCompare(String(left.updated_at || left.created_at)))
      .slice(0, limit);
  } catch (error) {
    updateLogs(`daily review list failed: ${error.message}`);
    return local;
  }
}

export async function handleRequest(req, res) {
  try {
    req.url = resolveApiRoute(req.url || '/');
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;
    if(pathname==='/api/annual-plans' && req.method==='GET') {
      const local=await readLocalContext(),plans=Array.isArray(local.annual_plans)?local.annual_plans:[];
      sendJson(req,res,{plans,activeId:local.active_annual_plan_id || plans[0]?.id || null});return;
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
      const generated=generateAnnualPlan({...existing,mode:'automatic',methodology:'hours',events:[...existing.events,planEvent]},snapshot?.metrics || {});
      const plan=await saveAnnualPlanRecord({...mergeRegeneratedPlan(existing,generated),updatedAt:new Date().toISOString()});
      const today=athleteLocalDate(new Date(),snapshot?.athlete?.time_zone || 'America/Chicago');
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
        for(const id of ids)deletedResults.push(await changeIntervalsEvent(request,id,'delete'));
        result=deletedResults.find(item=>item.workoutId===eventIdValue) || deletedResults[0];
        nextEvents=existing.events.filter(event=>event.id!==eventIdValue);
      } else {
        const payload=await readBody(req),priority=String(payload.priority || '').toUpperCase(),name=String(payload.name || '').trim(),eventDate=validDate(payload.date);
        providerEvent=await updateIntervalsRaceEvent(request,eventIdValue,{name,date:eventDate,priority});
        result={workoutId:eventIdValue,verified:true,action:'update',event:providerEvent};
        nextEvents=existing.events.map(event=>event.id===eventIdValue?{...event,name,date:eventDate,priority}:event);
      }
      intervalsMemoryCache=null;
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      const generated=generateAnnualPlan({...existing,mode:'automatic',methodology:'hours',events:nextEvents},snapshot?.metrics || {});
      const plan=await saveAnnualPlanRecord({...mergeRegeneratedPlan(existing,generated),updatedAt:new Date().toISOString()});
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
      const config=await readConfig(),mutation=validateMutation(await readBody(req));
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      if(!snapshot)throw Error('Load the saved calendar before editing');
      const pending=pendingMutationContext(snapshot,mutation);
      const job=await createMutationQueue(config,createContextStore(config)).enqueue(mutation);
      const context=job.state==='synced'?projectTrainingContext(snapshot,'full'):await saveVerifiedSnapshot(config,pending);
      sendJson(req,res,{queued:job.state!=='synced',verified:job.state==='synced',context,operationId:mutation.operationId});return;
    }
    if(pathname==='/api/sync' && req.method==='POST') {
      const config=await readConfig();
      const queue=await flushMutations(config,requestUrl.searchParams.get('retry')==='1');
      try {
        const context=await syncRecentTraining(config,{force:requestUrl.searchParams.get('force')==='1'});
        sendJson(req,res,{context,queue,checked_at:new Date().toISOString()});
      }catch(error){
        const view=await createContextStore(config).getSyncRecord(fastViewId(config));
        if(!view)throw error;
        sendJson(req,res,{context:projectTrainingContext(view),queue,sync_error:error.message});
      }
      return;
    }
    if(pathname==='/api/training-context' && req.method==='GET' && requestUrl.searchParams.get('refresh')!=='1') {
      const config=await readConfig(),store=createContextStore(config);
      const requestedScope=requestUrl.searchParams.get('scope') || 'week';
      let view=store.ready?await store.getSyncRecord(fastViewId(config,requestedScope)):null;
      if(!view){const saved=await loadSupabaseTrainingSnapshot(config);if(saved)view=await saveFastView(config,store,saved);}
      const scope=requestUrl.searchParams.get('scope') || 'week';
      let range;
      if(scope==='range') {
        const start=validDate(requestUrl.searchParams.get('start')),end=validDate(requestUrl.searchParams.get('end'));
        if(end<start || new Date(end)-new Date(start)>31*86400000)throw Error('Calendar range must be between 1 and 32 days.');
        range={start,end};
      }
      if(view && snapshotCoversRange(view,range)) {
        let projected=projectTrainingContext(view,scope==='week'?'week':'full');
        if(range)projected={...projected,display_range:range,history:projected.history.filter(w=>w.workout_date>=range.start && w.workout_date<=range.end),planned:projected.planned.filter(w=>w.workout_date>=range.start && w.workout_date<=range.end)};
        sendJson(req,res,projected);return;
      }
    }
    if (pathname === '/api/notification-settings') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
        res.end(JSON.stringify(await dailyReviews.getPreferences()));
        return;
      }
      if (req.method === 'PATCH') {
        const preferences = await dailyReviews.updatePreferences(await readBody(req));
        res.writeHead(200, { 'Content-Type':'application/json' });
        res.end(JSON.stringify(preferences));
        return;
      }
    }

    if (pathname === '/api/push-subscriptions' && req.method === 'POST') {
      const preferences = await dailyReviews.subscribe(await readBody(req));
      res.writeHead(201, { 'Content-Type':'application/json' });
      res.end(JSON.stringify(preferences));
      return;
    }

    if (pathname === '/api/push-subscriptions' && req.method === 'DELETE') {
      const preferences = await dailyReviews.unsubscribe((await readBody(req)).endpoint);
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(JSON.stringify(preferences));
      return;
    }

    if (pathname === '/api/daily-reviews/run' && req.method === 'POST') {
      const review = await dailyReviews.runDue(new Date(), { force:true, refresh:requestUrl.searchParams.get('refresh') === '1' });
      if (review) await syncDailyReviewToSupabase(review);
      res.writeHead(review ? 200 : 204, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
      res.end(review ? JSON.stringify(review) : '');
      return;
    }

    if (pathname === '/api/daily-reviews' && req.method === 'GET') {
      const reviews = await listPersistentDailyReviews(Number(requestUrl.searchParams.get('limit') || 30));
      res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
      res.end(JSON.stringify(reviews));
      return;
    }

    const reviewAction = pathname.match(/^\/api\/daily-reviews\/([^/]+)\/(approve|deny)$/);
    if (reviewAction && req.method === 'POST') {
      const id = decodeURIComponent(reviewAction[1]);
      await getPersistentDailyReview(id);
      const result = reviewAction[2] === 'approve' ? await dailyReviews.approve(id) : await dailyReviews.deny(id);
      if (result.body?.review) await syncDailyReviewToSupabase(result.body.review);
      res.writeHead(result.status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
      res.end(JSON.stringify(result.body));
      return;
    }

    const reviewRefinement = pathname.match(/^\/api\/daily-reviews\/([^/]+)\/refine$/);
    if (reviewRefinement && req.method === 'POST') {
      const id = decodeURIComponent(reviewRefinement[1]);
      await getPersistentDailyReview(id);
      const payload = await readBody(req);
      if (typeof payload.message !== 'string' || !payload.message.trim()) throw new Error('Refinement message is required');
      const result = await dailyReviews.refine(id, payload.message.trim());
      if (result.body?.review) await syncDailyReviewToSupabase(result.body.review);
      res.writeHead(result.status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
      res.end(JSON.stringify(result.body));
      return;
    }

    const reviewMatch = pathname.match(/^\/api\/daily-reviews\/([^/]+)$/);
    if (reviewMatch && req.method === 'GET') {
      const review = await getPersistentDailyReview(decodeURIComponent(reviewMatch[1]));
      res.writeHead(review ? 200 : 404, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
      res.end(JSON.stringify(review || { error:'Daily review not found' }));
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

    if (req.url?.startsWith('/api/section-11/status') && req.method === 'GET') {
      const config=await readConfig();
      const context=await buildCoachContext(config,{cacheOnly:true});
      const refresh=new URL(req.url,'http://localhost').searchParams.get('refresh')==='1';
      const artifacts=await loadSection11Artifacts(config,context.athlete?.id,{force:refresh,waitForRefresh:refresh});
      sendJson(req,res,{...section11SyncStatus(artifacts),upstream:await section11UpstreamStatus()});
      return;
    }

    if (req.url === '/api/coach' && req.method === 'POST') {
      const payload = await readBody(req);
      if (typeof payload.message !== 'string' || !payload.message.trim()) throw new Error('Message is required');
      const history = Array.isArray(payload.history)
        ? payload.history.slice(-10).filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').map(item => ({ role:item.role, content:item.content.slice(0, 4000) }))
        : [];
      const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : null;
      const actionMode=['workouts','annual_plan'].includes(payload.actionMode) ? payload.actionMode : null;
      const sourceFeedback=actionMode && typeof payload.sourceFeedback==='string' ? payload.sourceFeedback.slice(0,20000).trim() : '';
      if(actionMode && !sourceFeedback)throw new Error('Section 11 feedback is required for an application action');
      if (String(req.headers.accept || '').includes('text/event-stream')) {
        await streamCoach(payload.message.trim(), actionMode?[]:history, res, conversationId,{actionMode,sourceFeedback});
        return;
      }
      const message = await runCoach(payload.message.trim(), actionMode?[]:history, conversationId,null,{actionMode,sourceFeedback});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message }));
      return;
    }

    if (req.url === '/api/coach/actions/approve' && req.method === 'POST') {
      const payload=await readBody(req),proposal=payload?.proposal || {};
      const config=await readConfig();
      if(proposal.operation==='create_workout') {
        if(!proposal.workout || typeof proposal.workout!=='object')throw new Error('A complete workout preview is required');
        const context=await buildCoachContext(config,{cacheOnly:true});
        const currentDate=athleteLocalDate(new Date(),context.notification_preferences?.time_zone || context.athlete?.time_zone || 'America/Chicago');
        const event=await createCoachWorkout(config,proposal.workout,String(payload.conversationId || 'coach-action'),currentDate);
        sendJson(req,res,{operation:proposal.operation,destination:'intervals.icu',verified:true,event});return;
      }
      if(proposal.operation==='create_workouts') {
        if(!Array.isArray(proposal.workouts) || proposal.workouts.length<2 || proposal.workouts.length>14)throw new Error('A complete multi-workout preview is required');
        const context=await buildCoachContext(config,{cacheOnly:true});
        const currentDate=athleteLocalDate(new Date(),context.notification_preferences?.time_zone || context.athlete?.time_zone || 'America/Chicago');
        const events=[];
        for(const workout of proposal.workouts)events.push(await createCoachWorkout(config,workout,String(payload.conversationId || 'coach-action'),currentDate));
        sendJson(req,res,{operation:proposal.operation,destination:'intervals.icu',verified:true,events});return;
      }
      if(proposal.operation==='update_annual_plan') {
        const plan=await applyCoachAnnualPlan(proposal);
        sendJson(req,res,{operation:proposal.operation,destination:'application',verified:true,plan});return;
      }
      throw new Error('Unsupported coach action preview');
    }

    if (req.url === '/api/context/status') {
      const config = await readConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready:Boolean(config.SUPABASE_URL && config.SUPABASE_SECRET_KEY), retentionDays:90, needsProjectUrl:Boolean(config.SUPABASE_SECRET_KEY && !config.SUPABASE_URL) }));
      return;
    }

    if (req.url?.startsWith('/api/training-context') && req.method === 'GET') {
      const config = await readConfig();
      const local = await readLocalContext();
      const timeZone = local.notification_preferences?.time_zone || local.athlete?.time_zone || 'America/Chicago';
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
          sendJson(req,res,scopedTrainingContext({...local,...saved,athlete:athleteWithRace(saved.athlete),comments:local.comments,library:local.library},contextScope));
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
            await persistTrainingContext(config, mergeTrainingSnapshot(saved,liveContext,range));
          } catch (error) {
            updateLogs(`context write failed: ${error.message}`);
          }
          sendJson(req,res,scopedTrainingContext(liveContext, contextScope));
          return;
        } catch (error) {
          updateLogs(`Intervals.icu sync failed: ${error.message}`);
          try {
            const cached = JSON.parse(await fs.readFile(intervalsCachePath, 'utf8'));
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control':'no-store' });
            res.end(JSON.stringify(scopedTrainingContext({ ...local, ...cached, athlete:athleteWithRace(cached.athlete), comments:local.comments, library:local.library, source:'intervals-cache', sync_error:error.message }, contextScope)));
            return;
          } catch {
            const remote = await loadSupabaseTrainingSnapshot(config, local.athlete?.id);
            if (remote) {
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control':'no-store' });
              res.end(JSON.stringify(scopedTrainingContext({ ...local, ...remote, athlete:athleteWithRace(remote.athlete), sync_error:error.message }, contextScope)));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control':'no-store' });
            res.end(JSON.stringify(scopedTrainingContext({ ...local, athlete:athleteWithRace(local.athlete), source:'local-fallback', sync_error:error.message, retention_days:90 }, contextScope)));
            return;
          }
        }
      }
      // A local development session may temporarily be unable to reach the
      // settings store. Keep the last verified Intervals snapshot visible so
      // the app is usable offline instead of appearing completely empty.
      const cachedIntervals = await readIntervalsCache();
      if (cachedIntervals) {
        res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
        res.end(JSON.stringify(scopedTrainingContext({ ...local, ...cachedIntervals, athlete:athleteWithRace(cachedIntervals.athlete), comments:local.comments, library:local.library, source:'intervals-cache', sync_error:null }, contextScope)));
        return;
      }
      const remote = await loadSupabaseTrainingSnapshot(config, local.athlete?.id);
      if (remote) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control':'no-store' });
        res.end(JSON.stringify(scopedTrainingContext({ ...local, ...remote, athlete:athleteWithRace(remote.athlete) }, contextScope)));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(scopedTrainingContext({ ...local, athlete:{...athleteWithRace(local.athlete),zones:{}}, history:[],planned:[],metrics:{fitness:null,fatigue:null,form:null},wellness:{},source:'not-connected',sync_error:'Connect Intervals.icu in Settings to load your training.', retention_days:90 }, contextScope)));
      return;
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
      const config=await readConfig(),id=decodeURIComponent(editorRoute[1]),request=createIntervalsClient(config);
      try {
        if(req.method==='GET'){sendJson(req,res,await loadWorkoutEditor(request,id));return;}
        const result=await saveWorkoutEditor(request,id,await readBody(req),providerConnection(config));
        intervalsMemoryCache=null;
        providerReads.clear();
        const today=athleteLocalDate(new Date(),config.TIME_ZONE || 'America/Chicago');
        result.workout=mapIntervalsWorkout(result.event,today);
        try {
          const snapshot=await loadSupabaseTrainingSnapshot(config) || await fetchIntervalsTrainingContext(config,{force:true});
          if(snapshot){
            const context={...applyVerifiedEvent(snapshot,id,result,'edit'),provider:'intervals',provider_connection:providerConnection(config)};
            result.workout=[...context.history,...context.planned].find(w=>w.id===id);
            result.context=await saveVerifiedSnapshot(config,context);
            await fs.writeFile(intervalsCachePath,JSON.stringify(context));
          }
        } catch(error) { result.refreshWarning='Saved and verified in Intervals.icu; the durable calendar refresh is pending. Refresh the calendar to retry.';updateLogs(`Workout editor context refresh pending: ${error.message}`); }
        sendJson(req,res,result);return;
      } catch(error) {res.writeHead(error.status || 500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.message,code:error.code || 'PROVIDER_ERROR'}));return;}
    }

    if(pathname==='/api/calendar/workout-description' && req.method==='POST'){
      const config=await readConfig(),{id,description}=await readBody(req);
      const result=await updateWorkoutDescription(intervalsClient(config),id,description);
      intervalsMemoryCache=null;
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      if(snapshot){
        const map=w=>w.id===id?{...w,details:description,goal:description,app_updated_at:new Date().toISOString()}:w;
        result.context=await saveVerifiedSnapshot(config,{...snapshot,history:snapshot.history.map(map),planned:snapshot.planned.map(map)});
      }
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
    }
    const routeMap=pathname.match(/^\/api\/activities\/(i\d+|\d+)\/route$/);
    if(routeMap && req.method==='GET'){
      const config=await readConfig();
      const archive=createCompletedWorkoutStore(config,createContextStore(config,updateLogs));
      const points=await loadActivityView(archive,config,intervalsClient(config),routeMap[1],'route');
      sendJson(req,res,{points},'private,max-age=300');return;
    }

    const summaryRoute=pathname.match(/^\/api\/activities\/(i\d+|\d+)\/summary$/);
    if(summaryRoute && req.method==='GET'){
      const config=await readConfig();
      const request=intervalsClient(config);
      const archive=createCompletedWorkoutStore(config,createContextStore(config,updateLogs));
      const summary=await loadActivityView(archive,config,request,summaryRoute[1],'summary');
      sendJson(req,res,summary);return;
    }

    const analysisRoute=pathname.match(/^\/api\/activities\/(i\d+|\d+)\/analysis$/);
    if(analysisRoute && req.method==='GET'){
      const config=await readConfig(),id=analysisRoute[1],request=intervalsClient(config);
      const archive=createCompletedWorkoutStore(config,createContextStore(config,updateLogs));
      const analysis=await loadActivityView(archive,config,request,id,'analysis');
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
        try {results.push(await changeIntervalsEvent(request,`event:${event.id}`,action));}
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
      const result = action === 'move'
        ? await moveIntervalsEvent(request,id,payload.date)
        : await changeIntervalsEvent(request,id,action);
      intervalsMemoryCache = null;
      const snapshot=await loadSupabaseTrainingSnapshot(config);
      const context=snapshot?await saveVerifiedSnapshot(config,applyVerifiedEvent(snapshot,id,result,action)):null;
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify({...result,context}));
      return;
    }

    const coachInputMatch=pathname.match(/^\/api\/workouts\/([^/]+)\/coach-input$/);
    if(coachInputMatch && (req.method==='GET' || req.method==='POST')) {
      const workoutId=decodeURIComponent(coachInputMatch[1]),payload=req.method==='POST'?await readBody(req):{};
      const config=await readConfig();
      const context=await buildCoachContext(config,{cacheOnly:true});
      const workout=[...(context.history || []),...(context.planned || [])].find(item=>String(item.id)===workoutId);
      if(!workout)throw new Error('Workout not found in the current Intervals.icu calendar');
      const completed=Boolean(workout.completed || workout.status==='completed' || workout.activity_id);
      const commentType=completed?'coach_note_completed':'coach_note_planned';
      const existing=(context.comments || []).find(item=>item.workout_id===workoutId&&item.type===commentType&&(completed||!workout.source_updated_at||Date.parse(item.created_at)>=Date.parse(workout.source_updated_at)));
      if(req.method==='GET'){sendJson(req,res,{comment:existing || null,cached:Boolean(existing)});return;}
      // Planned-workout guidance is a single durable recommendation. A client
      // cannot regenerate it by sending refresh=true after it has been saved.
      if(existing&&(!payload.refresh||!completed)){sendJson(req,res,{comment:existing,cached:true});return;}
      const prompt=completed
        ? `Review the completed workout ${workoutId} (${workout.title}) using fresh data. Write a concise coach comment for the workout page in natural Markdown. Lead with the main takeaway in one or two sentences. Compare execution with the prescription when both exist; state plainly what was executed well or missed, what it suggests about progression, and one or two actionable considerations for upcoming training. Include only decision-relevant data, do not invent unavailable metrics, and do not add a confidence or raw-data section. Return only the comment.`
        : `Review the planned workout ${workoutId} (${workout.title}) using fresh current context. Write a concise pre-workout coach comment for the workout page in natural Markdown. Begin with **Today’s recommendation: Go**, **Today’s recommendation: Modify**, or **Today’s recommendation: Skip**, followed by the main reason. Explain its purpose, give the most important execution cues, and briefly state material uncertainty only when it changes the advice. Include only decision-relevant data, do not invent unavailable metrics, and clearly describe any change as proposed rather than saved. Return only the comment.`;
      const jobKey=`${workoutId}:${commentType}`;
      let job=coachCommentJobs.get(jobKey);
      if(!job) {
        job=(async()=>{
          const body=await runCoach(prompt,[],`workout-comment:${workoutId}`,null,{context,disableTools:true});
          const comment=await addLocalComment(workoutId,body,commentType);
          const store=createContextStore(config,updateLogs);
          if(store.ready)await store.upsert('athlete_comments',[{id:stableUuid(`comment:${comment.id}`),athlete_id:String(context.athlete?.id || 'default'),workout_id:workoutId,comment_type:'coach_note',body:comment.body,created_at:comment.created_at}]);
          return comment;
        })().finally(()=>coachCommentJobs.delete(jobKey));
        coachCommentJobs.set(jobKey,job);
      }
      const comment=await job;
      sendJson(req,res,{comment,cached:false});return;
    }

    if (pathname.startsWith('/api/workouts/') && (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PATCH')) {
      throw new Error('Only Intervals.icu calendar events can be changed. Refresh the calendar first.');
    }

    if (req.url?.startsWith('/api/workouts/') && req.method === 'PATCH') {
      const id = decodeURIComponent(req.url.split('/').pop());
      const payload = await readBody(req);
      const workout = await updateLocalWorkout(id, String(payload.change || 'Approved coaching adjustment'));
      updateLogs(`local workout updated: ${id}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(workout));
      return;
    }

    if (pathname === '/api/conversations' && req.method === 'GET') {
      const config = await readConfig();
      const conversations = await listCoachConversations(config, Number(requestUrl.searchParams.get('limit') || 500));
      res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
      res.end(JSON.stringify(conversations.map(conversationSummary)));
      return;
    }

    if (pathname === '/api/conversations' && req.method === 'POST') {
      const payload = await readBody(req);
      const title = String(payload.title || 'New conversation');
      const config = await readConfig();
      const review = payload.reviewId ? await getPersistentDailyReview(String(payload.reviewId)) : null;
      const requestedId = review?.conversation_id || payload.id;
      const conversationId = isUuid(requestedId)
        ? String(requestedId)
        : stableUuid(`conversation:${requestedId || `${Date.now()}:${Math.random()}`}`);
      const existing = await getCoachConversation(config, conversationId);
      const reviewMessageId = review ? `${review.id}:coach` : null;
      const reviewMessage = reviewMessageId
        ? { id:reviewMessageId, role:'assistant', content:review.conversation_text, created_at:review.created_at }
        : null;
      const incomingMessages = Array.isArray(payload.messages) ? payload.messages : [];
      const firstPrompt = String(incomingMessages.find(message => message.role === 'user')?.content || '').trim();
      const needsTitle = !existing || ['Coach', 'New conversation', 'New Conversation', firstPrompt.slice(0, 56)].includes(existing.title);
      const conversationTitle = !review && needsTitle
        ? await createConversationTitle(config, incomingMessages)
        : existing?.title || title;
      const conversation = await persistCoachConversation(config, {
        ...existing,
        id:conversationId,
        athlete_id:existing?.athlete_id || await currentConversationAthleteId(),
        title:review ? new Date(`${review.local_date}T12:00:00Z`).toLocaleDateString('en-US', { month:'short', day:'2-digit', timeZone:'UTC' }) + ' Review' : conversationTitle,
        kind:review ? 'daily_review' : 'conversation',
        review_id:review?.id || null,
        messages:reviewMessage ? [reviewMessage, ...incomingMessages.filter(message => message?.id !== reviewMessageId)] : incomingMessages,
        created_at:existing?.created_at || new Date().toISOString(),
        updated_at:new Date().toISOString(),
      });
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ...conversationSummary(conversation), saved:true }));
      return;
    }

    const conversationMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (conversationMatch && req.method === 'GET') {
      const config = await readConfig();
      const conversation = await getCoachConversation(config, decodeURIComponent(conversationMatch[1]));
      res.writeHead(conversation ? 200 : 404, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
      res.end(JSON.stringify(conversation || { error:'Conversation not found' }));
      return;
    }

    if (conversationMatch && req.method === 'PATCH') {
      const id = decodeURIComponent(conversationMatch[1]);
      const payload = await readBody(req);
      const config = await readConfig();
      const existing = await getCoachConversation(config, id);
      if (!existing) {
        res.writeHead(404, { 'Content-Type':'application/json' });
        res.end(JSON.stringify({ error:'Conversation not found' }));
        return;
      }
      const conversation = await persistCoachConversation(config, {
        ...existing,
        ...(typeof payload.pinned === 'boolean' ? { pinned:payload.pinned } : {}),
        updated_at:new Date().toISOString(),
      });
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(JSON.stringify(conversationSummary(conversation)));
      return;
    }

    if (conversationMatch && req.method === 'DELETE') {
      const id = decodeURIComponent(conversationMatch[1]);
      const config = await readConfig();
      const existing = await getCoachConversation(config, id);
      if (!existing) {
        res.writeHead(404, { 'Content-Type':'application/json' });
        res.end(JSON.stringify({ error:'Conversation not found' }));
        return;
      }
      const deletedAt = new Date().toISOString();
      await deleteLocalCoachConversation(id);
      const store = createContextStore(config, updateLogs);
      if (store.ready) await upsertSupabaseConversation(store, normalizeConversation({ ...existing, deleted_at:deletedAt, updated_at:deletedAt }));
      res.writeHead(204);
      res.end();
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
    res.writeHead(500, { 'Content-Type': 'application/json' });
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
