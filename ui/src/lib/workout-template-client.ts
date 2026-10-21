import { apiFetch } from "./api-client.ts"
import { randomId } from "./random-id.ts"
import { withRequestDeadline } from "./request-deadline.ts"
import { validatedLibraryWorkout } from "./training-context-validation.ts"
import {
  validateWorkoutTemplateInput,
  workoutTemplateFolderId,
  workoutTemplateId,
  workoutTemplateScope,
  type WorkoutTemplateFolders,
  type WorkoutTemplateInput,
  type WorkoutTemplateResult,
  type WorkoutTemplateInspection as TemplateInspection,
} from "../../../app-backend/lib/workout-template-model.mjs"

export type {
  WorkoutTemplateFolders,
  WorkoutTemplateResult,
  TemplateInspection,
}
export type WorkoutTemplateAttempt = {
  sourceWorkoutId: string
  body: Omit<WorkoutTemplateInput, "reconcileOnly">
}
export type WorkoutTemplateInspection = {
  outcome: TemplateInspection
  attempt: WorkoutTemplateAttempt
}
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">
type Request = (path: string, options?: RequestInit) => Promise<Response>
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sourceId = (value: unknown): value is string =>
  typeof value === "string" && /^event:[1-9]\d*$/.test(value)
const key = (scope: string) => {
  if (!workoutTemplateScope(scope))
    throw Error("Load the signed-in workout library before saving.")
  return `workout-template-pending:${scope}`
}
export class WorkoutTemplateError extends Error {
  status: number
  code: string
  uncertain: boolean
  constructor(message: string, status = 0, code = "", uncertain = true) {
    super(message)
    this.status = status
    this.code = code
    this.uncertain = uncertain
  }
}
export function checkedWorkoutTemplateAttempt(
  value: unknown
): WorkoutTemplateAttempt {
  if (
    !object(value) ||
    !sourceId(value.sourceWorkoutId) ||
    !object(value.body) ||
    Object.keys(value).some(
      (name) => !["sourceWorkoutId", "body"].includes(name)
    ) ||
    "reconcileOnly" in value.body ||
    validateWorkoutTemplateInput(value.body).length
  )
    throw Error(
      "The retained library save could not be verified. Keep its recovery identity."
    )
  return structuredClone(value) as WorkoutTemplateAttempt
}
export function parseWorkoutTemplateFolders(
  value: unknown
): WorkoutTemplateFolders {
  if (
    !object(value) ||
    !workoutTemplateScope(value.accountScope) ||
    typeof value.readOnly !== "boolean" ||
    !Array.isArray(value.folders) ||
    value.folders.length > 10000 ||
    new Set(value.folders.map((folder) => (object(folder) ? folder.id : null)))
      .size !== value.folders.length ||
    value.folders.some(
      (folder) =>
        !object(folder) ||
        !workoutTemplateFolderId(folder.id) ||
        typeof folder.name !== "string" ||
        !folder.name.trim() ||
        folder.name.length > 1000 ||
        !workoutTemplateScope(folder.revision) ||
        typeof folder.editable !== "boolean"
    )
  )
    throw Error(
      "The workout library folders could not be verified. Reload them before saving."
    )
  return structuredClone(value) as WorkoutTemplateFolders
}
export function workoutTemplateAttempt(
  folders: WorkoutTemplateFolders,
  source: { id: string; revision: string },
  folderId: string,
  title: string,
  operationId = randomId()
): WorkoutTemplateAttempt {
  const catalog = parseWorkoutTemplateFolders(folders),
    folder = catalog.folders.find((row) => row.id === folderId)
  if (catalog.readOnly || !folder?.editable)
    throw Error("Choose an editable workout library folder.")
  return checkedWorkoutTemplateAttempt({
    sourceWorkoutId: source.id,
    body: {
      accountScope: catalog.accountScope,
      sourceRevision: source.revision,
      folderId,
      folderRevision: folder.revision,
      title,
      operationId,
    },
  })
}
export function readWorkoutTemplatePending(
  store: Store,
  scope: string
): WorkoutTemplateAttempt | null {
  let raw: string | null
  try {
    raw = store.getItem(key(scope))
  } catch {
    throw Error(
      "Library save recovery could not be read. Retry before adding another template."
    )
  }
  if (raw === null) return null
  try {
    if (raw.length > 8000) throw Error()
    const value = JSON.parse(raw)
    if (value.version !== 1) throw Error()
    const attempt = checkedWorkoutTemplateAttempt(value.attempt)
    if (attempt.body.accountScope !== scope) throw Error()
    return attempt
  } catch {
    throw Error(
      "The retained library save is invalid. Keep it and retry recovery."
    )
  }
}
function remember(store: Store, attempt: WorkoutTemplateAttempt) {
  const prior = readWorkoutTemplatePending(store, attempt.body.accountScope)
  if (prior && !same(prior, attempt))
    throw Error(
      "Another library save needs confirmation. Recheck it before adding another template."
    )
  const encoded = JSON.stringify({ version: 1, attempt })
  try {
    store.setItem(key(attempt.body.accountScope), encoded)
    if (store.getItem(key(attempt.body.accountScope)) !== encoded) throw Error()
  } catch {
    throw Error(
      "The library recovery identity could not be retained. No new request was sent; keep this dialog open and retry."
    )
  }
}
function forget(store: Store, attempt: WorkoutTemplateAttempt) {
  const prior = readWorkoutTemplatePending(store, attempt.body.accountScope)
  if (!same(prior, attempt))
    throw Error(
      "The retained library save changed. Recheck its original identity."
    )
  store.removeItem(key(attempt.body.accountScope))
  if (store.getItem(key(attempt.body.accountScope)) !== null)
    throw Error(
      "The template was confirmed but recovery could not be cleared. Recheck this same save."
    )
}
export function parseWorkoutTemplateResult(
  value: unknown,
  input: WorkoutTemplateAttempt
): WorkoutTemplateResult {
  const attempt = checkedWorkoutTemplateAttempt(input)
  if (
    !object(value) ||
    value.verified !== true ||
    value.accountScope !== attempt.body.accountScope ||
    value.operationId !== attempt.body.operationId ||
    !workoutTemplateId(value.workoutId) ||
    !object(value.intent) ||
    value.intent.sourceWorkoutId !== attempt.sourceWorkoutId ||
    value.intent.sourceRevision !== attempt.body.sourceRevision ||
    value.intent.folderId !== attempt.body.folderId ||
    value.intent.folderRevision !== attempt.body.folderRevision ||
    value.intent.title !== attempt.body.title.trim()
  )
    throw new WorkoutTemplateError(
      "The library save response could not be verified. Recheck this same save."
    )
  const workout = validatedLibraryWorkout(value.workout)
  if (
    workout.id !== value.workoutId ||
    workout.title !== attempt.body.title.trim()
  )
    throw new WorkoutTemplateError(
      "The saved template differs from this request. Recheck its original identity."
    )
  return structuredClone({ ...value, workout }) as WorkoutTemplateResult
}
export function parseWorkoutTemplateInspection(
  value: unknown,
  input: WorkoutTemplateAttempt
): TemplateInspection {
  const attempt = checkedWorkoutTemplateAttempt(input)
  if (
    !object(value) ||
    value.accountScope !== attempt.body.accountScope ||
    value.operationId !== attempt.body.operationId ||
    !["saved", "changed", "deleted", "unconfirmed", "rejected"].includes(
      String(value.status)
    ) ||
    !object(value.intent) ||
    value.intent.sourceWorkoutId !== attempt.sourceWorkoutId ||
    value.intent.sourceRevision !== attempt.body.sourceRevision ||
    value.intent.folderId !== attempt.body.folderId ||
    value.intent.folderRevision !== attempt.body.folderRevision ||
    value.intent.title !== attempt.body.title.trim()
  )
    throw new WorkoutTemplateError(
      "The retained library outcome could not be verified. Keep the original save."
    )
  if (["saved", "changed"].includes(String(value.status))) {
    if (!workoutTemplateId(value.workoutId))
      throw new WorkoutTemplateError(
        "The saved template identity could not be verified."
      )
    const workout = validatedLibraryWorkout(value.workout)
    if (
      workout.id !== value.workoutId ||
      (value.status === "saved" && workout.title !== attempt.body.title.trim())
    )
      throw new WorkoutTemplateError(
        "The current template does not match this retained outcome."
      )
    return structuredClone({ ...value, workout }) as TemplateInspection
  }
  if (
    value.workout !== null ||
    (value.status === "deleted"
      ? !workoutTemplateId(value.workoutId)
      : value.workoutId !== null)
  )
    throw new WorkoutTemplateError(
      "The retained library outcome is incomplete. Keep the original save."
    )
  return structuredClone(value) as TemplateInspection
}
let accountGeneration = 0
if (typeof window !== "undefined")
  for (const event of ["app-auth-required", "training-cache-reset"])
    window.addEventListener(event, () => accountGeneration++)

