import { apiFetch } from "@/lib/api-client"
import {
  readDeviceCache,
  writeDeviceCache,
  clearDeviceCache,
} from "./device-cache"
import { randomId } from "@/lib/random-id"
import { validatedTrainingContext, validatedTrainingWorkout } from "./training-context-validation"
import { withRequestDeadline, waitForRequestDelay } from "./request-deadline"
import { twelveWeekStart } from "../../../app-backend/lib/training-retention.mjs"
import { projectOptimisticWorkout, rollbackOptimisticWorkout, clearOptimisticWorkout, type OptimisticWorkoutChange } from "./optimistic-workout"
import { applyVerifiedCalendarPair, removeVerifiedCalendarPlans } from "./calendar-interactions"
import { mergeVerifiedWorkout } from "./workout-save-state"
import { acceptWorkoutCommit, overlayWorkoutCommits, startWorkoutCommitRecovery, localCommittedWorkout, committedWorkouts, restoreWorkoutCommits } from "./workout-commits"
import { workoutRevisionInput } from "../../../app-backend/lib/workout-revision-input.mjs"
import { importWorkout } from "../../../app-backend/lib/workout-editor-model.mjs"
export interface TrainingHistoryItem {
  workout_date: string
  planned?: { duration_minutes?: number; tss?: number }
  completed?: { duration_minutes?: number }
  recovery?: { hrv?: number | null; resting_hr?: number | null }
}

export interface HeartRateZoneSummary {
  seconds: number[]
  boundaries_bpm: number[]
  threshold_bpm: number | null
}

export interface WorkoutSummaryValues {
  recorded_thresholds?: import("../../../app-backend/lib/recorded-analysis-thresholds.mjs").RecordedAnalysisThresholds | null
  power_load?: number | null
  hr_load?: number | null
  pace_load?: number | null
  hr_load_type?: string | null
  pace_load_type?: string | null
  heart_rate_zones?: HeartRateZoneSummary | null
  power_zone_times?: import("../../../app-backend/lib/recorded-zone-times.mjs").RecordedZoneTimes | null
  pace_zone_times?: import("../../../app-backend/lib/recorded-zone-times.mjs").RecordedZoneTimes | null
  elapsed_time_seconds?: number | null
  elapsed_speed?: number | null
  min_hr?: number | null
  min_speed?: number | null
  min_power?: number | null
  max_power?: number | null
  average_cadence?: number | null
  min_cadence?: number | null
  max_cadence?: number | null
  duration_seconds?: number | null
  distance_meters?: number | null
  average_speed?: number | null
  max_speed?: number | null
  calories?: number | null
  elevation_gain?: number | null
  elevation_loss?: number | null
  tss?: number | null
  normalized_power?: number | null
  intensity_factor?: number | null
  work_kj?: number | null
  average_power?: number | null
  average_hr?: number | null
  max_hr?: number | null
  temperature_c?: number | null
  humidity_percent?: number | null
  latitude?: number | null
  longitude?: number | null
}

