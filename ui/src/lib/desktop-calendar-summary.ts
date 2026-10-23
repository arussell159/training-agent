import type { PlannedWorkout, WorkoutSummaryValues } from "./training-context"
import { aggregateFitnessSummary, type AggregateMeasurement } from "./aggregate-analysis.ts"

/** Calendar and Fitness Summary deliberately share the same canonical seconds,
 * source dates and recording identities. Call with the entire visible history:
 * a plan and its recording may belong to different weeks. */
export function calendarDurationSummary(
  workouts: readonly PlannedWorkout[],
  range: { start: string; end: string },
) {
  const planned = aggregateFitnessSummary(workouts, { ...range, reportType: "Planned Duration" })
  const completed = aggregateFitnessSummary(workouts, { ...range, reportType: "Completed Duration" })
  const empty = (): AggregateMeasurement => ({ value: 0, observed: 0, missing: 0 })
  const sports = new Set([...planned.rows, ...completed.rows].map(row => row.sport))
  const order = ["Swim", "Bike", "Mtn Bike", "Run", "Strength"]
  return {
    planned: planned.total,
    completed: completed.total,
    rows: [...sports].sort((a, b) => {
      const rank = (sport: string) => order.includes(sport) ? order.indexOf(sport) : order.length
      return rank(a) - rank(b) || a.localeCompare(b)
    }).map(sport => ({
      sport,
      planned: planned.rows.find(row => row.sport === sport) || empty(),
      completed: completed.rows.find(row => row.sport === sport) || empty(),
    })),
  }
}

/** Round only after summing canonical seconds; + identifies a partial total. */
export function calendarDurationLabel(total: AggregateMeasurement): string {
  if (total.value === null) return "—"
  const minutes = Math.round(total.value / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}${total.missing ? "+" : ""}`
}

export function calendarDurationDescription(label: string, total: AggregateMeasurement): string {
  if (total.value === null) return `${label}: duration unavailable for ${total.missing} workout${total.missing === 1 ? "" : "s"}.`
  return `${label}: ${calendarDurationLabel(total).replace("+", "")} hours:minutes${total.missing ? `; partial total, duration unavailable for ${total.missing} workout${total.missing === 1 ? "" : "s"}` : ""}.`
}

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
