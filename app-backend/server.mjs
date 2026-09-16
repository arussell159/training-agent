import {loadWorkoutEditor,saveWorkoutEditor,loadNewWorkoutEditor,createWorkoutEditor} from './lib/workout-editor.mjs';
import { generateCoachResponse } from './lib/coach-response.mjs';
import { createIntervalsCoachAdapter } from './lib/triathlon-coach-adapter.mjs';
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
import {applyCompletionConfirmation} from './lib/completion-confirmation.mjs';
import {
  addLocalComment,
  deleteLocalCoachConversation,
  getDailyReview,
  getDailyReviewByDate,
  getNotificationPreferences as getLocalNotificationPreferences,
  getLocalCoachConversation,
  listDailyReviews,
  listLocalCoachConversations,
  readLocalContext,
  removePushSubscription as removeLocalPushSubscription,
  saveDailyReview,
  saveLocalCoachConversation,
  updateDailyReview,
  updateNotificationPreferences as updateLocalNotificationPreferences,
  updateLocalWorkout,
  upsertPushSubscription as upsertLocalPushSubscription,
} from './lib/local-context.mjs';
import { createDailyReviewService } from './lib/daily-review-service.mjs';
import { loadCoachingInstructions } from './lib/coaching-policy.mjs';
import { createConversationTitle } from './lib/conversation-title.mjs';
import { createIntervalsClient, fetchIntervalsContext, moveIntervalsEvent, changeIntervalsEvent, applyIntervalsPatch, mapIntervalsWorkout, validDate } from './lib/intervals.mjs';
import { activeConversations, conversationContext, conversationSummary, normalizeConversation } from './lib/conversation-history.mjs';
import {



  import8020BookPortions,
  readKnowledgeBase,

  verifiedPassages,
  writeKnowledgeBase,
} from './lib/evidence.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'config.json');
const uiDistPath = path.resolve(__dirname, '..', 'ui', 'dist');
const coachingConfigPath = path.join(__dirname, 'coaching-config.json');
const intervalsCachePath = path.join(process.env.VERCEL ? '/tmp' : __dirname, 'intervals.cache');
const knowledgeSourcesPath = path.join(__dirname, 'knowledge-sources.json');
let completionConfirmation=null;
try{completionConfirmation=await readDurableState('COMPLETION_CONFIRMATION',path.join(__dirname,'completion-confirmation.cache'),null);}catch(error){console.error('Completion confirmation unavailable:',error.message);}

const serverState = {
  child: null,
  logs: [],
  pid: null,
};

let intervalsMemoryCache = null;
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

export async function persistTrainingContext(config, context, {archiveActivities=true} = {}) {
  const store = createContextStore(config, updateLogs);
  if (!store.ready) return;
  const previous=await loadSupabaseTrainingSnapshot(config,context.athlete?.id);
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
  const coach = await readDurableState('COACHING_CONFIG',coachingConfigPath,{});
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
  const libraryRows = (context.library || []).filter(item => item?.title).map(item => ({
    id:stableUuid(`library:${item.id || item.title}`), athlete_id:athleteId,
    title:String(item.title), sport:String(item.sport || 'Other'), purpose:item.purpose || null,
    description:item.description || null, structure:item.structure || {}, tags:item.tags || [],
    updated_at:item.updated_at || new Date().toISOString(),
  }));
  await store.upsert('coaching_config', [{ athlete_id:athleteId, vision:coach.vision, instructions:coach.rules || [], race:{ name:context.athlete?.race, date:context.athlete?.race_date, phase:context.athlete?.phase }, zones:context.athlete?.zones || {}, updated_at:new Date().toISOString() }]);
  if (workoutRows.length) await store.upsert('workout_context', workoutRows);
  if (commentRows.length) await store.upsert('athlete_comments', commentRows);
  if (libraryRows.length) await store.upsert('workout_library', libraryRows);
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
    all.set(result.workoutId,{...mapIntervalsWorkout(result.event,today,prior?.raw_activity || null),app_updated_at:new Date().toISOString()});
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
  return settingsService.read(STORED_SETTINGS.filter(name=>!['APP_DATA','HISTORICAL_ARCHIVE','COACHING_CONFIG','KNOWLEDGE_BASE','TRAININGPEAKS_IMPORT_REPORT','RACE_PLAN_IMPORT_REPORT','COMPLETION_CONFIRMATION'].includes(name)));
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

async function buildCoachContext(config, coach, { force = false, strict = false } = {}) {
  const contextStore = createContextStore(config, updateLogs);
  const local = await readLocalContext();
  const timeZone = local.notification_preferences?.time_zone || local.athlete?.time_zone || 'America/Chicago';
  const raceDate = coach.race_date || local.athlete?.race_date;
  const raceTiming = assessRaceTiming(raceDate, timeZone);
  let context = {
    ...local,
    coaching:coach,
    history:[],planned:[],workouts:[],
  };

  if (contextStore.ready) {
    try {
      const snapshot = await loadSupabaseTrainingSnapshot(config,local.athlete?.id);
      if (snapshot) context = {...context,...snapshot,athlete:{...context.athlete,...snapshot.athlete},workouts:snapshot.history};
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
        athlete:{
          ...context.athlete,
          ...intervals.athlete,
          race:coach.race || context.athlete?.race,
          race_date:raceDate,
          phase:raceTiming.phase,
          days_to_race:raceTiming.daysToRace,
        },
        metrics:{ ...context.metrics, ...intervals.metrics },
        workouts:intervals.history,
        history:intervals.history,
        planned:intervals.planned,
        comments:context.comments || local.comments,
        library:context.library || local.library,
      };
      try {
        await persistTrainingContext(config, context);
      } catch (error) {
        updateLogs(`context write failed: ${error.message}`);
      }
    }
  }

  context.athlete = {
    ...(context.athlete || {}),
    race:coach.race || context.athlete?.race,
    race_date:raceDate,
    phase:raceTiming.phase,
    days_to_race:raceTiming.daysToRace,
  };

  return intervalsOnlyContext(context);
}

