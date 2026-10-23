import type { PlannedWorkout } from "./training-context"

type CalendarDisplayWorkout = Pick<PlannedWorkout,
  "id" | "status" | "activity_id" | "workout_date" | "category" |
  "calendar_annotation" | "calendar_annotation_key"
>

/** A linked plan is already the calendar card for its recording. Keep the
 * richer planned identity, but only replace a raw alias on the same day.
 * This is a display projection: source rows and planned aggregation stay intact.
 */
export function calendarDisplayWorkouts<T extends CalendarDisplayWorkout>(
  workouts: readonly T[]
): T[] {
  const represented = new Set<string>()
  const datedIdentity = (date: string | undefined, id: string | null | undefined) =>
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) && id
      ? `${date}\0${id}`
      : null
  for (const workout of workouts) {
    if (
      workout.status !== "completed" ||
      !/^(event:|app:)/.test(workout.id) ||
      workout.calendar_annotation || workout.calendar_annotation_key ||
      (workout.category && workout.category !== "WORKOUT" && !/^RACE_[ABC]$/.test(workout.category))
    ) continue
    const identity = datedIdentity(workout.workout_date, workout.activity_id)
    if (identity) represented.add(identity)
  }
  return workouts.filter(workout => {
    if (workout.status !== "completed" || !workout.id.startsWith("activity:")) return true
    // The raw record's identity comes from its own id, never title/metrics or
    // a potentially stale activity_id field copied from another projection.
    const identity = datedIdentity(workout.workout_date, workout.id.slice(9))
    return !identity || !represented.has(identity)
  })
}
