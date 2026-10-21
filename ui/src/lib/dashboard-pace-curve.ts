import { apiFetch } from "./api-client.ts"
import { createSharedRequestCache } from "./shared-request-cache.ts"
import {
  dashboardRangeError,
  validDashboardDate,
  type DashboardChartRange,
} from "./dashboard-chart-settings.ts"
import type { PersonalBestEffort } from "./personal-statistics.ts"
export type DashboardPaceSport = "Run" | "Swim"
export type DashboardPacePoint = {
  distance_meters: number
  elapsed_seconds: number | null
  value: number | null
  activity_id: string | null
  date: string | null
  name: string | null
  estimated: false
  start_index?: number
  end_index?: number
}
export type DashboardPaceCurve = {
  sport: DashboardPaceSport
  range: DashboardChartRange
  effectiveRange: DashboardChartRange | null
  points: DashboardPacePoint[]
  warning: string | null
}
export const dashboardObservedRunDistances = [
  { meters: 800, label: "800 m" },
  { meters: 1000, label: "1 km" },
  { meters: 1600, label: "1600 m" },
  { meters: 1609.344, label: "1 mi" },
  { meters: 5000, label: "5 km" },
  { meters: 8046.72, label: "5 mi" },
  { meters: 10000, label: "10 km" },
  { meters: 15000, label: "15 km" },
  { meters: 16093.44, label: "10 mi" },
  { meters: 21097.5, label: "HM" },
  { meters: 30000, label: "30 km" },
] as const
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
const invalid = () =>
  Error(
    "Recorded pace history could not be verified. Previous results are retained."
  )
export function recordedPaceRange(
  range: DashboardChartRange,
  today: string
): DashboardChartRange | null {
  const problem = dashboardRangeError(range)
  if (problem) throw Error(problem)
  if (!validDashboardDate(today))
    throw Error("The athlete date is unavailable.")
  if (range.start < "1900-01-01")
    throw Error("Recorded pace history is available from 1900 onward.")
  return range.start > today
    ? null
    : { start: range.start, end: range.end > today ? today : range.end }
}
export function parseDashboardPaceCurve(
  value: unknown,
  sport: DashboardPaceSport,
  range: DashboardChartRange,
  today: string
): DashboardPaceCurve {
  if (!["Run", "Swim"].includes(sport)) throw invalid()
  const effectiveRange = recordedPaceRange(range, today)
  if (!effectiveRange)
    return {
      sport,
      range: { ...range },
      effectiveRange: null,
      points: [],
      warning: null,
    }
  const body = object(value),
    errors = object(body?.paceCurveErrors)
  if (body?.paceCurveErrors !== undefined && !errors) throw invalid()
  if (errors?.[sport] !== undefined) {
    const message = errors[sport]
    if (typeof message !== "string" || !message.trim() || message.length > 1000)
      throw invalid()
    throw Error(message)
  }
  const curve = object(object(body?.paceCurves)?.[sport]),
    window = object(curve?.window)
  if (
    !body ||
    !["intervals", "synthetic-local-preview"].includes(String(body.source)) ||
    !validDashboardDate(body.today) ||
    body.today < effectiveRange.end ||
    !curve ||
    curve.version !== 1 ||
    curve.sport !== sport ||
    curve.kind !== "pace" ||
    curve.unit !== "m/s" ||
    curve.source !== "intervals-pace-curve" ||
    !window ||
    window.oldest !== effectiveRange.start ||
    window.newest !== effectiveRange.end ||
    !Array.isArray(curve.points) ||
    curve.points.length > 10000 ||
    (curve.warning !== null &&
      (typeof curve.warning !== "string" || curve.warning.length > 1000))
  )
    throw invalid()
  let previous = 0
  const points = curve.points.map((value) => {
    const point = object(value)
    if (
      !point ||
      !positive(point.distance_meters) ||
      point.distance_meters <= previous ||
      point.estimated !== false ||
      (point.value !== null && !positive(point.value)) ||
      (point.elapsed_seconds !== null && !positive(point.elapsed_seconds)) ||
      (point.value === null) !== (point.elapsed_seconds === null) ||
      (point.activity_id !== null &&
        (typeof point.activity_id !== "string" ||
          !/^i?[1-9]\d{0,29}$/.test(point.activity_id))) ||
      (point.date !== null &&
        (!validDashboardDate(point.date) ||
          point.date < effectiveRange.start ||
          point.date > effectiveRange.end)) ||
      (point.name !== null &&
        (typeof point.name !== "string" || point.name.length > 512))
    )
      throw invalid()
    previous = point.distance_meters
    if (point.value !== null) {
      const ratio = point.distance_meters / (point.elapsed_seconds as number)
      if (
        !positive(ratio) ||
        Math.abs((point.value as number) - ratio) >
          Math.max(1e-9, ratio * 1e-9) ||
        typeof point.activity_id !== "string" ||
        !validDashboardDate(point.date)
      )
        throw invalid()
    }
    if (point.start_index !== undefined || point.end_index !== undefined) {
      if (
        !Number.isSafeInteger(point.start_index) ||
        !Number.isSafeInteger(point.end_index) ||
        Number(point.start_index) < 0 ||
        Number(point.end_index) <= Number(point.start_index)
      )
        throw invalid()
    }
    return {
      distance_meters: point.distance_meters,
      elapsed_seconds: point.elapsed_seconds as number | null,
      value: point.value as number | null,
      activity_id: point.activity_id as string | null,
      date: point.date as string | null,
      name: point.name as string | null,
      estimated: false as const,
      ...(point.start_index !== undefined
        ? {
            start_index: point.start_index as number,
            end_index: point.end_index as number,
          }
        : {}),
    }
  })
  return {
    sport,
    range: { ...range },
    effectiveRange,
    points,
    warning: curve.warning as string | null,
  }
}
export function dashboardPaceEffort(
  curve: DashboardPaceCurve,
  point: DashboardPacePoint
): PersonalBestEffort | null {
  if (point.value === null || point.elapsed_seconds === null) return null
  return {
    sport: curve.sport,
    kind: "pace",
    duration_seconds: point.elapsed_seconds,
    distance_meters: point.distance_meters,
    value: point.value,
    unit: "m/s",
    activity_id: point.activity_id,
    date: point.date,
    name: point.name,
    estimated: false,
    ...(point.start_index !== undefined
      ? { start_index: point.start_index, end_index: point.end_index }
      : {}),
  }
}
export const dashboardPaceUnit = (sport: DashboardPaceSport) =>
  sport === "Run" ? "min/mi" : "min/100 yd"
