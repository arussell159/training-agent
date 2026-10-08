import { apiFetch } from "./api-client.ts"
import { createSharedRequestCache } from "./shared-request-cache.ts"
import { validHistoryDay } from "./training-history-view.ts"
import type { ActivityEffortTarget } from "./activity-effort-navigation.ts"

export const fitnessSports = ["Ride", "Run", "Swim"] as const
export type FitnessSport = (typeof fitnessSports)[number]
export type FitnessAnchor = {
  duration_seconds: number | null
  distance_meters: number | null
  unit: "watts" | "m/s"
}
export type FitnessPeak = FitnessAnchor & {
  value: number | null
  source?: "intervals-curve" | "calculated-activity-curves" | null
  activity_id?: string | null
  date?: string | null
  measured_distance_meters?: number | null
  name?: string | null
  elapsed_seconds?: number | null
  start_index?: number | null
  end_index?: number | null
  start_seconds?: number | null
  end_seconds?: number | null
}
export const fitnessTotalKeys = [
  "duration_seconds",
  "distance_meters",
  "tss",
  "work_kj",
] as const
export type FitnessTotal = (typeof fitnessTotalKeys)[number]
export type FitnessPeriod = Record<FitnessTotal, number | null> & {
  start: string
  end: string
  label: string
  activities: number
  incomplete: Record<FitnessTotal, boolean>
  peaks: FitnessPeak[]
}
export type FitnessHistory = {
  configured: boolean
  type: FitnessSport
  asOf: string | null
  anchors: FitnessAnchor[]
  weeks: FitnessPeriod[]
  months: FitnessPeriod[]
  comparisonMonths: FitnessPeriod[]
  source?: "intervals" | "synthetic-local-preview" | null
  peakCoverage?: "complete" | "partial"
  peaksError?: string
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
const anchorKey = (anchor: FitnessAnchor) =>
  `${anchor.duration_seconds}:${anchor.distance_meters}`
const METERS_PER_YARD = 0.9144

export function defaultFitnessAnchors(type: FitnessSport): FitnessAnchor[] {
  if (type === "Ride")
    return [5, 60, 300, 1200, 3600].map((duration_seconds) => ({
      duration_seconds,
      distance_meters: null,
      unit: "watts",
    }))
  return (
    type === "Run"
      ? [400, 1000, 5000, 10000, 21097.5]
      : [100, 200, 400, 1000, 1500].map((yards) => yards * METERS_PER_YARD)
  ).map((distance_meters) => ({
    duration_seconds: null,
    distance_meters,
    unit: "m/s",
  }))
}

function parseAnchor(value: unknown, type: FitnessSport): FitnessAnchor {
  if (!record(value)) throw new Error("Invalid peak history.")
  const duration = value.duration_seconds ?? null
  const distance = value.distance_meters ?? null
  if (
    type === "Ride"
      ? !nonnegative(duration) ||
        duration === 0 ||
        distance !== null ||
        value.unit !== "watts"
      : !nonnegative(distance) ||
        distance === 0 ||
        duration !== null ||
        value.unit !== "m/s"
  )
    throw new Error("Invalid peak history units.")
  return {
    duration_seconds: duration as number | null,
    distance_meters: distance as number | null,
    unit: type === "Ride" ? "watts" : "m/s",
  }
}

/** Validate compact summary data before keeping it in memory or rendering a table. */
export function parseFitnessHistory(
  value: unknown,
  type: FitnessSport
): FitnessHistory {
  if (
    !record(value) ||
    value.type !== type ||
    typeof value.configured !== "boolean" ||
    (value.source != null &&
      (typeof value.source !== "string" ||
        !["intervals", "synthetic-local-preview"].includes(value.source))) ||
    (value.peakCoverage != null &&
      (typeof value.peakCoverage !== "string" ||
        !["complete", "partial"].includes(value.peakCoverage))) ||
    (value.peaksError != null &&
      (typeof value.peaksError !== "string" ||
        value.peaksError.length > 1000)) ||
    (value.asOf != null &&
      (typeof value.asOf !== "string" ||
        !validHistoryDay(value.asOf.slice(0, 10)) ||
        !Number.isFinite(Date.parse(value.asOf))))
  )
    throw new Error(
      "Fitness history returned an invalid response. Please retry."
    )
  const sourceAnchors =
    value.anchors ?? (value.configured ? null : defaultFitnessAnchors(type))
  if (
    !Array.isArray(sourceAnchors) ||
    !sourceAnchors.length ||
    sourceAnchors.length > 5
  )
    throw new Error("Invalid peak history columns.")
  const anchors = sourceAnchors.map((anchor) => parseAnchor(anchor, type))
  if (new Set(anchors.map(anchorKey)).size !== anchors.length)
    throw new Error("Duplicate peak history columns.")
  const periods = (source: unknown, limit: number): FitnessPeriod[] => {
    if (!Array.isArray(source) || source.length > limit)
      throw new Error("Invalid fitness history periods.")
    const seen = new Set<string>()
    return source
      .map((candidate) => {
        if (
          !record(candidate) ||
          !validHistoryDay(candidate.start) ||
          !validHistoryDay(candidate.end) ||
          candidate.end < candidate.start ||
          seen.has(candidate.start) ||
          !Number.isSafeInteger(candidate.activities) ||
          !nonnegative(candidate.activities) ||
          (candidate.label != null &&
            (typeof candidate.label !== "string" ||
              candidate.label.length > 100)) ||
          (candidate.incomplete != null && !record(candidate.incomplete)) ||
          !Array.isArray(candidate.peaks) ||
          candidate.peaks.length > 5
        )
          throw new Error("Invalid fitness history row.")
        seen.add(candidate.start)
        const totals = {} as Record<FitnessTotal, number | null>
        const incomplete = {} as Record<FitnessTotal, boolean>
        for (const key of fitnessTotalKeys) {
          if (candidate[key] != null && !nonnegative(candidate[key]))
            throw new Error("Invalid fitness history total.")
          const partial = (
            candidate.incomplete as Record<string, unknown> | undefined
          )?.[key]
          if (partial != null && typeof partial !== "boolean")
            throw new Error("Invalid partial fitness total.")
          totals[key] = (candidate[key] as number | null) ?? null
          incomplete[key] = partial === true
        }
        const peaks = new Map<string, FitnessPeak>()
        for (const sourcePeak of candidate.peaks) {
          const anchor = parseAnchor(sourcePeak, type)
          // Intervals.icu may round a yard-equivalent distance to whole metres.
          // Match with the same half-metre tolerance used to select curve points.
          const column = anchors.find((item) =>
            type === "Ride"
              ? item.duration_seconds === anchor.duration_seconds
              : Math.abs(item.distance_meters! - anchor.distance_meters!) <=
                (type === "Swim" ? 0.5 : 0.01)
          )
          const key = column && anchorKey(column)
          if (
            !key ||
            peaks.has(key) ||
            !record(sourcePeak) ||
            (sourcePeak.value != null && !nonnegative(sourcePeak.value)) ||
            (sourcePeak.source != null &&
              (typeof sourcePeak.source !== "string" ||
                !["intervals-curve", "calculated-activity-curves"].includes(
                  sourcePeak.source
                ))) ||
            (sourcePeak.date != null &&
              (!validHistoryDay(sourcePeak.date) ||
                sourcePeak.date < candidate.start ||
                sourcePeak.date > candidate.end)) ||
            (sourcePeak.activity_id != null &&
              (typeof sourcePeak.activity_id !== "string" ||
                sourcePeak.activity_id.length > 512)) ||
            (sourcePeak.name != null &&
              (typeof sourcePeak.name !== "string" ||
                sourcePeak.name.length > 1000)) ||
            ["elapsed_seconds", "start_seconds", "end_seconds"].some(
              (field) =>
                sourcePeak[field] != null && !nonnegative(sourcePeak[field])
            ) ||
            ["start_index", "end_index"].some(
              (field) =>
                sourcePeak[field] != null &&
                (!nonnegative(sourcePeak[field]) ||
                  !Number.isSafeInteger(sourcePeak[field]))
            ) ||
            (nonnegative(sourcePeak.start_index) &&
              nonnegative(sourcePeak.end_index) &&
              sourcePeak.end_index < sourcePeak.start_index) ||
            (nonnegative(sourcePeak.start_seconds) &&
              nonnegative(sourcePeak.end_seconds) &&
              sourcePeak.end_seconds <= sourcePeak.start_seconds) ||
            (sourcePeak.estimated != null && sourcePeak.estimated !== false)
          )
            throw new Error("Invalid measured fitness peak.")
          peaks.set(key, {
            ...column!,
            value: (sourcePeak.value as number | null) ?? null,
            source: (sourcePeak.source as FitnessPeak["source"]) ?? null,
            activity_id: (sourcePeak.activity_id as string | null) ?? null,
            date: (sourcePeak.date as string | null) ?? null,
            measured_distance_meters: anchor.distance_meters,
            name: (sourcePeak.name as string | null) ?? null,
            elapsed_seconds:
              (sourcePeak.elapsed_seconds as number | null) ?? null,
            start_index: (sourcePeak.start_index as number | null) ?? null,
            end_index: (sourcePeak.end_index as number | null) ?? null,
            start_seconds: (sourcePeak.start_seconds as number | null) ?? null,
            end_seconds: (sourcePeak.end_seconds as number | null) ?? null,
          })
        }
        return {
          ...totals,
          incomplete,
          start: candidate.start,
          end: candidate.end,
          label:
            typeof candidate.label === "string"
              ? candidate.label
              : candidate.start,
          activities: candidate.activities as number,
          peaks: anchors.map(
            (anchor) =>
              peaks.get(anchorKey(anchor)) ?? { ...anchor, value: null }
          ),
        }
      })
      .sort((a, b) => b.start.localeCompare(a.start))
  }
  return {
    configured: value.configured,
    type,
    asOf: (value.asOf as string | null) ?? null,
    anchors,
    weeks: periods(value.weeks ?? (value.configured ? null : []), 4),
    months: periods(value.months ?? (value.configured ? null : []), 12),
    comparisonMonths: periods(value.comparisonMonths ?? [], 12),
    source: (value.source as FitnessHistory["source"]) ?? null,
    ...(value.peakCoverage
      ? { peakCoverage: value.peakCoverage as FitnessHistory["peakCoverage"] }
      : {}),
    ...(value.peaksError ? { peaksError: value.peaksError as string } : {}),
  }
}

/** Open only an attributed measured effort; source sample indices are not chart seconds. */
export function fitnessPeakEffortTarget(
  peak: FitnessPeak,
  sport: FitnessSport
): ActivityEffortTarget | null {
  const activityId = peak.activity_id
  if (
    !activityId ||
    !/^i?[1-9]\d{0,19}$/.test(activityId) ||
    !nonnegative(peak.value)
  )
    return null
  const duration = peak.duration_seconds
  const distance = peak.measured_distance_meters ?? peak.distance_meters
  if (
    sport === "Ride"
      ? peak.unit !== "watts" ||
        !nonnegative(duration) ||
        duration <= 0 ||
        !Number.isSafeInteger(duration)
      : peak.unit !== "m/s" ||
        peak.value <= 0 ||
        !nonnegative(distance) ||
        distance <= 0
  )
    return null
  return {
    activityId,
    sport,
    kind: sport === "Ride" ? "power" : "pace",
    durationSeconds: sport === "Ride" ? duration : null,
    distanceMeters: sport === "Ride" ? null : distance,
    value: peak.value,
    ...(nonnegative(peak.start_seconds) &&
    nonnegative(peak.end_seconds) &&
    peak.end_seconds > peak.start_seconds
      ? { startSeconds: peak.start_seconds, endSeconds: peak.end_seconds }
      : {}),
  }
}

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const METERS_PER_MILE = 1609.344
const weekLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})
const monthLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})
export function fitnessPeriodLabel(start: string, month = false) {
  if (!validHistoryDay(start)) return "—"
  return (month ? monthLabel : weekLabel).format(new Date(`${start}T12:00:00Z`))
}
export function fitnessAnchorLabel(anchor: FitnessAnchor, type: FitnessSport) {
  if (anchor.duration_seconds != null)
    return anchor.duration_seconds < 60
      ? `${anchor.duration_seconds}s`
      : `${number.format(anchor.duration_seconds / 60)}m`
  const distance = anchor.distance_meters!
  if (type === "Swim") return `${integer.format(distance / METERS_PER_YARD)}yd`
  if (distance === 21097.5) return "Half"
  return distance < 1000
    ? `${number.format(distance)}m`
    : `${number.format(distance / 1000)}km`
}
export function fitnessDuration(seconds: number | null) {
  if (seconds == null || !nonnegative(seconds)) return "—"
  const minutes = Math.round(seconds / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`
}
export function fitnessDistance(meters: number | null, type: FitnessSport) {
  if (meters == null || !nonnegative(meters)) return "—"
  const distance =
    meters / (type === "Swim" ? METERS_PER_YARD : METERS_PER_MILE)
  if (!Number.isFinite(distance)) return "—"
  return (type === "Swim" ? integer : number).format(distance)
}
export function fitnessNumber(value: number | null) {
  return value == null || !nonnegative(value) ? "—" : integer.format(value)
}
export function fitnessPeakValue(value: number | null, type: FitnessSport) {
  if (value == null || !nonnegative(value)) return "—"
  if (type === "Ride") return integer.format(value)
  if (value === 0) return "—"
  const seconds = Math.round(
    (type === "Run" ? METERS_PER_MILE : 100 * METERS_PER_YARD) / value
  )
  if (!Number.isFinite(seconds)) return "—"
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

const values = new Map<
  FitnessSport,
  { value: FitnessHistory; expires: number }
>()
let generation = 0
const reads = createSharedRequestCache(
  async (key, signal) => {
    const type = key as FitnessSport
    const revision = generation
    const response = await apiFetch(`/api/performance-history?type=${type}`, {
      signal,
      headers: { Accept: "application/json" },
    })
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Sign in to load fitness history."
          : "Fitness history could not load. Please retry."
      )
    const value = parseFitnessHistory(await response.json(), type)
    if (revision !== generation || signal.aborted)
      throw new DOMException("Aborted", "AbortError")
    values.set(type, { value, expires: Date.now() + 5 * 60_000 })
    return value
  },
  // A cold missing-peak calculation can follow a provider curve read; both
  // provider stages have a 30-second bound while the card reserves its size.
  { maxWeight: 0, maxEntries: 0, timeoutMs: 65_000 }
)

export function clearFitnessHistory() {
  generation++
  values.clear()
  reads.clear()
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("fitness-history-reset"))
}
if (typeof window !== "undefined") {
  for (const event of ["training-cache-reset", "app-auth-required"])
    window.addEventListener(event, clearFitnessHistory)
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === "training-agent-auth-change")
      clearFitnessHistory()
    else if (event.key === "training-agent-startup-v2") {
      // A routine snapshot in another tab does not change the signed-in account.
      const scope = (value: string | null) => {
        try {
          const candidate = JSON.parse(value || "null")?.cache_scope
          return typeof candidate === "string" && candidate ? candidate : null
        } catch {
          return null
        }
      }
      const previous = scope(event.oldValue),
        next = scope(event.newValue)
      if (!previous || !next || previous !== next) clearFitnessHistory()
    }
  })
}
export function cachedFitnessHistory(type: FitnessSport) {
  const cached = values.get(type)
  if (!cached || cached.expires <= Date.now()) {
    values.delete(type)
    return null
  }
  return cached.value
}
export function loadFitnessHistory(type: FitnessSport, signal?: AbortSignal) {
  if (!fitnessSports.includes(type))
    return Promise.reject(new Error("Unknown fitness sport."))
  if (signal?.aborted)
    return Promise.reject(new DOMException("Aborted", "AbortError"))
  const cached = cachedFitnessHistory(type)
  return cached ? Promise.resolve(cached) : reads.get(type, signal)
}
