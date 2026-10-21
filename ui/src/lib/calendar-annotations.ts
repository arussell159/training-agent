import { apiFetch } from "./api-client.ts"
import { withRequestDeadline } from "./request-deadline.ts"
import { randomId } from "./random-id.ts"
import type { PlannedWorkout, TrainingContext } from "./training-context"
import {
  calendarAvailabilityReasons,
  calendarAvailabilitySports,
  isCalendarAnnotation,
  validateCalendarAnnotationEntry,
  type CalendarAnnotationEntry as TransportEntry,
} from "../../../app-backend/lib/calendar-annotations-model.mjs"

export type AnnotationKind = "goals" | "availability"
export type GoalItem = { id: string; text: string; completed: boolean }
export type AnnotationEntry = {
  kind: AnnotationKind
  date: string
  endDate: string
  title: string
  goals: GoalItem[]
  mode: "unavailable" | "limited"
  sports: string[]
  reason: string
  description: string
}
export type CalendarAnnotation = AnnotationEntry & {
  id: string
  revision: string
  editable: boolean
  metadataCurrent: boolean
  nativeSportsComplete: boolean
  nativeWarning?: string
  providerDescription?: string
  creationId?: string
}
export type AnnotationResult = {
  annotation?: CalendarAnnotation
  workoutId: string
  workout?: PlannedWorkout
  deleted?: boolean
  id?: string
  verified: true
  context?: TrainingContext
}
export type AnnotationAttempt = {
  method: "POST" | "PUT" | "DELETE"
  path: string
  body: {
    operationId: string
    revision?: string
    entry?: TransportEntry
    reconcileOnly?: boolean
  }
}
export const availabilitySports = calendarAvailabilitySports
export const availabilityReasons = calendarAvailabilityReasons
export const validAnnotationDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
export function newAnnotation(
  kind: AnnotationKind,
  date: string
): AnnotationEntry {
  return {
    kind,
    date,
    endDate: date,
    title: kind === "goals" ? "Goals" : "Unavailable",
    goals:
      kind === "goals" ? [{ id: randomId(), text: "", completed: false }] : [],
    mode: "unavailable",
    sports: [],
    reason: "None",
    description: "",
  }
}
export function annotationEntry(
  row: Partial<AnnotationEntry> &
    Pick<AnnotationEntry, "kind" | "date" | "endDate">
): AnnotationEntry {
  return {
    kind: row.kind,
    date: row.date,
    endDate: row.endDate,
    title:
      row.title ||
      (row.kind === "goals"
        ? "Goals"
        : row.mode === "limited"
          ? "Limited Availability"
          : "Unavailable"),
    goals: (row.goals || []).map((item) => ({ ...item })),
    mode: row.mode || "unavailable",
    sports: [...(row.sports || [])],
    reason: row.reason || "None",
    description: row.description || "",
  }
}
export function annotationTransportEntry(entry: AnnotationEntry) {
  return entry.kind === "goals"
    ? {
        kind: entry.kind,
        date: entry.date,
        endDate: entry.endDate,
        title: entry.title,
        goals: entry.goals.filter((goal) => goal.text.trim()),
      }
    : {
        kind: entry.kind,
        date: entry.date,
        endDate: entry.endDate,
        mode: entry.mode,
        sports: entry.mode === "unavailable" ? [] : entry.sports,
        reason: entry.reason,
        description: entry.description,
      }
}
export function annotationProblem(entry: AnnotationEntry): string | null {
  if (entry.kind === "goals" && !entry.goals.some((goal) => goal.text.trim()))
    return "Add at least one goal before saving. Empty rows are ignored."
  try {
    validateCalendarAnnotationEntry(annotationTransportEntry(entry))
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : "Check this calendar entry."
  }
}
export function validateAnnotation(value: unknown): CalendarAnnotation {
  if (!isCalendarAnnotation(value))
    throw new Error("The calendar entry response is incomplete.")
  return { ...value, ...annotationEntry(value) }
}
export class AnnotationError extends Error {
  status?: number
  code?: string
  uncertain: boolean
  constructor(
    message: string,
    options: { status?: number; code?: string; uncertain?: boolean } = {}
  ) {
    super(message)
    Object.assign(this, options)
    this.uncertain = options.uncertain ?? false
  }
}
export function createAnnotationAttempt(
  entry: AnnotationEntry,
  row: CalendarAnnotation | null,
  operationId = randomId()
): AnnotationAttempt {
  const problem = annotationProblem(entry)
  if (problem) throw new Error(problem)
  return {
    method: row ? "PUT" : "POST",
    path: `/api/calendar/annotations${row ? `/${encodeURIComponent(row.id)}` : ""}`,
    body: {
      operationId,
      ...(row ? { revision: row.revision } : {}),
      entry: validateCalendarAnnotationEntry(annotationTransportEntry(entry)),
    },
  }
}
export function deleteAnnotationAttempt(
  row: CalendarAnnotation,
  operationId = randomId()
): AnnotationAttempt {
  return {
    method: "DELETE",
    path: `/api/calendar/annotations/${encodeURIComponent(row.id)}`,
    body: { operationId, revision: row.revision },
  }
}
export function createAnnotationClient(fetcher: typeof apiFetch = apiFetch) {
  return {
    read: (id: string, signal?: AbortSignal) =>
      withRequestDeadline(
        async (requestSignal) => {
          if (!/^event:[1-9]\d*$/.test(id))
            throw new Error("Choose a saved calendar entry.")
          const response = await fetcher(
            `/api/calendar/annotations/${encodeURIComponent(id)}`,
            { signal: requestSignal, cache: "no-store" }
          )
          const value = await response.json()
          if (!response.ok)
            throw new AnnotationError(
              value.error || "The calendar entry could not be loaded.",
              { status: response.status, code: value.code }
            )
          const row = validateAnnotation(value)
          if (row.id !== id)
            throw new Error(
              "The calendar entry response belongs to another record."
            )
          return row
        },
        60_000,
        signal
      ),
    write: async (attempt: AnnotationAttempt) => {
      try {
        return await withRequestDeadline(
          async (signal) => {
            const response = await fetcher(attempt.path, {
              method: attempt.method,
              signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(attempt.body),
            })
            const value = await response.json()
            if (!response.ok)
              throw new AnnotationError(
                value.error ||
                  "The calendar entry could not be saved. Your draft is retained.",
                {
                  status: response.status,
                  code: value.code,
                  uncertain: response.status >= 500,
                }
              )
            if (
              value.verified !== true ||
              !/^event:[1-9]\d*$/.test(value.workoutId) ||
              (attempt.method === "DELETE"
                ? value.deleted !== true
                : !value.annotation)
            )
              throw new AnnotationError(
                "The result needs confirmation. Recheck the retained request.",
                { uncertain: true }
              )
            if (attempt.method !== "DELETE")
              value.annotation = validateAnnotation(value.annotation)
            const expectedId =
              attempt.method === "POST"
                ? value.workoutId
                : decodeURIComponent(attempt.path.split("/").pop()!)
            if (
              value.workoutId !== expectedId ||
              (value.annotation &&
                (value.annotation.id !== expectedId ||
                  (attempt.body.entry &&
                    (value.annotation.kind !== attempt.body.entry.kind ||
                      value.annotation.date !== attempt.body.entry.date ||
                      value.annotation.endDate !==
                        attempt.body.entry.endDate))))
            )
              throw new AnnotationError(
                "The confirmed response does not match this request. Recheck the retained operation.",
                { uncertain: true }
              )
            if (
              attempt.body.entry &&
              value.annotation &&
              JSON.stringify(
                validateCalendarAnnotationEntry(
                  annotationTransportEntry(value.annotation)
                )
              ) !==
                JSON.stringify(
                  validateCalendarAnnotationEntry(attempt.body.entry)
                )
            )
              throw new AnnotationError(
                "The saved entry differs from this draft. Recheck the retained operation before editing again.",
                { uncertain: true }
              )
            if (
              attempt.method === "DELETE" &&
              value.id !== undefined &&
              value.id !== expectedId
            )
              throw new AnnotationError(
                "The delete response belongs to another entry. Recheck the retained operation.",
                { uncertain: true }
              )
            if (value.workout && value.workout.id !== value.workoutId)
              throw new AnnotationError(
                "The workout response belongs to another entry. Recheck the retained operation.",
                { uncertain: true }
              )
            return value as AnnotationResult
          },
          60_000,
          undefined,
          "The save needs confirmation. Recheck the retained request."
        )
      } catch (error) {
        if (error instanceof AnnotationError) throw error
        throw new AnnotationError(
          error instanceof Error
            ? error.message
            : "The save needs confirmation.",
          { uncertain: true }
        )
      }
    },
  }
}
export const annotationClient = createAnnotationClient()
type Recovery = { attempt: AnnotationAttempt; draft: AnnotationEntry }
const recoveries = new Map<string, Recovery | null>()
export const annotationRecoveryKey = (
  scope: string,
  kind: AnnotationKind,
  identity: string
) => `calendar-annotation-pending-v1:${JSON.stringify([scope, kind, identity])}`
export function rememberAnnotationRecovery(key: string, value: Recovery,options:{requireStorage?:boolean}={}) {
  const retained=structuredClone(value)
  if(options.requireStorage){
    try{localStorage.setItem(key,JSON.stringify(retained))}
    catch{throw Error("The delete recovery could not be saved. No delete request was sent.")}
    recoveries.set(key,retained)
    return
  }
  recoveries.set(key, retained)
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* Live recovery remains available if optional storage is blocked. */
  }
}
export function clearAnnotationRecovery(key: string) {
  recoveries.set(key, null)
  try {
    localStorage.removeItem(key)
  } catch {
    /* Optional recovery storage. */
  }
}
export function readAnnotationRecovery(key: string): Recovery | null {
  if (recoveries.has(key)) return recoveries.get(key) || null
  try {
    const saved = JSON.parse(
      localStorage.getItem(key) || "null"
    ) as Recovery | null
    if (
      !saved ||
      !saved.draft ||
      (saved.attempt?.method !== "DELETE" && annotationProblem(saved.draft)) ||
      !["POST", "PUT", "DELETE"].includes(saved.attempt?.method) ||
      !/^\/api\/calendar\/annotations(?:\/event%3A[1-9]\d*)?$/.test(
        saved.attempt.path
      ) ||
      !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
        saved.attempt.body.operationId
      )
    )
      return null
    if (
      saved.attempt.method !== "POST" &&
      (typeof saved.attempt.body.revision !== "string" ||
        !/^[a-f0-9]{64}$/.test(saved.attempt.body.revision))
    )
      return null
    if (saved.attempt.method !== "DELETE") {
      const normalized = validateCalendarAnnotationEntry(
        saved.attempt.body.entry
      )
      if (
        JSON.stringify(normalized) !==
        JSON.stringify(
          validateCalendarAnnotationEntry(annotationTransportEntry(saved.draft))
        )
      )
        return null
    }
    return saved
  } catch {
    return null
  }
}

/** Locate an uncertain create using its native opaque creation identity. */
export function findAnnotationCreationRecovery(
  scope: string,
  kind: AnnotationKind,
  creationId?: string
) {
  if (!creationId) return null
  const prefix = `calendar-annotation-pending-v1:[${JSON.stringify(scope)},${JSON.stringify(kind)},`
  const keys = new Set(
    [...recoveries.keys()].filter((key) => key.startsWith(prefix))
  )
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix)) keys.add(key)
    }
  } catch {
    /* Memory recovery remains available. */
  }
  for (const key of keys) {
    const recovery = readAnnotationRecovery(key)
    if (
      recovery?.attempt.method === "POST" &&
      recovery.attempt.body.operationId === creationId
    )
      return { key, recovery }
  }
  return null
}
