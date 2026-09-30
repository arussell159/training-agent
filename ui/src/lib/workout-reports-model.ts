import type { PlannedWorkout, WorkoutSummaryValues } from "./training-context"

export type ReportWorkout = PlannedWorkout & {
  completed?: boolean
  workout_date: string
}
export type DistanceUnit = "mi" | "km" | "yd" | "m"
export type ReportFilters = {
  sport: string
  range: "all" | "7" | "30" | "90" | "year" | "custom"
  start: string
  end: string
  minDistance: string
  maxDistance: string
  distanceUnit: DistanceUnit
  minDuration: string
  maxDuration: string
}
export const emptyFilters: ReportFilters = {
  sport: "all",
  range: "all",
  start: "",
  end: "",
  minDistance: "",
  maxDistance: "",
  distanceUnit: "mi",
  minDuration: "",
  maxDuration: "",
}
export const metersPerUnit: Record<DistanceUnit, number> = {
  mi: 1609.344,
  km: 1000,
  yd: 0.9144,
  m: 1,
}
export function changeDistanceUnit(
  filters: ReportFilters,
  unit: DistanceUnit
): ReportFilters {
  if (unit === filters.distanceUnit) return filters
  const convert = (text: string) =>
    text === "" || !Number.isFinite(Number(text))
      ? text
      : String(
          Number(
            (
              (Number(text) * metersPerUnit[filters.distanceUnit]) /
              metersPerUnit[unit]
            ).toPrecision(12)
          )
        )
  return {
    ...filters,
    distanceUnit: unit,
    minDistance: convert(filters.minDistance),
    maxDistance: convert(filters.maxDistance),
  }
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)
const positive = (value: unknown) => finite(value) && value > 0
export const validValue = (
  value: unknown
): value is number | string | boolean =>
  finite(value) ||
  typeof value === "boolean" ||
  (typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim() !== "--")
export const summary = (workout: ReportWorkout): WorkoutSummaryValues =>
  workout.workout_summary?.completed || {}
