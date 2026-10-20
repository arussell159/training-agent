import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
import { calendarCopyBody, eventId, validDate } from "./intervals.mjs";

const fail = (message, status = 502, code = "COPY_UNCONFIRMED") => {
  throw Object.assign(new Error(message), { status, code });
};
const same = (a, b) =>
  typeof b === "number"
    ? typeof a === "number" && Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-6
    : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// One encrypted CAS record per paste item. After an attempt is claimed, every
// caller (including another Vercel instance) may only read back that same copy.
export async function copyCalendarWorkout(config, request, id, input, options = {}) {
  const sourceId = options.sourceId || `event:${eventId(id)}`;
  const { creationId, date } = input;
  validDate(date);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(creationId || "")
  )
    fail("A valid paste identity is required.", 400, "INVALID_COPY");
  const record =
    options.record ||
    createEncryptedRecordStore(config, `${providerConnection(config)}/copy/${creationId}`, {
      namespace: "calendar-copy",
      name: "CALENDAR_COPY",
      fresh: () => ({ operation: null }),
      timestampCas: true,
    });
  const prior = (await record.read()).operation;
  let body;
  if (!prior) {
    const original = options.loadSource
      ? await options.loadSource()
      : await request(`/athlete/0/events/${eventId(sourceId)}`);
    body = {
      ...calendarCopyBody(original, date),
      external_id: `training-agent:copy:${creationId}`,
    };
  }
  const operation = await record.update((state) => {
    if (state.operation) {
      if (state.operation.sourceId !== sourceId || state.operation.date !== date)
        fail(
          "This paste is already bound to another workout or date. Recheck its original destination.",
          409,
          "COPY_CONFLICT"
        );
      return structuredClone(state.operation);
    }
    if (!body) fail("The paste intent could not be recovered.");
    state.operation = {
      sourceId,
      date,
      body,
      state: "prepared",
      createdAt: new Date().toISOString(),
    };
    return structuredClone(state.operation);
  });
  const find = async () => {
    const events = await request(`/athlete/0/events?oldest=${date}&newest=${date}`);
    const matches = (events || []).filter(
      (event) => event.external_id === operation.body.external_id
    );
    if (matches.length > 1)
      fail("Multiple copies match this paste. Review the calendar before continuing.");
    return matches[0];
  };
  const verify = async (candidate) => {
    const value = eventId(`event:${candidate.id}`);
    if (sourceId.startsWith("event:") && value === eventId(sourceId))
      fail("The provider did not create a separate copy.");
    const event = await request(`/athlete/0/events/${value}`);
    if (Object.entries(operation.body).some(([key, value]) => !same(event[key], value)))
      fail(
        "The copied workout differs from the saved paste intent. Recheck the original paste before repeating it."
      );
    if (operation.state !== "verified" || String(operation.eventId) !== value)
      await record.update((state) => {
        state.operation.state = "verified";
        state.operation.eventId = value;
      });
    return { workoutId: `event:${value}`, verified: true, action: "copy", event };
  };
  if (operation.eventId) return verify({ id: operation.eventId });
  const existing = await find();
  if (existing) return verify(existing);
  if (input.reconcileOnly)
    fail(
      "Scheduling is not confirmed yet. Recheck this same request; rechecking will not create another workout."
    );
  const claimed =
    (operation.state === "prepared" ||
      (operation.state === "rejected" && input.retryRejected === true)) &&
    (await record.update((state) => {
      if (
        state.operation.state !== "prepared" &&
        !(state.operation.state === "rejected" && input.retryRejected === true)
      )
        return false;
      state.operation.state = "attempted";
      return true;
    }));
  if (!claimed) {
    if (operation.state === "rejected")
      fail(
        "Intervals.icu rejected this copy. Clear the paste and copy the workout again after correcting the issue.",
        422,
        "COPY_REJECTED"
      );
    fail(
      "The paste is not confirmed yet. Recheck this same paste; rechecking will not create another workout."
    );
  }
  let created;
  try {
    created = await request("/athlete/0/events", {
      method: "POST",
      body: JSON.stringify(operation.body),
    });
  } catch (error) {
    if ([400, 401, 403, 422].includes(error.status)) {
      await record.update((state) => {
        state.operation.state = "rejected";
      });
      fail(
        "Intervals.icu rejected the copy. Check calendar permissions before copying again.",
        error.status,
        "COPY_REJECTED"
      );
    }
    try {
      const recovered = await find();
      if (recovered) return await verify(recovered);
    } catch {
      /* An uncertain POST is never repeated. */
    }
    fail(
      "The paste could not be confirmed. Recheck this same paste; rechecking will not create another workout."
    );
  }
  if (!created?.id) fail("The paste could not be confirmed. Recheck this same paste.");
  await record.update((state) => {
    state.operation.eventId = eventId(`event:${created.id}`);
  });
  return verify(created);
}
