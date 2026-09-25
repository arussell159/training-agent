import { apiFetch } from "@/lib/api-client"
import {readDeviceCache,writeDeviceCache,clearDeviceCache} from './device-cache'
export interface TrainingHistoryItem {
  workout_date: string
  planned?: { duration_minutes?: number; tss?: number }
  completed?: { duration_minutes?: number }
  recovery?: { hrv?: number | null; resting_hr?: number | null }
}

export interface WorkoutSummaryValues {
  elapsed_time_seconds?:number|null;elapsed_speed?:number|null;
  min_hr?:number|null;min_speed?:number|null;min_power?:number|null;max_power?:number|null;average_cadence?:number|null;min_cadence?:number|null;max_cadence?:number|null;
  duration_seconds?: number | null; distance_meters?: number | null; average_speed?: number | null; max_speed?: number | null;
  calories?: number | null; elevation_gain?: number | null; elevation_loss?: number | null; tss?: number | null;
  normalized_power?: number | null; intensity_factor?: number | null; work_kj?: number | null; average_power?: number | null; average_hr?: number | null; max_hr?: number | null;
  temperature_c?: number | null; humidity_percent?: number | null; latitude?: number | null; longitude?: number | null;
}

export interface PlannedWorkout {
  app_description_version?: number
  editor_model?: import('../../../app-backend/lib/workout-editor-model.mjs').WorkoutModel
  planned_time_label?: string | null
  source_updated_at?: string | null
  id: string
  day: string
  activity_id?: string | null
  recorded_start_local?: string | null
  device_name?: string | null
  completion_grade?: 'good' | 'medium' | 'failed'
  date: string
  workout_date?: string
  sport: string
  title: string
  duration: string
  distance_meters?: number | null
  goal: string
  details?: string
  status: "completed" | "today" | "upcoming"
  load?: number
  plannedDurationMinutes?: number
  actualDurationMinutes?: number
  planned?: { duration_minutes?: number; tss?: number; power_watts?: number; pace_seconds_per_unit?: number }
  completed_data?: { duration_minutes?: number; tss?: number; power_watts?: number; pace_seconds_per_unit?: number }
  scheduled_start_at?: string | null
  structure?: string | null
  workout_summary?: {planned:WorkoutSummaryValues|null;completed:WorkoutSummaryValues|null}
}

export interface LibraryWorkout {
  id: string
  sport: string
  title: string
  duration: string
  purpose: string
  tags?: string[]
}

export interface TrainingContext {
  athlete: {
    time_zone?: string
    name?: string
    race?: string
    race_date?: string
    days_to_race?: number | null
    phase?: string
    zones?: {
      bike_ftp?: number | null
      run_threshold_pace?: string | null
      swim_css?: string | null
      threshold_hr?: number | null
    }
    zone_history?: Array<{recorded_at:string;bike_ftp?:number|null;run_threshold_pace?:string|null;swim_css?:string|null;threshold_hr?:number|null}>
  }
  metrics: {
    fitness?: number
    fatigue?: number
    form?: number
    recovery?: number
  }
  wellness?: {
    hrv?: number | null
    resting_hr?: number | null
    sleep?: number | null
  }
  wellness_history?: Array<{date?: string; id?: string; timeStamp?: string; [key:string]:unknown}>
  history: TrainingHistoryItem[]
  planned: PlannedWorkout[]
  library?: LibraryWorkout[]
  source?: string
  synced_at?: string
  sync_error?: string | null
  context_scope?: "week" | "full" | "range"
  full_history_available?: boolean
}




export const fallbackTrainingContext: TrainingContext = {
  athlete: {
    name: "Alex Russell",
    race: "IRONMAN 70.3 Waco",
    race_date: "2026-10-04",
    phase: "Race-specific",
    zones: {
      bike_ftp: 278,
      run_threshold_pace: "7:12/mi",
      swim_css: "1:38/100yd",
      threshold_hr: 168,
    },
  },
  metrics: {},
  history: [],
  planned: [],
  source: "local-preview",
}

