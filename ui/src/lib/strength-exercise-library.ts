import { apiFetch } from "./api-client.ts"
import { randomId } from "./random-id.ts"
import { withRequestDeadline } from "./request-deadline.ts"
import {
  isStrengthLibraryExercise,
  strengthLibraryId,
  validateStrengthExerciseDefinition,
  type StrengthExerciseDefinition,
  type StrengthLibraryExercise,
} from "../../../app-backend/lib/strength-exercise-library-model.mjs"
import {
  validateStrengthPrescription,
  type StrengthExercise,
} from "../../../app-backend/lib/workout-strength-model.mjs"
export type { StrengthLibraryExercise, StrengthExerciseDefinition }
export type StrengthLibraryCatalog = {
  exercises: StrengthLibraryExercise[]
  revision: string
  accountScope: string
  total: number
  readOnly: boolean
}
export type StrengthLibraryAttempt = {
  method: "POST" | "PUT" | "DELETE"
  id: string | null
  body: {
    operationId: string
    accountScope: string
    catalogRevision?: string
    revision?: string
    definition?: StrengthExerciseDefinition
  }
}
export type StrengthLibraryResult = {
  id: string
  accountScope: string
  catalogRevision: string
  operationId: string
  verified: true
  exercise?: StrengthLibraryExercise
  deleted?: true
}
export type StrengthHistoryRecord = {
  workoutId: string
  date: string
  title: string
  workoutCompleted: boolean
  actualResultsAvailable: false
  exercises: StrengthExercise[]
  legacyTitleMatch?: true
}
export type StrengthLibraryHistory = {
  id: string
  accountScope: string
  records: StrengthHistoryRecord[]
  legacyMatches: StrengthHistoryRecord[]
  coverage: "retained-calendar-context"
  actualResultsAvailable: false
}
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">
type ChangedReceipt = {
  exerciseId: string
  operationId: string
  accountScope: string
}
export type StrengthChangedInspection = {
  exercise: StrengthLibraryExercise | null
  catalog: StrengthLibraryCatalog
  attempt: StrengthLibraryAttempt
}
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
const operation = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16,80}$/.test(value)
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const definition = (row: StrengthLibraryExercise) =>
  validateStrengthExerciseDefinition(
    Object.fromEntries(
      ["title", "muscleGroup", "instructions", "videoUrl", "parameters"].map(
        (key) => [key, row[key as keyof StrengthLibraryExercise]]
      )
    )
  )