export const metric = (workout: ReportWorkout, id: string): number | null => {
  const s = summary(workout)
  const value = (s as Record<string, unknown>)[id]
  if (id === "pace")
    return positive(s.average_speed) ? 1 / Number(s.average_speed) : null
  if (id === "elapsed_pace")
    return positive(s.elapsed_speed) ? 1 / Number(s.elapsed_speed) : null
  if (id === "duration_seconds")
    return finite(s.duration_seconds)
      ? s.duration_seconds
      : finite(workout.actualDurationMinutes)
        ? workout.actualDurationMinutes * 60
        : null
  if (id === "distance_meters")
    return finite(s.distance_meters) ? s.distance_meters : null
  if (id === "tss")
    return finite(s.tss)
      ? s.tss
      : finite(workout.completed_data?.tss)
        ? workout.completed_data.tss
        : null
  return finite(value) ? value : null
}
const clock = (seconds: number) => {
  const whole = Math.round(seconds)
  const h = Math.floor(whole / 3600),
    m = Math.floor((whole % 3600) / 60),
    s = whole % 60
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`
}
const number = (value: number, digits = 0) =>
  value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
export type ReportColumn = {
  id: string
  label: string
  unit: string
  value: (w: ReportWorkout) => number | null
  format: (value: number, w: ReportWorkout) => string
}
const numeric = (
  id: keyof WorkoutSummaryValues,
  label: string,
  unit: string,
  digits = 0
): ReportColumn => ({
  id,
  label,
  unit,
  value: (w) => metric(w, id),
  format: (v) => number(v, digits),
})
export const reportColumns: ReportColumn[] = [
  {
    id: "distance_meters",
    label: "Distance",
    unit: "mi / yd",
    value: (w) => metric(w, "distance_meters"),
    format: (v, w) =>
      /swim/i.test(w.sport)
        ? `${number(v / 0.9144, 0)} yd`
        : `${number(v / 1609.344, 2)} mi`,
  },
  {
    id: "duration_seconds",
    label: "Moving time",
    unit: "h:m:s",
    value: (w) => metric(w, "duration_seconds"),
    format: (v) => clock(v),
  },
  {
    id: "elapsed_time_seconds",
    label: "Elapsed time",
    unit: "h:m:s",
    value: (w) => metric(w, "elapsed_time_seconds"),
    format: (v) => clock(v),
  },
  {
    id: "pace",
    label: "Moving pace",
    unit: "min / mi or 100 yd",
    value: (w) => metric(w, "pace"),
    format: (v, w) => clock(v * (/swim/i.test(w.sport) ? 91.44 : 1609.344)),
  },
  {
    id: "elapsed_pace",
    label: "Elapsed pace",
    unit: "min / mi or 100 yd",
    value: (w) => metric(w, "elapsed_pace"),
    format: (v, w) => clock(v * (/swim/i.test(w.sport) ? 91.44 : 1609.344)),
  },
  numeric("average_speed", "Average speed", "m/s", 2),
  numeric("min_speed", "Min speed", "m/s", 2),
  numeric("max_speed", "Max speed", "m/s", 2),
  numeric("average_hr", "Average HR", "bpm"),
  numeric("min_hr", "Min HR", "bpm"),
  numeric("max_hr", "Max HR", "bpm"),
  numeric("average_power", "Average power", "W"),
  numeric("normalized_power", "Normalized power", "W"),
  numeric("min_power", "Min power", "W"),
  numeric("max_power", "Max power", "W"),
  numeric("average_cadence", "Average cadence", "rpm / spm"),
  numeric("min_cadence", "Min cadence", "rpm / spm"),
  numeric("max_cadence", "Max cadence", "rpm / spm"),
  numeric("elevation_gain", "Elevation gain", "m", 1),
  numeric("elevation_loss", "Elevation loss", "m", 1),
  numeric("tss", "Training load", "TSS"),
  numeric("intensity_factor", "Intensity factor", "IF", 2),
  numeric("calories", "Calories", "kcal"),
  numeric("work_kj", "Work", "kJ", 1),
  numeric("temperature_c", "Temperature", "°C", 1),
  numeric("humidity_percent", "Humidity", "%", 1),
]
export const columnById = new Map(
  reportColumns.map((column) => [column.id, column])
)
export const knownColumnIds = (ids: unknown): string[] =>
  Array.isArray(ids)
    ? [
        ...new Set(
          ids.filter(
            (id): id is string => typeof id === "string" && columnById.has(id)
          )
        ),
      ]
    : []
export const localDay = (now: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
const shiftDay = (day: string, delta: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}
export function dateBounds(
  filters: ReportFilters,
  now: Date,
  timeZone: string
) {
  const today = localDay(now, timeZone)
  if (filters.range === "all") return { start: "", end: "" }
  if (filters.range === "custom")
    return { start: filters.start, end: filters.end }
  if (filters.range === "year")
    return { start: `${today.slice(0, 4)}-01-01`, end: today }
  return { start: shiftDay(today, 1 - Number(filters.range)), end: today }
}
export function parseDuration(input: string): number | null {
  if (!input.trim()) return null
  if (!/^\d+(?::[0-5]?\d){0,2}$/.test(input.trim())) return NaN
  const parts = input.trim().split(":").map(Number)
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts.length === 2
      ? parts[0] * 60 + parts[1]
      : parts[0] * 60
}
const validDay = (day: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) &&
  new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day
export function filterErrors(
  filters: ReportFilters,
  now: Date,
  timeZone: string
): Record<string, string> {
  const errors: Record<string, string> = {},
    { start, end } = dateBounds(filters, now, timeZone)
  if (start && !validDay(start)) errors.start = "Enter a valid start date."
  if (end && !validDay(end)) errors.end = "Enter a valid end date."
  if (start && end && start > end)
    errors.end = "End date must be on or after start date."
  for (const key of ["minDistance", "maxDistance"] as const)
    if (
      filters[key] &&
      (!Number.isFinite(Number(filters[key])) || Number(filters[key]) < 0)
    )
      errors[key] = "Enter a nonnegative distance."
  if (
    !errors.minDistance &&
    !errors.maxDistance &&
    filters.minDistance &&
    filters.maxDistance &&
    Number(filters.minDistance) > Number(filters.maxDistance)
  )
    errors.maxDistance = "Maximum must be at least minimum."
  for (const key of ["minDuration", "maxDuration"] as const)
    if (filters[key] && !Number.isFinite(parseDuration(filters[key])))
      errors[key] = "Use minutes, m:ss, or h:mm:ss."
  if (
    !errors.minDuration &&
    !errors.maxDuration &&
    filters.minDuration &&
    filters.maxDuration &&
    (parseDuration(filters.minDuration) ?? 0) >
      (parseDuration(filters.maxDuration) ?? 0)
  )
    errors.maxDuration = "Maximum must be at least minimum."
  return errors
}
export function completedActivities(
  workouts: readonly ReportWorkout[]
): ReportWorkout[] {
  const byRecording = new Map<string, ReportWorkout>()
  for (const w of workouts) {
    if (!(w.status === "completed" || w.completed)) continue
    const key = String(
      w.activity_id || (w.id.startsWith("activity:") ? w.id.slice(9) : w.id)
    )
    const previous = byRecording.get(key)
    if (
      !previous ||
      (w.id.startsWith("activity:") && !previous.id.startsWith("activity:"))
    )
      byRecording.set(key, w)
  }
  return [...byRecording.values()]
}
export function filterActivities(
  workouts: readonly ReportWorkout[],
  filters: ReportFilters,
  now: Date,
  timeZone: string
) {
  if (Object.keys(filterErrors(filters, now, timeZone)).length) return []
  const { start, end } = dateBounds(filters, now, timeZone)
  const minDistance =
    filters.minDistance === ""
      ? null
      : Number(filters.minDistance) * metersPerUnit[filters.distanceUnit]
  const maxDistance =
    filters.maxDistance === ""
      ? null
      : Number(filters.maxDistance) * metersPerUnit[filters.distanceUnit]
  const minDuration = parseDuration(filters.minDuration),
    maxDuration = parseDuration(filters.maxDuration)
  return workouts.filter((w) => {
    if (filters.sport !== "all" && w.sport !== filters.sport) return false
    if ((start && w.workout_date < start) || (end && w.workout_date > end))
      return false
    const distance = metric(w, "distance_meters"),
      duration = metric(w, "duration_seconds")
    if (
      (minDistance != null || maxDistance != null) &&
      (distance == null ||
        (minDistance != null && distance < minDistance) ||
        (maxDistance != null && distance > maxDistance))
    )
      return false
    if (
      (minDuration != null || maxDuration != null) &&
      (duration == null ||
        (minDuration != null && duration < minDuration) ||
        (maxDuration != null && duration > maxDuration))
    )
      return false
    return true
  })
}
export function availability(workouts: readonly ReportWorkout[]) {
  return Object.fromEntries(
    reportColumns.map((c) => [
      c.id,
      workouts.reduce((count, w) => count + Number(validValue(c.value(w))), 0),
    ])
  ) as Record<string, number>
}
export const automaticColumns = (
  workouts: readonly ReportWorkout[],
  counts = availability(workouts)
) =>
  workouts.length
    ? reportColumns
        .filter((c) => counts[c.id] / workouts.length >= 0.9)
        .map((c) => c.id)
    : []
export function resolveColumns(
  manual: Record<string, string[]>,
  saved: Record<string, string[]>,
  sport: string,
  workouts: readonly ReportWorkout[],
  counts = availability(workouts)
) {
  if (Object.hasOwn(manual, sport))
    return { ids: knownColumnIds(manual[sport]), mode: "This view" }
  if (Object.hasOwn(saved, sport))
    return { ids: knownColumnIds(saved[sport]), mode: "Saved default" }
  return {
    ids: automaticColumns(workouts, counts),
    mode: "Automatic · 90% rule",
  }
}
export function sortActivities(
  workouts: readonly ReportWorkout[],
  id: string,
  direction: "asc" | "desc"
) {
  const sign = direction === "asc" ? 1 : -1
  return [...workouts].sort((a, b) => {
    const av =
      id === "date"
        ? `${a.workout_date}T${a.recorded_start_local?.slice(11) || "00:00:00"}`
        : (columnById.get(id)?.value(a) ?? null)
    const bv =
      id === "date"
        ? `${b.workout_date}T${b.recorded_start_local?.slice(11) || "00:00:00"}`
        : (columnById.get(id)?.value(b) ?? null)
    if (av == null && bv != null) return 1
    if (bv == null && av != null) return -1
    const compare =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av ?? "").localeCompare(String(bv ?? ""))
    return compare * sign || a.id.localeCompare(b.id)
  })
}
export function totals(workouts: readonly ReportWorkout[]) {
  let duration = 0,
    distance = 0,
    durationCount = 0,
    distanceCount = 0
  for (const w of workouts) {
    const d = metric(w, "duration_seconds"),
      m = metric(w, "distance_meters")
    if (d != null) {
      duration += d
      durationCount++
    }
    if (m != null) {
      distance += m
      distanceCount++
    }
  }
  return { duration, distance, durationCount, distanceCount }
}