export interface PlannedWorkout {
  structure_read_only?: boolean
  template_metadata_error?: string
  display_variant?: "brick" | "day-off" | "custom"
  unstructured?: boolean
  calendar_event_key?: string
  calendar_annotation?: import("../../../app-backend/lib/calendar-annotations-model.mjs").CalendarAnnotation
  calendar_annotation_key?: string
  calendar_annotation_kind?: "goals" | "availability"
  calendar_annotation_error?: string
  workout_end_date?: string
  app_pending_operation?: string
  sync_status?: string
  planned_values_edited?: boolean
  category?: string
  app_description_version?: number
  editable_description?: string
  manual_description?: string
  editor_model?: import("../../../app-backend/lib/workout-editor-model.mjs").WorkoutModel
  planned_time_label?: string | null
  source_updated_at?: string | null
  id: string
  day: string
  activity_id?: string | null
  provider_type?: string | null
  activity_type?: string | null
  recorded_start_local?: string | null
  device_name?: string | null
  completion_grade?: "good" | "medium" | "failed"
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
  planned?: {
    duration_minutes?: number
    tss?: number
    power_watts?: number
    pace_seconds_per_unit?: number
  }
  completed_data?: {
    duration_minutes?: number
    tss?: number
    power_watts?: number
    pace_seconds_per_unit?: number
  }
  scheduled_start_at?: string | null
  planned_workout_date?: string | null
  structure?: string | null
  workout_summary?: {
    planned: WorkoutSummaryValues | null
    completed: WorkoutSummaryValues | null
  }
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
    zone_history?: Array<{
      recorded_at: string
      bike_ftp?: number | null
      run_threshold_pace?: string | null
      swim_css?: string | null
      threshold_hr?: number | null
    }>
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
  wellness_history?: Array<{
    date?: string
    id?: string
    timeStamp?: string
    [key: string]: unknown
  }>
  history: TrainingHistoryItem[]
  planned: PlannedWorkout[]
  library?: LibraryWorkout[]
  source?: string
  synced_at?: string
  sync_error?: string | null
  context_scope?: "week" | "full" | "range"
  display_range?: { start: string; end: string }
  full_history_available?: boolean
  retention_days?: number
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
const contextRequests = new Map<
  "week" | "full",
  { promise: Promise<TrainingContext>; revision: number; forced: boolean }
>()
const networkLoadedScopes = new Set<"week" | "full">()
let contextRevision = 0
let mutationsInFlight = 0
const mutationRequests = new Set<AbortController>()
let contextSessionRevision = 0
const workoutWriteRevisions = new Map<string, number>()
const coachSchedulingReceipts = new Set<string>()
const activeCoachScheduling = new Map<string,Promise<import("./coach-client").CalendarProposal>>()
const confirmedCoachItems = new Map<string,Map<number,string>>()
const STARTUP_KEY = "training-agent-startup-v2"
const STARTUP_METADATA_KEY = "training-agent-startup-metadata-v1"
function beginMutation() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("training-mutation-started"))
  contextRevision++
  contextRequests.clear()
  networkLoadedScopes.clear()
  mutationsInFlight++
  return contextRevision
}
function optimisticWorkout(change: Omit<OptimisticWorkoutChange, "operation">, title: string, notify: boolean | "complete" = "complete") {
  const before = cachedTrainingContext()
  const startedRevision = contextRevision
  const sessionRevision = contextSessionRevision
  const intent = { ...change, operation: randomId() }
  workoutWriteRevisions.delete(change.id)
  workoutWriteRevisions.set(change.id, startedRevision)
  if (workoutWriteRevisions.size > 512) workoutWriteRevisions.delete(workoutWriteRevisions.keys().next().value!)
  let settled = false
  const publish = (context: TrainingContext) => {
    if (sessionRevision !== contextSessionRevision) return
    const scope = contextCache.has("full") || context.context_scope === "full" ? "full" : "week"
    context = { ...context, context_scope: scope }
    rememberTrainingContext(context, scope)
    window.dispatchEvent(new CustomEvent("training-context-updated", { detail: context }))
  }
  const feedback = (state: "pending" | "queued" | "success" | "error", error?: unknown, description?: string) => { if (sessionRevision === contextSessionRevision && notify && !(notify === "complete" && state === "pending")) window.dispatchEvent(new CustomEvent("training-write-feedback", { detail: { operation: intent.operation, workoutId:change.id, title: state === "pending" ? title : state === "queued" ? "Saved locally; sync pending" : state === "success" ? "Synced to Intervals.icu" : "Change wasn’t confirmed", state, description, error: error instanceof Error ? error.message : undefined } })) }
  try { publish(projectOptimisticWorkout(before, intent)) } catch { /* Invalid local projections never prevent provider validation. */ }
  feedback("pending")
  return {
    commit(workout: PlannedWorkout, context?: TrainingContext | null) {
      if (sessionRevision !== contextSessionRevision) throw new DOMException("Session changed", "AbortError")
      const current = cachedTrainingContext()
      if (workoutWriteRevisions.get(change.id) !== startedRevision) return {workout,context:current,applied:false}
      const providerContext=context?validatedTrainingContext(context):undefined
      const providerRow=providerContext && [...providerContext.history,...providerContext.planned].find(row=>"id" in row && row.id===workout.id) as PlannedWorkout | undefined
      // A write response acknowledges this workout. Its bounded snapshot may
      // predate another accepted write, so it cannot replace unrelated rows.
      const base=providerRow?mergeVerifiedWorkout(current,providerRow).context:current
      const saved = mergeVerifiedWorkout(base, validatedTrainingWorkout(workout), change.insert ? change.id : undefined)
      publish(saved.context)
      return {...saved,context:cachedTrainingContext(),applied:true}
    },
    confirm(queued = false, description?: string) { if(settled)return;settled=true;publish(clearOptimisticWorkout(cachedTrainingContext(), intent)); feedback(queued ? "queued" : "success",undefined,description); window.dispatchEvent(new Event("training-mutation-settled")) },
    fail(error: unknown) { if(settled)return;settled=true;try { publish(rollbackOptimisticWorkout(cachedTrainingContext(), before, intent)) } finally { feedback("error", error); window.dispatchEvent(new Event("training-mutation-settled")) } },
  }
}
/** One completion notification for a save containing several verified writes. */
export function beginWorkoutSaveFeedback(notify = true, workoutId?: string) {
  const operation=randomId(), session=contextSessionRevision
  let settled=false
  const finish=(state:"success"|"error", error?:unknown, description?:string)=>{
    if(settled)return;settled=true
    if(notify && session===contextSessionRevision)window.dispatchEvent(new CustomEvent("training-write-feedback",{detail:{operation,workoutId,state,title:state==="success"?"Synced to Intervals.icu":"Change wasn’t confirmed",description,error:error instanceof Error?error.message:undefined}}))
  }
  return {confirm:(description?:string)=>finish("success",undefined,description),fail:(error:unknown)=>finish("error",error)}
}
export function beginOptimisticWorkoutWrite(change: Omit<OptimisticWorkoutChange, "operation">, title = "Saving workout…") {
  beginMutation()
  const staged = optimisticWorkout(change, title)
  let finished = false
  return { ...staged, finish() { if (!finished) { finished = true; mutationsInFlight-- } } }
}
function acceptMutationContext(context: TrainingContext, revision: number) {
  if (revision !== contextRevision) return cachedTrainingContext()
  rememberTrainingContext(context, "full")
  networkLoadedScopes.add("full")
  networkLoadedScopes.add("week")
  return cachedTrainingContext()
}
export function trainingMutationState() {
  return { revision: contextRevision, busy: mutationsInFlight > 0 }
}
if (typeof window !== "undefined")
  for (const event of ["training-cache-reset", "app-auth-required"])
    window.addEventListener(event, () => {
      contextSessionRevision++
      workoutWriteRevisions.clear()
      coachSchedulingReceipts.clear()
      activeCoachScheduling.clear()
      confirmedCoachItems.clear()
      for (const controller of mutationRequests)
        controller.abort(new DOMException("Session changed", "AbortError"))
      mutationRequests.clear()
      delete (window as Window & { __trainingContextRequest?: Promise<Response | null> }).__trainingContextRequest
      delete (window as Window & { __trainingContextVersion?: string }).__trainingContextVersion
      recentRefresh?.controller.abort(
        new DOMException("Session changed", "AbortError")
      )
      recentRefresh = undefined
      contextRevision++
      contextCache.clear()
      contextRequests.clear()
      networkLoadedScopes.clear()
      try {
        localStorage.removeItem(STARTUP_KEY)
        localStorage.removeItem(STARTUP_METADATA_KEY)
      } catch {
        /* Storage is optional. */
      }
    })
