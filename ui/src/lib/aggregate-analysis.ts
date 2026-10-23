import type { HeartRateZoneSummary, PlannedWorkout } from "./training-context"
import {
  validRecordedZoneTimes,
  type RecordedZoneTimes,
} from "../../../app-backend/lib/recorded-zone-times.mjs"
import {
  calendarMetricFields,
  isCalendarMetricsEntries,
  type CalendarMetricEntry,
  type CalendarMetricKey,
} from "../../../app-backend/lib/calendar-metrics-model.mjs"

export const aggregateMetrics = [
  "duration_seconds",
  "distance_meters",
  "tss",
  "work_kj",
  "power_load",
  "hr_load",
  "pace_load",
  "calories",
  "elevation_gain",
  "elevation_loss",
] as const
export type AggregateMetric = (typeof aggregateMetrics)[number]
export type AggregateMeasurement = {
  value: number | null
  observed: number
  missing: number
}
export type FitnessSummaryReportType =
  | "Planned Distance"
  | "Planned Duration"
  | "Completed Distance"
  | "Completed Duration"
export type AggregateFitnessSummary = {
  reportType: FitnessSummaryReportType
  source: "planned" | "completed"
  metric: "distance_meters" | "duration_seconds"
  rows: (AggregateMeasurement & { sport: string })[]
  total: AggregateMeasurement
}

/** Observed Fitness Summary report choices, with exact planned/recorded sources.
 * Paired events use their own planned date/sport; recordings use actual date/sport.
 * Modern nulls are authoritative and never revive stale legacy targets.
 */