const contextCache = new Map<"week" | "full", TrainingContext>()
const contextRequests = new Map<"week" | "full", Promise<TrainingContext>>()
const networkLoadedScopes = new Set<"week" | "full">()
let contextRevision = 0
let mutationsInFlight=0
const STARTUP_KEY='training-agent-startup-v2'
export function trainingMutationState() {return {revision:contextRevision,busy:mutationsInFlight>0}}
if(typeof window!=='undefined')window.addEventListener('training-cache-reset',()=>{contextRevision++;contextCache.clear();contextRequests.clear();networkLoadedScopes.clear();try{localStorage.removeItem(STARTUP_KEY)}catch{/* Storage is optional. */}})
type CachedContext = TrainingContext & {cache_scope?:string;version?:string;display_range?:{start:string;end:string}}
export function cachedTrainingContext(): TrainingContext {
  // Prefer the complete archive once it has loaded. A later fast-week update
  // must not replace history charts with the short startup window.
  const memory=contextCache.get('full') || contextCache.get('week')
  if(memory)return memory
  try {
    const saved=JSON.parse(localStorage.getItem(STARTUP_KEY) || 'null') as TrainingContext | null
    if(saved?.athlete && Array.isArray(saved.history) && Array.isArray(saved.planned)) {
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:saved.athlete.time_zone || 'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
      const sessions=[...new Map([...saved.history,...saved.planned].map(w=>[(w as PlannedWorkout).id,w as PlannedWorkout])).values()].filter((w):w is PlannedWorkout & {workout_date:string}=>typeof w.workout_date==='string')
      const context={...saved,history:sessions.filter(w=>w.workout_date<=day),planned:sessions.filter(w=>w.workout_date>=day)}
      contextCache.set(saved.context_scope==='full'?'full':'week',context);return context
    }
  } catch { /* No cache, or storage is unavailable. */ }
  return fallbackTrainingContext
}
export function rememberTrainingContext(context: CachedContext,scope:'week'|'full'='week') {
  const previous=(contextCache.get('full') || contextCache.get('week')) as CachedContext | undefined
  if(previous?.cache_scope && context.cache_scope && previous.cache_scope!==context.cache_scope) {
    contextCache.clear();void clearDeviceCache()
  }
  contextCache.set(scope,context)
  if(scope==='week' && contextCache.has('full')) {
    const merged=mergeCalendarContext(contextCache.get('full')!,context)
    contextCache.set('full',merged);void writeDeviceCache('training:full',merged)
  }
  if(scope==='full')void writeDeviceCache('training:full',context)
  const day=new Date();const today=new Intl.DateTimeFormat('en-CA',{timeZone:context.athlete.time_zone || 'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(day)
  const start=new Date(`${today}T12:00:00Z`);start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7))
  const date=(n:number)=>new Date(start.getTime()+n*86400000).toISOString().slice(0,10)
  const startupSource=contextCache.get('full') || context
  const hasFullHistory=contextCache.has('full')
  const week:CachedContext={...startupSource,context_scope:hasFullHistory?'full':'week',display_range:hasFullHistory?{start:date(-77),end:date(13)}:context.display_range || {start:date(-14),end:date(13)},history:startupSource.history.filter(w=>w.workout_date>=date(hasFullHistory?-77:-14)),planned:startupSource.planned,wellness_history:startupSource.wellness_history?.filter(w=>(w.date || '')>=date(hasFullHistory?-106:-30))}
  contextCache.set('week',week)
  try {localStorage.setItem(STARTUP_KEY,JSON.stringify(week))} catch { /* Cache is optional. */ }
  if(!previous?.version || previous.version!==context.version || scope==='full')window.dispatchEvent(new CustomEvent('training-context-updated',{detail:context}))
}
export function trainingCacheScope() {return (cachedTrainingContext() as CachedContext).cache_scope || 'initial'}
export function mergeCalendarContext(previous:TrainingContext,incoming:CachedContext): TrainingContext {
  const range=incoming.display_range
  const merge=<T extends {workout_date?:string}>(old:T[],next:T[])=>[...new Map([...old.filter(w=>!range || (w.workout_date || '')<range.start || (w.workout_date || '')>range.end),...next].map(w=>[(w as T & {id?:string}).id,w])).values()]
  return {...previous,...incoming,history:merge(previous.history,incoming.history),planned:merge(previous.planned,incoming.planned),wellness_history:[...new Map([...(previous.wellness_history || []),...(incoming.wellness_history || [])].map(w=>[w.date,w])).values()]}
}
export async function hydrateDeviceHistory() {
  const saved=await readDeviceCache<CachedContext>('training:full')
  if(saved && (trainingCacheScope()==='initial' || saved.cache_scope===trainingCacheScope())) {
    const context=mergeCalendarContext(saved,cachedTrainingContext() as CachedContext);contextCache.set('full',context);return context
  }
  return null
}

