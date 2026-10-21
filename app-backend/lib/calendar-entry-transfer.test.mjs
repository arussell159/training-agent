import test from "node:test";
import assert from "node:assert/strict";
import { createCalendarEntryTransferService } from "./calendar-entry-transfer.mjs";
import { createCalendarAnnotationsService } from "./calendar-annotations.mjs";
import { createRaceEventDetailsService } from "./race-event-details.mjs";
import { emptyRaceGoals } from "./race-event-details-model.mjs";
const sourceOperation = "7b5317a5-4ed9-499a-937e-854dbf385f38",
  copyOperation = "1db8f3fe-6985-4051-9c9e-52334a3d844a",
  moveOperation = "be13d3b3-4c1d-49f5-8c43-076331f67636";
function fixture() {
  const storage = new Map(),
    native = new Map(),
    writes = [],
    options = { lostPost: false, failStore: false };
  let nextId = 100;
  const record = (prefix) => (key, initial) => ({
    read: async () => structuredClone(storage.get(prefix + key) ?? initial()),
    update: async (change) => {
      if (options.failStore) throw Error("Synthetic storage failure");
      const current = structuredClone(storage.get(prefix + key) ?? initial()),
        result = change(current);
      storage.set(prefix + key, current);
      return structuredClone(result);
    },
  });
  const request = async (path, input = {}) => {
    const url = new URL(path, "http://synthetic.invalid"),
      method = input.method || "GET";
    if (url.pathname === "/athlete/0/events" && method === "GET")
      return [...native.values()]
        .filter(
          (row) =>
            row.start_date_local.slice(0, 10) <= url.searchParams.get("newest") &&
            (!row.end_date_local ||
              row.end_date_local.slice(0, 10) >= url.searchParams.get("oldest"))
        )
        .map((row) => structuredClone(row));
    if (method === "POST") {
      const row = { ...JSON.parse(input.body), id: nextId++, updated: `v${writes.length}` };
      native.set(row.id, row);
      writes.push({ path, method, body: JSON.parse(input.body) });
      if (options.lostPost) throw Error("Synthetic lost create reply");
      return structuredClone(row);
    }
    const number = Number(url.pathname.split("/").at(-1)),
      row = native.get(number);
    if (!row) throw Object.assign(Error("Missing"), { status: 404 });
    if (method === "PUT") {
      writes.push({ path, method, body: JSON.parse(input.body) });
      native.set(number, { ...row, ...JSON.parse(input.body), updated: `v${writes.length}` });
    }
    return structuredClone(native.get(number));
  };
  const annotations = createCalendarAnnotationsService({ request, record: record("annotations:") }),
    events = createRaceEventDetailsService({ request, record: record("events:") });
  const service = () =>
    createCalendarEntryTransferService({ annotations, events, record: record("transfer:") });
  return { storage, native, writes, options, annotations, events, service };
}
const availability = () => ({
  kind: "availability",
  date: "2026-10-31",
  endDate: "2026-11-02",
  mode: "limited",
  sports: ["Run", "Brick"],
  reason: "Work",
  description: "Synthetic afternoon only",
});
const goals = () => ({
  kind: "goals",
  date: "2026-10-31",
  endDate: "2026-10-31",
  title: "Synthetic goals",
  goals: [
    { id: "first", text: "Completed goal", completed: true },
    { id: "second", text: "Next goal", completed: false },
  ],
});
const event = () => ({
  name: "Synthetic exact event",
  date: "2026-10-31",
  priority: "B",
  eventType: "RunningRoad",
  raceDistance: "10000",
  atpEventType: "RunOnetoTwoHours",
  description: "Human event description",
  goals: { ...emptyRaceGoals(), time: "1:00:00", custom: ["Exact custom goal"] },
});
const input = (kind, action, row, date, operationId = copyOperation) => ({
  kind,
  action,
  revision: row.revision,
  date,
  operationId,
});

