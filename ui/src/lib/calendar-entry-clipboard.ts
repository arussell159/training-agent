import {
  calendarEntryTransferValue,
  validateCalendarEntryTransfer,
  type CalendarEntryTransferKind,
} from "../../../app-backend/lib/calendar-entry-transfer-model.mjs"
import {
  validateCalendarEntryTransferRow,
  type CalendarEntryTransferAttempt,
  type CalendarEntryTransferRow,
} from "./calendar-entry-transfer.ts"

export type CalendarEntryClipboard = {
  kind: "entry"
  mode: "copy" | "cut"
  workoutIds: [string]
  label: string
  entryKind: CalendarEntryTransferKind
  row: CalendarEntryTransferRow
  entryAttempt?: CalendarEntryTransferAttempt
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
export function validateCalendarEntryClipboard(
  value: unknown
): CalendarEntryClipboard {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "kind",
          "mode",
          "workoutIds",
          "label",
          "entryKind",
          "row",
          "entryAttempt",
        ].includes(key)
    ) ||
    value.kind !== "entry" ||
    !["copy", "cut"].includes(String(value.mode)) ||
    !["goals", "availability", "event"].includes(String(value.entryKind)) ||
    typeof value.label !== "string" ||
    value.label.length > 1000 ||
    !Array.isArray(value.workoutIds) ||
    value.workoutIds.length !== 1
  )
    throw Error(
      "The saved calendar clipboard could not be verified. Keep its recovery identity before replacing it."
    )
  const kind = value.entryKind as CalendarEntryTransferKind,
    row = validateCalendarEntryTransferRow(kind, value.row)
  if (value.workoutIds[0] !== row.id || !row.editable || !row.metadataCurrent)
    throw Error("The saved calendar source could not be verified.")
  if (value.entryAttempt !== undefined) {
    const attempt = value.entryAttempt
    if (
      !object(attempt) ||
      Object.keys(attempt).some(
        (key) => !["sourceId", "body", "expected"].includes(key)
      ) ||
      attempt.sourceId !== row.id
    )
      throw Error("The saved paste belongs to another source.")
    const body = validateCalendarEntryTransfer(attempt.body)
    if (
      body.kind !== kind ||
      body.revision !== row.revision ||
      body.action !== (value.mode === "cut" ? "move" : "copy") ||
      JSON.stringify(body) !== JSON.stringify(attempt.body) ||
      JSON.stringify(
        calendarEntryTransferValue(kind, row, body.date, body.action)
      ) !== JSON.stringify(attempt.expected)
    )
      throw Error(
        "The saved paste differs from its original calendar selection."
      )
  }
  return structuredClone(value) as CalendarEntryClipboard
}
