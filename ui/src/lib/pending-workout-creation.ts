import {
  validateWorkout,
  type WorkoutModel,
} from "../../../app-backend/lib/workout-editor-model.mjs"
import { validatePlannedValues } from "../../../app-backend/lib/planned-workout-values.mjs"
import type { WorkoutSummaryValues } from "./training-context"

export type PendingWorkoutCreation = {
  model: WorkoutModel
  values: Partial<WorkoutSummaryValues>
  time: string
  comment: string
  creationId: string
  reconcileOnly?: boolean
  descriptionMode?: "manual"
  description?: string
}
type CreationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
const key = (scope: string) => `workout-creation-pending:${scope}`
export function readPendingWorkoutCreation(
  storage: CreationStorage,
  scope: string
): PendingWorkoutCreation | null {
  try {
    const record = JSON.parse(storage.getItem(key(scope)) || "null")
    const input = record?.input
    if (
      record?.version !== 1 ||
      !input ||
      !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
        input.creationId
      ) ||
      validateWorkout(input.model).length ||
      typeof input.comment !== "string" ||
      input.comment.length > 2000 ||
      typeof input.time !== "string" ||
      (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))
    )
      return null
    validatePlannedValues(input.values)
    return input
  } catch {
    return null
  }
}
export function rememberPendingWorkoutCreation(
  storage: CreationStorage,
  scope: string,
  input: PendingWorkoutCreation
) {
  const existing = readPendingWorkoutCreation(storage, scope)
  if (existing && existing.creationId !== input.creationId)
    throw Object.assign(
      Error(
        "Another workout save still needs confirmation. Reopen Add Workout to recheck it before creating another workout."
      ),
      { status: 409, code: "CREATION_PENDING" }
    )
  try {
    storage.setItem(key(scope), JSON.stringify({ version: 1, input }))
    return true
  } catch {
    return false
  }
}
export function clearPendingWorkoutCreation(
  storage: CreationStorage,
  scope: string,
  creationId: string
) {
  try {
    if (readPendingWorkoutCreation(storage, scope)?.creationId !== creationId)
      return false
    storage.removeItem(key(scope))
    return true
  } catch {
    return false
  }
}
