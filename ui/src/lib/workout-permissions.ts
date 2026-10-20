import type { PlannedWorkout } from "./training-context"

// Paired completed activities can keep their original event ID.
export function canEditWorkout(
  workout: Pick<PlannedWorkout, "id" | "status" | "activity_id" | "app_pending_operation">
) {
  return (
    /^event:[1-9]\d*$/.test(workout.id) &&
    workout.status !== "completed" &&
    !workout.activity_id
  )
}