test("availability copy retains inclusive span, exact sports/reason/prose and independent identity through private metadata", async () => {
  const f = fixture(),
    source = (await f.annotations.create({ operationId: sourceOperation, entry: availability() }))
      .annotation;
  const before = structuredClone(f.native.get(Number(source.id.slice(6))));
  const copied = await f
    .service()
    .transfer(source.id, input("availability", "copy", source, "2026-11-07"));
  assert.notEqual(copied.workoutId, source.id);
  assert.equal(copied.annotation.date, "2026-11-07");
  assert.equal(copied.annotation.endDate, "2026-11-09");
  assert.deepEqual(copied.annotation.sports, ["Run", "Brick"]);
  assert.equal(copied.annotation.nativeSportsComplete, false);
  assert.deepEqual(f.native.get(Number(source.id.slice(6))), before);
  const loaded = await f.annotations.load(copied.workoutId);
  assert.equal(loaded.description, availability().description);
  const changed = {
    ...availability(),
    date: loaded.date,
    endDate: loaded.endDate,
    description: "Independent copied description",
  };
  await f.annotations.update(copied.workoutId, {
    operationId: moveOperation,
    revision: loaded.revision,
    entry: changed,
  });
  assert.equal((await f.annotations.load(source.id)).description, availability().description);
  for (const write of f.writes)
    assert.doesNotMatch(
      write.body.description || "",
      /training-agent-|Workout editor v1|"goals"|"sports"/
    );
});

test("goals move keeps source identity, ordered completion and title while shifting its single local day", async () => {
  const f = fixture(),
    source = (await f.annotations.create({ operationId: sourceOperation, entry: goals() }))
      .annotation;
  const moved = await f
    .service()
    .transfer(source.id, input("goals", "move", source, "2026-11-02", moveOperation));
  assert.equal(moved.workoutId, source.id);
  assert.equal(moved.annotation.date, "2026-11-02");
  assert.equal(moved.annotation.endDate, "2026-11-02");
  assert.deepEqual(moved.annotation.goals, goals().goals);
  assert.equal(f.writes.filter((write) => write.method === "POST").length, 1);
  const repeated = await f.service().transfer(source.id, {
    ...input("goals", "move", source, "2026-11-02", moveOperation),
    reconcileOnly: true,
  });
  assert.equal(repeated.workoutId, source.id);
  assert.equal(f.writes.filter((write) => write.method === "PUT").length, 1);
});

test("Goals copy resets observed completion while preserving source checks and independent ordered rows", async () => {
  const f = fixture(),
    source = (await f.annotations.create({ operationId: sourceOperation, entry: goals() }))
      .annotation;
  const copied = await f
    .service()
    .transfer(source.id, input("goals", "copy", source, "2026-11-07"));
  assert.notEqual(copied.workoutId, source.id);
  assert.deepEqual(
    copied.annotation.goals,
    goals().goals.map((goal) => ({ ...goal, completed: false }))
  );
  assert.deepEqual((await f.annotations.load(source.id)).goals, goals().goals);
  const changed = {
    ...goals(),
    date: copied.annotation.date,
    endDate: copied.annotation.endDate,
    goals: [{ ...copied.annotation.goals[0], text: "Independent copied item", completed: true }],
  };
  await f.annotations.update(copied.workoutId, {
    operationId: moveOperation,
    revision: copied.annotation.revision,
    entry: changed,
  });
  assert.deepEqual((await f.annotations.load(source.id)).goals, goals().goals);
});