type CachedContext = TrainingContext & {
  cache_scope?: string
  version?: string
  display_range?: { start: string; end: string }
}
export function cachedTrainingContext(): TrainingContext {
  // Prefer the complete archive once it has loaded. A later fast-week update
  // must not replace history charts with the short startup window.
  const memory = contextCache.get("full") || contextCache.get("week")
  if (memory) return memory
  try {
    const raw = JSON.parse(localStorage.getItem(STARTUP_KEY) || "null")
    if (raw) {
      const saved = validatedTrainingContext(raw)
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: saved.athlete.time_zone || "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
      const sessions = [
        ...new Map(
          [...saved.history, ...saved.planned].map((w) => [
            (w as PlannedWorkout).id || w,
            w as PlannedWorkout & { workout_date: string },
          ])
        ).values(),
      ]
      const context = {
        ...saved,
        history: sessions.filter((w) => w.workout_date <= day),
        planned: sessions.filter((w) => w.workout_date >= day),
      }
      contextCache.set(
        saved.context_scope === "full" ? "full" : "week",
        context
      )
      return context
    }
  } catch {
    /* No cache, or storage is unavailable. */
  }
  return fallbackTrainingContext
}
export function rememberTrainingContext(
  context: CachedContext,
  scope: "week" | "full" = "week"
) {
  context = overlayWorkoutCommits(validatedTrainingContext(context) as CachedContext)
  const previous = (contextCache.get("full") || contextCache.get("week")) as
    CachedContext | undefined
  if (
    previous?.cache_scope &&
    context.cache_scope &&
    previous.cache_scope !== context.cache_scope
  ) {
    contextSessionRevision++
    contextRevision++
    contextCache.clear()
    contextRequests.clear()
    networkLoadedScopes.clear()
    void clearDeviceCache()
  }
  contextCache.set(scope, context)
  if (scope === "week" && contextCache.has("full")) {
    const merged = mergeCalendarContext(contextCache.get("full")!, context)
    contextCache.set("full", merged)
    void writeDeviceCache(
      `training:${context.cache_scope || "initial"}:full`,
      merged
    )
  }
  if (scope === "full")
    void writeDeviceCache(
      `training:${context.cache_scope || "initial"}:full`,
      context
    )
  const day = new Date()
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: context.athlete.time_zone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(day)
  const start = new Date(`${today}T12:00:00Z`)
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
  const date = (n: number) =>
    new Date(start.getTime() + n * 86400000).toISOString().slice(0, 10)
  const startupSource = (contextCache.get("full") || context) as CachedContext
  const hasFullHistory = contextCache.has("full")
  const week: CachedContext = {
    ...startupSource,
    context_scope: hasFullHistory ? "full" : "week",
    display_range: hasFullHistory
      ? { start: date(-77), end: date(13) }
      : context.display_range || { start: date(-14), end: date(13) },
    history: startupSource.history.filter(
      (w) => w.workout_date >= date(hasFullHistory ? -77 : -14)
    ),
    planned: startupSource.planned,
    wellness_history: startupSource.wellness_history?.filter(
      (w) => (w.date || "") >= date(hasFullHistory ? -106 : -30)
    ),
  }
  contextCache.set("week", week)
  try {
    localStorage.setItem(STARTUP_KEY, JSON.stringify(week))
    if (hasFullHistory && startupSource.version)
      localStorage.setItem(STARTUP_METADATA_KEY, JSON.stringify({ version: startupSource.version }))
    else localStorage.removeItem(STARTUP_METADATA_KEY)
  } catch {
    /* Cache is optional. */
  }
  if (
    typeof window !== "undefined" &&
    (!previous?.version ||
      previous.version !== context.version ||
      scope === "full")
  )
    window.dispatchEvent(
      new CustomEvent("training-context-updated", { detail: context })
    )
}
export function trainingCacheScope() {
  return (cachedTrainingContext() as CachedContext).cache_scope || "initial"
}
export function rememberLiveTrainingContext(context: CachedContext) {
  context = validatedTrainingContext(context) as CachedContext
  // Supersede an older cached response still in flight when the live check wins.
  contextRevision++
  contextRequests.clear()
  rememberTrainingContext(context, "full")
  networkLoadedScopes.add("full")
  networkLoadedScopes.add("week")
}
export function mergeCalendarContext(
  previous: TrainingContext,
  incoming: CachedContext
): TrainingContext {
  const range = incoming.context_scope === "full" && incoming.retention_days && incoming.display_range?.start === "0000-01-01"
    ? { start: twelveWeekStart(new Date(), incoming.athlete.time_zone), end: "9999-12-31" }
    : incoming.display_range
  const incomingIds = new Set([...incoming.history, ...incoming.planned].map(row => (row as PlannedWorkout).id).filter(Boolean))
  const merge = <T extends { workout_date?: string }>(old: T[], next: T[]) => {
    const rows = new Map<string | T, T>()
    for (const row of [
      ...old.filter(
        (w) => {
          const row=w as T & Partial<PlannedWorkout>
          if(row.id && incomingIds.has(row.id))return false
          if(incoming.context_scope!=="range" && row.app_pending_operation)return false
          return !range || (w.workout_date || "") < range.start || (w.workout_date || "") > range.end
        }
      ),
      ...next,
    ]) {
      const id = (row as T & { id?: string }).id
      rows.set(id || row, row)
    }
    return [...rows.values()]
  }
  return {
    ...previous,
    // A historical page describes only its date range. Its cache/version,
    // athlete and wellness summary must never replace the current live view.
    ...(incoming.context_scope === "range" ? {} : incoming),
    history: merge(previous.history, incoming.history),
    planned: merge(previous.planned, incoming.planned),
    wellness_history: [
      ...new Map(
        [
          ...(previous.wellness_history || []),
          ...(incoming.wellness_history || []),
        ].map((w) => [w.date || w.id || w, w])
      ).values(),
    ],
  }
}
export function rememberWorkoutForEditing(workout: PlannedWorkout) {
  if(!/^(event:[1-9]\d*|activity:i?\d+)$/.test(workout.id))return
  const current=cachedTrainingContext()
  if([...current.history,...current.planned].some(row=>"id" in row && row.id===workout.id))return
  rememberTrainingContext(mergeVerifiedWorkout(current,workout).context,"full")
}
export async function hydrateDeviceHistory() {
  const revision = contextRevision,
    scope = trainingCacheScope()
  const saved = await readDeviceCache<CachedContext>(`training:${scope}:full`)
  if (
    revision !== contextRevision ||
    scope !== trainingCacheScope() ||
    networkLoadedScopes.has("full")
  )
    return null
  if (saved && (saved.cache_scope || "initial") === scope)
    try {
      const context = mergeCalendarContext(
        validatedTrainingContext(saved),
        cachedTrainingContext() as CachedContext
      )
      contextCache.set("full", context)
      return context
    } catch {
      /* Invalid device snapshots are ignored. */
    }
  return null
}

export type ManualRefreshProgress = {
  phase:
    | "starting"
    | "intervals"
    | "saving"
    | "github"
    | "finalizing"
    | "complete"
    | "error"
  label: string
  requestId?: string | null
  completed?: number | null
  total?: number | null
  status?: string
  currentStep?: string | null
  error?: string
}