export function createWorkoutTemplateClient(
  request: Request = apiFetch,
  storage: () => Store = () => window.localStorage,
  { timeoutMs = 65000 }: { timeoutMs?: number } = {}
) {
  const busy = new Set<string>()
  const inspections = new WeakMap<
    WorkoutTemplateInspection,
    { generation: number; fingerprint: string }
  >()
  return {
    folders: async (signal?: AbortSignal): Promise<WorkoutTemplateFolders> => {
      const generation = accountGeneration
      return withRequestDeadline(
        async (signal) => {
          const response = await request("/api/workout-library/folders", {
              signal,
              headers: { Accept: "application/json" },
            }),
            body = await response.json()
          signal.throwIfAborted()
          if (generation !== accountGeneration)
            throw Error("The signed-in library changed. Reopen its folders.")
          if (!response.ok)
            throw new WorkoutTemplateError(
              typeof body?.error === "string"
                ? body.error
                : "The workout library folders could not load.",
              response.status,
              body?.code,
              false
            )
          return parseWorkoutTemplateFolders(body)
        },
        20000,
        signal
      )
    },
    pending: (scope: string) => readWorkoutTemplatePending(storage(), scope),
    inspect: async (
      input: WorkoutTemplateAttempt
    ): Promise<WorkoutTemplateInspection> => {
      const attempt = checkedWorkoutTemplateAttempt(input),
        generation = accountGeneration
      if (
        !same(
          readWorkoutTemplatePending(storage(), attempt.body.accountScope),
          attempt
        )
      )
        throw Error(
          "Keep the original retained save before reviewing its outcome."
        )
      const outcome = await withRequestDeadline(async (signal) => {
        const response = await request(
            `/api/workout-template-operations/${encodeURIComponent(attempt.body.operationId)}?${new URLSearchParams({ accountScope: attempt.body.accountScope })}`,
            { signal, headers: { Accept: "application/json" } }
          ),
          body = await response.json()
        signal.throwIfAborted()
        if (generation !== accountGeneration)
          throw Error(
            "The signed-in library changed. Return to the original account to review this save."
          )
        if (!response.ok)
          throw new WorkoutTemplateError(
            typeof body?.error === "string"
              ? body.error
              : "The retained library outcome could not load.",
            response.status,
            typeof body?.code === "string" ? body.code : ""
          )
        return parseWorkoutTemplateInspection(body, attempt)
      }, 20000)
      const inspection = { outcome, attempt }
      inspections.set(inspection, {
        generation,
        fingerprint: JSON.stringify(inspection),
      })
      return inspection
    },
    acknowledge: (
      inspection: WorkoutTemplateInspection
    ): TemplateInspection => {
      const proof = inspections.get(inspection)
      if (
        !proof ||
        proof.generation !== accountGeneration ||
        proof.fingerprint !== JSON.stringify(inspection) ||
        inspection.outcome.status === "unconfirmed"
      )
        throw Error(
          "Review a verified saved, changed, deleted or rejected outcome before resolving this save."
        )
      forget(storage(), inspection.attempt)
      inspections.delete(inspection)
      return structuredClone(inspection.outcome)
    },
    save: async (
      input: WorkoutTemplateAttempt,
      reconcileOnly = false
    ): Promise<WorkoutTemplateResult> => {
      const attempt = checkedWorkoutTemplateAttempt(input),
        scope = attempt.body.accountScope,
        generation = accountGeneration
      if (busy.has(scope))
        throw new WorkoutTemplateError(
          "A library save is already being confirmed.",
          409,
          "CLIENT_BUSY",
          false
        )
      const store = storage(),
        prior = readWorkoutTemplatePending(store, scope)
      if (prior && !same(prior, attempt))
        throw Error(
          "Recheck the retained library save before adding another template."
        )
      if (prior && !reconcileOnly)
        throw Error(
          "This library save must be rechecked using its retained identity."
        )
      if (reconcileOnly && !prior)
        throw Error("No retained library save is available to recheck.")
      remember(store, attempt)
      busy.add(scope)
      let dispatched = false
      try {
        const result = await withRequestDeadline(async (signal) => {
          if (generation !== accountGeneration)
            throw Error(
              "The signed-in library changed. Return to the original account to recheck this save."
            )
          dispatched = true
          const response = await request(
              `/api/workouts/${encodeURIComponent(attempt.sourceWorkoutId)}/save-template`,
              {
                method: "POST",
                signal,
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({
                  ...attempt.body,
                  ...(reconcileOnly ? { reconcileOnly: true } : {}),
                }),
              }
            ),
            body = await response.json()
          signal.throwIfAborted()
          if (!response.ok) {
            const safe =
              !reconcileOnly &&
              ((response.status === 400 && body?.code === "TEMPLATE_INVALID") ||
                (response.status === 403 &&
                  body?.code === "TEMPLATE_READ_ONLY") ||
                (response.status === 409 &&
                  [
                    "TEMPLATE_ACCOUNT_CHANGED",
                    "TEMPLATE_SOURCE_CHANGED",
                    "TEMPLATE_FOLDER_CHANGED",
                  ].includes(body?.code)) ||
                ([400, 401, 403, 422].includes(response.status) &&
                  body?.code === "TEMPLATE_REJECTED"))
            if (safe) forget(store, attempt)
            throw new WorkoutTemplateError(
              typeof body?.error === "string"
                ? body.error
                : "The library save could not be confirmed. Keep it and recheck.",
              response.status,
              typeof body?.code === "string" ? body.code : "",
              !safe
            )
          }
          if (generation !== accountGeneration)
            throw new WorkoutTemplateError(
              "The signed-in library changed. Recheck this save from its original account."
            )
          return parseWorkoutTemplateResult(body, attempt)
        }, timeoutMs)
        forget(store, attempt)
        return result
      } catch (reason) {
        if (!dispatched && !prior) forget(store, attempt)
        throw reason
      } finally {
        busy.delete(scope)
      }
    },
  }
}
export const workoutTemplateClient = createWorkoutTemplateClient()