test("Event copy resets reference priority/distance while freezing private type/goals and repeats its original intent", async () => {
  const f = fixture(),
    source = (await f.events.create({ ...event(), creationId: sourceOperation })).event;
  const attempt = input("event", "copy", source, "2026-11-07");
  const copied = await f.service().transfer(source.id, attempt);
  assert.notEqual(copied.workoutId, source.id);
  assert.equal(copied.event.eventType, "RunningRoad");
  assert.equal(copied.event.priority, "");
  assert.equal(copied.event.raceDistance, "");
  assert.equal(copied.event.atpEventType, "RunOnetoTwoHours");
  assert.equal((await f.events.load(source.id)).priority, "B");
  assert.equal((await f.events.load(source.id)).raceDistance, "10000");
  assert.deepEqual(copied.event.goals, event().goals);
  assert.equal(copied.event.date, "2026-11-07");
  await f.events.update(source.id, {
    ...event(),
    name: "Later source edit",
    goals: { ...event().goals, custom: ["Later source goal"] },
    revision: source.revision,
  });
  const rechecked = await f.service().transfer(source.id, { ...attempt, reconcileOnly: true });
  assert.equal(rechecked.workoutId, copied.workoutId);
  assert.deepEqual(rechecked.event.goals, event().goals);
  assert.equal(f.writes.filter((write) => write.method === "POST").length, 2);
  const destination = await f.events.load(copied.workoutId);
  await f.events.update(copied.workoutId, {
    ...event(),
    date: "2026-11-07",
    name: "Later destination edit",
    revision: destination.revision,
  });
  await assert.rejects(
    f.service().transfer(source.id, { ...attempt, reconcileOnly: true }),
    (error) => error.status === 409
  );
});

test("lost native create replies and operation reuse cannot duplicate or retarget a calendar copy", async () => {
  const f = fixture(),
    source = (await f.annotations.create({ operationId: sourceOperation, entry: availability() }))
      .annotation;
  f.options.lostPost = true;
  const attempt = input("availability", "copy", source, "2026-11-07");
  const first = await f.service().transfer(source.id, attempt),
    again = await f.service().transfer(source.id, { ...attempt, reconcileOnly: true });
  assert.equal(first.workoutId, again.workoutId);
  assert.equal(f.writes.filter((write) => write.method === "POST").length, 2);
  await assert.rejects(
    f.service().transfer(source.id, { ...attempt, date: "2026-11-08" }),
    (error) => error.status === 409 && error.code === "ENTRY_TRANSFER_CONFLICT"
  );
});

test("recheck-only Event create/update cannot authorize a first write even if no inner receipt exists", async () => {
  const f = fixture();
  await assert.rejects(
    f.events.create({ ...event(), creationId: sourceOperation, reconcileOnly: true }),
    (error) => error.code === "EVENT_CREATE_UNCONFIRMED"
  );
  assert.equal(f.writes.length, 0);
  const source = (await f.events.create({ ...event(), creationId: sourceOperation })).event,
    before = f.writes.length;
  await assert.rejects(
    f.events.update(source.id, {
      ...event(),
      date: "2026-11-03",
      revision: source.revision,
      reconcileOnly: true,
    }),
    (error) => error.code === "EVENT_UPDATE_UNCONFIRMED"
  );
  assert.equal(f.writes.length, before);
  await assert.rejects(
    f.service().transfer(source.id, {
      ...input("event", "copy", source, "2026-11-07"),
      reconcileOnly: true,
    }),
    (error) => error.code === "ENTRY_TRANSFER_UNCONFIRMED"
  );
  assert.equal(f.writes.length, before);
});

test("invalid, stale, read-only and failed prepared storage inputs cause no native copy or move", async () => {
  const f = fixture(),
    source = (await f.annotations.create({ operationId: sourceOperation, entry: goals() }))
      .annotation,
    before = f.writes.length;
  for (const change of [
    { date: "2026-02-30" },
    { kind: "note" },
    { action: "cut" },
    { operationId: "bad" },
    { revision: "0".repeat(64) },
    { extra: true },
  ])
    await assert.rejects(
      f
        .service()
        .transfer(source.id, { ...input("goals", "copy", source, "2026-11-07"), ...change })
    );
  assert.equal(f.writes.length, before);
  const native = f.native.get(Number(source.id.slice(6)));
  native.athlete_cannot_edit = true;
  await assert.rejects(
    f.service().transfer(source.id, input("goals", "copy", source, "2026-11-07")),
    (error) => error.status === 403
  );
  assert.equal(f.writes.length, before);
  delete native.athlete_cannot_edit;
  f.options.failStore = true;
  await assert.rejects(
    f.service().transfer(source.id, input("goals", "copy", source, "2026-11-07")),
    /storage failure/
  );
  assert.equal(f.writes.length, before);
});
