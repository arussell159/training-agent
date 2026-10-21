import {
  dashboardTagClient,
  createDashboardTagClient,
} from "./dashboard-chart-tags.ts"
import { apiFetch } from "./api-client.ts"
import { createSharedRequestCache } from "./shared-request-cache.ts"
import {
  nativePowerCurveSelection,
  nativePowerSourceMatches,
  nativePowerSports,
  type NativePowerCurveResult,
} from "../../../app-backend/lib/native-power-curve-model.mjs"
import {
  dashboardRangeError,
  validDashboardDate,
  dashboardChartSports,
  type DashboardChartSport,
  type ChartDatePreset,
  type DashboardChartRange,
} from "./dashboard-chart-settings.ts"
import {
  BIKE_PERSONAL_BESTS,
  bestCurveEffort,
  normalizedPersonalStatistics,
  samePersonalBestWindow,
  type PersonalBestEffort,
} from "./personal-statistics.ts"
export const dashboardPowerAnchors = BIKE_PERSONAL_BESTS.map(
  (anchor) => anchor.seconds
)
export const dashboardPowerGridDurations = [
  5, 10, 12, 20, 30, 60, 120, 300, 360, 600, 720, 1200, 1800, 3600, 5400,
] as const
export function dashboardPowerSelection(
  sports: readonly DashboardChartSport[],
  globalSport = "all"
) {
  if (
    !sports.length ||
    new Set(sports).size !== sports.length ||
    sports.some((sport) => !dashboardChartSports.includes(sport))
  )
    throw Error("Choose valid workout types for power curves.")
  const all = sports.length === dashboardChartSports.length
  if (all && globalSport === "all") return "all"
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
  const native: Partial<Record<DashboardChartSport, string>> = {
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
  const unsupported = selected.filter((sport) => !native[sport])
  if (unsupported.length)
    throw Error(
      `Power curves cannot identify ${unsupported.join(", ")} separately in recorded provider data. Choose All or supported workout types.`
    )
  return [...new Set(selected.map((sport) => native[sport]!))].sort().join(",")
}
export function dashboardPowerTitle(sports: readonly DashboardChartSport[]) {
  return `Peaks - Power: ${sports.length === dashboardChartSports.length ? "All Workout Types" : sports.join(", ") || "No Workout Types"}`
}
export type DashboardPowerSettings = {
  comparison: boolean
  comparisonRange: DashboardChartRange & { preset: ChartDatePreset }
  display: "chart" | "grid"
}
export type DashboardPowerPoint = Omit<PersonalBestEffort, "sport"> & {
  sport: string
  native_type?: string
}
export type DashboardPowerCurve = {
  range: DashboardChartRange
  effectiveRange: DashboardChartRange | null
  points: DashboardPowerPoint[]
  samples: { seconds: number; watts: number | null }[]
  full: boolean
  warning: string | null
  native?: NativePowerCurveResult
}
export function dashboardPowerPlotRows(
  primary: DashboardPowerCurve,
  comparison: DashboardPowerCurve | null = null
) {
  const rows = new Map<
    number,
    { seconds: number; primary: number | null; comparison: number | null }
  >()
  for (const [key, curve] of [
    ["primary", primary],
    ["comparison", comparison],
  ] as const)
    for (const sample of curve?.samples || []) {
      const row = rows.get(sample.seconds) || {
        seconds: sample.seconds,
        primary: null,
        comparison: null,
      }
      row[key] = sample.watts
      rows.set(sample.seconds, row)
    }
  return [...rows.values()].sort((a, b) => a.seconds - b.seconds)
}
const invalidCurve = () =>
  Error(
    "Recorded power history contained an invalid full duration curve. Previous results are retained."
  )
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
function fullPowerCurve(
  value: unknown,
  effectiveRange: DashboardChartRange
): Pick<DashboardPowerCurve, "points" | "samples" | "full" | "warning"> {
  const curve = record(value),
    window = record(curve?.window)
  if (
    !curve ||
    curve.version !== 1 ||
    curve.sport !== "Bike" ||
    curve.kind !== "power" ||
    curve.unit !== "watts" ||
    curve.source !== "intervals-power-curve" ||
    !window ||
    window.oldest !== effectiveRange.start ||
    window.newest !== effectiveRange.end ||
    !Array.isArray(curve.points) ||
    curve.points.length > 10_000 ||
    (curve.warning !== null &&
      (typeof curve.warning !== "string" || curve.warning.length > 1000))
  )
    throw invalidCurve()
  const measured = new Map<number, PersonalBestEffort>()
  const samples: DashboardPowerCurve["samples"] = []
  let previous = 0
  for (const value of curve.points) {
    const point = record(value)
    if (
      !point ||
      !Number.isSafeInteger(point.duration_seconds) ||
      Number(point.duration_seconds) <= previous ||
      point.estimated !== false ||
      (point.value !== null &&
        (typeof point.value !== "number" ||
          !Number.isFinite(point.value) ||
          point.value < 0)) ||
      (point.activity_id !== null &&
        (typeof point.activity_id !== "string" ||
          !/^i?[1-9]\d{0,29}$/.test(point.activity_id))) ||
      (point.date !== null &&
        (!validDashboardDate(point.date) ||
          point.date < effectiveRange.start ||
          point.date > effectiveRange.end)) ||
      (point.name !== null &&
        (typeof point.name !== "string" || point.name.length > 512)) ||
      (point.watts_per_kg !== undefined &&
        (typeof point.watts_per_kg !== "number" ||
          !Number.isFinite(point.watts_per_kg) ||
          point.watts_per_kg < 0))
    )
      throw invalidCurve()
    previous = Number(point.duration_seconds)
    if (point.start_index !== undefined || point.end_index !== undefined) {
      if (
        !Number.isSafeInteger(point.start_index) ||
        !Number.isSafeInteger(point.end_index) ||
        Number(point.start_index) < 0 ||
        Number(point.end_index) <= Number(point.start_index)
      )
        throw invalidCurve()
    }
    samples.push({ seconds: previous, watts: point.value as number | null })
    if (point.value === null) continue
    if (
      typeof point.activity_id !== "string" ||
      !validDashboardDate(point.date)
    )
      throw invalidCurve()
    measured.set(previous, {
      sport: "Bike",
      kind: "power",
      unit: "watts",
      duration_seconds: previous,
      distance_meters: null,
      value: point.value as number,
      activity_id: point.activity_id,
      date: point.date,
      name: point.name as string | null,
      estimated: false,
      ...(point.watts_per_kg !== undefined
        ? { watts_per_kg: point.watts_per_kg as number }
        : {}),
      ...(point.start_index !== undefined
        ? {
            start_index: point.start_index as number,
            end_index: point.end_index as number,
          }
        : {}),
    })
  }
  return {
    points: [...measured.values()],
    samples,
    full: true,
    warning: curve.warning as string | null,
  }
}
export const newDashboardPowerSettings = (
  range: DashboardChartRange
): DashboardPowerSettings => ({
  comparison: false,
  comparisonRange: { ...range, preset: "dashboard" },
  display: "chart",
})
export function recordedPowerRange(
  range: DashboardChartRange,
  today: string
): DashboardChartRange | null {
  const problem = dashboardRangeError(range)
  if (problem) throw Error(problem)
  if (!validDashboardDate(today))
    throw Error("The athlete date is unavailable.")
  if (range.start < "1900-01-01")
    throw Error("Recorded power history is available from 1900 onward.")
  return range.start > today
    ? null
    : { start: range.start, end: range.end > today ? today : range.end }
}
export function parseDashboardNativePowerCurve(
  value: unknown,
  sport: string,
  range: DashboardChartRange,
  today: string
): DashboardPowerCurve {
  const effective = recordedPowerRange(range, today)
  if (!effective) throw invalidCurve()
  const requested = nativePowerCurveSelection(
      { kind: "power", sport, start: effective.start, end: effective.end },
      today
    ),
    body = record(value),
    selection = record(body?.selection),
    window = record(body?.window),
    coverage = record(body?.coverage)
  const count = (value: unknown) =>
    Number.isSafeInteger(value) && Number(value) >= 0
  const counts = [
    "inventoryRecords",
    "eligibleRecordings",
    "fetchedRecordings",
    "failedRecordings",
    "missingRecordings",
    "skippedForCap",
    "excludedWithoutPower",
    "excludedIgnoredRecordings",
    "unknownLengthRecordings",
    "unknownStreamRecordings",
    "invalidInventoryRecords",
    "conflictingRecordings",
    "unknownPoints",
  ]
  if (
    !body ||
    body.version !== 1 ||
    body.kind !== "power" ||
    body.unit !== "W" ||
    body.source !== "intervals-activity-power-curves" ||
    body.unitPolicy !== "native-watts" ||
    body.valuePolicy !== "native-reported" ||
    body.tagsSupported !== false ||
    !selection ||
    selection.sport !== requested.sport ||
    JSON.stringify(selection.nativeTypes) !==
      JSON.stringify(requested.nativeTypes) ||
    !window ||
    window.oldest !== effective.start ||
    window.newest !== effective.end ||
    !coverage ||
    !["available-recordings", "partial"].includes(String(coverage.status)) ||
    counts.some(
      (key) => !count(coverage[key]) || Number(coverage[key]) > 100000
    ) ||
    Number(coverage.inventoryRecords) > 10000 ||
    coverage.inventoryRecords !==
      Number(coverage.eligibleRecordings) +
        Number(coverage.excludedWithoutPower) +
        Number(coverage.excludedIgnoredRecordings) ||
    coverage.eligibleRecordings !==
      Number(coverage.fetchedRecordings) + Number(coverage.skippedForCap) ||
    Number(coverage.fetchedRecordings) > 128 ||
    Number(coverage.failedRecordings) + Number(coverage.missingRecordings) >
      Number(coverage.fetchedRecordings) ||
    Number(coverage.unknownLengthRecordings) >
      Number(coverage.eligibleRecordings) ||
    Number(coverage.unknownStreamRecordings) >
      Number(coverage.eligibleRecordings) ||
    !Array.isArray(body.points) ||
    body.points.length > 10000 ||
    typeof body.warning !== "string" ||
    body.warning.length > 4000
  )
    throw invalidCurve()
  let previous = 0,
    unknown = 0
  const identities = new Map<string, string>()
  for (const item of body.points) {
    const point = record(item)
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
      !nativePowerSports.includes(point.native_type) ||
      !(
        requested.sport === "all" ||
        requested.nativeTypes.some((type) =>
          nativePowerSourceMatches(String(point.native_type), type)
        )
      ) ||
      !validDashboardDate(point.date) ||
      point.date < effective.start ||
      point.date > effective.end ||
      (point.name !== null &&
        (typeof point.name !== "string" || point.name.length > 512))
    )
      throw invalidCurve()
    if (
      (point.start_index !== undefined || point.end_index !== undefined) &&
      (!Number.isSafeInteger(point.start_index) ||
        !Number.isSafeInteger(point.end_index) ||
        Number(point.start_index) < 0 ||
        Number(point.end_index) <= Number(point.start_index))
    )
      throw invalidCurve()
    const identity = JSON.stringify([point.native_type, point.date, point.name])
    if (
      identities.has(point.activity_id) &&
      identities.get(point.activity_id) !== identity
    )
      throw invalidCurve()
    identities.set(point.activity_id, identity)
    previous = Number(point.duration_seconds)
    if (point.value === null) unknown++
  }
  if (
    coverage.unknownPoints !== unknown ||
    identities.size >
      Number(coverage.fetchedRecordings) -
        Number(coverage.failedRecordings) -
        Number(coverage.missingRecordings) ||
    (coverage.status === "available-recordings" &&
      [
        "unknownPoints",
        "failedRecordings",
        "missingRecordings",
        "skippedForCap",
        "unknownLengthRecordings",
        "unknownStreamRecordings",
        "invalidInventoryRecords",
        "conflictingRecordings",
      ].some((key) => coverage[key] !== 0))
  )
    throw invalidCurve()
  const native = structuredClone(body) as NativePowerCurveResult
  return {
    range: { ...range },
    effectiveRange: effective,
    full: true,
    warning: native.warning,
    native,
    samples: native.points.map((point) => ({
      seconds: point.duration_seconds,
      watts: point.value,
    })),
    points: native.points.flatMap((point) =>
      point.value === null
        ? []
        : [
            {
              ...point,
              sport: point.native_type,
              kind: "power" as const,
              unit: "watts" as const,
              distance_meters: null,
              value: point.value,
            },
          ]
    ),
  }
}
export function parseDashboardPowerCurve(
  value: unknown,
  range: DashboardChartRange,
  today: string
): DashboardPowerCurve {
  const effectiveRange = recordedPowerRange(range, today)
  if (!effectiveRange)
    return {
      range: { ...range },
      effectiveRange: null,
      points: [],
      samples: [],
      full: true,
      warning: null,
    }
  const body = record(value)
  if (body?.powerCurveError !== undefined) {
    if (
      typeof body.powerCurveError !== "string" ||
      !body.powerCurveError.trim() ||
      body.powerCurveError.length > 1000
    )
      throw invalidCurve()
    throw Error(body.powerCurveError)
  }
  if (body?.powerCurve !== undefined && body.powerCurve !== null) {
    if (
      !["intervals", "synthetic-local-preview"].includes(String(body.source)) ||
      !validDashboardDate(body.today) ||
      body.today < effectiveRange.end
    )
      throw invalidCurve()
    const legacyWindow = record(body.bestEffortsWindow)
    if (
      body.bestEffortsWindow !== undefined &&
      (!legacyWindow ||
        legacyWindow.oldest !== effectiveRange.start ||
        legacyWindow.newest !== effectiveRange.end)
    )
      throw Error(
        "Power history returned a different date range. Previous results are retained."
      )
    const parsed = fullPowerCurve(body.powerCurve, effectiveRange)
    return { range: { ...range }, effectiveRange, ...parsed }
  }
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { bestEfforts?: unknown }).bestEfforts)
  )
    throw Error(
      "Recorded power history response is incomplete. Previous results are retained."
    )
  const raw = (value as { bestEfforts: unknown[] }).bestEfforts
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw Error(
        "Recorded power history contained an invalid measured anchor. Previous results are retained."
      )
    const point = item as Record<string, unknown>
    if (typeof point.sport !== "string" || typeof point.kind !== "string")
      throw Error(
        "Recorded power history contained an invalid measured anchor. Previous results are retained."
      )
    if (point.sport !== "Bike" || point.kind !== "power") continue
    if (
      point.unit !== "watts" ||
      point.estimated !== false ||
      typeof point.value !== "number" ||
      !Number.isFinite(point.value) ||
      point.value < 0 ||
      !Number.isSafeInteger(point.duration_seconds) ||
      Number(point.duration_seconds) < 1 ||
      Number(point.duration_seconds) > 86400 ||
      (point.date != null &&
        (!validDashboardDate(point.date) ||
          point.date < effectiveRange.start ||
          point.date > effectiveRange.end))
    )
      throw Error(
        "Recorded power history contained an invalid measured anchor. Previous results are retained."
      )
  }
  const data = normalizedPersonalStatistics(value),
    expected = { oldest: effectiveRange.start, newest: effectiveRange.end }
  if (!samePersonalBestWindow(data.bestEffortsWindow, expected))
    throw Error(
      "Power history returned a different date range. Previous results are retained."
    )
  const points = dashboardPowerAnchors.flatMap((seconds) => {
    const point = bestCurveEffort(data.bestEfforts, "Bike", seconds)
    return point ? [point] : []
  })
  return {
    range: { ...range },
    effectiveRange,
    points,
    samples: points.map((point) => ({
      seconds: point.duration_seconds!,
      watts: point.value,
    })),
    full: false,
    warning: data.bestEffortsError || null,
  }
}
type Request = (path: string, options?: RequestInit) => Promise<Response>
export function createDashboardPowerClient(request: Request = apiFetch) {
  const tagsClient =
    request === apiFetch
      ? dashboardTagClient
      : createDashboardTagClient(request)
  const cache = createSharedRequestCache<DashboardPowerCurve>(
    async (key, signal) => {
      const [, range, today, , sport] = JSON.parse(key) as [
        string,
        DashboardChartRange,
        string,
        number,
        string | null,
      ]
      const effective = recordedPowerRange(range, today)
      if (!effective)
        return {
          range,
          effectiveRange: null,
          points: [],
          samples: [],
          full: true,
          warning: null,
        }
      const response = await request(
          sport === null
            ? `/api/personal-statistics?${new URLSearchParams({ oldest: effective.start, newest: effective.end })}`
            : `/api/performance-curves?${new URLSearchParams({ kind: "power", sport, start: effective.start, end: effective.end })}`,
          { signal, headers: { Accept: "application/json" } }
        ),
        body = await response.json()
      if (!response.ok)
        throw Error(
          typeof body?.error === "string"
            ? body.error
            : "Recorded power history could not load. Retry to keep reviewing this chart."
        )
      signal.throwIfAborted()
      return sport === null
        ? parseDashboardPowerCurve(body, range, today)
        : parseDashboardNativePowerCurve(body, sport, range, today)
    },
    { maxEntries: 32, ttlMs: 5 * 60_000, timeoutMs: 65_000 }
  )
  return {
    load: (
      scope: string,
      range: DashboardChartRange,
      today: string,
      {
        signal,
        revision = 0,
        tags = [],
        sport,
      }: {
        signal?: AbortSignal
        revision?: number
        tags?: readonly string[]
        sport?: string
      } = {}
    ) => {
      const effective = recordedPowerRange(range, today)
      if (tags.length && effective)
        return tagsClient
          .load(scope, "power", sport ?? "all", effective, today, tags, {
            signal,
            revision,
          })
          .then((curve) => ({
            range: { ...range },
            effectiveRange: effective,
            full: true,
            warning: curve.warning,
            samples: curve.points.map((point) => ({
              seconds: point.duration_seconds,
              watts: point.value,
            })),
            points: curve.points.flatMap((point) =>
              point.value === null
                ? []
                : [
                    {
                      ...point,
                      sport: point.native_type,
                      kind: "power" as const,
                      unit: "watts" as const,
                      distance_meters: null,
                      value: point.value,
                    },
                  ]
            ),
          }))
      const selection =
        sport === undefined
          ? null
          : nativePowerCurveSelection(
              {
                kind: "power",
                sport,
                start: effective?.start || today,
                end: effective?.end || today,
              },
              today
            ).sport
      return cache
        .get(JSON.stringify([scope, range, today, revision, selection]), signal)
        .then((curve) => structuredClone(curve))
    },
    clear: () => {
      cache.clear()
      tagsClient.clear()
    },
  }
}
export const dashboardPowerClient = createDashboardPowerClient()
if (typeof window !== "undefined")
  for (const event of [
    "app-auth-required",
    "training-cache-reset",
    "training-mutation-settled",
  ])
    window.addEventListener(event, () => dashboardPowerClient.clear())
