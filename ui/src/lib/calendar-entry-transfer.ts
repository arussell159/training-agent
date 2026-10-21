import { apiFetch } from "./api-client.ts"
import { randomId } from "./random-id.ts"
import { withRequestDeadline } from "./request-deadline.ts"
import {
  validatedTrainingContext,
  validatedTrainingWorkout,
} from "./training-context-validation.ts"
import type { PlannedWorkout, TrainingContext } from "./training-context"
import type { AnnualPlan } from "./annual-plan"
import type { RaceEventRead } from "./race-event-details.ts"
import {
  isCalendarAnnotation,
  type CalendarAnnotation,
} from "../../../app-backend/lib/calendar-annotations-model.mjs"
import {
  calendarEntryTransferValue,
  validateCalendarEntryTransfer,
  type CalendarEntryTransferInput,
  type CalendarEntryTransferKind,
} from "../../../app-backend/lib/calendar-entry-transfer-model.mjs"

export type CalendarEntryTransferRow = CalendarAnnotation | RaceEventRead
export type CalendarEntryTransferAttempt = {
  sourceId: string
  body: CalendarEntryTransferInput
  expected: ReturnType<typeof calendarEntryTransferValue>
}
export type CalendarEntryTransferResult = {
  sourceId: string
  kind: CalendarEntryTransferKind
  action: "copy" | "move"
  operationId: string
  workoutId: string
  annotation?: CalendarAnnotation
  event?: RaceEventRead
  workout: PlannedWorkout
  verified: true
  context?: TrainingContext
  plan?: AnnualPlan | null
  planWarning?: string
  refreshWarning?: string
}
export class CalendarEntryTransferError extends Error {
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
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^event:[1-9]\d*$/.test(id)
export function validateCalendarEntryTransferRow(
  kind: CalendarEntryTransferKind,
  value: unknown
): CalendarEntryTransferRow {
  if (!value || typeof value !== "object")
    throw Error("The calendar entry response is incomplete.")
  const row = value as CalendarEntryTransferRow
  if (
    !validId(row.id) ||
    !/^[a-f0-9]{64}$/.test(row.revision) ||
    typeof row.editable !== "boolean" ||
    typeof row.metadataCurrent !== "boolean" ||
    (kind !== "event" && (!isCalendarAnnotation(row) || row.kind !== kind))
  )
    throw Error("The calendar entry response is incomplete.")
  calendarEntryTransferValue(kind, row, row.date)
  return row
}
export function createCalendarEntryTransferAttempt(
  kind: CalendarEntryTransferKind,
  row: CalendarEntryTransferRow,
  action: "copy" | "move",
  date: string,
  operationId = randomId()
): CalendarEntryTransferAttempt {
  validateCalendarEntryTransferRow(kind, row)
  if (!row.editable || !row.metadataCurrent)
    throw Error("Reload the authoritative entry before copying or moving it.")
  const body = validateCalendarEntryTransfer({
    kind,
    action,
    date,
    operationId,
    revision: row.revision,
  })
  return {
    sourceId: row.id,
    body,
    expected: calendarEntryTransferValue(kind, row, date, action),
  }
}
export function createCalendarEntryTransferClient(
  fetcher: typeof apiFetch = apiFetch
) {
  return {
    read: (kind: CalendarEntryTransferKind, id: string, signal?: AbortSignal) =>
      withRequestDeadline(
        async (requestSignal) => {
          if (!validId(id)) throw Error("Choose a saved calendar entry.")
          const response = await fetcher(
            `/api/${kind === "event" ? "race-events" : "calendar/annotations"}/${encodeURIComponent(id)}`,
            { signal: requestSignal, cache: "no-store" }
          )
          const value = await response.json()
          if (!response.ok)
            throw new CalendarEntryTransferError(
              value.error || "The entry could not be loaded.",
              { status: response.status, code: value.code }
            )
          const row = validateCalendarEntryTransferRow(
            kind,
            kind === "event" ? value.event : value
          )
          if (row.id !== id)
            throw Error("The loaded entry belongs to another identity.")
          return row
        },
        60_000,
        signal
      ),
    write: async (
      attempt: CalendarEntryTransferAttempt,
      options: { reconcileOnly?: boolean; signal?: AbortSignal } = {}
    ): Promise<CalendarEntryTransferResult> => {
      if (!validId(attempt.sourceId))
        throw Error("Choose a saved calendar entry.")
      const body = validateCalendarEntryTransfer(attempt.body)
      const expected = calendarEntryTransferValue(
        body.kind,
        attempt.expected,
        body.date
      )
      if (JSON.stringify(expected) !== JSON.stringify(attempt.expected))
        throw Error("The retained paste intent is invalid.")
      try {
        return await withRequestDeadline(
          async (signal) => {
            const response = await fetcher(
              `/api/calendar/entry-transfer/${encodeURIComponent(attempt.sourceId)}`,
              {
                method: "POST",
                signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...body,
                  ...(options.reconcileOnly ? { reconcileOnly: true } : {}),
                }),
              }
            )
            const result = await response.json()
            if (!response.ok)
              throw new CalendarEntryTransferError(
                result.error ||
                  "The paste could not be confirmed. Retain this operation before retrying.",
                {
                  status: response.status,
                  code: result.code,
                  uncertain:
                    options.reconcileOnly === true || response.status >= 500,
                }
              )
            const row = validateCalendarEntryTransferRow(
              body.kind,
              body.kind === "event" ? result.event : result.annotation
            )
            if (
              result.verified !== true ||
              result.sourceId !== attempt.sourceId ||
              result.kind !== body.kind ||
              result.action !== body.action ||
              result.operationId !== body.operationId ||
              !validId(result.workoutId) ||
              row.id !== result.workoutId ||
              row.date !== body.date ||
              (body.action === "move"
                ? row.id !== attempt.sourceId
                : row.id === attempt.sourceId) ||
              row.editable !== true ||
              row.metadataCurrent !== true ||
              JSON.stringify(
                calendarEntryTransferValue(body.kind, row, body.date)
              ) !== JSON.stringify(expected) ||
              !result.workout ||
              result.workout.id !== row.id ||
              result.workout.workout_date !== body.date ||
              (body.kind !== "event" &&
                (row as CalendarAnnotation).endDate !==
                  (expected as CalendarAnnotation).endDate)
            )
              throw Error(
                "The confirmed paste differs from the retained intent. Recheck the same operation before editing."
              )
            if (result.context != null)
              result.context = validatedTrainingContext(result.context)
            result.workout = validatedTrainingWorkout(result.workout)
            return result as CalendarEntryTransferResult
          },
          60_000,
          options.signal,
          "The paste needs confirmation. Recheck the retained operation."
        )
      } catch (error) {
        if (error instanceof CalendarEntryTransferError) throw error
        throw new CalendarEntryTransferError(
          error instanceof Error
            ? error.message
            : "The paste needs confirmation.",
          { uncertain: true }
        )
      }
    },
  }
}
