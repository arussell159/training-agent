import test from "node:test";
import assert from "node:assert/strict";
import { createCalendarNote, loadCalendarNote, saveCalendarNote } from "./calendar-notes.mjs";
import { changeIntervalsEvent, mapIntervalsWorkout, pairIntervalsWorkouts } from "./intervals.mjs";

function provider({ uncertain = false, corrupt = false } = {}) {
  const events = new Map(),
    calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path.includes("?")) return [...events.values()].map((event) => structuredClone(event));
    const body = options.body ? JSON.parse(options.body) : {};
    if (options.method === "POST") {
      const event = { ...body, id: 1 + events.size };
      events.set(event.id, event);
      if (uncertain) throw new Error("Lost reply after create");
      return structuredClone(event);
    }
    const id = Number(path.split("/").at(-1));
    if (options.method === "DELETE") {
      events.delete(id);
      return null;
    }
    if (!events.has(id)) throw Object.assign(new Error("Not found"), { status: 404 });
    if (options.method === "PUT") {
      events.set(id, { ...events.get(id), ...body, ...(corrupt ? { description: "wrong" } : {}) });
      if (uncertain) throw new Error("Lost reply after update");
    }
    return structuredClone(events.get(id));
  };
  return { events, calls, request };
}
const input = {
  name: "Recovery notes",
  description: "Easy day\nProtect sleep",
  date: "2026-10-14",
  creationId: "fc45932e-2c8c-4d81-994a-cea2f2d3dc3f",
};

test("notes create, load, edit and delete through verified provider endpoints", async () => {
  const mock = provider();
  const created = await createCalendarNote(mock.request, input);
  assert.equal(created.event.category, "NOTE");
  assert.equal(created.verified, true);
  assert.equal(mapIntervalsWorkout(created.event, input.date).category, "NOTE");
  const loaded = await loadCalendarNote(mock.request, created.workoutId);
  const edited = await saveCalendarNote(mock.request, created.workoutId, {
    ...loaded,
    name: "Changed note",
    date: "2026-10-15",
  });
  assert.equal(edited.event.name, "Changed note");
  assert.equal(edited.event.start_date_local, "2026-10-15T00:00:00");
  assert.equal(mock.events.size, 1);
  assert.equal(
    (await changeIntervalsEvent(mock.request, created.workoutId, "delete")).verified,
    true
  );
  assert.equal(mock.events.size, 0);
});

test("uncertain note creation and update reconcile without duplicate provider writes", async () => {
  const mock = provider({ uncertain: true });
  const created = await createCalendarNote(mock.request, input);
  const retry = await createCalendarNote(mock.request, { ...input, reconcileOnly: true });
  assert.equal(retry.workoutId, created.workoutId);
  assert.equal(mock.calls.filter((call) => call.method === "POST").length, 1);
  const loaded = await loadCalendarNote(mock.request, created.workoutId);
  const draft = { ...loaded, description: "Updated" };
  await saveCalendarNote(mock.request, created.workoutId, draft);
  await saveCalendarNote(mock.request, created.workoutId, draft);
  assert.equal(mock.calls.filter((call) => call.method === "PUT").length, 1);
});

test("note conflicts, read-only permissions and failed verification never report a successful save", async () => {
  const mock = provider();
  const created = await createCalendarNote(mock.request, input);
  const loaded = await loadCalendarNote(mock.request, created.workoutId);
  mock.events.get(1).description = "Remote change";
  await assert.rejects(
    saveCalendarNote(mock.request, created.workoutId, { ...loaded, description: "Draft" }),
    (error) => error.code === "CONFLICT"
  );
  mock.events.get(1).athlete_cannot_edit = true;
  await assert.rejects(
    saveCalendarNote(mock.request, created.workoutId, { ...loaded, description: "Draft" }),
    (error) => error.code === "READ_ONLY"
  );
  assert.equal(mock.calls.filter((call) => call.method === "PUT").length, 0);
  const bad = provider({ corrupt: true });
  const note = await createCalendarNote(bad.request, input);
  const latest = await loadCalendarNote(bad.request, note.workoutId);
  await assert.rejects(
    saveCalendarNote(bad.request, note.workoutId, { ...latest, description: "Intended" }),
    (error) => error.code === "SAVE_UNCONFIRMED"
  );
});

test("rechecking an unconfirmed note never repeats creation, and notes do not pair to activities", async () => {
  const mock = provider();
  await assert.rejects(
    createCalendarNote(mock.request, { ...input, reconcileOnly: true }),
    (error) => error.code === "CREATE_UNCONFIRMED"
  );
  assert.equal(mock.calls.filter((call) => call.method === "POST").length, 0);
  const event = { id: 1, ...input, type: "Other", category: "NOTE", start_date_local: input.date };
  assert.equal(pairIntervalsWorkouts([event], [{ ...event, id: "i1" }]).size, 0);
});
