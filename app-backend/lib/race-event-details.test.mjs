import test from "node:test";
import assert from "node:assert/strict";
import { loadCalendarNote, saveCalendarNote } from "./calendar-notes.mjs";
import { createRaceEventDetailsService } from "./race-event-details.mjs";
import {
  raceEventTypeGroups,
  validateRaceEventDetails,
  raceAtpEventTypes,
  raceGoalDistanceUnits,
} from "./race-event-details-model.mjs";

const entry = {
  name: "City half marathon",
  date: "2026-10-24",
  priority: "",
  eventType: "RunningRoad",
  description: "Meet at the west entrance.\nKeep the first mile controlled.",
};

test("creation receipt replay rejects later native or private edits without overwriting or duplicating the Event", async () => {
  for (const change of ["native", "private"]) {
    const f = fixture(),
      input = { ...entry, creationId: `event-replay-${change}-fixture` };
    const created = await f.service().create(input),
      id = created.event.id;
    if (change === "native") f.events.get(Number(id.slice(6))).name = "Renamed externally";
    else {
      const loaded = await f.service().load(id);
      await f.service().update(id, {
        ...entry,
        goals: { ...loaded.goals, custom: ["Updated private goal"] },
        revision: loaded.revision,
      });
    }
    const before = structuredClone([...f.events]),
      writes = f.writes.length;
    await assert.rejects(
      f.service().create(input),
      (error) =>
        error.status === 409 && error.code === "EVENT_REPLAY_CHANGED" && error.eventId === id
    );
    assert.deepEqual([...f.events], before);
    assert.equal(f.writes.length, writes);
    assert.equal(f.writes.filter((write) => write.method === "POST").length, 1);
  }
});
function fixture({
  lostCreate = false,
  lostUpdate = false,
  reject = false,
  storageFailure = false,
} = {}) {
  const records = new Map(),
    events = new Map(),
    writes = [];
  let next = 100;
  const request = async (path, options = {}) => {
    if (path.includes("events?")) return structuredClone([...events.values()]);
    const id = Number(path.split("/").at(-1));
    if (options.method) {
      if (reject) throw Object.assign(Error("Rejected"), { status: 403 });
      writes.push({ path, method: options.method, body: JSON.parse(options.body) });
      const patch = JSON.parse(options.body),
        key = options.method === "POST" ? next++ : id;
      events.set(key, { ...events.get(key), ...patch, id: key });
      if ((lostCreate && options.method === "POST") || (lostUpdate && options.method === "PUT"))
        throw Error("Reply lost after commit");
      return structuredClone(events.get(key));
    }
    if (!events.has(id)) throw Object.assign(Error("Missing"), { status: 404 });
    return structuredClone(events.get(id));
  };
  const record = (key, fresh) => ({
    async read() {
      return structuredClone(records.get(key) ?? fresh());
    },
    async update(change) {
      if (storageFailure) throw Error("Storage unavailable");
      const state = structuredClone(records.get(key) ?? fresh());
      const result = change(state);
      records.set(key, state);
      return result;
    },
  });
  return {
    records,
    events,
    writes,
    request,
    service: () => createRaceEventDetailsService({ request, record }),
  };
}