export type MutationQueueStatus = {
  synced: number
  failed: number
  pending: number
  unknown: number
}
type RefreshResult = {
  context: TrainingContext
  queue: MutationQueueStatus
}
type RefreshOperation = {
  controller: AbortController
  promise: Promise<RefreshResult>
  listeners: Set<(progress: ManualRefreshProgress) => void>
}
let recentRefresh: RefreshOperation | undefined
export function refreshRecentIntervals(
  onProgress?: (progress: ManualRefreshProgress) => void
) {
  if (!recentRefresh) {
    const entry: RefreshOperation = {
      controller: new AbortController(),
      promise: null as unknown as Promise<RefreshResult>,
      listeners: new Set(),
    }
    recentRefresh = entry
    entry.promise = Promise.resolve()
      .then(() => runRecentRefresh(entry))
      .finally(() => {
        if (recentRefresh === entry) recentRefresh = undefined
        entry.listeners.clear()
      })
  }
  if (onProgress) recentRefresh.listeners.add(onProgress)
  return recentRefresh.promise
}
async function runRecentRefresh(operation: RefreshOperation) {
  operation.controller.signal.throwIfAborted()
  const revision = beginMutation()
  const syncId = randomId()
  let progressId: string = syncId
  const report = (progress: ManualRefreshProgress) => {
    for (const listener of operation.listeners)
      try {
        listener(progress)
      } catch {
        /* A view callback cannot interrupt a durable refresh. */
      }
  }
  report({
    phase: "starting",
    label: "Starting manual refresh",
    completed: 0,
    total: 1,
  })
  let requestDone = false
  const progressController = new AbortController()
  const queue: MutationQueueStatus = {
    synced: 0,
    failed: 0,
    pending: 0,
    unknown: 0,
  }
  const request = withRequestDeadline(
    async (signal) => {
      const trainingResponse = await apiFetch(
        `/api/sync?trainingOnly=1&forceIntervals=1&retry=1&syncId=${encodeURIComponent(syncId)}`,
        {
          method: "POST",
          signal,
          headers: { Accept: "application/json" },
        }
      )
      const training = (await trainingResponse.json()) as {
        context?: TrainingContext
        sync_error?: string
        error?: string
        queue?: Partial<MutationQueueStatus>
      }
      signal.throwIfAborted()
      if (!trainingResponse.ok || !training?.context)
        throw Error(
          training?.error ||
            `Intervals.icu refresh failed (${trainingResponse.status})`
        )
      if (training.sync_error) throw Error(training.sync_error)
      for (const key of ["synced", "failed", "pending", "unknown"] as const) {
        const count = training.queue?.[key]
        queue[key] =
          typeof count === "number" && Number.isSafeInteger(count) && count >= 0
            ? count
            : 0
      }
      training.context = validatedTrainingContext(training.context)
      training.context = acceptMutationContext(training.context, revision)
      return training.context
    },
    240_000,
    operation.controller.signal,
    "Manual refresh took too long. Your saved calendar is still available; refresh to check the result."
  ).finally(() => {
    requestDone = true
    progressController.abort()
  })
  const pollProgress = (async () => {
    while (!requestDone) {
      try {
        await waitForRequestDelay(1500, progressController.signal)
      } catch {
        break
      }
      if (requestDone) break
      try {
        const progress = await withRequestDeadline(
          async (signal) => {
            const response = await apiFetch(
              `/api/sync/progress?id=${encodeURIComponent(progressId)}`,
              { signal }
            )
            return response.ok
              ? ((await response.json()) as ManualRefreshProgress)
              : null
          },
          5000,
          progressController.signal
        )
        if (progress && !requestDone) {
          if (progress.requestId) progressId = progress.requestId
          report(progress)
        }
      } catch {
        /* The main sync request reports errors; progress polling is best effort. */
      }
    }
  })()
  let context: Awaited<typeof request>
  try {
    context = await request
  } finally {
    requestDone = true
    await pollProgress
    mutationsInFlight--
  }
  operation.controller.signal.throwIfAborted()
  report({
    phase: "complete",
    label: "Training data ready",
    completed: 1,
    total: 1,
  })
  return { context, queue }
}

export async function moveWorkoutDate(id: string, date: string, direct = true, options: { feedback?: boolean | "complete" } = {}) {
  if (direct) return changeWorkout(id, "move", date, undefined, options)
  return queueWorkoutMutation({ type: "move", id, date })
}

export async function pairCompletedWorkout(plannedId: string, completedId: string) {
  const revision = beginMutation()
  try {
    const { response, result } = await readMutationResponse<{
      verified?: boolean
      error?: string
      context?: TrainingContext | null
      workout?: PlannedWorkout
    }>(
      "/api/workouts/pair",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ plannedId, completedId }),
      },
      180_000,
      "The workout pairing could not be confirmed. Refresh your calendar before retrying."
    )
    if (!response.ok || !result?.verified)
      throw new Error(result?.error || "Unable to combine these workouts.")
    if (result.workout) result.workout = validatedTrainingWorkout(result.workout)
    if (result.context) {
      result.context = validatedTrainingContext(result.context)
      const previous = contextCache.get("full") || contextCache.get("week")
      const merged = { ...previous, ...result.context }
      const today = new Intl.DateTimeFormat("en-CA", {timeZone:merged.athlete.time_zone || "America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())
      result.context = acceptMutationContext(result.workout ? applyVerifiedCalendarPair(merged, plannedId, completedId, result.workout, today) : merged, revision)
    }
    else if (result.workout) {
      const previous = cachedTrainingContext()
      const today = new Intl.DateTimeFormat("en-CA", {timeZone:previous.athlete.time_zone || "America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())
      result.context = acceptMutationContext(applyVerifiedCalendarPair(previous, plannedId, completedId, result.workout, today), revision)
    }
    return result
  } finally {
    mutationsInFlight--
    window.dispatchEvent(new Event("training-mutation-settled"))
  }
}
function readMutationResponse<T>(
  path: string,
  options: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
) {
  const controller = new AbortController()
  mutationRequests.add(controller)
  return withRequestDeadline(
    async (signal) => {
      const response = await apiFetch(path, { ...options, signal })
      return { response, result: (await response.json()) as T }
    },
    timeoutMs,
    controller.signal,
    timeoutMessage
  ).finally(() => mutationRequests.delete(controller))
}
export async function queueWorkoutMutation(input: {
  type: "move" | "description"
  id: string
  date?: string
  description?: string
  descriptionMode?: "manual"
}, direct = false, options: {feedback?:boolean} = {}) {
  if (direct && input.type === "move") return changeWorkout(input.id,"move",input.date,undefined,options)
  const revision = beginMutation()
  const descriptionPatch = { goal: input.description ?? "", details: input.description ?? "", editable_description: input.description ?? "", ...(input.descriptionMode === "manual" ? {manual_description:input.description ?? ""} : {}) }
  const optimistic = optimisticWorkout({ id: input.id, patch: input.type === "description" ? descriptionPatch : { workout_date: input.date } }, "Saving workout…", options.feedback ?? "complete")
  try {
    const { response, result } = await readMutationResponse<{
      queued?: boolean
      verified?: boolean
      error?: string
      context?: TrainingContext | null
    }>(
      direct ? "/api/calendar/workout-description" : "/api/mutations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(direct ? input : { ...input, operationId: randomId() }),
      },
      65_000,
      "The edit could not be confirmed. Refresh your saved calendar to check the result before repeating it."
    )
    if (!response.ok || !(direct ? result?.verified : result?.context && (result.queued || result.verified)))
      throw Error(result?.error || (direct ? "The change could not be verified in Intervals.icu." : "The change could not be saved in Supabase."))
    if (result.context) result.context = validatedTrainingContext(result.context)
    if (direct) {
      const current=cachedTrainingContext()
      const row=[...current.history,...current.planned].find(item=>"id" in item && item.id===input.id) as PlannedWorkout | undefined
      if(row)result.context=optimistic.commit({...row,...descriptionPatch},result.context).context
    } else if (!result.context) {
      const previous = cachedTrainingContext()
      const update = (workout: PlannedWorkout | TrainingHistoryItem) => "id" in workout && workout.id === input.id ? { ...workout, ...descriptionPatch } : workout
      result.context = { ...previous, history: previous.history.map(update) as TrainingContext["history"], planned: previous.planned.map(update) as PlannedWorkout[] }
    }
    if(!direct)result.context = acceptMutationContext(result.context!, revision)
    if (!direct) window.dispatchEvent(new Event("request-background-sync"))
    optimistic.confirm(!direct && !result.verified)
    return result
  } catch (error) {
    optimistic.fail(error)
    throw error
  } finally {
    mutationsInFlight--
  }
}

export async function changeWorkout(
  id: string,
  action: "copy" | "delete" | "move",
  date?: string,
  creationId?: string,
  options: { feedback?: boolean | "complete"; optimistic?: boolean } = {}
) {
  const prior = [...cachedTrainingContext().planned, ...cachedTrainingContext().history].find(row => "id" in row && row.id === id) as PlannedWorkout | undefined
  if (prior && /^(Swim|Ride|Bike|Run)$/.test(prior.sport) && prior.status !== "completed") {
    const local = localCommittedWorkout(id)
    const raw = (prior as PlannedWorkout & {raw?:Record<string,unknown>}).raw
    const parsed = !local?.input.model && !prior.editor_model && raw ? importWorkout(raw) : null
    if (parsed?.issues.length) throw Error(`This workout's full prescription needs review before it can be changed: ${parsed.issues.join(" ")}`)
    const model = local?.input.model || prior.editor_model || parsed?.model
    if (model) {
      const cachedRevision = raw ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(workoutRevisionInput(raw))))].map(byte=>byte.toString(16).padStart(2,"0")).join("") : undefined
      const appRevision = (prior as PlannedWorkout & {app_revision?:number}).app_revision
      const revision = local?.revision || (appRevision ? `app:${appRevision}` : cachedRevision) || (await (await import("./workout-read-cache")).loadWorkoutEditor(`/api/workouts/${encodeURIComponent(id)}/editor`)).revision
      const input = { ...(local?.input || {}), model: { ...structuredClone(model), ...(date ? { date } : {}) }, revision }
      const result = await acceptWorkoutCommit(action === "copy" ? null : id, { ...input, ...(action === "copy" ? { creationId: creationId || randomId(), revision: undefined } : {}) }, prior, action === "delete" ? "delete" : undefined, action !== "copy" && !local && !appRevision ? raw : undefined)
      return { ...result, context: cachedTrainingContext() }
    }
  }
  const revision = beginMutation()
  const deferredDelete = action === "delete" && options.optimistic === false
  const optimistic = action === "copy" || deferredDelete ? null : optimisticWorkout({ id, ...(action === "delete" ? { remove: true } : { patch: { workout_date: date } }) }, action === "delete" ? "Removing workout…" : "Moving workout…", options.feedback ?? "complete")
  try {
    const { response, result } = await readMutationResponse<{
      verified?: boolean
      error?: string
      context?: TrainingContext | null
    }>(
      `/api/workouts/${encodeURIComponent(id)}${action === "delete" ? "" : `/${action}`}`,
      {
        method: action === "delete" ? "DELETE" : "POST",
        headers: {
          Accept: "application/json",
          ...(action !== "delete" && date ? { "Content-Type": "application/json" } : {}),
        },
          ...(action !== "delete" && date ? { body: JSON.stringify({ date, ...(creationId ? { creationId } : {}) }) } : {}),
      },
      180_000,
      `The workout ${action} could not be confirmed. Refresh your calendar to check the result before repeating it.`
    )
    if (!response.ok || !result?.verified)
      throw new Error(result?.error || `Unable to ${action} workout.`)
    if (result.context)
      result.context = validatedTrainingContext(result.context)
    const previous = contextCache.get("full") || contextCache.get("week")
    if (result.context) {
      const context = { ...previous, ...result.context } as TrainingContext
      result.context = acceptMutationContext(deferredDelete ? removeVerifiedCalendarPlans(context, [id]) : context, revision)
    } else if (deferredDelete) {
      result.context = acceptMutationContext(removeVerifiedCalendarPlans(cachedTrainingContext(), [id]), revision)
    }
    optimistic?.confirm()
    return result
  } catch (error) {
    optimistic?.fail(error)
    throw error
  } finally {
    mutationsInFlight--
    if (deferredDelete && typeof window !== "undefined") window.dispatchEvent(new Event("training-mutation-settled"))
  }
}

