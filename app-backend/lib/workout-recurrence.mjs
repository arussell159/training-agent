import { normalizeRecurrenceRule, recurrenceDates } from "./workout-recurrence-rule.mjs";
export { normalizeRecurrenceRule, recurrenceDates } from "./workout-recurrence-rule.mjs";
import { createHash, randomUUID } from "node:crypto";
import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
import { copyCalendarWorkout } from "./calendar-workout-copy.mjs";
import {
  assertEditableCalendarEvent,
  changeIntervalsEvent,
  eventId,
  validDate,
} from "./intervals.mjs";
import { athleteLocalDate } from "./athlete-date.mjs";
import { workoutRevision } from "./workout-editor.mjs";

const fail = (message, status = 400, code = "RECURRENCE_INVALID") => {
  throw Object.assign(new Error(message), { status, code });
};
const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");

const clone = (value) => globalThis.structuredClone(value);

export function recurrenceCreationId(operationId, date) {
  const hex = createHash("sha256")
    .update(`workout-recurrence:${operationId}:${date}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function createWorkoutRecurrenceStore(config) {
  return createEncryptedRecordStore(config, providerConnection(config), {
    namespace: "workout-recurrence",
    name: "WORKOUT_RECURRENCE",
    fresh: () => ({ series: {} }),
    timestampCas: true,
  });
}
const findSeries = (state, id) =>
  Object.values(state.series || {}).find(
    (series) => series.sourceId === id || series.occurrences.some((item) => item.workoutId === id)
  );
function publicSeries(series) {
  if (!series) return null;
  return {
    id: series.id,
    sourceId: series.sourceId,
    rule: series.rule,
    revision: series.revision,
    status: series.status,
    occurrences: series.occurrences.map(({ date, workoutId, state }) => ({
      date,
      workoutId,
      state,
    })),
    pendingOperationId: series.operation?.complete ? null : series.operation?.id,
    pendingAction: series.operation?.complete ? null : series.operation?.action,
    pendingFromDate: series.operation?.complete ? null : series.operation?.fromDate,
    error: series.operation?.error || null,
    remaining: series.operation?.actions.filter((action) => !action.done).length || 0,
    protectedCount: series.occurrences.filter((item) => item.state === "protected").length,
  };
}
export async function loadWorkoutRecurrence(config, id, options = {}) {
  eventId(id);
  const store = options.store || createWorkoutRecurrenceStore(config);
  return { series: publicSeries(findSeries(await store.read(), id)) };
}

/**
 * Each request makes a bounded amount of progress. The same operation identity
 * resumes across processes; individual provider creations retain durable CAS
 * claims through copyCalendarWorkout. A missing response can never cause a
 * second POST. Completed/individually edited occurrences are preserved.
 */
export async function saveWorkoutRecurrence(config, request, id, input, options = {}) {
  eventId(id);
  if (!uuid(input?.operationId)) fail("A valid repeat operation identity is required.");
  const cancelling = input.action === "cancel";
  const rule = cancelling ? null : normalizeRecurrenceRule(input.rule);
  const dates = rule ? recurrenceDates(rule) : [];
  const today =
    options.today || athleteLocalDate(new Date(), config.TIME_ZONE || "America/Chicago");
  const store = options.store || createWorkoutRecurrenceStore(config);
  const existing = findSeries(await store.read(), id);
  const sameOperation = existing?.operation?.id === input.operationId;
  const fromDate = input.fromDate || (sameOperation ? existing.operation.fromDate : today);
  validDate(fromDate);
  if (!sameOperation && fromDate < today)
    fail("Only today's and future occurrences can be changed.");
  if (!sameOperation && rule && rule.startDate < today)
    fail("Choose today or a future date as the first repeat date.");
  if (!sameOperation && existing && !existing.operation.complete)
    fail(
      "Finish or recheck the pending repeat request before changing this series.",
      409,
      "RECURRENCE_PENDING"
    );
  let source;
  if (!sameOperation && !cancelling) {
    source = await request(`/athlete/0/events/${eventId(id)}`);
    assertEditableCalendarEvent(source);
    if (source.category !== "WORKOUT") fail("Only planned workouts can repeat.");
  }
  const seriesId = existing?.id || input.operationId;
  const series = await store.update((state) => {
    state.series ||= {};
    let current = findSeries(state, id);
    if (current?.operation?.id === input.operationId) {
      if (
        current.operation.action !== (cancelling ? "cancel" : "schedule") ||
        current.operation.fromDate !== fromDate ||
        (!cancelling && JSON.stringify(current.operation.rule) !== JSON.stringify(rule))
      )
        fail(
          "This repeat request is already bound to another schedule.",
          409,
          "RECURRENCE_CONFLICT"
        );
      return clone(current);
    }
    if (current) {
      if (!current.operation.complete)
        fail("Another repeat request is still pending.", 409, "RECURRENCE_PENDING");
      if (input.revision !== current.revision)
        fail("The repeat schedule changed. Reload it before saving.", 409, "RECURRENCE_CONFLICT");
    } else {
      if (cancelling) fail("This workout has no repeat schedule.", 404);
      if (Object.keys(state.series).length >= 100)
        fail("This account has reached its 100-series limit.");
      current = {
        id: seriesId,
        sourceId: id,
        sourceDate: String(source.start_date_local || "").slice(0, 10),
        revision: 0,
        occurrences: [],
      };
      state.series[seriesId] = current;
    }
    const active = current.occurrences.filter(
      (item) => !["deleted", "expired"].includes(item.state)
    );
    const sourceDate = String(source?.start_date_local || "").slice(0, 10);
    if (source && id === current.sourceId) current.sourceDate = sourceDate;
    const wanted = new Set(dates.filter((date) => date >= fromDate && date !== current.sourceDate));
    const actions = [];
    for (const occurrence of active) {
      if (
        occurrence.date >= fromDate &&
        occurrence.workoutId !== id &&
        (cancelling || !wanted.has(occurrence.date))
      )
        actions.push({ kind: "delete", creationId: occurrence.creationId, done: false });
      else wanted.delete(occurrence.date);
    }
    if (!cancelling)
      for (const date of wanted) {
        const creationId = recurrenceCreationId(input.operationId, date);
        current.occurrences.push({ date, creationId, state: "pending", workoutId: null });
        actions.push({ kind: "create", creationId, done: false });
      }
    current.revision++;
    current.status = cancelling ? "cancelling" : "scheduling";
    current.operation = {
      id: input.operationId,
      action: cancelling ? "cancel" : "schedule",
      rule,
      fromDate,
      sourceId: id,
      source,
      actions,
      complete: false,
      error: null,
      lease: null,
    };
    if (rule) current.rule = rule;
    return clone(current);
  });
  if (series.operation.complete)
    return { verified: true, series: publicSeries(series), changes: [] };
  const leaseId = randomUUID();
  await store.update((state) => {
    const operation = state.series[seriesId].operation;
    if (operation.id !== input.operationId)
      fail("This repeat request was replaced.", 409, "RECURRENCE_CONFLICT");
    if (operation.lease?.expires > Date.now())
      fail("This repeat request is being processed. Recheck in a moment.", 409, "RECURRENCE_BUSY");
    operation.lease = { id: leaseId, expires: Date.now() + 90_000 };
    operation.error = null;
  });
  const changes = [];
  try {
    const pending = series.operation.actions
      .filter((action) => !action.done)
      .slice(0, options.batchSize || 4);
    for (const action of pending) {
      const current = (await store.read()).series[seriesId];
      const occurrence = current.occurrences.find((item) => item.creationId === action.creationId);
      let receipt,
        protectedOccurrence = false,
        expiredOccurrence = false;
      try {
        if (action.kind === "create") {
          // A resumed request may span midnight. Reconcile any previously
          // attempted copy, but never initiate a new workout in the past.
          const reconcileOnly = occurrence.date < today;
          const copyRecord = options.copyRecordFor
            ? options.copyRecordFor(occurrence.creationId)
            : createEncryptedRecordStore(
                config,
                `${providerConnection(config)}/copy/${occurrence.creationId}`,
                {
                  namespace: "calendar-copy",
                  name: "CALENDAR_COPY",
                  fresh: () => ({ operation: null }),
                  timestampCas: true,
                }
              );
          const priorCopy = reconcileOnly ? (await copyRecord.read()).operation : null;
          expiredOccurrence =
            reconcileOnly && (!priorCopy || ["prepared", "rejected"].includes(priorCopy.state));
          if (!expiredOccurrence)
            receipt = await copyCalendarWorkout(
              config,
              request,
              null,
              {
                creationId: occurrence.creationId,
                date: occurrence.date,
                retryRejected: true,
                reconcileOnly,
              },
              {
                record: copyRecord,
                sourceId: `recurrence:${seriesId}:${current.operation.id}`,
                loadSource: async () => current.operation.source,
              }
            );
        } else {
          let event;
          try {
            event = await request(`/athlete/0/events/${eventId(occurrence.workoutId)}`);
          } catch (error) {
            if (error.status !== 404) throw error;
          }
          if (
            event &&
            (occurrence.date < today ||
              event.paired_activity_id ||
              event.category !== "WORKOUT" ||
              workoutRevision(event) !== occurrence.revision)
          ) {
            protectedOccurrence = true;
          } else {
            receipt = await (options.deleteWorkout
              ? options.deleteWorkout(occurrence.workoutId, occurrence.revision)
              : changeIntervalsEvent(request, occurrence.workoutId, "delete"));
          }
        }
        await store.update((state) => {
          const value = state.series[seriesId],
            operation = value.operation;
          if (operation.id !== input.operationId || operation.lease?.id !== leaseId)
            fail("The repeat request must be rechecked.", 409, "RECURRENCE_BUSY");
          const item = value.occurrences.find((item) => item.creationId === action.creationId);
          if (expiredOccurrence) item.state = "expired";
          else if (action.kind === "create")
            Object.assign(item, {
              state: "scheduled",
              workoutId: receipt.workoutId,
              revision: workoutRevision(receipt.event),
            });
          else item.state = protectedOccurrence ? "protected" : "deleted";
          operation.actions.find(
            (item) => item.creationId === action.creationId && item.kind === action.kind
          ).done = true;
          operation.lease.expires = Date.now() + 90_000;
        });
        if (receipt) changes.push(receipt);
      } catch (error) {
        await store.update((state) => {
          const operation = state.series[seriesId].operation;
          if (operation.id === input.operationId && operation.lease?.id === leaseId)
            operation.error = error.message
              .replace(/\bpaste\b/gi, "repeat request")
              .replace(/\bcopied\b/gi, "repeated");
        });
        break;
      }
    }
  } finally {
    await store.update((state) => {
      const current = state.series[seriesId],
        operation = current.operation;
      if (operation.id !== input.operationId || operation.lease?.id !== leaseId) return;
      operation.lease = null;
      operation.complete = operation.actions.every((action) => action.done);
      if (operation.complete) {
        current.status = cancelling ? "cancelled" : "active";
        delete operation.source;
      }
    });
  }
  const updated = (await store.read()).series[seriesId];
  return { verified: updated.operation.complete, series: publicSeries(updated), changes };
}