async function runCoach(message, history = [], conversationId = null) {
  const config = await readConfig();
  if (!config.OPENAI_API_KEY) throw new Error('OpenAI is not configured');
  if (!config.INTERVALS_API_KEY) throw new Error('Connect Intervals.icu in Settings before using live coaching');
  const coach = await readDurableState('COACHING_CONFIG',coachingConfigPath,{});
  const context = await buildCoachContext(config, coach, {force:true,strict:true});
  const guide = await loadCoachingInstructions();
  return generateCoachResponse(config, {
    guide, currentDate:athleteLocalDate(new Date(),context.notification_preferences?.time_zone || context.athlete?.time_zone || 'America/Chicago'),
    context,
    history, message,
    executeTool:createIntervalsCoachAdapter(intervalsClient(config)),

  });
}
async function streamCoach(message, history, res, conversationId = null) {
  const content = await runCoach(message, history, conversationId);
  res.writeHead(200, {
    'Content-Type':'text/event-stream; charset=utf-8',
    'Cache-Control':'no-cache, no-transform',
    'Connection':'keep-alive',
    'X-Accel-Buffering':'no',
  });
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type:'response.output_text.delta', delta:content })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
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
  const coach = await readDurableState('COACHING_CONFIG',coachingConfigPath,{});
  return buildCoachContext(config, coach, options);
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

    if (pathname === '/api/evidence/sources' && req.method === 'GET') {
      const knowledge = await readDurableState('KNOWLEDGE_BASE',knowledgeSourcesPath,()=>readKnowledgeBase(knowledgeSourcesPath));
      res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
      res.end(JSON.stringify({ version:knowledge.version, retrieved_at:knowledge.retrieved_at, sources:[...knowledge.sources, ...knowledge.imports] }));
      return;
    }

    if (pathname === '/api/evidence/import/8020-triathlon' && req.method === 'POST') {
      const imported = import8020BookPortions(await readBody(req));
      const knowledge = await readDurableState('KNOWLEDGE_BASE',knowledgeSourcesPath,()=>readKnowledgeBase(knowledgeSourcesPath));
      const imports = [...knowledge.imports.filter(item => item.id !== imported.id), imported];
      await writeDurableState('KNOWLEDGE_BASE',{ ...knowledge, imports },knowledgeSourcesPath);
      res.writeHead(201, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
      res.end(JSON.stringify({ imported:{ id:imported.id, title:imported.title, authors:imported.authors, edition:imported.edition, imported_at:imported.imported_at, scope_note:imported.scope_note, portions:imported.passages.map(item => ({ id:item.id, locator:item.locator, content_hash:item.content_hash })) } }));
      return;
    }

    if (req.url === '/api/coach' && req.method === 'POST') {
      const payload = await readBody(req);
      if (typeof payload.message !== 'string' || !payload.message.trim()) throw new Error('Message is required');
      const history = Array.isArray(payload.history)
        ? payload.history.slice(-10).filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').map(item => ({ role:item.role, content:item.content.slice(0, 4000) }))
        : [];
      const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : null;
      if (String(req.headers.accept || '').includes('text/event-stream')) {
        await streamCoach(payload.message.trim(), history, res, conversationId);
        return;
      }
      const message = await runCoach(payload.message.trim(), history, conversationId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message }));
      return;
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
      let coach={};
      try { coach=await readDurableState('COACHING_CONFIG',coachingConfigPath,{}); }
      catch { try { coach=JSON.parse(await fs.readFile(coachingConfigPath,'utf8')); } catch {} }
      const timeZone = local.notification_preferences?.time_zone || local.athlete?.time_zone || 'America/Chicago';
      const raceDate = coach.race_date || local.athlete?.race_date;
      const raceTiming = assessRaceTiming(raceDate, timeZone);
      const athleteWithRace = athlete => ({
        ...local.athlete,
        ...(athlete || {}),
        race:coach.race || local.athlete?.race,
        race_date:raceDate,
        phase:raceTiming.phase,
        days_to_race:raceTiming.daysToRace,
      });
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