export async function changeWorkoutDay(
  date: string,
  action: "copy" | "delete"
) {
  const revision = beginMutation()
  try {
    const { response, result } = await readMutationResponse<{
      error?: string
      results: Array<{ workoutId: string }>
      failures: Array<{ error: string }>
      total: number
      context: TrainingContext | null
    }>(
      "/api/calendar/day-actions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, action }),
      },
      240_000,
      `The day's workout ${action} could not be confirmed. Refresh your calendar to check the result before repeating it.`
    )
    if (
      !response.ok ||
      !result ||
      !Array.isArray(result.results) ||
      !Array.isArray(result.failures)
    )
      throw new Error(
        result?.error || "Unable to update workouts for this day."
      )
    if (result.context)
      result.context = validatedTrainingContext(result.context)
    const previous = contextCache.get("full") || contextCache.get("week")
    if (result.context) {
      const context = { ...previous, ...result.context } as TrainingContext
      result.context = acceptMutationContext(context, revision)
    }
    return result
  } finally {
    mutationsInFlight--
  }
}

export async function saveCalendarNote(input: {
  id?: string; name: string; description: string; date: string; revision?: string; creationId: string; reconcileOnly?: boolean
}) {
  const placeholder: PlannedWorkout = { id: `pending:${input.creationId}`, category: "NOTE", title: input.name, sport: "Other", workout_date: input.date, day: "", date: input.date, duration: "", status: "upcoming", goal: input.description, details: input.description }
  beginMutation()
  const optimistic = optimisticWorkout(input.id ? { id: input.id, patch: { title: input.name, workout_date: input.date, goal: input.description, details: input.description } } : { id: placeholder.id, insert: placeholder }, "Saving note…")
  try {
    const { response, result } = await readMutationResponse<{
      verified?: boolean; error?: string; code?: string; workout?: PlannedWorkout; context?: TrainingContext | null; refreshWarning?: string
    }>(input.id ? `/api/calendar/notes/${encodeURIComponent(input.id)}` : "/api/calendar/notes", {
      method: input.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }, 65_000, "The note save could not be confirmed. Your draft is retained; recheck before trying again.")
    if (!response.ok || !result.verified || !result.workout)
      throw Object.assign(new Error(result.error || "Intervals.icu did not confirm the note save."), { status: response.status, code: result.code })
    if (input.id ? result.workout.id !== input.id : !/^event:[1-9]\d*$/.test(result.workout.id))
      throw Error("The saved note does not match this draft. Reload before retrying.")
    const saved = optimistic.commit(validatedTrainingWorkout(result.workout), result.context)
    optimistic.confirm(false,result.refreshWarning)
    return { ...result, workout:saved.workout, context:saved.context }
  } catch (error) { optimistic.fail(error); throw error }
  finally { mutationsInFlight-- }
}

