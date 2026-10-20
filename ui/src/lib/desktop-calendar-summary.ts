import type { PlannedWorkout, WorkoutSummaryValues } from "./training-context"

type RecordedField =
  "duration_seconds" | "distance_meters" | "elevation_gain" | "work_kj"
export type RecordedCalendarTotal = {
  value: number | null
  known: number
  expected: number
}

function recordedValue(workout: PlannedWorkout, field: RecordedField) {
  if (workout.status !== "completed") return null
  const valid = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
  // Authoritative summaries preserve absent measurements. Never replace a
  // missing actual with a planned prescription or a rounded legacy field.
  if (workout.workout_summary != null) {
    const value =
      workout.workout_summary.completed?.[field as keyof WorkoutSummaryValues]
    return valid(value) ? value : null
  }
  const legacy =
    field === "duration_seconds"
      ? (workout.actualDurationMinutes ??
        workout.completed_data?.duration_minutes)
      : field === "distance_meters"
        ? workout.distance_meters
        : null
  return valid(legacy) ? legacy * (field === "duration_seconds" ? 60 : 1) : null
}

export function desktopCalendarRecordedTotal(
  workouts: PlannedWorkout[],
  field: RecordedField
): RecordedCalendarTotal {
  const completed = workouts.filter((workout) => workout.status === "completed")
  const values = completed
    .map((workout) => recordedValue(workout, field))
    .filter((value): value is number => value !== null)
  return {
    value:
      values.length || !completed.length
        ? values.reduce((sum, value) => sum + value, 0)
        : null,
    known: values.length,
    expected: completed.length,
  }
}

export function sameDesktopCalendarSport(first: string, second: string) {
  // Match the provider pairing discipline rules without combining every
  // unsupported sport into the calendar's generic "Other" display group.
  const discipline = (value: string) =>
    /Ride|Bike/i.test(value)
      ? "bike"
      : /Run/i.test(value)
        ? "run"
        : /Swim/i.test(value)
          ? "swim"
          : /Weight|Strength/i.test(value)
            ? "strength"
            : value.toLowerCase()
  return discipline(first) === discipline(second)
}