const storageKey = (scope: string) => {
  if (!digest(scope))
    throw Error("Load your signed-in exercise library before saving.")
  return `strength-library-pending:${scope}`
}
function checkedAttempt(value: unknown): StrengthLibraryAttempt {
  if (
    !object(value) ||
    !["POST", "PUT", "DELETE"].includes(String(value.method)) ||
    !object(value.body) ||
    !operation(value.body.operationId) ||
    !digest(value.body.accountScope)
  )
    throw Error(
      "The retained exercise change could not be verified. Keep its recovery identity."
    )
  const { body } = value
  if (value.method !== "POST") strengthLibraryId(value.id)
  if (
    (value.method === "POST" &&
      (value.id !== null || !digest(body.catalogRevision))) ||
    (value.method !== "POST" && !digest(body.revision))
  )
    throw Error("The retained exercise revision could not be verified.")
  if (
    Object.keys(value).some((key) => !["method", "id", "body"].includes(key)) ||
    Object.keys(body).some(
      (key) =>
        ![
          "operationId",
          "accountScope",
          value.method === "POST" ? "catalogRevision" : "revision",
          ...(value.method === "DELETE" ? [] : ["definition"]),
        ].includes(key)
    )
  )
    throw Error("The retained exercise request is invalid.")
  const normalized = {
    ...value,
    body: {
      ...body,
      ...(value.method !== "DELETE"
        ? { definition: validateStrengthExerciseDefinition(body.definition) }
        : {}),
    },
  }
  if (!same(normalized, value))
    throw Error(
      "The retained exercise request changed. Keep its original recovery identity."
    )
  return structuredClone(normalized) as StrengthLibraryAttempt
}
export function strengthLibraryAttempt(
  catalog: StrengthLibraryCatalog,
  value: StrengthExerciseDefinition | null,
  row?: StrengthLibraryExercise,
  operationId = randomId()
): StrengthLibraryAttempt {
  if (catalog.readOnly || (row && !row.editable))
    throw Error("This exercise library is read-only.")
  if (row && row.accountScope !== catalog.accountScope)
    throw Error("This exercise belongs to a different account.")
  return checkedAttempt({
    method: value ? (row ? "PUT" : "POST") : "DELETE",
    id: row?.id || null,
    body: {
      operationId,
      accountScope: catalog.accountScope,
      ...(row
        ? { revision: row.revision }
        : { catalogRevision: catalog.revision }),
      ...(value
        ? { definition: validateStrengthExerciseDefinition(value) }
        : {}),
    },
  })
}
export function readStrengthLibraryPending(
  store: Store,
  scope: string
): StrengthLibraryAttempt | null {
  let raw: string | null
  try {
    raw = store.getItem(storageKey(scope))
  } catch {
    throw Error(
      "Exercise recovery storage could not be read. Retry before saving another exercise."
    )
  }
  if (raw === null) return null
  try {
    if (raw.length > 30000) throw Error()
    const value = JSON.parse(raw)
    if (value.version !== 1) throw Error()
    const attempt = checkedAttempt(value.attempt)
    if (attempt.body.accountScope !== scope) throw Error()
    return attempt
  } catch {
    throw Error(
      "The retained exercise change could not be verified. Keep it and retry recovery."
    )
  }
}
function remember(store: Store, attempt: StrengthLibraryAttempt) {
  const previous = readStrengthLibraryPending(store, attempt.body.accountScope)
  if (previous && !same(previous, attempt))
    throw Error(
      "Another exercise change still needs confirmation. Recheck it before saving another exercise."
    )
  const changed = readChanged(store, attempt.body.accountScope)
  const encoded = JSON.stringify({
    version: 1,
    attempt,
    ...(changed ? { changed } : {}),
  })
  try {
    store.setItem(storageKey(attempt.body.accountScope), encoded)
    if (store.getItem(storageKey(attempt.body.accountScope)) !== encoded)
      throw Error()
  } catch {
    throw Error(
      "The exercise recovery identity could not be retained. No new request was sent; keep this editor open and retry."
    )
  }
}
function readChanged(store: Store, scope: string): ChangedReceipt | null {
  const attempt = readStrengthLibraryPending(store, scope)
  if (!attempt) return null
  const raw = JSON.parse(store.getItem(storageKey(scope))!)
  if (raw.changed === undefined) return null
  const value = raw.changed
  if (
    !object(value) ||
    value.accountScope !== scope ||
    value.operationId !== attempt.body.operationId
  )
    throw Error(
      "The changed exercise receipt could not be verified. Retain its original identity."
    )
  strengthLibraryId(value.exerciseId)
  return value as ChangedReceipt
}
function rememberChanged(
  store: Store,
  attempt: StrengthLibraryAttempt,
  proof: ChangedReceipt
) {
  if (
    !same(readStrengthLibraryPending(store, attempt.body.accountScope), attempt)
  )
    throw Error("The retained exercise change no longer matches this receipt.")
  const encoded = JSON.stringify({ version: 1, attempt, changed: proof })
  store.setItem(storageKey(attempt.body.accountScope), encoded)
  if (store.getItem(storageKey(attempt.body.accountScope)) !== encoded)
    throw Error(
      "The changed receipt could not be retained. Recheck its original identity."
    )
}
function clear(store: Store, attempt: StrengthLibraryAttempt) {
  if (
    !same(readStrengthLibraryPending(store, attempt.body.accountScope), attempt)
  )
    throw Error("A different exercise change needs recovery.")
  store.removeItem(storageKey(attempt.body.accountScope))
  if (store.getItem(storageKey(attempt.body.accountScope)) !== null)
    throw Error(
      "The confirmed change could not clear its recovery identity. Recheck it before making another change."
    )
}
export class StrengthLibraryError extends Error {
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
function catalog(value: unknown): StrengthLibraryCatalog {
  if (
    !object(value) ||
    !digest(value.accountScope) ||
    !digest(value.revision) ||
    !Array.isArray(value.exercises) ||
    value.exercises.length > 500 ||
    !Number.isSafeInteger(value.total) ||
    Number(value.total) < value.exercises.length ||
    Number(value.total) > 500 ||
    typeof value.readOnly !== "boolean" ||
    value.exercises.some(
      (row) =>
        !isStrengthLibraryExercise(row) ||
        row.accountScope !== value.accountScope ||
        (value.readOnly && row.editable)
    ) ||
    new Set(value.exercises.map((row) => row.id)).size !==
      value.exercises.length
  )
    throw Error(
      "The exercise library response could not be verified. Existing prescriptions are retained."
    )
  return value as StrengthLibraryCatalog
}
function history(
  value: unknown,
  id: string,
  scope: string
): StrengthLibraryHistory {
  if (
    !object(value) ||
    value.id !== id ||
    value.accountScope !== scope ||
    value.coverage !== "retained-calendar-context" ||
    value.actualResultsAvailable !== false ||
    !Array.isArray(value.records) ||
    !Array.isArray(value.legacyMatches)
  )
    throw Error("The exercise history response could not be verified.")
  for (const [rows, legacy] of [
    [value.records, false],
    [value.legacyMatches, true],
  ] as const) {
    if (rows.length > 2000)
      throw Error("Exercise history exceeds the supported view.")
    for (const row of rows) {
      if (
        !object(row) ||
        typeof row.workoutId !== "string" ||
        typeof row.title !== "string" ||
        typeof row.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        typeof row.workoutCompleted !== "boolean" ||
        row.actualResultsAvailable !== false ||
        !Array.isArray(row.exercises) ||
        !row.exercises.length ||
        row.exercises.some(
          (exercise) =>
            !object(exercise) ||
            (legacy
              ? Boolean(exercise.libraryExerciseId)
              : exercise.libraryExerciseId !== id)
        ) ||
        validateStrengthPrescription({
          version: 1,
          blocks: [
            {
              id: "history",
              kind: "circuit",
              title: "",
              instructions: "",
              notes: "",
              timeSeconds: null,
              recordMode: "completion",
              exercises: row.exercises,
            },
          ],
        }).length
      )
        throw Error("The exercise history does not match this saved exercise.")
    }
  }
  return value as StrengthLibraryHistory
}
type Request = (path: string, options?: RequestInit) => Promise<Response>
let accountGeneration = 0
if (typeof window !== "undefined")
  for (const event of ["app-auth-required", "training-cache-reset"])
    window.addEventListener(event, () => accountGeneration++)
export function createStrengthLibraryClient(
  request: Request = apiFetch,
  storage: () => Store = () => window.localStorage
) {
  const busy = new Set<string>()
  const inspections = new WeakSet<StrengthChangedInspection>()
  const read = async (path: string, signal?: AbortSignal) =>
    withRequestDeadline(
      async (signal) => {
        const response = await request(path, {
            signal,
            headers: { Accept: "application/json" },
          }),
          body = await response.json()
        if (!response.ok)
          throw new StrengthLibraryError(
            typeof body?.error === "string"
              ? body.error
              : "The exercise library could not load.",
            response.status,
            body?.code,
            false
          )
        return body
      },
      20000,
      signal
    )
  return {
    list: async (
      filters: {
        query?: string
        owner?: "all" | "me"
        muscleGroup?: string
      } = {},
      signal?: AbortSignal
    ) =>
      catalog(
        await read(
          `/api/strength-exercises?${new URLSearchParams(filters)}`,
          signal
        )
      ),
    load: async (id: string, scope: string, signal?: AbortSignal) => {
      strengthLibraryId(id)
      const row = await read(
        `/api/strength-exercises/${encodeURIComponent(id)}`,
        signal
      )
      if (
        !isStrengthLibraryExercise(row) ||
        row.id !== id ||
        row.accountScope !== scope
      )
        throw Error("The saved exercise does not match this account.")
      return row
    },
    history: async (id: string, scope: string, signal?: AbortSignal) => {
      strengthLibraryId(id)
      return history(
        await read(
          `/api/strength-exercises/${encodeURIComponent(id)}/history`,
          signal
        ),
        id,
        scope
      )
    },
    pending: (scope: string) => readStrengthLibraryPending(storage(), scope),
    changed: (scope: string) => readChanged(storage(), scope),
    inspectChanged: async (
      input: StrengthLibraryAttempt
    ): Promise<StrengthChangedInspection> => {
      const attempt = checkedAttempt(input),
        store = storage(),
        proof = readChanged(store, attempt.body.accountScope)
      if (
        !proof ||
        !same(
          readStrengthLibraryPending(store, attempt.body.accountScope),
          attempt
        )
      )
        throw Error(
          "Recheck the original exercise change to verify its saved identity first."
        )
      const current = catalog(await read("/api/strength-exercises"))
      if (current.accountScope !== attempt.body.accountScope)
        throw Error(
          "The signed-in exercise account changed. Its retained draft cannot be resolved in another account."
        )
      let exercise: StrengthLibraryExercise | null = null
      try {
        const value = await read(
          `/api/strength-exercises/${encodeURIComponent(proof.exerciseId)}`
        )
        if (
          !isStrengthLibraryExercise(value) ||
          value.id !== proof.exerciseId ||
          value.accountScope !== proof.accountScope
        )
          throw Error("The saved exercise does not match the retained receipt.")
        exercise = value
      } catch (reason) {
        if (
          !(reason instanceof StrengthLibraryError) ||
          reason.status !== 404 ||
          reason.code !== "STRENGTH_LIBRARY_NOT_FOUND"
        )
          throw reason
      }
      const inspection = { exercise, catalog: current, attempt }
      inspections.add(inspection)
      return inspection
    },
    acknowledgeChanged: (inspection: StrengthChangedInspection) => {
      if (
        !inspections.has(inspection) ||
        !readChanged(storage(), inspection.attempt.body.accountScope)
      )
        throw Error(
          "Reload the saved exercise before acknowledging its changed outcome."
        )
      clear(storage(), inspection.attempt)
      inspections.delete(inspection)
    },
    mutate: async (
      input: StrengthLibraryAttempt,
      reconcileOnly = false
    ): Promise<StrengthLibraryResult> => {
      const attempt = checkedAttempt(input),
        scope = attempt.body.accountScope,
        generation = accountGeneration
      if (busy.has(scope))
        throw new StrengthLibraryError(
          "An exercise change is already being confirmed.",
          409,
          "CLIENT_BUSY",
          false
        )
      const store = storage(),
        existing = readStrengthLibraryPending(store, scope)
      if (existing && !same(existing, attempt))
        throw Error(
          "Recheck the retained exercise change before saving another exercise."
        )
      if (existing && !reconcileOnly)
        throw Error(
          "This exercise change must be rechecked using its retained identity."
        )
      if (reconcileOnly && !existing)
        throw Error("No retained exercise change is available to recheck.")
      remember(store, attempt)
      busy.add(scope)
      try {
        const result = await withRequestDeadline(async (signal) => {
          if (generation !== accountGeneration)
            throw Error(
              "The signed-in account changed. Reopen its exercise library before rechecking."
            )
          const response = await request(
              `/api/strength-exercises${attempt.method === "POST" ? "" : `/${encodeURIComponent(attempt.id!)}`}`,
              {
                method: attempt.method,
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
            if (
              response.status === 409 &&
              body?.code === "STRENGTH_LIBRARY_REPLAY_CHANGED" &&
              body.accountScope === scope &&
              body.operationId === attempt.body.operationId
            ) {
              try {
                strengthLibraryId(body.exerciseId)
                rememberChanged(store, attempt, {
                  exerciseId: body.exerciseId,
                  accountScope: scope,
                  operationId: attempt.body.operationId,
                })
              } catch {
                throw new StrengthLibraryError(
                  "The changed exercise receipt could not be retained or verified. Keep the original change and recheck."
                )
              }
            }
            const safeRejection =
              !reconcileOnly &&
              ((response.status === 400 &&
                [
                  "STRENGTH_LIBRARY_INVALID",
                  "STRENGTH_LIBRARY_REJECTED",
                ].includes(body?.code)) ||
                (response.status === 403 &&
                  body?.code === "STRENGTH_LIBRARY_READ_ONLY") ||
                (response.status === 409 &&
                  body?.code === "STRENGTH_LIBRARY_CONFLICT"))
            if (safeRejection) clear(store, attempt)
            throw new StrengthLibraryError(
              typeof body?.error === "string"
                ? body.error
                : "This exercise change could not be confirmed. Keep it and recheck.",
              response.status,
              typeof body?.code === "string" ? body.code : "",
              !safeRejection
            )
          }
          if (
            generation !== accountGeneration ||
            !object(body) ||
            body.verified !== true ||
            (attempt.method !== "POST" && body.id !== attempt.id) ||
            body.operationId !== attempt.body.operationId ||
            body.accountScope !== scope ||
            !digest(body.catalogRevision) ||
            (attempt.method === "DELETE"
              ? body.deleted !== true || body.exercise !== undefined
              : !isStrengthLibraryExercise(body.exercise) ||
                body.exercise.id !== body.id ||
                body.exercise.accountScope !== scope ||
                !same(definition(body.exercise), attempt.body.definition))
          )
            throw new StrengthLibraryError(
              "The exercise save response could not be verified. Keep this change and recheck its original identity."
            )
          return body as StrengthLibraryResult
        }, 30000)
        clear(store, attempt)
        return result
      } finally {
        busy.delete(scope)
      }
    },
  }
}
export const strengthLibraryClient = createStrengthLibraryClient()

/** Explicit selection keeps existing set values only for matching independent columns. */
export function selectStrengthLibraryExercise(
  current: StrengthExercise,
  row: Pick<
    StrengthLibraryExercise,
    "id" | "title" | "instructions" | "parameters"
  >
): StrengthExercise {
  const used = new Set<string>(),
    parameters = row.parameters.map((source) => {
      const matching = current.parameters.find(
        (column) =>
          !used.has(column.id) &&
          column.kind === source.kind &&
          column.unit === source.unit
      )
      if (matching) used.add(matching.id)
      return { ...source, id: matching?.id || randomId() }
    })
  return {
    ...current,
    libraryExerciseId: row.id,
    title: row.title,
    instructions: row.instructions,
    parameters,
    sets: current.sets.map((set) => ({
      ...set,
      values: Object.fromEntries(
        parameters.map((column) => [column.id, set.values[column.id] ?? null])
      ),
    })),
  }
}
