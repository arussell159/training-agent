import type { CalendarAnnotationEntry, CalendarAnnotation } from "./calendar-annotations-model.mjs";
import type { RaceEventDetails } from "./race-event-details-model.mjs";
export type CalendarEntryTransferKind = "goals" | "availability" | "event";
export type CalendarEntryTransferInput = {
  kind: CalendarEntryTransferKind;
  action: "copy" | "move";
  operationId: string;
  date: string;
  revision: string;
  reconcileOnly?: boolean;
};
export function validateCalendarEntryTransfer(
  value: unknown
): Omit<CalendarEntryTransferInput, "reconcileOnly">;
export function calendarEntryTransferValue(
  kind: CalendarEntryTransferKind,
  row: CalendarAnnotationEntry | CalendarAnnotation | RaceEventDetails,
  date: string,
  action?: "copy" | "move"
): CalendarAnnotationEntry | RaceEventDetails;