export function aggregateFitnessSummary(
  workouts: readonly PlannedWorkout[],
  {
    start,
    end,
    reportType,
  }: { start: string; end: string; reportType: FitnessSummaryReportType }
): AggregateFitnessSummary {
  if (
    !day(start) ||
    !day(end) ||
    start > end ||
    Date.parse(end) - Date.parse(start) > 36600 * 86400000
  )
    throw Error("Choose valid aggregate dates covering at most 100 years.")
  if (
    ![
      "Planned Distance",
      "Planned Duration",
      "Completed Distance",
      "Completed Duration",
    ].includes(reportType)
  )
    throw Error("Choose a supported Fitness Summary report type.")
  const source = reportType.startsWith("Planned") ? "planned" : "completed",
    metric = reportType.endsWith("Distance")
      ? "distance_meters"
      : "duration_seconds"
  const measurement = (row: PlannedWorkout): number | null => {
    if (row.workout_summary != null) {
      const value = row.workout_summary[source]?.[metric]
      return finite(value) ? value : null
    }
    if (source === "completed") return aggregateMetricValue(row, metric)
    const planned = row.planned as PlannedWorkout["planned"] & {
      distance_meters?: number
    }
    const value =
      metric === "distance_meters"
        ? planned?.distance_meters
        : (planned?.duration_minutes ?? row.plannedDurationMinutes)
    return finite(value)
      ? value * (metric === "duration_seconds" ? 60 : 1)
      : null
  }
  const sport = (row: PlannedWorkout) => {
    const native =
      source === "completed"
        ? row.activity_type || row.provider_type || row.sport
        : row.provider_type || row.editor_model?.sport || row.sport
    const variant = row.display_variant || row.editor_model?.variant
    if (
      source === "planned" &&
      native === "Other" &&
      variant &&
      ["brick", "day-off", "custom"].includes(variant)
    )
      return (
        { brick: "Brick", "day-off": "Day off", custom: "Custom" } as Record<
          string,
          string
        >
      )[variant]
    return (
      (
        {
          Ride: "Bike",
          VirtualRide: "Bike",
          MountainBikeRide: "Mtn Bike",
          Run: "Run",
          VirtualRun: "Run",
          TrailRun: "Run",
          Swim: "Swim",
          WeightTraining: "Strength",
          Workout: "Crosstrain",
          NordicSki: "XC-Ski",
          Rowing: "Rowing",
          Walk: "Walk",
          Other: "Other",
        } as Record<string, string>
      )[native] || native
    )
  }
  const unique = new Map<string, PlannedWorkout>()
  const quality = (row: PlannedWorkout) =>
    (row.workout_summary != null ? 4 : 0) +
    (measurement(row) !== null ? 2 : 0) +
    (source === "completed" && row.id.startsWith("event:") && row.activity_id
      ? 1
      : 0)
  for (const row of workouts) {
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id ||
      row.id.startsWith("pending:") ||
      row.calendar_annotation_key ||
      row.calendar_annotation
    )
      continue
    const recording = Boolean(
      row.activity_id ||
      row.id.startsWith("activity:") ||
      row.workout_summary?.completed != null ||
      (row.actualDurationMinutes != null && row.actualDurationMinutes > 0) ||
      (row.distance_meters != null && row.distance_meters > 0)
    )
    if (
      source === "completed"
        ? row.status !== "completed" || !recording
        : row.id.startsWith("activity:") ||
          (row.workout_summary != null &&
            row.workout_summary.planned === null &&
            !row.id.startsWith("event:")) ||
          (row.category != null && row.category !== "WORKOUT") ||
          (row.workout_summary == null &&
            !row.id.startsWith("event:") &&
            row.status === "completed" &&
            !row.planned &&
            row.plannedDurationMinutes == null)
    )
      continue
    const identity = source === "completed" ? activityKey(row) : row.id
    const prior = unique.get(identity)
    const updated = Date.parse(row.source_updated_at || ""),
      priorUpdated = Date.parse(prior?.source_updated_at || "")
    if (
      !prior ||
      (Number.isFinite(updated) &&
      Number.isFinite(priorUpdated) &&
      updated !== priorUpdated
        ? updated > priorUpdated
        : quality(row) > quality(prior))
    )
      unique.set(identity, row)
  }
  const grouped = new Map<string, AggregateMeasurement>()
  for (const row of unique.values()) {
    const date =
      source === "planned"
        ? row.planned_workout_date || row.workout_date
        : row.workout_date
    if (!day(date) || date < start || date > end) continue
    const name = sport(row),
      value = measurement(row),
      bucket = grouped.get(name) || { value: 0, observed: 0, missing: 0 }
    if (value === null) bucket.missing++
    else {
      bucket.value = (bucket.value || 0) + value
      bucket.observed++
    }
    grouped.set(name, bucket)
  }
  const rows = [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sport, bucket]) => ({
      ...bucket,
      sport,
      value: bucket.observed ? bucket.value : null,
    }))
  const total = rows.reduce<AggregateMeasurement>(
    (sum, row) => ({
      value: (sum.value || 0) + (row.value || 0),
      observed: sum.observed + row.observed,
      missing: sum.missing + row.missing,
    }),
    { value: 0, observed: 0, missing: 0 }
  )
  if (rows.length && !total.observed) total.value = null
  return { reportType, source, metric, rows, total }
}
export type AggregatePeriod = {
  key: string
  start: string
  end: string
  activities: number
  metrics: Record<AggregateMetric, AggregateMeasurement>
  maxima: Record<AggregateMaximumMetric, AggregateMaximum>
  missingZoneActivities: { heartRate: number; power: number; pace: number }
}
export type AggregateZonePeriod = {
  key: string
  start: string
  end: string
  activities: number
  seconds: number[]
}
export const aggregateMaximumMetrics = [
  "duration_seconds",
  "distance_meters",
  "max_cadence",
  "max_hr",
  "max_power",
  "max_speed",
] as const
export type AggregateMaximumMetric = (typeof aggregateMaximumMetrics)[number]
export type AggregateMaximum = AggregateMeasurement & { activityIds: string[] }
export type AggregateRecordedZones = RecordedZoneTimes & {
  key: string
  sport: string
  activities: number
  periods: AggregateZonePeriod[]
}
export type AggregateHeartRateZones = HeartRateZoneSummary & {
  key: string
  sport: string
  activities: number
  periods: AggregateZonePeriod[]
}
export type AggregateAnalysis = {
  periods: AggregatePeriod[]
  records: PlannedWorkout[]
  activities: number
  heartRateZones: AggregateHeartRateZones[]
  missingHeartRateZones: number
  powerZones: AggregateRecordedZones[]
  paceZones: AggregateRecordedZones[]
  missingPowerZones: number
  missingPaceZones: number
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
const day = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const date = new Date(`${value}T12:00:00Z`)
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}
const shift = (value: string, days: number) =>
  new Date(Date.parse(`${value}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10)
const monday = (value: string) => {
  const weekday = new Date(`${value}T12:00:00Z`).getUTCDay()
  return shift(value, -((weekday + 6) % 7))
}
const canonicalSport = (workout: PlannedWorkout) =>
  workout.activity_type || workout.provider_type || workout.sport
const family = (sport: string) => {
  if (/run/i.test(sport)) return "run"
  if (/ride|bike|cycl/i.test(sport)) return "bike"
  if (/swim/i.test(sport)) return "swim"
  if (/walk/i.test(sport)) return "walk"
  if (/strength|weight/i.test(sport)) return "strength"
  if (/row/i.test(sport)) return "rowing"
  if (/nordic|xc-ski/i.test(sport)) return "nordicski"
  if (/^workout$|crosstrain/i.test(sport)) return "crosstrain"
  return sport.toLowerCase()
}
const matchesSport = (workout: PlannedWorkout, requested: string) => {
  const filter = requested.toLowerCase()
  if (filter === "all") return true
  const source = canonicalSport(workout)
  if (
    [
      "bike",
      "ride",
      "cycling",
      "run",
      "swim",
      "walk",
      "strength",
      "crosstrain",
    ].includes(filter)
  )
    return family(source) === family(filter)
  return (
    source.toLowerCase() === filter || workout.sport.toLowerCase() === filter
  )
}
const activityKey = (workout: PlannedWorkout) =>
  workout.activity_id ||
  (workout.id.startsWith("activity:") ? workout.id.slice(9) : workout.id)

/** Only recorded summaries contribute; calendar load/default zeroes are not measurements. */
export function aggregateMetricValue(
  workout: PlannedWorkout,
  metric: AggregateMetric
): number | null {
  const summary = workout.workout_summary?.completed
  if (workout.workout_summary != null) return finite(summary?.[metric]) ? summary[metric] : null
  // Older compact records may have no completed summary. Positive actual time
  // remains usable, but a fallback calendar zero cannot establish a measured zero.
  if (
    metric === "duration_seconds" &&
    finite(workout.actualDurationMinutes) &&
    workout.actualDurationMinutes > 0
  )
    return workout.actualDurationMinutes * 60
  if (metric === "distance_meters" && finite(workout.distance_meters))
    return workout.distance_meters
  return null
}

function validZones(
  value: HeartRateZoneSummary | null | undefined
): value is HeartRateZoneSummary {
  return (
    !!value &&
    Array.isArray(value.seconds) &&
    Array.isArray(value.boundaries_bpm) &&
    value.seconds.length > 0 &&
    value.seconds.length <= 100 &&
    value.seconds.length === value.boundaries_bpm.length &&
    value.seconds.every(finite) &&
    value.boundaries_bpm.every(
      (n, index, all) =>
        finite(n) && n > 0 && (index === 0 || n > all[index - 1])
    ) &&
    (value.threshold_bpm == null ||
      (finite(value.threshold_bpm) && value.threshold_bpm > 0))
  )
}

/** Build real recorded totals, preserving incomplete coverage and historical zone schemes.
 * Date inputs are athlete-local calendar days. Weekly keys are Mondays while
 * start/end clip to the requested range; no planned values or invented IF enter totals.
 */
export function aggregateActivityHistory(
  workouts: readonly PlannedWorkout[],
  {
    start,
    end,
    period = "week",
    sport = "all",
  }: {
    start: string
    end: string
    period?: "day" | "week"
    sport?: string
  }
): AggregateAnalysis {
  if (
    !day(start) ||
    !day(end) ||
    start > end ||
    Date.parse(end) - Date.parse(start) > 36600 * 86400000
  )
    throw Error("Choose valid aggregate dates covering at most 100 years.")
  if (period !== "day" && period !== "week")
    throw Error("Choose daily or weekly aggregation.")
  const unique = new Map<string, PlannedWorkout>()
  const completeness = (row: PlannedWorkout) =>
    aggregateMetrics.filter(
      (metric) => aggregateMetricValue(row, metric) !== null
    ).length +
    (validZones(row.workout_summary?.completed?.heart_rate_zones) ? 1 : 0) +
    aggregateMaximumMetrics.filter((metric) =>
      finite(row.workout_summary?.completed?.[metric])
    ).length +
    [
      row.workout_summary?.completed?.power_zone_times,
      row.workout_summary?.completed?.pace_zone_times,
    ].filter(validRecordedZoneTimes).length
  for (const workout of workouts) {
    if (
      !workout ||
      typeof workout.id !== "string" ||
      typeof workout.sport !== "string" ||
      !day(workout.workout_date) ||
      workout.workout_date < start ||
      workout.workout_date > end ||
      !(
        workout.status === "completed" ||
        workout.workout_summary?.completed ||
        workout.id.startsWith("activity:")
      ) ||
      !matchesSport(workout, sport)
    )
      continue
    const key = activityKey(workout),
      previous = unique.get(key)
    if (!previous || completeness(workout) > completeness(previous))
      unique.set(key, workout)
  }
  const records = [...unique.values()].sort(
    (a, b) =>
      a.workout_date!.localeCompare(b.workout_date!) || a.id.localeCompare(b.id)
  )
  const byPeriod = new Map<string, AggregatePeriod>()
  const periodKey = period === "week" ? monday : (value: string) => value
  const width = period === "week" ? 7 : 1
  for (let key = periodKey(start); key <= end; key = shift(key, width)) {
    byPeriod.set(key, {
      key,
      start: key < start ? start : key,
      end: shift(key, width - 1) > end ? end : shift(key, width - 1),
      activities: 0,
      missingZoneActivities: { heartRate: 0, power: 0, pace: 0 },
      metrics: Object.fromEntries(
        aggregateMetrics.map((metric) => [
          metric,
          { value: 0, observed: 0, missing: 0 },
        ])
      ) as Record<AggregateMetric, AggregateMeasurement>,
      maxima: Object.fromEntries(
        aggregateMaximumMetrics.map(
          (metric): [AggregateMaximumMetric, AggregateMaximum] => [
            metric,
            { value: null, observed: 0, missing: 0, activityIds: [] },
          ]
        )
      ) as Record<AggregateMaximumMetric, AggregateMaximum>,
    })
  }
  const zoneGroups = new Map<string, AggregateHeartRateZones>()
  const powerGroups = new Map<string, AggregateRecordedZones>(),
    paceGroups = new Map<string, AggregateRecordedZones>()
  let missingHeartRateZones = 0
  let missingPowerZones = 0,
    missingPaceZones = 0
  const zonePeriods = new Map<string, AggregateZonePeriod>()
  const addZonePeriod = (
    kind: string,
    group: { key: string; periods: AggregateZonePeriod[] },
    bucket: AggregatePeriod,
    seconds: readonly number[]
  ) => {
    const key = JSON.stringify([kind, group.key, bucket.key])
    let entry = zonePeriods.get(key)
    if (!entry) {
      entry = {
        key: bucket.key,
        start: bucket.start,
        end: bucket.end,
        activities: 0,
        seconds: seconds.map(() => 0),
      }
      zonePeriods.set(key, entry)
      group.periods.push(entry)
    }
    entry.activities++
    seconds.forEach((value, index) => {
      entry.seconds[index] += value
    })
  }
  for (const workout of records) {
    const bucket = byPeriod.get(periodKey(workout.workout_date!))!
    bucket.activities++
    for (const metric of aggregateMaximumMetrics) {
      const maximum = bucket.maxima[metric],
        value = workout.workout_summary?.completed?.[metric]
      if (!finite(value)) {
        maximum.missing++
        continue
      }
      maximum.observed++
      const id = activityKey(workout)
      if (maximum.value === null || value > maximum.value) {
        maximum.value = value
        maximum.activityIds = [id]
      } else if (value === maximum.value) maximum.activityIds.push(id)
    }
    for (const [kind, groups] of [
      ["power_zone_times", powerGroups],
      ["pace_zone_times", paceGroups],
    ] as const) {
      const zones = workout.workout_summary?.completed?.[kind]
      if (
        !validRecordedZoneTimes(zones) ||
        (kind === "power_zone_times") !== (zones.basis === "power")
      ) {
        if (kind === "power_zone_times") {
          missingPowerZones++
          bucket.missingZoneActivities.power++
        } else {
          missingPaceZones++
          bucket.missingZoneActivities.pace++
        }
        continue
      }
      const sourceSport = canonicalSport(workout),
        key = JSON.stringify([
          sourceSport,
          zones.basis,
          zones.unit,
          zones.boundaries_percent,
          zones.threshold,
        ])
      let group = groups.get(key)
      if (!group) {
        group = {
          ...zones,
          boundaries_percent: [...zones.boundaries_percent],
          seconds: zones.seconds.map(() => 0),
          sport: sourceSport,
          key,
          activities: 0,
          periods: [],
        }
        groups.set(key, group)
      }
      group.activities++
      addZonePeriod(kind, group, bucket, zones.seconds)
      zones.seconds.forEach((seconds, index) => {
        group.seconds[index] += seconds
      })
    }
    for (const metric of aggregateMetrics) {
      const value = aggregateMetricValue(workout, metric),
        measurement = bucket.metrics[metric]
      if (value === null) measurement.missing++
      else {
        measurement.value! += value
        measurement.observed++
      }
    }
    const zones = workout.workout_summary?.completed?.heart_rate_zones
    if (!validZones(zones)) {
      missingHeartRateZones++
      bucket.missingZoneActivities.heartRate++
      continue
    }
    const sourceSport = canonicalSport(workout)
    const key = JSON.stringify([
      sourceSport,
      zones.boundaries_bpm,
      zones.threshold_bpm,
    ])
    let group = zoneGroups.get(key)
    if (!group) {
      group = {
        key,
        sport: sourceSport,
        boundaries_bpm: [...zones.boundaries_bpm],
        threshold_bpm: zones.threshold_bpm,
        seconds: zones.seconds.map(() => 0),
        activities: 0,
        periods: [],
      }
      zoneGroups.set(key, group)
    }
    group.activities++
    addZonePeriod("heart-rate", group, bucket, zones.seconds)
    zones.seconds.forEach((seconds, index) => {
      group.seconds[index] += seconds
    })
  }
  for (const bucket of byPeriod.values())
    for (const measurement of Object.values(bucket.metrics))
      if (measurement.missing && !measurement.observed) measurement.value = null
  return {
    periods: [...byPeriod.values()],
    records,
    activities: records.length,
    heartRateZones: [...zoneGroups.values()],
    missingHeartRateZones,
    powerZones: [...powerGroups.values()],
    paceZones: [...paceGroups.values()],
    missingPowerZones,
    missingPaceZones,
  }
}

/** Source maximum speed only, in seconds/metre. Zero speed has no finite pace.
 * Sustained best efforts still require the separately verified performance curves.
 */
export function aggregateFastestPace(maximum: AggregateMaximum): number | null {
  return maximum.value !== null && finite(maximum.value) && maximum.value > 0
    ? 1 / maximum.value
    : null
}

/** Daily metric snapshots are not additive; exact subjective labels never become scores.
 * Exact manual projections win (including cleared null), native imports retain source.
 */
export function aggregateDailyMetrics(
  rows: readonly Record<string, unknown>[],
  { start, end }: { start: string; end: string }
) {
  if (!day(start) || !day(end) || start > end)
    throw Error("Choose valid daily metric dates.")
  const byDate = new Map<
    string,
    {
      date: string
      entries: Record<CalendarMetricKey, CalendarMetricEntry>
      note: string | null
    }
  >()
  const manualDates = new Set<string>()
  const native: Partial<
    Record<CalendarMetricKey, { key: string; factor: number }>
  > = {
    weight: { key: "weight", factor: 1 / 0.45359237 },
    sleepHours: { key: "sleepSecs", factor: 1 / 3600 },
    bodyFat: { key: "bodyFat", factor: 1 },
    restingHR: { key: "restingHR", factor: 1 },
    hrv: { key: "hrv", factor: 1 },
  }
  for (const row of rows) {
    const date = row.date ?? row.id
    if (!day(date) || date < start || date > end) continue
    const entries = Object.fromEntries(
      calendarMetricFields.map((field) => [
        field.key,
        { value: null, time: null, source: "unavailable" },
      ])
    ) as Record<CalendarMetricKey, CalendarMetricEntry>
    if (isCalendarMetricsEntries(row.calendar_metrics))
      for (const field of calendarMetricFields)
        entries[field.key] = { ...row.calendar_metrics[field.key] }
    else
      for (const [metric, mapping] of Object.entries(native)) {
        const value = row[mapping.key]
        if (finite(value))
          entries[metric as CalendarMetricKey] = {
            value: value * mapping.factor,
            time: null,
            source: "intervals",
          }
      }
    const result = {
      date,
      entries,
      note:
        typeof row.calendar_metrics_note === "string"
          ? row.calendar_metrics_note
          : typeof row.comments === "string"
            ? row.comments
            : null,
    }
    const projected = isCalendarMetricsEntries(row.calendar_metrics)
    if (projected || !manualDates.has(date)) byDate.set(date, result)
    if (projected) manualDates.add(date)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