test("all 29 selectable reference event types are unique and validated; placeholder and malformed drafts reject", () => {
  const values = raceEventTypeGroups.flatMap((group) => group.options.map(([value]) => value));
  assert.equal(values.length, 29);
  assert.equal(new Set(values).size, 29);
  for (const eventType of values)
    assert.equal(validateRaceEventDetails({ ...entry, eventType }).eventType, eventType);
  for (const patch of [
    { name: "" },
    { name: "x".repeat(151) },
    { date: "2026-02-30" },
    { priority: "D" },
    { eventType: "Undefined" },
    { description: 42 },
    { description: "x".repeat(12001) },
    { unexpected: true },
  ])
    assert.throws(() => validateRaceEventDetails({ ...entry, ...patch }));
});
test("exact Event type and prose survive durable restart with valid native NOTE and private unspecified priority", async () => {
  const f = fixture();
  const created = await f.service().create({ ...entry, creationId: "event-details-fixture-01" });
  assert.equal(created.verified, true);
  const loaded = await f.service().load(created.event.id);
  assert.equal(loaded.eventType, "RunningRoad");
  assert.equal(loaded.priority, "");
  assert.equal(loaded.description, entry.description);
  assert.equal(loaded.metadataCurrent, true);
  assert.equal(f.writes[0].body.category, "NOTE");
  assert.equal(f.writes[0].body.type, "Run");
  assert.equal(f.writes[0].body.description, entry.description);
  assert.doesNotMatch(f.writes[0].body.description, /Workout editor v1|"eventType"|"version"/);
  const replay = await f.service().create({ ...entry, creationId: "event-details-fixture-01" });
  assert.equal(replay.event.id, loaded.id);
  assert.equal(f.writes.length, 1);
  await assert.rejects(
    f.service().create({ ...entry, name: "Changed", creationId: "event-details-fixture-01" }),
    (error) => error.status === 409
  );
});
test("legacy third-party race can become an unspecified Event without changing its external identity", async () => {
  const f = fixture();
  f.events.set(77, {
    id: 77,
    name: "Existing race",
    type: "Run",
    category: "RACE_A",
    external_id: "third-party-original-id",
    description: "Original instructions",
    start_date_local: "2026-10-24T08:00:00",
  });
  const loaded = await f.service().load("event:77");
  const updated = await f.service().update("event:77", { ...entry, revision: loaded.revision });
  assert.equal(f.events.get(77).category, "NOTE");
  assert.equal(f.events.get(77).external_id, "third-party-original-id");
  assert.equal(updated.event.priority, "");
  const reopened = await f.service().load("event:77");
  assert.equal(reopened.eventType, "RunningRoad");
  const hydrated = await f.service().hydrateContext({
    history: [
      { id: "event:77", category: "NOTE" },
      { id: "event:78", category: "NOTE" },
    ],
    planned: [],
  });
  assert.ok(hydrated.history[0].calendar_event_key);
  assert.equal(hydrated.history[1].calendar_event_key, undefined);
  const again = await f
    .service()
    .update("event:77", { ...entry, priority: "B", revision: reopened.revision });
  assert.equal(again.event.priority, "B");
  assert.equal(f.events.get(77).category, "RACE_B");
  assert.equal(f.events.get(77).external_id, "third-party-original-id");
});
test("lost creation and update responses reconcile exact provider readback without duplicate writes", async () => {
  const f = fixture({ lostCreate: true, lostUpdate: true });
  const created = await f.service().create({ ...entry, creationId: "event-details-fixture-02" });
  const changed = await f.service().update(created.event.id, {
    ...entry,
    eventType: "CyclingMountain",
    priority: "B",
    description: "Climb steadily.",
    revision: created.event.revision,
  });
  const loaded = await f.service().load(changed.event.id);
  assert.equal(loaded.eventType, "CyclingMountain");
  assert.equal(loaded.priority, "B");
  assert.equal(loaded.description, "Climb steadily.");
  assert.equal(f.events.get(100).type, "MountainBikeRide");
  assert.equal(f.writes.length, 2);
  await assert.rejects(
    f.service().update(changed.event.id, { ...entry, revision: created.event.revision }),
    (error) => error.status === 409
  );
  assert.equal(f.writes.length, 2);
});
test("remote prose and type changes invalidate exact private category without restoring stale prose", async () => {
  const f = fixture();
  const created = await f.service().create({ ...entry, creationId: "event-details-fixture-03" });
  f.events.get(100).description = "Changed directly at provider";
  f.events.get(100).type = "Rowing";
  const loaded = await f.service().load(created.event.id);
  assert.equal(loaded.metadataCurrent, false);
  assert.equal(loaded.editable, false);
  assert.equal(loaded.description, "Changed directly at provider");
  assert.equal(loaded.eventType, "RowingOther");
  await assert.rejects(
    f.service().update(created.event.id, { ...entry, revision: created.event.revision }),
    (error) => error.status === 409
  );
  assert.equal(f.writes.length, 1);
});

