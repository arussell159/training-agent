import { apiFetch } from "./api-client"
import { readDeviceCache, writeDeviceCache } from "./device-cache"
import {
  cachedTrainingContext,
  trainingCacheScope,
  type TrainingContext,
  type PlannedWorkout,
} from "./training-context"
import {
  validatedTrainingContext,
  validatedTrainingWorkout,
} from "./training-context-validation"
import { withRequestDeadline } from "./request-deadline"
import { historyMonths } from "./training-history-range-policy"

type Options = { signal?: AbortSignal; force?: boolean }
type Saved<T> = { value: T; version: string; savedAt: number }
type Entry = {
  promise: Promise<unknown>
  controller: AbortController
  expires: number
}
const entries = new Map<string, Entry>()
const controllers = new Set<AbortController>()
const maxAge = 15 * 60_000
let generation = 0
const currentVersion = () =>
  String(
    (cachedTrainingContext() as TrainingContext & { version?: string })
      .version || ""
  )
let seenVersion = ""

function clear() {
  generation++
  for (const controller of controllers) controller.abort()
  controllers.clear()
  entries.clear()
}
if (typeof window !== "undefined") {
  for (const name of [
    "training-cache-reset",
    "app-auth-required",
    "device-cache-cleared",
  ])
    window.addEventListener(name, clear)
  window.addEventListener("training-context-updated", () => {
    const version = currentVersion()
    // Let readers already in flight finish; future reads use the new version.
    // Aborting here would drop the first history request when startup validation finishes.
    if (seenVersion && version !== seenVersion) entries.clear()
    seenVersion = version
  })
}

function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      }
    )
  })
}

async function cachedRead<T>(
  kind: string,
  query: string,
  validate: (value: unknown) => T,
  options: Options
): Promise<T> {
  options.signal?.throwIfAborted()
  const scope = trainingCacheScope(),
    version = currentVersion(),
    epoch = generation
  seenVersion = version
  const key = `${kind}:${scope}:${query}`,
    memoryKey = `${key}:${version}`
  const existing = entries.get(memoryKey)
  if (!options.force && existing && existing.expires > Date.now()) {
    entries.delete(memoryKey)
    entries.set(memoryKey, existing)
    return waitFor(existing.promise as Promise<T>, options.signal)
  }
  const controller = new AbortController()
  controllers.add(controller)
  const entry: Entry = {
    controller,
    expires: Infinity,
    promise: Promise.resolve(null),
  }
  const promise = (async () => {
    if (!options.force) {
      const saved = await Promise.race([
        readDeviceCache<Saved<T>>(key, maxAge),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 40)),
      ])
      if (
        saved?.version === version &&
        saved.savedAt <= Date.now() &&
        Date.now() - saved.savedAt < maxAge
      ) {
        try {
          const value = validate(saved.value)
          if (generation !== epoch || trainingCacheScope() !== scope)
            throw new DOMException("Session changed", "AbortError")
          entry.expires = saved.savedAt + maxAge
          return value
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError")
            throw error
        }
      }
    }
    const value = await withRequestDeadline(
      async (signal) => {
        const endpoint =
          kind === "history-range"
            ? `/api/training-context?scope=range&${query}&`
            : kind === "history-workout"
              ? `/api/workout-history/${query}?`
              : `/api/workout-history?${query}&`
        const response = await apiFetch(
          `${endpoint}version=${encodeURIComponent(version)}`,
          { signal }
        )
        const body = await response.json()
        if (!response.ok)
          throw Error(
            body.error || `History request failed (${response.status}).`
          )
        return validate(body)
      },
      30_000,
      controller.signal
    )
    if (generation !== epoch || trainingCacheScope() !== scope)
      throw new DOMException("Session changed", "AbortError")
    entry.expires = Date.now() + maxAge
    void writeDeviceCache(key, { value, version, savedAt: Date.now() })
    return value
  })().catch((error) => {
    if (entries.get(memoryKey) === entry) entries.delete(memoryKey)
    throw error
  })
  entry.promise = promise
  void promise.then(
    () => controllers.delete(controller),
    () => controllers.delete(controller)
  )
  entries.delete(memoryKey)
  entries.set(memoryKey, entry)
  if (entries.size > 60) entries.delete(entries.keys().next().value!)
  return waitFor(promise, options.signal)
}

/** Calendar weeks share month pages; visiting old dates never replaces the live snapshot. */
export async function loadTrainingHistoryRange(
  start: string,
  end: string,
  options: Options = {}
): Promise<TrainingContext> {
  const months = historyMonths(start, end)
  const pages: TrainingContext[] = []
  for (const range of months) {
    options.signal?.throwIfAborted()
    pages.push(
      await cachedRead(
        "history-range",
        new URLSearchParams(range).toString(),
        (value) => {
          const context = validatedTrainingContext(value)
          if (context.context_scope !== "range")
            throw Error("Requested historical dates are unavailable.")
          return context
        },
        options
      )
    )
  }
  const merge = (kind: "history" | "planned") => [
    ...new Map(
      pages
        .flatMap(
          (page) => page[kind] as (PlannedWorkout & { workout_date: string })[]
        )
        .filter((row) => {
          const date = (row as PlannedWorkout).workout_date || ""
          return date >= start && date <= end
        })
        .map((row) => [(row as PlannedWorkout).id, row])
    ).values(),
  ]
  return {
    ...pages[0],
    context_scope: "range",
    display_range: { start, end },
    history: merge("history"),
    planned: merge("planned") as PlannedWorkout[],
    wellness_history: [
      ...new Map(
        pages
          .flatMap((page) => page.wellness_history || [])
          .filter((row) => (row.date || "") >= start && (row.date || "") <= end)
          .map((row) => [row.date, row])
      ).values(),
    ],
  } as TrainingContext
}

export type WorkoutHistoryPage = {
  workouts: (PlannedWorkout & { workout_date: string })[]
  next_before: string | null
  complete: boolean
}
export function loadHistoricalWorkout(
  id: string,
  options: Options = {}
): Promise<PlannedWorkout> {
  if (!/^(activity:i?[1-9]\d*|event:[1-9]\d*)$/.test(id))
    return Promise.reject(Error("Choose a valid Intervals.icu workout."))
  return cachedRead(
    "history-workout",
    encodeURIComponent(id),
    (value) =>
      validatedTrainingWorkout((value as { workout?: unknown })?.workout),
    options
  )
}
export function loadWorkoutHistoryPage(
  bounds: { start?: string; end?: string; before?: string },
  options: Options = {}
): Promise<WorkoutHistoryPage> {
  const query = new URLSearchParams(
    Object.entries(bounds).filter(([, value]) => Boolean(value)) as [
      string,
      string,
    ][]
  ).toString()
  return cachedRead(
    "history-report",
    query,
    (value) => {
      const body = value as WorkoutHistoryPage
      if (
        !body ||
        !Array.isArray(body.workouts) ||
        typeof body.complete !== "boolean" ||
        (body.next_before !== null &&
          !/^\d{4}-\d{2}-\d{2}$/.test(body.next_before))
      )
        throw Error("Workout history response is incomplete.")
      return {
        ...body,
        workouts: body.workouts.map(
          validatedTrainingWorkout
        ) as WorkoutHistoryPage["workouts"],
      }
    },
    options
  )
}
