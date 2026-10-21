import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";

test("preview Availability copy and cut use production adapters, keep inclusive span, refresh immediately and reject real native readonly", async () => {
  const source = createDesktopCalendarPreview(
    createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z"))
  );
  const saved = await source.handle("calendar/annotations", "POST", {
    operationId: "preview-transfer-source",
    entry: {
      kind: "availability",
      date: "2026-10-26",
      endDate: "2026-10-28",
      mode: "limited",
      sports: ["Run"],
      reason: "Work",
      description: "Synthetic availability prose",
    },
  });
  const route = (id) => `calendar/entry-transfer/${encodeURIComponent(id)}`;
  assert.equal(source.canWrite(route(saved.workoutId), "POST"), true);
  assert.equal(source.canWrite(route(saved.workoutId), "PUT"), false);
  const input = {
    kind: "availability",
    action: "copy",
    operationId: "preview-transfer-copy",
    revision: saved.annotation.revision,
    date: "2026-11-02",
  };
  const copied = await source.handle(route(saved.workoutId), "POST", input);
  assert.notEqual(copied.workoutId, saved.workoutId);
  assert.equal(copied.annotation.endDate, "2026-11-04");
  assert.equal(copied.providerEvent, undefined);
  assert.equal(copied.event, undefined);
  const rechecked = await source.handle(route(saved.workoutId), "POST", {
    ...input,
    reconcileOnly: true,
  });
  assert.equal(rechecked.workoutId, copied.workoutId);
  const moved = await source.handle(route(copied.workoutId), "POST", {
    kind: "availability",
    action: "move",
    operationId: "preview-transfer-move",
    revision: copied.annotation.revision,
    date: "2026-11-09",
  });
  assert.equal(moved.workoutId, copied.workoutId);
  assert.equal(moved.annotation.endDate, "2026-11-11");
  const after = await source.handle(
    "calendar/annotations/" + encodeURIComponent(copied.workoutId),
    "GET"
  );
  assert.equal(after.date, "2026-11-09");
  assert.equal(after.description, "Synthetic availability prose");
  assert.equal(after.reason, "Work");
  assert.deepEqual(after.sports, ["Run"]);
  const projected = [...moved.context.history, ...moved.context.planned].filter(
    (row) => row.id === moved.workoutId
  );
  assert.ok(projected.length);
  assert.ok(
    projected.every(
      (row) => row.workout_date === "2026-11-09" && row.calendar_annotation.endDate === "2026-11-11"
    )
  );
  await source.handle("preview/provider-permissions", "POST", {
    id: saved.workoutId,
    readOnly: true,
  });
  await assert.rejects(
    source.handle(route(saved.workoutId), "POST", {
      ...input,
      operationId: "preview-transfer-readonly",
    }),
    (error) => error.status === 403
  );
  const native = await source.handle("preview/provider-records", "GET");
  assert.equal(
    native.events.filter(
      (event) =>
        event.description ===
        "Availability: Limited\nAvailable sports: Run\nReason: Work\n\nSynthetic availability prose"
    ).length,
    2
  );
  assert.equal(
    native.writes.filter((request) => request.method === "POST" && request.path.includes("/events"))
      .length,
    2
  );
  assert.equal(
    native.events.find((event) => `event:${event.id}` === saved.workoutId).start_date_local,
    "2026-10-26T00:00:00"
  );
  await assert.rejects(
    source.handle("preview/provider-permissions", "POST", {
      id: saved.workoutId,
      readOnly: true,
      editable: true,
    }),
    (error) => error.status === 400
  );
});

