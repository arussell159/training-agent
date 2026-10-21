import {
  dashboardTagClient,
  createDashboardTagClient,
  type TaggedCurveResult,
} from "./dashboard-chart-tags.ts"
import { apiFetch } from "./api-client.ts"
import { createSharedRequestCache } from "./shared-request-cache.ts"
import {
  dashboardChartSports,
  dashboardRangeError,
  validDashboardDate,
  type DashboardChartSport,
  type DashboardChartRange,
} from "./dashboard-chart-settings.ts"
import { dashboardPowerGridDurations } from "./dashboard-power-curve.ts"
import {
  heartRateCurveSelection,
  heartRateNativeSports,
  heartRateSportMatches,
  type HeartRateCurveResult,
} from "../../../app-backend/lib/heart-rate-curve-model.mjs"

export { dashboardPowerGridDurations as dashboardHeartRateGridDurations }
export function recordedHeartRateRange(
  range: DashboardChartRange,
  today: string
): DashboardChartRange | null {
  const problem = dashboardRangeError(range)
  if (problem) throw Error(problem)
  if (!validDashboardDate(today))
    throw Error("The athlete date is unavailable.")
  if (range.start < "1900-01-01")
    throw Error("Recorded heart-rate history is available from 1900 onward.")
  return range.start > today
    ? null
    : { start: range.start, end: range.end > today ? today : range.end }
}
export type DashboardHeartRateCurve = (
  HeartRateCurveResult | TaggedCurveResult
) & {
  range: DashboardChartRange
  effectiveRange: DashboardChartRange | null
}
const nativeLabels: Partial<Record<DashboardChartSport, string>> = {
  Bike: "Ride",
  Run: "Run",
  Swim: "Swim",
  Strength: "WeightTraining",
  Crosstrain: "Workout",
  "Mtn Bike": "MountainBikeRide",
  "XC-Ski": "NordicSki",
  Rowing: "Rowing",
  Walk: "Walk",
  Other: "Other",
}
export function dashboardHeartRateSelection(
  sports: readonly DashboardChartSport[],
  globalSport = "all"
) {
  if (!sports.length)
    throw Error("Choose at least one workout type for heart-rate curves.")
  if (
    new Set(sports).size !== sports.length ||
    sports.some((sport) => !dashboardChartSports.includes(sport))
  )
    throw Error("Choose valid workout types for heart-rate curves.")
  const all = sports.length === dashboardChartSports.length
  const selected =
    globalSport === "all"
      ? sports
      : sports.filter((sport) =>
          globalSport === "bike"
            ? ["Bike", "Mtn Bike"].includes(sport)
            : globalSport === "run"
              ? sport === "Run"
              : globalSport === "swim"
                ? sport === "Swim"
                : false
        )
  if (!selected.length)
    throw Error("No selected workout types match the dashboard sport filter.")
  if (all && globalSport === "all") return "all"
  const unsupported = selected.filter((sport) => !nativeLabels[sport])
  if (unsupported.length)
    throw Error(
      `Heart-rate curves cannot identify ${unsupported.join(", ")} separately in recorded provider data. Choose All or supported workout types.`
    )
  return [...new Set(selected.map((sport) => nativeLabels[sport]!))]
    .sort()
    .join(",")
}
export function dashboardHeartRateTitle(
  sports: readonly DashboardChartSport[]
) {
  return `Peaks - Heart Rate: ${sports.length === dashboardChartSports.length ? "All Workout Types" : sports.join(", ") || "No Workout Types"}`
}
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const invalid = () =>
  Error(
    "Recorded heart-rate history returned invalid or mismatched source data. Previous results are retained."
  )
