import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";
const preview = () =>
  createDesktopCalendarPreview(createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z")));
const input = {
  name: "Preview event with goals",
  date: "2026-10-24",
  priority: "",
  eventType: "RunningRoad",
  description: "Start slowly.",
  raceDistance: "21097",
  atpEventType: "RunOnetoTwoHours",
  goals: {
    time: "1:30:00",
    distance: "13.1",
    distanceUnit: "mi",
    place: "10",
    finish: true,
    setPr: true,
    custom: ["Finish comfortably"],
  },
  creationId: "event-details-preview-01",
};
test("desktop Event routes persist exact goals privately, expose native race and hydrate actual calendar context", async () => {
  const source = preview();
  const created = await source.handle("race-events", "POST", input);
  assert.equal(created.verified, true);
  const path = `race-events/${encodeURIComponent(created.event.id)}`;
  assert.equal(source.canWrite(path, "PUT"), true);
  const reloaded = await source.handle(path, "GET");
  assert.deepEqual(reloaded.event.goals, input.goals);
  const records = await source.handle("preview/provider-records", "GET");
  const raw = records.events.find((event) => `event:${event.id}` === created.event.id);
  assert.equal(raw.category, "NOTE");
  assert.equal(raw.type, "Run");
  assert.equal(raw.description, "Start slowly.");
  assert.equal(raw.time_target, undefined);
  assert.equal(raw.distance_target, undefined);
  assert.equal(
    [...created.context.history, ...created.context.planned].find(
      (row) => row.id === created.event.id
    ).category,
    "NOTE"
  );
  assert.ok(
    [...created.context.history, ...created.context.planned].find(
      (row) => row.id === created.event.id
    ).calendar_event_key
  );
  const officialEventCategories = [
    "WORKOUT",
    "RACE_A",
    "RACE_B",
    "RACE_C",
    "NOTE",
    "PLAN",
    "HOLIDAY",
    "SICK",
    "INJURED",
    "SET_EFTP",
    "FITNESS_DAYS",
    "SEASON_START",
    "TARGET",
    "SET_FITNESS",
  ];
  for (const write of records.writes.filter(
    (write) => write.path.includes("/events") && write.body.category
  ))
    assert.ok(
      officialEventCategories.includes(write.body.category),
      `Invalid Event transport category ${write.body.category}`
    );
  assert.equal(
    (await source.handle("race-events", "GET")).events.some(
      (event) => `event:${event.id}` === created.event.id
    ),
    true
  );
  const { creationId, ...fields } = input;
  const changed = await source.handle(path, "PUT", {
    ...fields,
    priority: "B",
    description: "A revised plan.",
    revision: reloaded.event.revision,
  });
  assert.equal(changed.event.priority, "B");
  assert.deepEqual(changed.event.goals, input.goals);
  const again = await source.handle(path, "GET");
  assert.equal(again.event.description, "A revised plan.");
  const updated = (await source.handle("preview/provider-records", "GET")).events.find(
    (event) => `event:${event.id}` === created.event.id
  );
  assert.equal(updated.category, "RACE_B");
  assert.equal(updated.description, "A revised plan.");
});
test("desktop Event malformed and stale writes do not mutate synthetic provider state", async () => {
  const source = preview(),
    created = await source.handle("race-events", "POST", input),
    path = `race-events/${encodeURIComponent(created.event.id)}`;
  const before = (await source.handle("preview/provider-records", "GET")).writes.length;
  const { creationId, ...fields } = input;
  assert.ok(creationId);
  await assert.rejects(
    source.handle(path, "PUT", {
      ...fields,
      description: "A stale edit",
      revision: "0".repeat(64),
    }),
    (error) => error.status === 409
  );
  await assert.rejects(source.handle("race-events", "POST", { ...input, eventType: "Undefined" }));
  assert.equal((await source.handle("preview/provider-records", "GET")).writes.length, before);
});
test("unprioritized Events remain protected from bulk day actions and legacy identity survives conversion", async () => {
  const source = preview();
  const legacy = await source.handle("race-events", "POST", {
    name: "Legacy annual race",
    date: input.date,
    priority: "A",
  });
  const id = `event:${legacy.event.id}`,
    path = `race-events/${encodeURIComponent(id)}`;
  const loaded = (await source.handle(path, "GET")).event;
  const before = (await source.handle("preview/provider-records", "GET")).events.find(
    (event) => `event:${event.id}` === id
  );
  const { creationId, ...fields } = input;
  assert.ok(creationId);
  await source.handle(path, "PUT", {
    ...fields,
    name: "Legacy now general Event",
    revision: loaded.revision,
  });
  const converted = (await source.handle(path, "GET")).event;
  assert.equal(converted.priority, "");
  const listed = await source.handle("race-events", "GET");
  assert.equal(
    listed.events.some((event) => `event:${event.id}` === id),
    true
  );
  for (const action of ["copy", "delete"])
    await source.handle("calendar/day-actions", "POST", { date: input.date, action });
  const records = await source.handle("preview/provider-records", "GET");
  const after = records.events.find((event) => `event:${event.id}` === id);
  assert.ok(after);
  assert.equal(after.category, "NOTE");
  assert.equal(after.external_id, before.external_id);
  assert.equal(
    records.events.filter((event) => event.name === "Legacy now general Event").length,
    1
  );
});
