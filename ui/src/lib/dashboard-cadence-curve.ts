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

import {
  CADENCE_GRID_SECONDS,
  cadenceCurveSelection,
  cadenceNativeSports,
  cadenceSourceMatches,
  type CadenceCurveResult,
} from "../../../app-backend/lib/cadence-curve-model.mjs"

export const dashboardCadenceGridDurations = CADENCE_GRID_SECONDS
export function recordedCadenceRange(
  range: DashboardChartRange,
  today: string
): DashboardChartRange | null {
  const problem = dashboardRangeError(range)
  if (problem) throw Error(problem)
  if (!validDashboardDate(today))
    throw Error("The athlete date is unavailable.")
  if (range.start < "1900-01-01")
    throw Error("Recorded cadence history is available from 1900 onward.")
  return range.start > today
    ? null
    : { start: range.start, end: range.end > today ? today : range.end }
}
export type DashboardCadenceCurve = (CadenceCurveResult | TaggedCurveResult) & {
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
export function dashboardCadenceSelection(
  sports: readonly DashboardChartSport[],
  globalSport = "all"
) {
  if (!sports.length)
    throw Error("Choose at least one workout type for cadence curves.")
  if (
    new Set(sports).size !== sports.length ||
    sports.some((sport) => !dashboardChartSports.includes(sport))
  )
    throw Error("Choose valid workout types for cadence curves.")
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
      `Cadence curves cannot identify ${unsupported.join(", ")} separately in recorded provider data. Choose All or supported workout types.`
    )
  return [...new Set(selected.map((sport) => nativeLabels[sport]!))]
    .sort()
    .join(",")
}
export function dashboardCadenceTitle(sports: readonly DashboardChartSport[]) {
  return `Peaks - Cadence: ${sports.length === dashboardChartSports.length ? "All Workout Types" : sports.join(", ") || "No Workout Types"}`
}
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const invalid = () =>
  Error(
    "Recorded cadence history returned invalid or mismatched source data. Previous results are retained."
  )