test("native prose-only edits preserve exact Event type and every private goal while stale drafts conflict", async () => {
  const f = fixture(),
    original = {
      ...entry,
      raceDistance: "21097",
      atpEventType: "RunOnetoTwoHours",
      goals: {
        time: "1:30:00",
        distance: "13.1",
        distanceUnit: "mi",
        place: "5",
        finish: true,
        setPr: true,
        custom: ["Keep this private goal"],
      },
    };
  const created = await f.service().create({ ...original, creationId: "event-prose-only-fixture" });
  f.events.get(100).description = "New native prose wins";
  const loaded = await f.service().load(created.event.id);
  assert.equal(loaded.metadataCurrent, true);
  assert.equal(loaded.editable, true);
  assert.equal(loaded.description, "New native prose wins");
  assert.equal(loaded.eventType, "RunningRoad");
  assert.deepEqual(loaded.goals, original.goals);
  assert.notEqual(loaded.revision, created.event.revision);
  await assert.rejects(
    f.service().update(created.event.id, { ...original, revision: created.event.revision }),
    (error) => error.status === 409
  );
  assert.equal(f.writes.length, 1);
  const saved = await f.service().update(created.event.id, {
    ...original,
    name: "Renamed after review",
    description: loaded.description,
    revision: loaded.revision,
  });
  assert.deepEqual(saved.event.goals, original.goals);
  assert.equal(saved.event.eventType, "RunningRoad");
  assert.equal(f.events.get(100).description, "New native prose wins");
});