export async function createPlannedWorkout(input: {
  model: import("../../../app-backend/lib/workout-editor-model.mjs").WorkoutModel
  values: Partial<WorkoutSummaryValues>
  time: string
  comment: string
  creationId: string
  reconcileOnly?: boolean
  descriptionMode?: "manual"
  description?: string
  personal?: import("./workout-local-metadata").WorkoutLocalMetadata
  recurrence?: import("./workout-recurrence").WorkoutRecurrenceDraft | null
  personalId?: string
}) {
  if (/^(Swim|Ride|Run)$/.test(input.model.sport)) {
    await restoreWorkoutCommits()
    const accepted = localCommittedWorkout(`app:${input.creationId}`)
    // A crash may occur after IDB commits but before the old creation-recovery
    // slot is cleared. Recover the accepted identity without replaying the
    // legacy provider POST alongside the independent worker.
    if (accepted) {
      if (accepted.deleted) throw Object.assign(Error("This workout was already deleted. Start a separate workout to create another."), {status:409,code:"DELETED"})
      return {workout:accepted.workout,revision:accepted.revision,accepted:true,verified:accepted.state === "synced",durableBoundary:"local" as const,syncStatus:accepted.state,context:undefined as TrainingContext | undefined,refreshWarning:accepted.state === "synced" ? undefined : "Saved on this device; sync pending."}
    }
    if (!input.reconcileOnly) return acceptWorkoutCommit(null, input)
  }
  const seconds = input.values.duration_seconds || 0
  const description = input.description ?? input.model.notes
  const placeholder: PlannedWorkout = { id: `pending:${input.creationId}`, category: "WORKOUT", title: input.model.name, sport: input.model.sport, workout_date: input.model.date, day: "", date: input.model.date, duration: `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2,"0")}:${String(Math.round(seconds % 60)).padStart(2,"0")}`, status: "upcoming", goal: description, details: description, ...(input.descriptionMode === "manual" ? {manual_description:description} : {}), editor_model: input.model, planned_values_edited: true, plannedDurationMinutes: seconds / 60, workout_summary: { planned: input.values, completed: null } }
  beginMutation()
  const optimistic = optimisticWorkout({ id: placeholder.id, insert: placeholder }, "Adding workout…")
  try {
    const { response, result } = await readMutationResponse<{
      verified?: boolean; error?: string; code?: string; workout?: PlannedWorkout; context?: TrainingContext; refreshWarning?: string
    }>("/api/workouts/editor", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }, 90_000, "Creation could not be confirmed. Recheck this draft before creating another workout.")
    if (!response.ok || !result.verified || !result.workout)
      throw Object.assign(Error(result.error || "Intervals.icu did not confirm the workout."), { code: result.code, status: response.status })
    if(!/^event:[1-9]\d*$/.test(result.workout.id))throw Error("Intervals.icu did not return a saved workout ID. Your draft is retained.")
    const saved = optimistic.commit(validatedTrainingWorkout(result.workout), result.context)
    if (saved.applied) window.dispatchEvent(new CustomEvent("workout-editor-saved", { detail: saved.workout }))
    optimistic.confirm(false,result.refreshWarning)
    return { ...result, workout:saved.workout, context:saved.context }
  } catch (error) { optimistic.fail(error); throw error }
  finally { mutationsInFlight-- }
}

export async function savePlannedWorkoutValues(id: string, values: Partial<WorkoutSummaryValues>, providerRevision: string, metadata: { name?: string; date?: string; time?: string } = {}, options: {feedback?:boolean} = {}) {
  beginMutation()
  const prior = [...cachedTrainingContext().planned, ...cachedTrainingContext().history].find(row => "id" in row && row.id === id) as PlannedWorkout | undefined
  const optimistic = optimisticWorkout({ id, patch: { ...(metadata.name !== undefined ? { title: metadata.name } : {}), ...(metadata.date ? { workout_date: metadata.date } : {}), workout_summary: { planned: { ...prior?.workout_summary?.planned, ...values }, completed: prior?.workout_summary?.completed || null }, planned_values_edited:true, ...(values.duration_seconds != null ? { plannedDurationMinutes: values.duration_seconds / 60 } : {}), ...(values.tss != null ? { load: values.tss } : {}) } }, "Saving workout…", options.feedback ?? "complete")
  try {
    const { response, result } = await readMutationResponse<{
      verified?: boolean; error?: string; code?: string; revision?: string; workout?: PlannedWorkout; context?: TrainingContext; refreshWarning?: string
    }>(`/api/workouts/${encodeURIComponent(id)}/planned-values`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values, revision: providerRevision, ...metadata }),
    }, 65_000, "The planned value save could not be confirmed. Your draft is retained; reload before retrying.")
    if (!response.ok || !result.verified || !result.workout || !result.revision)
      throw Object.assign(new Error(result.error || "Intervals.icu did not confirm these planned values."), { code: result.code })
    if(result.workout.id!==id)throw Error("The saved workout does not match this draft. Reload before retrying.")
    const saved = optimistic.commit(validatedTrainingWorkout(result.workout), result.context)
    if (saved.applied) window.dispatchEvent(new CustomEvent("workout-editor-saved", { detail: saved.workout }))
    optimistic.confirm(false,result.refreshWarning)
    return { ...result, workout:saved.workout, context:saved.context, revision: result.revision }
  } catch (error) { optimistic.fail(error); throw error }
  finally { mutationsInFlight-- }
}

