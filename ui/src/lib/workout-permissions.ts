import type { PlannedWorkout } from "./training-context"

export function canEditActivity(workout: Pick<PlannedWorkout, "id" | "activity_id" | "app_pending_operation">) {
  return !workout.app_pending_operation && (/^activity:i?\d+$/.test(workout.id) || Boolean(workout.activity_id && /^i?\d+$/.test(workout.activity_id)))
}

// Paired completed activities can keep their original event ID.
export function canEditWorkout(
  workout: Pick<PlannedWorkout, "id" | "status" | "activity_id" | "app_pending_operation">
) {
  return (
    /^(event:[1-9]\d*|app:[a-f\d-]{36})$/.test(workout.id) &&
    workout.status !== "completed" &&
    !workout.activity_id
  )
}
