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
function immutableCreationBody(input: PendingWorkoutCreation) {
  return JSON.stringify(
    {
      model: input.model,
      values: input.values,
      time: input.time,
      comment: input.comment,
      descriptionMode: input.descriptionMode,
      description: input.description,
    },
    (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]])
          )
        : value
  )
}
const key = (scope: string) => `workout-creation-pending:${scope}`
export type PendingWorkoutCreationState =
  | { status: "empty" }
  | { status: "pending"; input: PendingWorkoutCreation }
  | { status: "blocked"; error: string }
/** An unreadable prior intent cannot safely be interpreted as no prior POST. */
export function inspectPendingWorkoutCreation(
  storage: CreationStorage,
  scope: string
): PendingWorkoutCreationState {
  try {
    const raw = storage.getItem(key(scope))
    if (raw === null) return { status: "empty" }
    const input = readPendingWorkoutCreation(
      {
        getItem: () => raw,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      scope
    )
    return input
      ? { status: "pending", input }
      : {
          status: "blocked",
          error:
            "An earlier workout save could not be read safely. Restore the retained browser data or review the original workout before creating another.",
        }
  } catch {
    return {
      status: "blocked",
      error:
        "Browser storage is unavailable. Restore access so an earlier workout save can be checked before creating another.",
    }
  }
}
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
      (input.description !== undefined &&
        (typeof input.description !== "string" ||
          input.description.length > 30000)) ||
      (input.descriptionMode !== undefined &&
        input.descriptionMode !== "manual") ||
      (input.reconcileOnly !== undefined &&
        typeof input.reconcileOnly !== "boolean") ||
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
  const state = inspectPendingWorkoutCreation(storage, scope)
  if (state.status === "blocked")
    throw Object.assign(Error(state.error), {
      status: 409,
      code: "CREATION_STORAGE",
    })
  const existing = state.status === "pending" ? state.input : null
  if (
    existing &&
    (existing.creationId !== input.creationId ||
      immutableCreationBody(existing) !== immutableCreationBody(input))
  )
    throw Object.assign(
      Error(
        "Another workout save still needs confirmation. Reopen Add Workout to recheck it before creating another workout."
      ),
      { status: 409, code: "CREATION_PENDING" }
    )
  // The first immutable intent also owns its recovery extensions. Rechecking
  // may change a transport flag, but cannot rewrite the original saved body.
  try {
    if (existing) {
      const raw = storage.getItem(key(scope))
      const retained = readPendingWorkoutCreation(
        { getItem: () => raw, setItem: () => {}, removeItem: () => {} },
        scope
      )
      if (
        !raw ||
        !retained ||
        retained.creationId !== input.creationId ||
        immutableCreationBody(retained) !== immutableCreationBody(input)
      )
        return false
      // Verify recovery is still writable without replacing a single byte of
      // the first intent, including private editor recovery extensions.
      storage.setItem(key(scope), raw)
      return true
    }
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
