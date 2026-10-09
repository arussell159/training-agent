import { apiFetch } from "@/lib/api-client"
import {
  readDeviceCache,
  writeDeviceCache,
  clearDeviceCache,
} from "./device-cache"
import { randomId } from "@/lib/random-id"
import { validatedTrainingContext } from "./training-context-validation"
import { withRequestDeadline, waitForRequestDelay } from "./request-deadline"
import { twelveWeekStart } from "../../../app-backend/lib/training-retention.mjs"
export interface TrainingHistoryItem {
  workout_date: string
  planned?: { duration_minutes?: number; tss?: number }
  completed?: { duration_minutes?: number }
  recovery?: { hrv?: number | null; resting_hr?: number | null }
}

export interface WorkoutSummaryValues {
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
  app_description_version?: number
  editor_model?: import("../../../app-backend/lib/workout-editor-model.mjs").WorkoutModel
  planned_time_label?: string | null
  source_updated_at?: string | null
  id: string
  day: string
  activity_id?: string | null
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
const STARTUP_KEY = "training-agent-startup-v2"
function beginMutation() {
  contextRevision++
  contextRequests.clear()
  networkLoadedScopes.clear()
  mutationsInFlight++
  return contextRevision
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
      for (const controller of mutationRequests)
        controller.abort(new DOMException("Session changed", "AbortError"))
      mutationRequests.clear()
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
  context = validatedTrainingContext(context) as CachedContext
  const previous = (contextCache.get("full") || contextCache.get("week")) as
    CachedContext | undefined
  if (
    previous?.cache_scope &&
    context.cache_scope &&
    previous.cache_scope !== context.cache_scope
  ) {
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
  const startupSource = contextCache.get("full") || context
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
  const merge = <T extends { workout_date?: string }>(old: T[], next: T[]) => {
    const rows = new Map<string | T, T>()
    for (const row of [
      ...old.filter(
        (w) =>
          !range ||
          (w.workout_date || "") < range.start ||
          (w.workout_date || "") > range.end
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

export async function moveWorkoutDate(id: string, date: string) {
  return queueWorkoutMutation({ type: "move", id, date })
}

export async function pairCompletedWorkout(plannedId: string, completedId: string) {
  const revision = beginMutation()
  try {
    const { response, result } = await readMutationResponse<{
      verified?: boolean
      error?: string
      context?: TrainingContext | null
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
    if (result.context) {
      result.context = validatedTrainingContext(result.context)
      const previous = contextCache.get("full") || contextCache.get("week")
      if (previous)
        result.context = acceptMutationContext({ ...previous, ...result.context }, revision)
    }
    return result
  } finally {
    mutationsInFlight--
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
}) {
  const revision = beginMutation()
  try {
    const { response, result } = await readMutationResponse<{
      queued?: boolean
      verified?: boolean
      error?: string
      context?: TrainingContext | null
    }>(
      "/api/mutations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, operationId: randomId() }),
      },
      65_000,
      "The edit could not be confirmed. Refresh your saved calendar to check the result before repeating it."
    )
    if (!response.ok || !result?.context || !(result.queued || result.verified))
      throw Error(result?.error || "The change could not be saved in Supabase.")
    result.context = validatedTrainingContext(result.context)
    result.context = acceptMutationContext(result.context, revision)
    window.dispatchEvent(new Event("request-background-sync"))
    return result
  } finally {
    mutationsInFlight--
  }
}

export async function changeWorkout(
  id: string,
  action: "copy" | "delete",
  date?: string
) {
  const revision = beginMutation()
  try {
    const { response, result } = await readMutationResponse<{
      verified?: boolean
      error?: string
      context?: TrainingContext | null
    }>(
      `/api/workouts/${encodeURIComponent(id)}${action === "copy" ? "/copy" : ""}`,
      {
        method: action === "copy" ? "POST" : "DELETE",
        headers: {
          Accept: "application/json",
          ...(action === "copy" && date ? { "Content-Type": "application/json" } : {}),
        },
        ...(action === "copy" && date ? { body: JSON.stringify({ date }) } : {}),
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
      result.context = acceptMutationContext(context, revision)
    }
    return result
  } finally {
    mutationsInFlight--
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

export async function loadTrainingContext(
  forceRefresh = false,
  scope: "week" | "full" = "week",
  networkOnly = false
): Promise<TrainingContext> {
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
        const compare = !forceRefresh && saved.context_scope === 'full' && saved.version
        const response = await apiFetch(compare
          ? `/api/training-updates?${new URLSearchParams({ version: saved.version! })}`
          : `/api/training-context?${query}`, { signal })
        if (!response.ok) throw new Error(`Training context ${response.status}`)
        const body = await response.json()
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
