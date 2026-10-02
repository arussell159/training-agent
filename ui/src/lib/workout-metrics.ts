import type { PlannedWorkout } from "@/lib/training-context"

export type WorkoutTss = { value: number; estimated: boolean } | null

/** Return the planned estimate or recorded TSS for the workout's current status. */
export function workoutTss(workout: PlannedWorkout): WorkoutTss {
  const completed = workout.status === "completed"
  const values = completed
    ? workout.workout_summary?.completed
    : workout.workout_summary?.planned
  const explicit = completed
    ? values?.tss ?? workout.completed_data?.tss
    : values?.tss ?? workout.planned?.tss ?? workout.load
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return { value: explicit, estimated: !completed }
  }

  const durationSeconds = values?.duration_seconds ??
    (completed
      ? (workout.actualDurationMinutes ?? workout.completed_data?.duration_minutes ?? 0) * 60
      : (workout.planned?.duration_minutes ?? workout.plannedDurationMinutes ?? 0) * 60)
  const intensityFactor = values?.intensity_factor
  if (
    typeof intensityFactor === "number" && intensityFactor > 0 &&
    Number.isFinite(durationSeconds) && durationSeconds > 0
  ) {
    return {
      value: (durationSeconds / 3600) * intensityFactor ** 2 * 100,
      estimated: true,
    }
  }
  return null
}

export function formatWorkoutTss(workout: PlannedWorkout): string {
  const tss = workoutTss(workout)
  if (!tss) return "—"
  const value = Math.round(tss.value).toLocaleString("en-US")
  return `${tss.estimated ? "~" : ""}${value} TSS`
}