export async function scheduleLibraryWorkout(source:PlannedWorkout,date:string,creationId:string,reconcileOnly=false) {
  if (!reconcileOnly && (source.structure_read_only || source.template_metadata_error)) throw Error(source.template_metadata_error || "The private template prescription is unavailable. Reload before scheduling.")
  const placeholder:PlannedWorkout={id:`pending:${creationId}`,title:source.title,sport:source.sport,day:"",date,workout_date:date,duration:source.duration,status:"upcoming",category:"WORKOUT",goal:source.goal || "",details:source.details,structure:source.structure,plannedDurationMinutes:source.plannedDurationMinutes,planned:source.planned,workout_summary:{planned:source.workout_summary?.planned || null,completed:null},...(source.editor_model?{editor_model:{...source.editor_model,date}}:{})}
  beginMutation()
  const stage=optimisticWorkout({id:placeholder.id,insert:placeholder},"Scheduling workout…")
  try {
    const {response,result}=await readMutationResponse<{verified?:boolean;workout?:PlannedWorkout;error?:string;code?:string;refreshWarning?:string}>(`/api/workout-library/${encodeURIComponent(source.id)}/schedule`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({date,creationId,reconcileOnly})},90_000,"Scheduling could not be confirmed. Recheck this same request before adding another workout.")
    if(!response.ok || !result?.verified || !result.workout || !/^event:[1-9]\d*$/.test(result.workout.id) || result.workout.workout_date!==date)throw Object.assign(Error(result?.error || "Intervals.icu did not confirm the scheduled workout."),{status:response.status,code:result?.code})
    const saved=stage.commit(validatedTrainingWorkout(result.workout))
    stage.confirm(false,result.refreshWarning)
    return saved.workout
  } catch(error){stage.fail(error);throw error}
  finally {mutationsInFlight--}
}
function verifiedCoachRows(proposal:import("./coach-client").CalendarProposal) {
  const indexes=new Set<number>(),ids=new Set<string>()
  return (proposal.scheduledWorkouts || []).map(item=>{
    const source=proposal.workouts[item.index],workout=validatedTrainingWorkout(item.workout)
    if(!source || !Number.isInteger(item.index) || indexes.has(item.index) || ids.has(workout.id) || !/^event:[1-9]\d*$/.test(workout.id) || workout.workout_date!==source.date || workout.title!==source.name)throw Error("The scheduled workouts do not match this proposal. Recheck its saved status.")
    indexes.add(item.index);ids.add(workout.id)
    return {...item,workout}
  })
}
function rememberCoachReceipt(id:string) {
  coachSchedulingReceipts.add(id)
  if(coachSchedulingReceipts.size>128)coachSchedulingReceipts.delete(coachSchedulingReceipts.values().next().value!)
}
/** A late status check may confirm a lost reply; it never sends another write. */
export function acceptCoachSchedulingReceipt(proposal:import("./coach-client").CalendarProposal,notify=true) {
  if(coachSchedulingReceipts.has(proposal.id) || activeCoachScheduling.has(proposal.id))return
  const rows=verifiedCoachRows(proposal)
  if(proposal.state!=="applied" || proposal.verified!==true || rows.length!==proposal.workouts.length)return
  beginMutation()
  try {
    let context=cachedTrainingContext()
    for(const item of rows)context=mergeVerifiedWorkout(context,item.workout).context
    rememberTrainingContext(context,"full")
    rememberCoachReceipt(proposal.id)
    beginWorkoutSaveFeedback(notify,`coach:${proposal.id}`).confirm()
  } finally {mutationsInFlight--;window.dispatchEvent(new Event("training-mutation-settled"))}
}
export function confirmCoachWorkouts(proposal:import("./coach-client").CalendarProposal) {
  const active=activeCoachScheduling.get(proposal.id)
  if(active)return active
  const promise=performCoachScheduling(proposal)
  activeCoachScheduling.set(proposal.id,promise)
  void promise.finally(()=>{if(activeCoachScheduling.get(proposal.id)===promise)activeCoachScheduling.delete(proposal.id)}).catch(()=>{})
  return promise
}
async function performCoachScheduling(proposal:import("./coach-client").CalendarProposal) {
  beginMutation()
  const feedback=beginWorkoutSaveFeedback(true,`coach:${proposal.id}`)
  const stages=proposal.workouts.map((workout,index)=>{
    const knownId=proposal.scheduledWorkouts?.find(item=>item.index===index)?.workout.id || confirmedCoachItems.get(proposal.id)?.get(index)
    const row:PlannedWorkout={id:`pending:coach:${proposal.id}:${index}`,title:workout.name,sport:workout.type,workout_date:workout.date,date:workout.date,day:"",duration:"",status:"upcoming",goal:workout.description,details:workout.description,plannedDurationMinutes:workout.duration_minutes,workout_summary:{planned:{...(workout.duration_minutes!=null?{duration_seconds:workout.duration_minutes*60}:{}),...(workout.tss!=null?{tss:workout.tss}:{})},completed:null}}
    return optimisticWorkout(knownId?{id:knownId,patch:{}}:{id:row.id,insert:row},"Scheduling workouts…",false)
  })
  try {
    const {response,result}=await readMutationResponse<import("./coach-client").CalendarProposal>(`/api/coach/calendar/${encodeURIComponent(proposal.id)}/confirm`,{method:"POST",headers:{"Content-Type":"application/json","X-Coach-Request":"1"},body:"{}"},240_000,"Scheduling could not be confirmed. Recheck this same proposal; do not create another copy.")
    if(!response.ok || result?.id!==proposal.id)throw Error((result as {error?:string})?.error || "The coach scheduling request could not be confirmed.")
    const signature=(rows:import("./coach-client").CalendarProposal["workouts"])=>JSON.stringify(rows.map(w=>[w.name,w.date,w.type,w.description,w.duration_minutes??null,w.tss??null,w.target??null,w.indoor??false]))
    if(!Array.isArray(result.workouts) || signature(result.workouts)!==signature(proposal.workouts))throw Error("The saved proposal does not match this approval. Reload before retrying.")
    const rows=verifiedCoachRows(result)
    // Preserve verified items if a later item failed. Unconfirmed cards roll back.
    for(const item of rows){
      stages[item.index].commit(item.workout);stages[item.index].confirm()
      const known=confirmedCoachItems.get(proposal.id) || new Map<number,string>();known.set(item.index,item.workout.id);confirmedCoachItems.set(proposal.id,known)
    }
    if(confirmedCoachItems.size>128)confirmedCoachItems.delete(confirmedCoachItems.keys().next().value!)
    if(result.state!=="applied" || result.verified!==true || rows.length!==proposal.workouts.length)throw Object.assign(Error(result.error || "Scheduling is not confirmed. Recheck this same proposal."),{proposal:result})
    for(const stage of stages)stage.confirm()
    rememberCoachReceipt(proposal.id)
    feedback.confirm()
    return result
  } catch(error){for(const stage of stages)stage.fail(error);feedback.fail(error);throw error}
  finally {mutationsInFlight--}
}

/** Bound the entire editor response, including its body, and never replay it. */
export async function writeWorkoutEditor(id: string | null, input: {
  model: import("../../../app-backend/lib/workout-editor-model.mjs").WorkoutModel
  revision?: string; creationId?: string; reconcileOnly?: boolean
  values?: Partial<WorkoutSummaryValues>; time?: string; description?: string; descriptionMode?: "manual"; comment?: string; commentId?: string
  personal?: import("./workout-local-metadata").WorkoutLocalMetadata
  recurrence?: import("./workout-recurrence").WorkoutRecurrenceDraft | null
  comments?: {id:string;body:string}[]; zoneSettings?: import("../../../app-backend/lib/workout-editor-zones.mjs").SportZoneSettings[]; personalId?: string
}) {
  if (/^(Swim|Ride|Run)$/.test(input.model.sport) && !input.reconcileOnly) {
    const previous = [...cachedTrainingContext().planned, ...cachedTrainingContext().history].find(row => "id" in row && row.id === id) as PlannedWorkout | undefined
    return acceptWorkoutCommit(id, input, previous)
  }
  const {response,result}=await readMutationResponse<{
    verified?:boolean;workout?:PlannedWorkout;context?:TrainingContext;revision?:string;error?:string;code?:string;refreshWarning?:string
  }>(id?`/api/workouts/${encodeURIComponent(id)}/editor`:"/api/workouts/editor",{
    method:id?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),
  },id?65_000:90_000,"The workout save could not be confirmed. Your draft is retained; check the saved workout before retrying.")
  if(!response.ok || !result.verified || !result.workout || typeof result.revision!=="string")
    throw Object.assign(Error(result.error || "Intervals.icu did not verify the saved workout. Your draft is retained."),{status:response.status,code:result.code})
  const workout=validatedTrainingWorkout(result.workout)
  if(id ? workout.id!==id : !/^event:[1-9]\d*$/.test(workout.id))throw Error("The saved workout does not match this draft. Reload before retrying.")
  return {...result,workout,revision:result.revision,context:result.context?validatedTrainingContext(result.context):undefined}
}

