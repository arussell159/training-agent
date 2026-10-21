import {
  annotationDate,
  shiftAnnotationDate,
  validateCalendarAnnotationEntry,
} from "./calendar-annotations-model.mjs";
import { validateRaceEventDetails } from "./race-event-details-model.mjs";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export function validateCalendarEntryTransfer(value) {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) => !["kind", "action", "operationId", "date", "revision", "reconcileOnly"].includes(key)
    ) ||
    !["goals", "availability", "event"].includes(value.kind) ||
    !["copy", "move"].includes(value.action) ||
    !/^[a-zA-Z0-9_-]{16,80}$/.test(value.operationId || "") ||
    !/^[a-f0-9]{64}$/.test(value.revision || "") ||
    (value.reconcileOnly !== undefined && typeof value.reconcileOnly !== "boolean")
  )
    throw Object.assign(Error("Choose a valid calendar entry transfer and retain its identity."), {
      status: 400,
      code: "ENTRY_TRANSFER_INVALID",
    });
  return {
    kind: value.kind,
    action: value.action,
    operationId: value.operationId,
    date: annotationDate(value.date),
    revision: value.revision,
  };
}
export function calendarEntryTransferValue(kind, row, date, action = "move") {
  annotationDate(date);
  if (!object(row) || (row.kind && row.kind !== kind))
    throw Error("The calendar entry kind differs from this transfer.");
  if (kind === "event")
    return validateRaceEventDetails({
      ...Object.fromEntries(
        ["name", "priority", "eventType", "raceDistance", "atpEventType", "description", "goals"]
          .filter((key) => row[key] !== undefined)
          .map((key) => [key, structuredClone(row[key])])
      ),
      date,
      ...(action === "copy" ? { priority: "", raceDistance: "" } : {}),
    });
  const start = annotationDate(row.date),
    end = annotationDate(row.endDate),
    days = (Date.parse(date + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / 86400000;
  return validateCalendarAnnotationEntry(
    kind === "goals"
      ? {
          kind,
          date,
          endDate: date,
          title: row.title,
          goals: structuredClone(row.goals).map((goal) =>
            action === "copy" ? { ...goal, completed: false } : goal
          ),
        }
      : {
          kind,
          date,
          endDate: shiftAnnotationDate(end, days),
          mode: row.mode,
          sports: structuredClone(row.sports),
          reason: row.reason,
          description: row.description,
        }
  );
}