export type ManualRefreshProgress = {
  phase: "starting" | "intervals" | "saving" | "github" | "finalizing" | "complete" | "error"
  label: string
  requestId?: string | null
  completed?: number | null
  total?: number | null
  status?: string
  currentStep?: string | null
  error?: string
}

export async function refreshRecentIntervals(onProgress?: (progress: ManualRefreshProgress) => void) {
  const syncId=crypto.randomUUID()
  let progressId:string=syncId
  const report=(progress:ManualRefreshProgress)=>onProgress?.(progress)
  report({phase:"starting",label:"Starting manual refresh",completed:0,total:1})
  let requestDone=false
  const request=(async()=>{
    const trainingResponse=await apiFetch(`/api/sync?trainingOnly=1&forceIntervals=1&retry=1&syncId=${encodeURIComponent(syncId)}`,{
      method:"POST",headers:{Accept:"application/json"},
    })
    const training=await trainingResponse.json() as {context?:TrainingContext;sync_error?:string;error?:string}
    if(!trainingResponse.ok || !training.context)throw Error(training.error || `Intervals.icu refresh failed (${trainingResponse.status})`)
    if(training.sync_error)throw Error(training.sync_error)
    rememberTrainingContext(training.context,'full')
    const exportResponse=await apiFetch(`/api/sync?section11Only=1&syncId=${encodeURIComponent(syncId)}`,{
      method:"POST",headers:{Accept:"application/json"},
    })
    const exported=await exportResponse.json() as {section11Sync?:{requestId?:string;status:string;error?:string|null;label?:string;progress?:{completed:number;total:number;currentStep:string|null}};error?:string}
    return {context:training.context,section11Sync:exported.section11Sync || {status:'failed',error:exported.error || `Section 11 export failed (${exportResponse.status})`}}
  })().finally(()=>{requestDone=true})
  const pollProgress=(async()=>{
    while(!requestDone){
      await new Promise(resolve=>setTimeout(resolve,1500))
      if(requestDone)break
      try{
        const response=await apiFetch(`/api/sync/progress?id=${encodeURIComponent(progressId)}`)
        if(response.ok){
          const progress=await response.json() as ManualRefreshProgress
          if(progress.requestId)progressId=progress.requestId
          report(progress)
        }
      }catch{/* The main sync request reports errors; progress polling is best effort. */}
    }
  })()
  let result:Awaited<typeof request>
  try{
    result=await request
  }finally{
    requestDone=true
    await pollProgress
  }
  if(result.section11Sync?.requestId)progressId=result.section11Sync.requestId
  let progress=result.section11Sync
  const reportGithub=(value:typeof progress)=>{
    if(!value)return
    const steps=value.progress
    report({
      phase:"github",
      requestId:value.requestId || undefined,
      label:value.label || (steps?.currentStep ? `Section 11 · ${steps.currentStep}` : `Section 11 · ${value.status}`),
      status:value.status,
      completed:steps?.completed ?? null,
      total:steps?.total ?? null,
      currentStep:steps?.currentStep || null,
      error:value.error || undefined,
    })
  }
  reportGithub(progress)
  const deadline=Date.now()+30*60_000
  while(progress && ["dispatching","queued","running","checking","waiting"].includes(progress.status) && Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,5000))
    const status=await apiFetch(`/api/sync/progress?id=${encodeURIComponent(progressId)}`)
    if(!status.ok)throw Error("Training refreshed; Section 11 sync status could not be checked.")
    progress=await status.json()
    reportGithub(progress as typeof progress)
  }
  if(progress && progress.status!=="complete")throw Error(progress.error || (["failed","unavailable"].includes(progress.status)?"Training refreshed; Section 11 sync failed. Try Refresh again.":"Training refreshed; Section 11 sync is still running. Check again shortly."))
  report({phase:"finalizing",label:"Loading refreshed data into the app",completed:0,total:1})
  const context=await loadTrainingContext(false,"full",true)
  report({phase:"complete",label:"Refresh complete",completed:1,total:1})
  return context
}