test("generic Note routes deny rich Event identities including legacy private and pending records but retain plain Notes", async () => {
  const f = fixture();
  const created = await f.service().create({ ...entry, creationId: "note-event-route-fixture" });
  const options = { assertNotAppEvent: (id) => f.service().assertNotAppEvent(id) };
  const load = () => loadCalendarNote(f.request, created.event.id, options);
  await assert.rejects(load(), (error) => error.status === 403);
  // A converted third-party Event retains its original external identifier.
  f.events.get(100).external_id = "legacy-external-identity";
  await assert.rejects(
    load(),
    (error) => error.status === 403 && error.code === "EVENT_NOTE_ROUTE"
  );
  const before = f.writes.length;
  await assert.rejects(
    saveCalendarNote(
      f.request,
      created.event.id,
      {
        name: "Wrong editor",
        date: entry.date,
        description: "Wrong path",
        revision: created.event.revision,
      },
      options
    ),
    (error) => error.status === 403
  );
  assert.equal(f.writes.length, before);
  // A provider commit can precede index completion; its per-entry pending record still protects routing.
  f.records.set("index", { ids: {} });
  f.records.set("event:100", { entry: null, nativeHash: null, pending: { entry } });
  await assert.rejects(load(), (error) => error.status === 403);
  f.events.set(200, {
    id: 200,
    name: "Plain note",
    category: "NOTE",
    type: "Other",
    description: "Ordinary prose",
    start_date_local: entry.date + "T00:00:00",
  });
  const plain = await loadCalendarNote(f.request, "event:200", options);
  const saved = await saveCalendarNote(
    f.request,
    "event:200",
    { ...plain, name: "Updated plain note" },
    options
  );
  assert.equal(saved.event.name, "Updated plain note");
  f.events.get(200).read_only = true;
  await assert.rejects(
    loadCalendarNote(f.request, "event:200", options),
    (error) => error.status === 403
  );
});
test("validation, storage failures and read-only providers never start an unsafe write", async () => {
  const f = fixture({ storageFailure: true });
  await assert.rejects(
    f.service().create({ ...entry, creationId: "event-details-fixture-04" }),
    /Storage unavailable/
  );
  assert.equal(f.writes.length, 0);
  const allowed = fixture();
  const created = await allowed
    .service()
    .create({ ...entry, creationId: "event-details-fixture-05" });
  allowed.events.get(100).athlete_cannot_edit = true;
  assert.equal((await allowed.service().load(created.event.id)).editable, false);
  await assert.rejects(
    allowed.service().update(created.event.id, { ...entry, revision: created.event.revision })
  );
  assert.equal(allowed.writes.length, 1);
});
test("distance, ATP choice and every goal survive private restart, metadata-only edit and calendar move", async () => {
  const f = fixture();
  const original = {
    ...entry,
    raceDistance: "21097",
    atpEventType: "RunOnetoTwoHours",
    goals: {
      time: "1:30:00",
      distance: "13.1",
      distanceUnit: "mi",
      place: "10",
      finish: true,
      setPr: true,
      custom: ["Finish comfortably", "Keep drinking"],
    },
  };
  const created = await f.service().create({ ...original, creationId: "event-details-goals-01" });
  const reopened = await f.service().load(created.event.id);
  assert.deepEqual(reopened.goals, original.goals);
  assert.equal(reopened.raceDistance, "21097");
  assert.equal(reopened.atpEventType, "RunOnetoTwoHours");
  assert.equal(f.writes[0].body.description, entry.description);
  const updated = await f.service().update(created.event.id, {
    ...original,
    goals: { ...original.goals, time: "1:29:00" },
    revision: reopened.revision,
  });
  assert.notEqual(
    updated.event.revision,
    reopened.revision,
    "A metadata-only change must advance the stale-write revision"
  );
  assert.equal(
    f.writes.length,
    1,
    "Goals do not create a provider description or change physical workout targets"
  );
  await assert.rejects(
    f.service().update(created.event.id, { ...original, revision: reopened.revision }),
    (error) => error.status === 409
  );
  await assert.rejects(
    f.service().create({ ...original, creationId: "event-details-goals-01" }),
    (error) => error.status === 409 && error.code === "EVENT_REPLAY_CHANGED"
  );
  assert.equal(
    (await f.service().load(created.event.id)).goals.time,
    "1:29:00",
    "The original creation receipt must not claim to save an obsolete draft or overwrite current metadata"
  );
  f.events.get(100).start_date_local = "2026-10-25T00:00:00";
  const moved = await f.service().load(created.event.id);
  assert.equal(moved.date, "2026-10-25");
  assert.equal(moved.eventType, "RunningRoad");
  assert.equal(moved.goals.time, "1:29:00");
});
test("invalid optional metadata rejects before storage or native writes", async () => {
  for (const patch of [
    { raceDistance: "1234" },
    { atpEventType: "unknown" },
    { goals: { time: "1:99:00" } },
    { goals: { distance: "-2" } },
    { goals: { place: "0" } },
    { goals: { finish: "yes" } },
    { goals: { custom: [""] } },
    { goals: { distanceUnit: "parsec" } },
  ]) {
    const f = fixture();
    await assert.rejects(
      f.service().create({ ...entry, ...patch, creationId: "event-details-invalid-01" })
    );
    assert.equal(f.writes.length, 0);
    assert.equal(f.records.size, 0);
  }
});
test("observed sport-specific ATP choices persist without inventing training targets", async () => {
  for (const [eventType, atpEventType, nativeSport] of [
    ["CyclingRoad", "BikeCentury", "Ride"],
    ["CyclingMountain", "MtbOverTwoHours", "MountainBikeRide"],
    ["MultisportTriathlon", "TriOverFourHours", "Other"],
    ["MultisportDuathlon", "DuTwoToFourHours", "Other"],
    ["SwimPool", "RunUnderOneHour", "Swim"],
    ["OtherOther", "DuOverFourHours", "Other"],
  ]) {
    const f = fixture();
    const created = await f
      .service()
      .create({ ...entry, eventType, atpEventType, creationId: `catalog-example-${eventType}` });
    const reloaded = await f.service().load(created.event.id);
    assert.equal(reloaded.atpEventType, atpEventType);
    assert.equal(reloaded.name, entry.name);
    assert.equal(f.writes[0].body.type, nativeSport);
    assert.equal(f.writes[0].body.time_target, undefined);
    assert.equal(f.writes[0].body.distance_target, undefined);
  }
  for (const [eventType, atpEventType] of [
    ["RunningRoad", "BikeCentury"],
    ["CyclingRoad", "RunUnderOneHour"],
    ["MultisportTriathlon", "DuOverFourHours"],
    ["MultisportDuathlon", "TriOverFourHours"],
  ])
    assert.throws(
      () => validateRaceEventDetails({ ...entry, eventType, atpEventType }),
      /ATP event type/
    );
  assert.equal(raceAtpEventTypes("SnowNordic").length, 15);
  assert.deepEqual(raceGoalDistanceUnits, ["mi", "km", "yds", "m"]);
  const f = fixture();
  const created = await f.service().create({
    ...entry,
    goals: { distance: "1000", distanceUnit: "yds" },
    creationId: "goal-unit-yard-retention",
  });
  assert.equal((await f.service().load(created.event.id)).goals.distance, "1000");
  assert.equal((await f.service().load(created.event.id)).goals.distanceUnit, "yds");
});