const count = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0
export function parseDashboardCadenceCurve(
  value: unknown,
  sport: string,
  range: DashboardChartRange,
  today: string
): DashboardCadenceCurve {
  const effectiveRange = recordedCadenceRange(range, today)
  if (!effectiveRange) throw invalid()
  const requested = cadenceCurveSelection(
      {
        kind: "cadence",
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
    body.kind !== "cadence" ||
    body.unit !== "rpm" ||
    body.source !== "intervals-activity-cadence-curves" ||
    body.unitPolicy !== "native-rpm" ||
    body.tagsSupported !== false ||
    !selection ||
    selection.sport !== requested.sport ||
    JSON.stringify(selection.nativeTypes) !==
      JSON.stringify(requested.nativeTypes) ||
    !window ||
    window.oldest !== effectiveRange.start ||
    window.newest !== effectiveRange.end ||
    !coverage ||
    !["available-recordings", "partial"].includes(String(coverage.status)) ||
    !count(coverage.inventoryRecords) ||
    Number(coverage.inventoryRecords) > 10000 ||
    [
      "eligibleRecordings",
      "fetchedRecordings",
      "failedRecordings",
      "missingRecordings",
      "skippedForCap",
      "excludedWithoutCadence",
      "unknownPoints",
    ].some((key) => !count(coverage[key])) ||
    Number(coverage.eligibleRecordings) +
      Number(coverage.excludedWithoutCadence) !==
      coverage.inventoryRecords ||
    Number(coverage.fetchedRecordings) + Number(coverage.skippedForCap) !==
      coverage.eligibleRecordings ||
    Number(coverage.fetchedRecordings) > 128 ||
    Number(coverage.failedRecordings) + Number(coverage.missingRecordings) >
      Number(coverage.fetchedRecordings) ||
    !Array.isArray(body.points) ||
    body.points.length > 10000 ||
    typeof body.warning !== "string" ||
    body.warning.length > 1000
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
          point.value < 0)) ||
      typeof point.activity_id !== "string" ||
      !/^i?[1-9]\d{0,29}$/.test(point.activity_id) ||
      typeof point.native_type !== "string" ||
      !cadenceNativeSports.includes(point.native_type) ||
      !validDashboardDate(point.date) ||
      point.date < effectiveRange.start ||
      point.date > effectiveRange.end ||
      !(
        requested.sport === "all" ||
        requested.nativeTypes.some((type) =>
          cadenceSourceMatches(String(point.native_type), type)
        )
      ) ||
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
    if (point.value !== null) known++
    previous = Number(point.duration_seconds)
  }
  if (
    coverage.unknownPoints !== body.points.length - known ||
    (coverage.status === "available-recordings" &&
      [
        "unknownPoints",
        "failedRecordings",
        "missingRecordings",
        "skippedForCap",
      ].some((key) => coverage[key] !== 0)) ||
    (body.points.length > 0 &&
      Number(coverage.fetchedRecordings) -
        Number(coverage.failedRecordings) -
        Number(coverage.missingRecordings) <=
        0)
  )
    throw invalid()
  return {
    ...(structuredClone(body) as CadenceCurveResult),
    range: { ...range },
    effectiveRange,
  }
}
export function dashboardCadencePlotRows(
  primary: DashboardCadenceCurve,
  comparison: DashboardCadenceCurve | null = null
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
export function dashboardCadenceGridRows(
  primary: DashboardCadenceCurve,
  comparison: DashboardCadenceCurve | null = null
) {
  const first = new Map(
      primary.points.map((point) => [point.duration_seconds, point])
    ),
    second = new Map(
      (comparison?.points || []).map((point) => [point.duration_seconds, point])
    )
  return CADENCE_GRID_SECONDS.map((seconds) => ({
    seconds,
    primary: first.get(seconds),
    comparison: second.get(seconds),
  }))
}
type Request = (path: string, options?: RequestInit) => Promise<Response>
export function createDashboardCadenceClient(request: Request = apiFetch) {
  const tagsClient =
    request === apiFetch
      ? dashboardTagClient
      : createDashboardTagClient(request)
  const cache = createSharedRequestCache<DashboardCadenceCurve>(
    async (key, signal) => {
      const [, sport, range, today] = JSON.parse(key) as [
          string,
          string,
          DashboardChartRange,
          string,
          number,
        ],
        effective = recordedCadenceRange(range, today)
      const selection = cadenceCurveSelection(
        {
          kind: "cadence",
          sport,
          start: effective?.start || today,
          end: effective?.end || today,
        },
        today
      )
      if (!effective)
        return {
          version: 1,
          kind: "cadence",
          unit: "rpm",
          source: "intervals-activity-cadence-curves",
          unitPolicy: "native-rpm",
          tagsSupported: false,
          selection: {
            sport: selection.sport,
            nativeTypes: selection.nativeTypes,
          },
          window: { oldest: range.start, newest: range.end },
          points: [],
          coverage: {
            status: "available-recordings",
            inventoryRecords: 0,
            eligibleRecordings: 0,
            fetchedRecordings: 0,
            failedRecordings: 0,
            missingRecordings: 0,
            skippedForCap: 0,
            excludedWithoutCadence: 0,
            unknownPoints: 0,
          },
          warning: "",
          range: { ...range },
          effectiveRange: null,
        }
      const response = await request(
          `/api/performance-curves?${new URLSearchParams({ kind: "cadence", sport: selection.sport, start: effective.start, end: effective.end })}`,
          { signal, headers: { Accept: "application/json" } }
        ),
        body = await response.json()
      signal.throwIfAborted()
      if (!response.ok)
        throw Error(
          typeof body?.error === "string"
            ? body.error
            : "Recorded cadence history could not load."
        )
      return parseDashboardCadenceCurve(body, selection.sport, range, today)
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
      const effective = recordedCadenceRange(range, today)
      const selection = cadenceCurveSelection(
        {
          kind: "cadence",
          sport,
          start: effective?.start || today,
          end: effective?.end || today,
        },
        today
      )
      if (tags.length && effective)
        return tagsClient
          .load(scope, "cadence", selection.sport, effective, today, tags, {
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
export const dashboardCadenceClient = createDashboardCadenceClient()
if (typeof window !== "undefined")
  for (const event of [
    "app-auth-required",
    "training-cache-reset",
    "training-mutation-settled",
  ])
    window.addEventListener(event, () => dashboardCadenceClient.clear())
