import type { PlannedWorkout, TrainingContext } from "./training-context"

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const optionalStrings = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => value[key] == null || typeof value[key] === "string")
const optionalNumbers = (
  value: Record<string, unknown>,
  keys: readonly string[]
) =>
  keys.every(
    (key) =>
      value[key] == null ||
      (typeof value[key] === "number" && Number.isFinite(value[key]))
  )
const calendarDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const timestamp = Date.parse(`${value}T12:00:00Z`)
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  )
}
const summaryNumbers = [
  "elapsed_time_seconds",
  "elapsed_speed",
  "min_hr",
  "min_speed",
  "min_power",
  "max_power",
  "average_cadence",
  "min_cadence",
  "max_cadence",
  "duration_seconds",
  "duration_minutes",
  "distance_meters",
  "average_speed",
  "max_speed",
  "calories",
  "elevation_gain",
  "elevation_loss",
  "tss",
  "normalized_power",
  "intensity_factor",
  "work_kj",
  "average_power",
  "average_hr",
  "max_hr",
  "temperature_c",
  "humidity_percent",
  "latitude",
  "longitude",
] as const
const optionalMeasurement = (value: unknown, fields: readonly string[]) =>
  value == null || (record(value) && optionalNumbers(value, fields))
const validSummary = (value: unknown) =>
  value == null ||
  (record(value) &&
    optionalMeasurement(value.planned, summaryNumbers) &&
    optionalMeasurement(value.completed, summaryNumbers))
const validAthlete = (value: unknown) =>
  record(value) &&
  optionalStrings(value, ["name", "race", "race_date", "phase"]) &&
  optionalNumbers(value, ["days_to_race"]) &&
  (value.zones == null ||
    (record(value.zones) &&
      optionalStrings(value.zones, ["run_threshold_pace", "swim_css"]) &&
      optionalNumbers(value.zones, ["bike_ftp", "threshold_hr"]))) &&
  (value.zone_history == null ||
    (Array.isArray(value.zone_history) &&
      value.zone_history.every(
        (row) =>
          record(row) &&
          optionalStrings(row, [
            "recorded_at",
            "run_threshold_pace",
            "swim_css",
          ]) &&
          optionalNumbers(row, ["bike_ftp", "threshold_hr"])
      )))

const validWorkout = (value: unknown, planned = false) => {
  if (!record(value) || !calendarDay(value.workout_date)) return false
  if (planned || value.id !== undefined) {
    if (typeof value.id !== "string" || !value.id) return false
    for (const key of ["sport", "title", "duration"])
      if (typeof value[key] !== "string") return false
  }
  for (const key of [
    "goal",
    "day",
    "date",
    "details",
    "activity_id",
    "recorded_start_local",
    "scheduled_start_at",
    "device_name",
    "structure",
  ])
    if (value[key] != null && typeof value[key] !== "string") return false
  return (
    optionalNumbers(value, [
      "elapsed_time_seconds",
      "duration_seconds",
      "duration_minutes",
      "distance_meters",
      "elevation_gain",
      "load",
      "plannedDurationMinutes",
      "actualDurationMinutes",
    ]) &&
    optionalMeasurement(value.planned, [
      ...summaryNumbers,
      "power_watts",
      "pace_seconds_per_unit",
    ]) &&
    optionalMeasurement(value.completed_data, [
      ...summaryNumbers,
      "power_watts",
      "pace_seconds_per_unit",
    ]) &&
    (typeof value.completed === "boolean" ||
      optionalMeasurement(value.completed, summaryNumbers)) &&
    optionalMeasurement(value.recovery, ["hrv", "resting_hr"]) &&
    validSummary(value.workout_summary)
  )
}

export function validatedTrainingWorkout(value: unknown): PlannedWorkout {
  if (!validWorkout(value, true))
    throw new Error("The saved workout is incomplete. Please retry.")
  return value as PlannedWorkout
}

/** Reject broken responses before replacing the last usable display snapshot. */
export function validatedTrainingContext(value: unknown): TrainingContext {
  if (
    !record(value) ||
    !record(value.athlete) ||
    !validAthlete(value.athlete) ||
    !record(value.metrics) ||
    !optionalNumbers(value.metrics, [
      "fitness",
      "fatigue",
      "form",
      "recovery",
    ]) ||
    !optionalMeasurement(value.wellness, ["hrv", "resting_hr", "sleep"]) ||
    (value.cache_scope != null && typeof value.cache_scope !== "string") ||
    (value.display_range != null &&
      (!record(value.display_range) ||
        !calendarDay(value.display_range.start) ||
        !calendarDay(value.display_range.end) ||
        value.display_range.start > value.display_range.end)) ||
    !Array.isArray(value.history) ||
    !value.history.every((row) => validWorkout(row)) ||
    !Array.isArray(value.planned) ||
    !value.planned.every((row) => validWorkout(row, true)) ||
    (value.wellness_history !== undefined &&
      (!Array.isArray(value.wellness_history) ||
        !value.wellness_history.every(record))) ||
    (value.library !== undefined &&
      (!Array.isArray(value.library) ||
        !value.library.every(
          (row) =>
            record(row) &&
            ["id", "sport", "title", "duration", "purpose"].every(
              (key) => typeof row[key] === "string"
            ) &&
            (row.tags == null ||
              (Array.isArray(row.tags) &&
                row.tags.every((tag) => typeof tag === "string")))
        )))
  )
    throw new Error("Training data is incomplete. Please retry.")

  // A bad provider time zone otherwise throws from every date formatter.
  let timeZone = value.athlete.time_zone
  try {
    if (timeZone !== undefined && typeof timeZone !== "string")
      throw new Error()
    if (timeZone) new Intl.DateTimeFormat("en-US", { timeZone })
  } catch {
    timeZone = "America/Chicago"
  }
  return {
    ...value,
    athlete: { ...value.athlete, time_zone: timeZone },
  } as TrainingContext
}
