import type { FoodEntry, NutritionDay } from "./nutrition"

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
export type NutritionWrite = {
  date: string
  action: "add" | "update" | "delete"
  entries?: FoodEntry[]
  id?: string
  operationId: string
  revision: number
}
export type NutritionWriteResult = {
  day: NutritionDay | null
  committed?: boolean
  revision?: number
}
const key = (scope: string) => {
  if (!scope || scope === "initial")
    throw Error("Wait for your account food log to load before saving.")
  return `nutrition-write-pending:${scope}`
}
export function pendingNutritionWrite(
  storage: RecoveryStorage,
  scope: string
): NutritionWrite | null {
  const raw = storage.getItem(key(scope))
  if (!raw) return null
  try {
    const row = JSON.parse(raw)
    const input = row.input as NutritionWrite
    if (
      row.version !== 1 ||
      !input ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
      !["add", "update", "delete"].includes(input.action) ||
      !/^[a-zA-Z0-9_-]{8,80}$/.test(input.operationId) ||
      !Number.isSafeInteger(input.revision) ||
      input.revision < 0 ||
      (input.action !== "delete" &&
        (!Array.isArray(input.entries) || !input.entries.length))
    )
      throw Error()
    return input
  } catch {
    throw Error(
      "An earlier food save could not be read. Restore the retained browser data before adding another food."
    )
  }
}
export function rememberNutritionWrite(
  storage: RecoveryStorage,
  scope: string,
  input: NutritionWrite
) {
  const pending = pendingNutritionWrite(storage, scope)
  if (pending && JSON.stringify(pending) !== JSON.stringify(input))
    throw Error(
      "An earlier food save still needs confirmation. Use Retry saved food entry before making another change."
    )
  try {
    storage.setItem(key(scope), JSON.stringify({ version: 1, input }))
  } catch {
    throw Error(
      "Your food save could not be retained on this device. Keep this screen open and retry; no request was sent."
    )
  }
}
export function clearNutritionWrite(
  storage: RecoveryStorage,
  scope: string,
  operationId: string
) {
  if (pendingNutritionWrite(storage, scope)?.operationId === operationId)
    storage.removeItem(key(scope))
}
const running = new Map<string, Promise<NutritionWriteResult>>()
function validDay(value: unknown): value is NutritionDay {
  if (!value || typeof value !== "object") return false
  const day = value as NutritionDay
  return (
    Number.isSafeInteger(day.revision) &&
    day.revision >= 0 &&
    Array.isArray(day.entries) &&
    day.entries.every(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        typeof entry.unit === "string" &&
        ["breakfast", "lunch", "dinner", "snacks"].includes(entry.meal) &&
        typeof entry.quantity === "number" &&
        Number.isFinite(entry.quantity) &&
        entry.quantity > 0 &&
        (["calories", "protein", "carbs", "fat", "fiber"] as const).every(
          (key) =>
            (key === "fiber" && entry[key] === null) ||
            (typeof entry[key] === "number" &&
              Number.isFinite(entry[key]) &&
              entry[key]! >= 0)
        )
    )
  )
}
export function nutritionWriteInFlight(scope: string, operationId: string) {
  return running.has(`${scope}:${operationId}`)
}
export async function recoverPendingNutritionWrite(
  storage: RecoveryStorage,
  scope: string,
  current: () => boolean,
  prepare: () => Promise<
    (input: NutritionWrite) => Promise<NutritionWriteResult>
  >
) {
  if (!current()) return null
  const input = pendingNutritionWrite(storage, scope)
  if (!input || nutritionWriteInFlight(scope, input.operationId)) return null
  const send = await prepare()
  if (!current()) return null
  await submitNutritionWrite(storage, scope, input, (payload) => {
    if (!current())
      throw Error(
        "Your account changed. Return to the original account to recover this food entry."
      )
    return send(payload)
  })
  return current() ? input : null
}
/** Retain one immutable intent before transport; every retry uses its original revision and ID. */
export function submitNutritionWrite(
  storage: RecoveryStorage,
  scope: string,
  input: NutritionWrite,
  send: (input: NutritionWrite) => Promise<NutritionWriteResult>
) {
  rememberNutritionWrite(storage, scope, input)
  const name = `${scope}:${input.operationId}`
  const current = running.get(name)
  if (current) return current
  const request = Promise.resolve()
    .then(() => send(input))
    .then((result) => {
      const hasDay = validDay(result?.day)
      const hasReceipt =
        result?.committed === true &&
        Number.isSafeInteger(result.revision) &&
        result.revision! > input.revision
      if (
        !result ||
        (!hasReceipt &&
          !(
            result.committed === undefined &&
            hasDay &&
            result.day!.revision > input.revision
          ))
      )
        throw Error(
          "The food save has not been confirmed. Retry the retained entry."
        )
      // A cleanup failure must never turn a confirmed backend commit into failure.
      try {
        clearNutritionWrite(storage, scope, input.operationId)
      } catch {
        /* Replaying the receipt remains safe. */
      }
      return { ...result, day: hasDay ? result.day : null }
    })
    .catch((error) => {
      // These responses prove this operation was rejected before a commit. Keep
      // the editor draft, but allow a corrected intent/revision on the next save.
      if ([400, 409, 422].includes(error?.status)) {
        try {
          clearNutritionWrite(storage, scope, input.operationId)
        } catch {
          /* Keep safe recovery. */
        }
      }
      throw error
    })
    .finally(() => {
      if (running.get(name) === request) running.delete(name)
    })
  running.set(name, request)
  return request
}