const count = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0
export function parseDashboardHeartRateCurve(
  value: unknown,
  sport: string,
  range: DashboardChartRange,
  today: string
): DashboardHeartRateCurve {
  const effectiveRange = recordedHeartRateRange(range, today)
  if (!effectiveRange) throw invalid()
  const requested = heartRateCurveSelection(
      {
        kind: "heartRate",
        sport,
        start: effectiveRange.start,
        end: effectiveRange.end,
      },
      today
    ),
    body = object(value),
    selection = object(body?.selection),
    window = object(body?.window),
    coverage = object(body?.coverage)
  if (
    !body ||
    body.version !== 1 ||
    body.kind !== "heartRate" ||
    body.unit !== "bpm" ||
    body.source !== "intervals-hr-curve" ||
    !selection ||
    selection.sport !== requested.sport ||
    JSON.stringify(selection.nativeTypes) !==
      JSON.stringify(requested.nativeTypes) ||
    !window ||
    window.oldest !== effectiveRange.start ||
    window.newest !== effectiveRange.end ||
    !coverage ||
    !["native-aggregate", "partial"].includes(String(coverage.status)) ||
    !count(coverage.inventoryRecords) ||
    Number(coverage.inventoryRecords) > 10000 ||
    !count(coverage.verifiedPoints) ||
    !count(coverage.unknownPoints) ||
    !Array.isArray(coverage.failedSelections) ||
    coverage.failedSelections.length > 14 ||
    new Set(coverage.failedSelections).size !==
      coverage.failedSelections.length ||
    coverage.failedSelections.some(
      (type) =>
        typeof type !== "string" ||
        !(requested.sport === "all"
          ? type === "all"
          : requested.nativeTypes.includes(type))
    ) ||
    !Array.isArray(body.points) ||
    body.points.length > 10000 ||
    (body.warning !== null &&
      (typeof body.warning !== "string" || body.warning.length > 1000))
  )
    throw invalid()
  let previous = 0,
    known = 0
  for (const item of body.points) {
    const point = object(item)
    if (
      !point ||
      !Number.isSafeInteger(point.duration_seconds) ||
      Number(point.duration_seconds) <= previous ||
      point.estimated !== false ||
      (point.value !== null &&
        (typeof point.value !== "number" ||
          !Number.isFinite(point.value) ||
          point.value < 0 ||
          !Number.isInteger(point.value))) ||
      (point.activity_id !== null &&
        (typeof point.activity_id !== "string" ||
          !/^i?[1-9]\d{0,29}$/.test(point.activity_id))) ||
      (point.native_type !== null &&
        (typeof point.native_type !== "string" ||
          !heartRateNativeSports.includes(point.native_type))) ||
      (point.date !== null &&
        (!validDashboardDate(point.date) ||
          point.date < effectiveRange.start ||
          point.date > effectiveRange.end)) ||
      (point.name !== null &&
        (typeof point.name !== "string" || point.name.length > 512))
    )
      throw invalid()
    if (
      (point.start_index !== undefined || point.end_index !== undefined) &&
      (!Number.isSafeInteger(point.start_index) ||
        !Number.isSafeInteger(point.end_index) ||
        Number(point.start_index) < 0 ||
        Number(point.end_index) <= Number(point.start_index))
    )
      throw invalid()
    if (point.value !== null) {
      if (
        typeof point.activity_id !== "string" ||
        !validDashboardDate(point.date) ||
        typeof point.native_type !== "string" ||
        !(
          requested.sport === "all" ||
          requested.nativeTypes.some((type) =>
            heartRateSportMatches(String(point.native_type), type)
          )
        )
      )
        throw invalid()
      known++
    }
    previous = Number(point.duration_seconds)
  }
  if (
    coverage.verifiedPoints !== known ||
    coverage.unknownPoints !== body.points.length - known ||
    (coverage.status === "native-aggregate" &&
      (coverage.unknownPoints !== 0 ||
        coverage.failedSelections.length !== 0)) ||
    (known > 0 && coverage.inventoryRecords === 0)
  )
    throw invalid()
  return {
    ...(structuredClone(body) as HeartRateCurveResult),
    range: { ...range },
    effectiveRange,
  }
}
export function dashboardHeartRatePlotRows(
  primary: DashboardHeartRateCurve,
  comparison: DashboardHeartRateCurve | null = null
) {
  const rows = new Map<
    number,
    { seconds: number; primary: number | null; comparison: number | null }
  >()
  for (const [key, curve] of [
    ["primary", primary],
    ["comparison", comparison],
  ] as const)
    for (const point of curve?.points || []) {
      const row = rows.get(point.duration_seconds) || {
        seconds: point.duration_seconds,
        primary: null,
        comparison: null,
      }
      row[key] = point.value
      rows.set(point.duration_seconds, row)
    }
  return [...rows.values()].sort((a, b) => a.seconds - b.seconds)
}
export function dashboardHeartRateGridRows(
  primary: DashboardHeartRateCurve,
  comparison: DashboardHeartRateCurve | null = null
) {
  const first = new Map(
      primary.points.map((point) => [point.duration_seconds, point])
    ),
    second = new Map(
      (comparison?.points || []).map((point) => [point.duration_seconds, point])
    )
  return dashboardPowerGridDurations.map((seconds) => ({
    seconds,
    primary: first.get(seconds),
    comparison: second.get(seconds),
  }))
}
type Request = (path: string, options?: RequestInit) => Promise<Response>
export function createDashboardHeartRateClient(request: Request = apiFetch) {
  const tagsClient =
    request === apiFetch
      ? dashboardTagClient
      : createDashboardTagClient(request)
  const cache = createSharedRequestCache<DashboardHeartRateCurve>(
    async (key, signal) => {
      const [, sport, range, today] = JSON.parse(key) as [
          string,
          string,
          DashboardChartRange,
          string,
          number,
        ],
        effective = recordedHeartRateRange(range, today)
      const selection = heartRateCurveSelection(
        {
          kind: "heartRate",
          sport,
          start: effective?.start || today,
          end: effective?.end || today,
        },
        today
      )
      if (!effective)
        return {
          version: 1,
          kind: "heartRate",
          unit: "bpm",
          source: "intervals-hr-curve",
          selection: {
            sport: selection.sport,
            nativeTypes: selection.nativeTypes,
          },
          window: { oldest: range.start, newest: range.end },
          points: [],
          coverage: {
            status: "native-aggregate",
            inventoryRecords: 0,
            verifiedPoints: 0,
            unknownPoints: 0,
            failedSelections: [],
          },
          warning: null,
          range: { ...range },
          effectiveRange: null,
        }
      const response = await request(
          `/api/performance-curves?${new URLSearchParams({ kind: "heartRate", sport: selection.sport, start: effective.start, end: effective.end })}`,
          { signal, headers: { Accept: "application/json" } }
        ),
        body = await response.json()
      signal.throwIfAborted()
      if (!response.ok)
        throw Error(
          typeof body?.error === "string"
            ? body.error
            : "Recorded heart-rate history could not load."
        )
      return parseDashboardHeartRateCurve(body, selection.sport, range, today)
    },
    { maxEntries: 32, ttlMs: 5 * 60000, timeoutMs: 65000 }
  )
  return {
    load: (
      scope: string,
      sport: string,
      range: DashboardChartRange,
      today: string,
      {
        signal,
        revision = 0,
        tags = [],
      }: {
        signal?: AbortSignal
        revision?: number
        tags?: readonly string[]
      } = {}
    ) => {
      const effective = recordedHeartRateRange(range, today)
      const selection = heartRateCurveSelection(
        {
          kind: "heartRate",
          sport,
          start: effective?.start || today,
          end: effective?.end || today,
        },
        today
      )
      if (tags.length && effective)
        return tagsClient
          .load(scope, "heartRate", selection.sport, effective, today, tags, {
            signal,
            revision,
          })
          .then((curve) => ({
            ...curve,
            range: { ...range },
            effectiveRange: effective,
          }))
      return cache
        .get(
          JSON.stringify([scope, selection.sport, range, today, revision]),
          signal
        )
        .then((curve) => structuredClone(curve))
    },
    clear: () => {
      cache.clear()
      tagsClient.clear()
    },
  }
}
export const dashboardHeartRateClient = createDashboardHeartRateClient()
if (typeof window !== "undefined")
  for (const event of [
    "app-auth-required",
    "training-cache-reset",
    "training-mutation-settled",
  ])
    window.addEventListener(event, () => dashboardHeartRateClient.clear())
