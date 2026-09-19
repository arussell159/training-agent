import type { PlannedWorkout } from "./training-context"

// Paired completed activities can keep their original event ID.
export function canEditWorkout(
  workout: Pick<PlannedWorkout, "id" | "status" | "activity_id">
) {
  return (
    workout.id.startsWith("event:") &&
    workout.status !== "completed" &&
    !workout.activity_id
  )
}