test("preview Event copy resets only observed fields and Cut preserves goals and Event routing under its original identity", async () => {
  const source = createDesktopCalendarPreview(
    createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z"))
  );
  const fields = {
    name: "Synthetic clipboard race",
    date: "2026-11-16",
    priority: "B",
    eventType: "RunningRoad",
    raceDistance: "10000",
    atpEventType: "RunUnderOneHour",
    description: "Exact Event prose",
    goals: {
      time: "",
      distance: "",
      distanceUnit: "mi",
      place: "",
      finish: false,
      setPr: false,
      custom: ["Preserve this goal"],
    },
  };
  const saved = await source.handle("race-events", "POST", {
    ...fields,
    creationId: "preview-transfer-event-source",
  });
  const route = (id) => `calendar/entry-transfer/${encodeURIComponent(id)}`;
  const copied = await source.handle(route(saved.event.id), "POST", {
    kind: "event",
    action: "copy",
    operationId: "preview-transfer-event-copy",
    revision: saved.event.revision,
    date: "2026-11-23",
  });
  assert.notEqual(copied.workoutId, saved.event.id);
  assert.equal(copied.event.priority, "");
  assert.equal(copied.event.raceDistance, "");
  assert.equal(copied.event.atpEventType, fields.atpEventType);
  assert.deepEqual(copied.event.goals, fields.goals);
  assert.equal(copied.providerEvent, undefined);
  assert.ok(copied.workout.calendar_event_key);
  assert.equal(copied.workout.id, copied.workoutId);
  const moved = await source.handle(route(saved.event.id), "POST", {
    kind: "event",
    action: "move",
    operationId: "preview-transfer-event-move",
    revision: saved.event.revision,
    date: "2026-11-30",
  });
  assert.equal(moved.workoutId, saved.event.id);
  assert.equal(moved.event.priority, "B");
  assert.equal(moved.event.raceDistance, "10000");
  assert.deepEqual(moved.event.goals, fields.goals);
  const loaded = await source.handle(`race-events/${encodeURIComponent(moved.workoutId)}`, "GET");
  assert.equal(loaded.event.date, "2026-11-30");
  assert.deepEqual(loaded.event.goals.custom, fields.goals.custom);
  const actual = await source.handle("preview/provider-records", "GET");
  assert.equal(actual.writes.filter((write) => write.method === "POST").length, 2);
  assert.equal(
    actual.events.find((event) => `event:${event.id}` === moved.workoutId).category,
    "RACE_B"
  );
  assert.equal(
    actual.events.find((event) => `event:${event.id}` === copied.workoutId).category,
    "NOTE"
  );
  const projected = [...moved.context.history, ...moved.context.planned].find(
    (row) => row.id === moved.workoutId
  );
  assert.equal(projected.workout_date, "2026-11-30");
  assert.ok(projected.calendar_event_key);
});

test("synthetic next-provider rejection executes real transfer failure without mutating or duplicating native entries", async () => {
  const source = createDesktopCalendarPreview(
    createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z"))
  );
  const saved = await source.handle("calendar/annotations", "POST", {
    operationId: "preview-reject-transfer-source",
    entry: {
      kind: "goals",
      date: "2026-10-26",
      endDate: "2026-10-26",
      title: "Synthetic goals",
      goals: [{ id: "first", text: "Keep original", completed: true }],
    },
  });
  const route = `calendar/entry-transfer/${encodeURIComponent(saved.workoutId)}`,
    input = {
      kind: "goals",
      action: "copy",
      operationId: "preview-reject-transfer-copy",
      revision: saved.annotation.revision,
      date: "2026-11-02",
    };
  const before = await source.handle("preview/provider-records", "GET");
  await source.handle("preview/provider-failure", "POST", { method: "POST", status: 400 });
  await assert.rejects(
    source.handle(route, "POST", input),
    (error) => error.status === 400 && error.code === "SYNTHETIC_PROVIDER_REJECTED"
  );
  await assert.rejects(
    source.handle(route, "POST", { ...input, reconcileOnly: true }),
    (error) => error.status === 502
  );
  const after = await source.handle("preview/provider-records", "GET");
  assert.deepEqual(after.events, before.events);
  assert.equal(after.writes.length, before.writes.length + 1);
  const explicit = await source.handle(route, "POST", {
    ...input,
    operationId: "preview-reject-transfer-explicit-retry",
  });
  assert.notEqual(explicit.workoutId, saved.workoutId);
  assert.equal(explicit.annotation.goals[0].completed, false);
  await assert.rejects(
    source.handle("preview/provider-failure", "POST", { method: "DELETE", status: 400 }),
    (error) => error.status === 400
  );
});
