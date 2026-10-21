import type { WorkoutModel } from "../../../app-backend/lib/workout-editor-model.mjs"

/** Entering an interval editor must not preserve the simple-session exemption. */
export function builderWorkoutModel(model: WorkoutModel): WorkoutModel {
  const structured = { ...model }
  delete structured.unstructured
  if (structured.sport === "Swim" && !structured.steps.length) structured.swimUnitMode = "explicit"
  if (structured.sport !== "Swim") delete structured.swimUnitMode
  return structured
}
export function hasWorkoutStructure(model?: WorkoutModel | null) {
  return Boolean(
    model &&
    !model.unstructured &&
    (model.steps.length || model.strength?.blocks.length)
  )
}
