import type { PlannedWorkout } from "@/lib/training-context"
import { durationMinutes } from "@/lib/training-context"
import { formatDuration } from "@/lib/duration"

export type WorkoutTss = { value: number; estimated: boolean } | null

const hasWorkoutPlan = (workout: PlannedWorkout) =>
  workout.workout_summary == null || workout.workout_summary.planned != null

/** Unpaired modern recordings contribute recorded time, never planned time. */
export function workoutPlannedMinutes(workout: PlannedWorkout): number {
  if (workout.workout_summary == null) return durationMinutes(workout)
  if (!hasWorkoutPlan(workout)) return 0
  const seconds = workout.workout_summary.planned?.duration_seconds
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) return seconds / 60
  const minutes = [workout.plannedDurationMinutes, workout.planned?.duration_minutes]
    .find((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
  return minutes ?? 0
}

/** Return the planned estimate or recorded TSS for the workout's current status. */
export function workoutTss(workout: PlannedWorkout): WorkoutTss {
  const completed = workout.status === "completed"
  const authoritative = workout.workout_summary != null
  const values = completed
    ? workout.workout_summary?.completed
    : workout.workout_summary?.planned
  // Modern summaries preserve missing provider measurements. Older normalized
  // fields may contain placeholder zeroes and cannot override that absence.
  const explicit = authoritative ? values?.tss : completed
    ? workout.completed_data?.tss
    : workout.planned?.tss ?? workout.load
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    return { value: explicit, estimated: !completed }
  }

  const durationSeconds = authoritative ? values?.duration_seconds :
    (completed
      ? (workout.actualDurationMinutes ?? workout.completed_data?.duration_minutes ?? 0) * 60
      : (workout.planned?.duration_minutes ?? workout.plannedDurationMinutes ?? 0) * 60)
  const intensityFactor = values?.intensity_factor
  if (
    typeof intensityFactor === "number" && Number.isFinite(intensityFactor) && intensityFactor > 0 &&
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0
  ) {
    const value = (durationSeconds / 3600) * intensityFactor ** 2 * 100
    if (Number.isFinite(value)) return { value, estimated: true }
  }
  return null
}

export function workoutTssTotal(workouts: PlannedWorkout[], kind: "planned" | "completed") {
  const applicable = workouts.filter((workout) => kind === "completed"
    ? workout.status === "completed"
    : hasWorkoutPlan(workout))
  const values = applicable.map((workout) => workoutTss(kind === "planned" ? { ...workout, status: "upcoming" } : workout))
    .filter((value) => value !== null)
  const estimated = values.some((value) => value.estimated)
  const partial = values.length > 0 && values.length < applicable.length
  const sum = values.reduce((total, value) => total + value.value, 0)
  const value = values.length && Number.isFinite(sum) ? sum : null
  return {
    value,
    label: value !== null ? `${estimated ? "~" : ""}${Math.round(value).toLocaleString("en-US")}${partial ? "+" : ""}` : "—",
    available: values.length,
    expected: applicable.length,
    estimated,
    partial,
  }
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
