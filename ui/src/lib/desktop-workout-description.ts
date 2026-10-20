import type { PlannedWorkout } from "./training-context"
import { readManualWorkoutDescription } from "../../../app-backend/lib/workout-manual-description.mjs"

/** Desktop Description contains provider/user prose, never a generated outline. */
export function desktopWorkoutDescription(workout: PlannedWorkout): string {
  if (typeof workout.manual_description === "string")
    return workout.manual_description
  const raw = (
    workout as PlannedWorkout & {
      raw?: { description?: string; workout_doc?: { steps?: unknown[] } }
    }
  ).raw
  if (raw && typeof raw.description === "string")
    return readManualWorkoutDescription(raw, workout.editor_model)
  const description =
    workout.editable_description ??
    workout.goal ??
    (workout.app_description_version ? "" : workout.details) ??
    ""
  return readManualWorkoutDescription({ description }, workout.editor_model)
}
