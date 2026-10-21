import type { WorkoutModel } from "../../../app-backend/lib/workout-editor-model.mjs"

// Native all-day events use midnight too. Only the private explicit choice can
// distinguish that value from a user who actually selected 12:00 AM.
export function editorStartTime(model: WorkoutModel, scheduledTime?: string) {
  const time = (scheduledTime ?? "00:00").slice(0, 5)
  return model.strength &&
    time === "00:00" &&
    model.strength.startTimeAssigned !== true
    ? ""
    : time
}

// Time is a header field, outside prescription Undo/Redo. Keep its private
// assignment alongside the current time even when an exercise edit is undone.
export function withStrengthTimeAssignment(
  model: WorkoutModel,
  assigned: boolean | undefined
): WorkoutModel {
  if (!model.strength || model.strength.startTimeAssigned === assigned)
    return model
  const strength = { ...model.strength }
  if (assigned === undefined) delete strength.startTimeAssigned
  else strength.startTimeAssigned = assigned
  return { ...model, strength }
}