export const dashboardPaceSeconds = (
  sport: DashboardPaceSport,
  value: number | null
) => (value === null ? null : (sport === "Run" ? 1609.344 : 91.44) / value)
export function dashboardPaceTime(seconds: number | null) {
  if (seconds === null || !positive(seconds)) return "—"
  const rounded = Math.max(1, Math.round(seconds))
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`
}
export function dashboardPacePlotRows(
  primary: DashboardPaceCurve,
  comparison: DashboardPaceCurve | null = null
) {
  const rows = new Map<
    number,
    { meters: number; primary: number | null; comparison: number | null }
  >()
  for (const [key, curve] of [
    ["primary", primary],
    ["comparison", comparison],
  ] as const)
    for (const point of curve?.points || []) {
      const row = rows.get(point.distance_meters) || {
        meters: point.distance_meters,
        primary: null,
        comparison: null,
      }
      row[key] = dashboardPaceSeconds(curve!.sport, point.value)
      rows.set(point.distance_meters, row)
    }
  return [...rows.values()].sort((a, b) => a.meters - b.meters)
}
export function dashboardPaceGridRows(
  primary: DashboardPaceCurve,
  comparison: DashboardPaceCurve | null = null
) {
  const primaryKnown = new Map(
    primary.points
      .filter((point) => point.value !== null)
      .map((point) => [point.distance_meters, point])
  )
  const comparisonKnown = new Map(
    (comparison?.points || [])
      .filter((point) => point.value !== null)
      .map((point) => [point.distance_meters, point])
  )
  const known = new Set([...primaryKnown.keys(), ...comparisonKnown.keys()])
  const distances =
    primary.sport === "Run"
      ? dashboardObservedRunDistances
          .filter((anchor) => known.has(anchor.meters))
          .map((anchor) => anchor.meters)
      : [...known].sort((a, b) => a - b)
  return distances.map((meters) => ({
    meters,
    label:
      primary.sport === "Run"
        ? dashboardObservedRunDistances.find(
            (anchor) => anchor.meters === meters
          )!.label
        : `${meters.toLocaleString("en-US", { maximumFractionDigits: 4 })} m`,
    primary: primaryKnown.get(meters),
    comparison: comparisonKnown.get(meters),
  }))
}
type Request = (path: string, options?: RequestInit) => Promise<Response>
export function createDashboardPaceClient(request: Request = apiFetch) {
  const cache = createSharedRequestCache<DashboardPaceCurve>(
    async (key, signal) => {
      const [, sport, range, today] = JSON.parse(key) as [
        string,
        DashboardPaceSport,
        DashboardChartRange,
        string,
        number,
      ]
      const effective = recordedPaceRange(range, today)
      if (!effective)
        return { sport, range, effectiveRange: null, points: [], warning: null }
      const response = await request(
          `/api/personal-statistics?${new URLSearchParams({ oldest: effective.start, newest: effective.end })}`,
          { signal, headers: { Accept: "application/json" } }
        ),
        body = await response.json()
      signal.throwIfAborted()
      if (!response.ok)
        throw Error(
          typeof body?.error === "string"
            ? body.error
            : "Recorded pace history could not load. Retry to keep reviewing this chart."
        )
      return parseDashboardPaceCurve(body, sport, range, today)
    },
    { maxEntries: 32, ttlMs: 5 * 60000, timeoutMs: 65000 }
  )
  return {
    load: (
      scope: string,
      sport: DashboardPaceSport,
      range: DashboardChartRange,
      today: string,
      { signal, revision = 0 }: { signal?: AbortSignal; revision?: number } = {}
    ) => {
      recordedPaceRange(range, today)
      return cache.get(
        JSON.stringify([scope, sport, range, today, revision]),
        signal
      )
    },
    clear: () => cache.clear(),
  }
}
export const dashboardPaceClient = createDashboardPaceClient()
if (typeof window !== "undefined")
  for (const event of [
    "app-auth-required",
    "training-cache-reset",
    "training-mutation-settled",
  ])
    window.addEventListener(event, () => dashboardPaceClient.clear())
