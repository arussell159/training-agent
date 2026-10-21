import { eventId, validDate } from "./intervals.mjs";
import { workoutRevision } from "./workout-editor.mjs";
import { raceEventKey } from "./race-event-details-model.mjs";

const fail = (message, status = 400, code = "INVALID_NOTE") => {
  throw Object.assign(new Error(message), { status, code });
};
function editable(event) {
  if (raceEventKey(event?.external_id))
    fail("Open this Event in its own editor.", 403, "EVENT_NOTE_ROUTE");
  if (/^training-agent:annotation:/.test(event?.external_id || ""))
    fail("Open this Goals or Availability entry in its own editor.", 403, "READ_ONLY");
  if (event?.category !== "NOTE") fail("Only calendar notes can be edited here.", 403, "READ_ONLY");
  if (event.read_only || event.readonly || event.editable === false || event.athlete_cannot_edit)
    fail("This calendar note is read-only in Intervals.icu.", 403, "READ_ONLY");
}
function fields(input) {
  validDate(input.date);
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 200)
    fail("Enter a note title under 200 characters.");
  if (typeof input.description !== "string" || input.description.length > 12000)
    fail("Note text must be under 12,000 characters.");
  return {
    name: input.name.trim(),
    description: input.description,
    start_date_local: `${input.date}T00:00:00`,
  };
}
function result(event) {
  return {
    workoutId: `event:${event.id}`,
    event,
    revision: workoutRevision(event),
    verified: true,
  };
}
function verify(event, expected) {
  if (
    event?.category !== "NOTE" ||
    Object.entries(expected).some(([key, value]) => event[key] !== value)
  )
    fail(
      "Intervals.icu did not confirm the note save. Your draft is retained; retry checks the same note.",
      502,
      "SAVE_UNCONFIRMED"
    );
  return result(event);
}
export async function loadCalendarNote(request, id, { assertNotAppEvent } = {}) {
  const event = await request(`/athlete/0/events/${eventId(id)}`);
  editable(event);
  await assertNotAppEvent?.(id, event);
  return {
    name: event.name || "Note",
    description: event.description || "",
    date: String(event.start_date_local).slice(0, 10),
    revision: workoutRevision(event),
  };
}
export async function saveCalendarNote(request, id, input, { assertNotAppEvent } = {}) {
  const expected = fields(input);
  const path = `/athlete/0/events/${eventId(id)}`;
  const current = await request(path);
  editable(current);
  await assertNotAppEvent?.(id, current);
  const oldDate = String(current.start_date_local).slice(0, 10);
  validDate(oldDate);
  expected.start_date_local =
    input.date + (String(current.start_date_local).slice(10) || "T00:00:00");
  if (current.end_date_local) {
    const endDate = String(current.end_date_local).slice(0, 10);
    validDate(endDate);
    const delta = Date.parse(`${input.date}T00:00:00Z`) - Date.parse(`${oldDate}T00:00:00Z`);
    expected.end_date_local =
      new Date(Date.parse(`${endDate}T00:00:00Z`) + delta).toISOString().slice(0, 10) +
      String(current.end_date_local).slice(10);
  }
  if (Object.entries(expected).every(([key, value]) => current[key] === value))
    return verify(current, expected);
  if (!input.revision || input.revision !== workoutRevision(current))
    fail(
      "This note changed in Intervals.icu. Reload it before saving; your draft is retained.",
      409,
      "CONFLICT"
    );
  try {
    await request(path, { method: "PUT", body: JSON.stringify(expected) });
  } catch (error) {
    if (error.status >= 400 && error.status < 500) throw error;
  }
  return verify(await request(path), expected);
}

const creations = new Map();
export async function createCalendarNote(request, input, scope = "default") {
  const expected = {
    ...fields(input),
    category: "NOTE",
    external_id: `training-agent:note:${input.creationId}`,
  };
  if (!/^[0-9a-f-]{36}$/i.test(input.creationId || "")) fail("A note creation ID is required.");
  const key = `${scope}:${input.creationId}`;
  const job = (creations.get(key) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const find = async () =>
        ((await request(`/athlete/0/events?oldest=${input.date}&newest=${input.date}`)) || []).find(
          (event) => event.external_id === expected.external_id
        );
      const readback = async (event) =>
        verify(await request(`/athlete/0/events/${eventId(`event:${event.id}`)}`), expected);
      const prior = await find();
      if (prior) return readback(prior);
      if (input.reconcileOnly)
        fail(
          "Creation is not confirmed yet. Recheck this same draft before starting another note.",
          502,
          "CREATE_UNCONFIRMED"
        );
      let created;
      try {
        created = await request("/athlete/0/events", {
          method: "POST",
          body: JSON.stringify(expected),
        });
      } catch (error) {
        if (error.status >= 400 && error.status < 500) throw error;
        created = await find();
      }
      if (!created?.id)
        fail(
          "Note creation could not be confirmed. Recheck uses the same draft without creating a duplicate.",
          502,
          "CREATE_UNCONFIRMED"
        );
      return readback(created);
    });
  creations.set(key, job);
  try {
    return await job;
  } finally {
    if (creations.get(key) === job) creations.delete(key);
  }
}
