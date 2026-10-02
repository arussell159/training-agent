import type { PlannedWorkout } from "@/lib/training-context"
import { durationMinutes } from "@/lib/training-context"
import { formatDuration } from "@/lib/duration"

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

export function workoutTime(workout: PlannedWorkout): { label: string; value: string } {
  const recordedMinutes =
    workout.workout_summary?.completed?.duration_seconds != null
      ? workout.workout_summary.completed.duration_seconds / 60
      : workout.actualDurationMinutes ?? workout.completed_data?.duration_minutes ?? 0
  const hasRecordedTime = workout.status === "completed" && recordedMinutes > 0
  const minutes = hasRecordedTime ? recordedMinutes : durationMinutes(workout)
  const value =
    !hasRecordedTime && workout.planned_time_label
      ? workout.planned_time_label
      : minutes > 0
        ? formatDuration(minutes)
        : "—"
  return {
    label: hasRecordedTime ? "Completed time" : "Est. time",
    value,
  }
}