export async function saveWorkoutComment(input: {workoutId:string;body:string;type:"pre"|"post";creationId:string;syncOnly:boolean}) {
  beginMutation()
  try {
    const {response,result}=await readMutationResponse<import("./workout-read-cache").WorkoutComment & {verified?:boolean;comments?:import("./workout-read-cache").WorkoutComment[];error?:string}>("/api/comments",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),
    },65_000,"The comment save could not be confirmed. Your draft is retained; check before retrying.")
    if(!response.ok || !result.verified || result.workout_id!==input.workoutId || (input.body.trim() && (!result.id || result.body!==input.body.trim() || (result.type || result.comment_type)!==input.type)))
      throw Error(result.error || "The comment save could not be confirmed. Your draft is retained.")
    return result
  } finally {mutationsInFlight--;window.dispatchEvent(new Event("training-mutation-settled"))}
}

export async function loadTrainingContext(
  forceRefresh = false,
  scope: "week" | "full" = "week",
  networkOnly = false
): Promise<TrainingContext> {
  // Navigating to Calendar during a save must paint the pending projection.
  // A fresh snapshot requested mid-write can still predate the provider change.
  if(mutationsInFlight>0)return cachedTrainingContext()
  const requireNetwork = networkOnly || !networkLoadedScopes.has(scope)
  const underway = contextRequests.get(scope)
  if (
    underway?.revision === contextRevision &&
    (underway.forced || !forceRefresh)
  )
    return underway.promise
  if (forceRefresh) {
    contextRevision += 1
    contextRequests.clear()
  }
  if (!forceRefresh) {
    const cached = contextCache.get(scope)
    if (cached && !requireNetwork) return cached
  }
  const revision = contextRevision
  const request = (async () => {
    try {
      const query = new URLSearchParams({ scope })
      if (forceRefresh) query.set("refresh", "1")
      const result = await withRequestDeadline(async (signal) => {
        const saved = cachedTrainingContext() as CachedContext
        const target = window as Window & { __trainingContextRequest?: Promise<Response | null>; __trainingContextVersion?: string }
        const startup = !forceRefresh && scope === 'full' ? target.__trainingContextRequest : undefined
        const startupVersion = target.__trainingContextVersion
        if (startup) { delete target.__trainingContextRequest; delete target.__trainingContextVersion }
        const compare = !startup && !forceRefresh && saved.context_scope === 'full' && saved.version
        const response = (startup ? await startup : null) || await apiFetch(compare
          ? `/api/training-updates?${new URLSearchParams({ version: saved.version! })}`
          : `/api/training-context?${query}`, { signal })
        if (!response.ok) throw new Error(`Training context ${response.status}`)
        let body = await response.json()
        if (startup) {
          if (body.unchanged && saved.context_scope === 'full' && saved.version === startupVersion) return { context: saved, unchanged: true }
          if (body.unchanged) {
            const fresh = await apiFetch(`/api/training-context?${query}`, { signal })
            if (!fresh.ok) throw new Error(`Training context ${fresh.status}`)
            body = await fresh.json()
          }
          return { context: validatedTrainingContext(body.context || body), unchanged: false }
        }
        if (compare && body.unchanged) return { context: saved, unchanged: true }
        return { context: validatedTrainingContext(compare ? body.context : body), unchanged: false }
      }, 20_000)
      if (revision !== contextRevision) {
        // Never return our own registered promise or start another database read
        // merely because a mutation superseded this request.
        return cachedTrainingContext()
      }
      const { context, unchanged } = result
      if (
        context.sync_error &&
        /authentication|401|403|expired|credential/i.test(context.sync_error)
      ) {
        window.dispatchEvent(new CustomEvent("intervals-auth-expired"))
      }
      // Version validation isn't new content: preserve object identity, avoid
      // another IndexedDB/localStorage write, and don't move the calendar.
      if (!unchanged)
        rememberTrainingContext(context, context.context_scope === 'full' ? 'full' : scope)
      networkLoadedScopes.add(scope)
      if (scope === "full") networkLoadedScopes.add("week")
      return context
    } catch {
      return cachedTrainingContext()
    }
  })()
  const entry = { promise: request, revision, forced: forceRefresh }
  contextRequests.set(scope, entry)
  try {
    return await request
  } finally {
    if (contextRequests.get(scope) === entry) contextRequests.delete(scope)
  }
}
export function revalidateTrainingContext() {
  return loadTrainingContext(false, "week", true)
}

export function loadFullTrainingContext(
  forceRefresh = false,
  networkOnly = false
) {
  return loadTrainingContext(forceRefresh, "full", networkOnly)
}

export function durationMinutes(workout: PlannedWorkout) {
  if (Number.isFinite(workout.plannedDurationMinutes)) {
    const plannedMinutes = Number(workout.plannedDurationMinutes)
    if (plannedMinutes > 0) return plannedMinutes
  }
  if (Number.isFinite(workout.planned?.duration_minutes)) {
    const plannedMinutes = Number(workout.planned?.duration_minutes)
    if (plannedMinutes > 0) return plannedMinutes
  }

  if (Number.isFinite(workout.actualDurationMinutes)) {
    return Number(workout.actualDurationMinutes)
  }
  if (Number.isFinite(workout.completed_data?.duration_minutes)) {
    return Number(workout.completed_data?.duration_minutes)
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

if (typeof window !== "undefined") {
  window.addEventListener("workout-commits-updated", event => {
    let context = cachedTrainingContext()
    for (const row of (event as CustomEvent<{ synced: ReturnType<typeof committedWorkouts> }>).detail?.synced || []) {
      if (!row.deleted) context = mergeVerifiedWorkout(context, row.workout, row.providerWorkoutId).context
    }
    for (const row of committedWorkouts()) {
      if (row.deleted) context = { ...context, planned: context.planned.filter(w => w.id !== row.workoutId && w.id !== row.providerWorkoutId), history: context.history.filter(w => !("id" in w && (w.id === row.workoutId || w.id === row.providerWorkoutId))) }
    }
    rememberTrainingContext(overlayWorkoutCommits(context), contextCache.has("full") ? "full" : "week")
  })
  startWorkoutCommitRecovery()
}
