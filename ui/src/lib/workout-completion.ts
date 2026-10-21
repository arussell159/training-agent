export type CompletionGrade =
  "good" | "medium" | "failed" | "planned" | "unknown"

type Goals = {
  duration_minutes?: number | null
  tss?: number | null
  distance_meters?: number | null
}

export function gradeWorkoutCompletion(
  status: string,
  planned: Goals,
  actual: Goals
): CompletionGrade {
  if (status !== "completed") return "planned"
  // The inspected athlete's priority is Duration, TSS, Distance.
  const first = (["duration_minutes", "tss", "distance_meters"] as const)
    .map((key) => ({ target: planned[key], actual: actual[key] }))
    .find(
      (check) =>
        typeof check.target === "number" &&
        Number.isFinite(check.target) &&
        check.target > 0 &&
        typeof check.actual === "number" &&
        Number.isFinite(check.actual) &&
        check.actual >= 0
    )
  if (!first) return "unknown"
  const deviation = Math.abs(Number(first.actual) / Number(first.target) - 1)
  if (deviation > 0.5 + 1e-9) return "failed"
  if (deviation > 0.2 + 1e-9) return "medium"
  return "good"
}

type Summary = {
  duration_seconds?: number | null
  tss?: number | null
  distance_meters?: number | null
}
type CompletionSource = {
  status: string
  workout_summary?: { planned: Summary | null; completed: Summary | null }
  planned?: Goals
  completed_data?: Goals
  plannedDurationMinutes?: number
  actualDurationMinutes?: number
}
export function workoutCompletionGrade(
  workout: CompletionSource
): CompletionGrade {
  const minutes = (seconds?: number | null) =>
    typeof seconds === "number" ? seconds / 60 : undefined
  if (workout.workout_summary != null) {
    const planned = workout.workout_summary.planned,
      actual = workout.workout_summary.completed
    return gradeWorkoutCompletion(
      workout.status,
      {
        duration_minutes: minutes(planned?.duration_seconds),
        tss: planned?.tss,
        distance_meters: planned?.distance_meters,
      },
      {
        duration_minutes: minutes(actual?.duration_seconds),
        tss: actual?.tss,
        distance_meters: actual?.distance_meters,
      }
    )
  }
  return gradeWorkoutCompletion(
    workout.status,
    {
      ...workout.planned,
      duration_minutes:
        workout.planned?.duration_minutes ?? workout.plannedDurationMinutes,
    },
    {
      ...workout.completed_data,
      duration_minutes:
        workout.actualDurationMinutes ??
        workout.completed_data?.duration_minutes,
    }
  )
}