export async function moveWorkoutDate(id: string, date: string) {
  return queueWorkoutMutation({type:'move',id,date})
}
export async function queueWorkoutMutation(input:{type:'move'|'description';id:string;date?:string;description?:string}) {
  contextRevision++;mutationsInFlight++
  try{
    const response=await apiFetch('/api/mutations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,operationId:crypto.randomUUID()})})
    const result=await response.json() as {queued?:boolean;verified?:boolean;error?:string;context?:TrainingContext|null}
    if(!response.ok || !result.context || !(result.queued || result.verified))throw Error(result.error || 'The change could not be saved in Supabase.')
    rememberTrainingContext(result.context,'full')
    window.dispatchEvent(new Event('request-background-sync'))
    return result
  }finally{mutationsInFlight--}
}

export async function changeWorkout(id: string, action: "copy" | "delete") {
  contextRevision++;mutationsInFlight++
  try {
  const response = await apiFetch(`/api/workouts/${encodeURIComponent(id)}${action === "copy" ? "/copy" : ""}`, {
    method: action === "copy" ? "POST" : "DELETE",
    headers: { Accept: "application/json" },
  })
  const result = await response.json() as {verified?: boolean; error?: string; context?: TrainingContext | null}
  if (!response.ok || !result.verified) throw new Error(result.error || `Unable to ${action} workout.`)
  const previous = contextCache.get("full") || contextCache.get("week")
  contextCache.clear()
  if (result.context) {
    const context = {...previous, ...result.context} as TrainingContext
    rememberTrainingContext(context,'full')
  }
  return result
  } finally {mutationsInFlight--}
}

export async function changeWorkoutDay(date: string, action: "copy" | "delete") {
  contextRevision++;mutationsInFlight++
  try {
  const response = await apiFetch("/api/calendar/day-actions", {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({date,action}),
  })
  const result = await response.json() as {error?: string; results: Array<{workoutId:string}>; failures:Array<{error:string}>; total:number; context:TrainingContext | null}
  if (!response.ok) throw new Error(result.error || "Unable to update workouts for this day.")
  const previous = contextCache.get("full") || contextCache.get("week")
  contextCache.clear()
  if (result.context) {
    const context = {...previous,...result.context} as TrainingContext
    rememberTrainingContext(context,'full')
  }
  return result
  } finally {mutationsInFlight--}
}

export async function loadTrainingContext(forceRefresh = false, scope: "week" | "full" = "week", networkOnly=false): Promise<TrainingContext> {
  const requireNetwork = networkOnly || !networkLoadedScopes.has(scope)
  if (forceRefresh) {
    contextRevision += 1
    contextRequests.clear()
  }
  if (!forceRefresh) {
    const cached = contextCache.get(scope)
    if (cached && !requireNetwork) return cached
    const pending = contextRequests.get(scope)
    if (pending) return pending
  }
  const revision = contextRevision
  const request = (async () => {
  try {
    const query = new URLSearchParams({ scope })
    if (forceRefresh) query.set("refresh", "1")
    const response = await apiFetch(`/api/training-context?${query}`, {
      headers: { Accept: "application/json" },
    })
    if (!response.ok) throw new Error(`Training context ${response.status}`)
    const context = (await response.json()) as TrainingContext
    networkLoadedScopes.add(scope)
    if (revision !== contextRevision) {
      return contextCache.get("full") || contextCache.get("week") || loadTrainingContext(false, scope)
    }
    if (context.sync_error && /authentication|401|403|expired|credential/i.test(context.sync_error)) {
      window.dispatchEvent(new CustomEvent("intervals-auth-expired"))
    }
    rememberTrainingContext(context,scope)
    return context
  } catch {
    return cachedTrainingContext()
  }
  })()
  contextRequests.set(scope, request)
  try {
    return await request
  } finally {
    if (contextRequests.get(scope) === request) contextRequests.delete(scope)
  }
}
export function revalidateTrainingContext() {return loadTrainingContext(false,'week',true)}

export function loadFullTrainingContext(forceRefresh = false, networkOnly = false) {
  return loadTrainingContext(forceRefresh, "full", networkOnly)
}

export function durationMinutes(workout: PlannedWorkout) {
  if (Number.isFinite(workout.plannedDurationMinutes)) {
    return Number(workout.plannedDurationMinutes)
  }
  if (Number.isFinite(workout.planned?.duration_minutes)) {
    return Number(workout.planned?.duration_minutes)
  }

  const hours = Number(workout.duration.match(/(\d+)h/)?.[1] ?? 0)
  const minutes = Number(workout.duration.match(/(\d+)\s*m/)?.[1] ?? 0)
  return hours * 60 + minutes
}

export function completedMinutes(workout: PlannedWorkout) {
  if (Number.isFinite(workout.actualDurationMinutes)) {
    return Number(workout.actualDurationMinutes)
  }
  if (Number.isFinite(workout.completed_data?.duration_minutes)) {
    return Number(workout.completed_data?.duration_minutes)
  }
  return workout.status === "completed" ? durationMinutes(workout) : 0
}
