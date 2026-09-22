import test from "node:test";
import assert from "node:assert/strict";
import {
  incrementalSnapshot,
  frozenWorkout,
  completedIds,
  changedComments,
  contentHash,
} from "./workout-sync-policy.mjs";

const NOW = Date.parse("2026-09-22T18:00:00Z");
const workout = (id, age = 2, extra = {}) => ({
  id: `activity:${id}`,
  activity_id: id,
  completed: true,
  status: "completed",
  workout_date: new Date(NOW - age * 3600000).toISOString().slice(0, 10),
  title: "Synthetic workout",
  raw_activity: {
    id,
    start_date: new Date(NOW - age * 3600000 - 3600000).toISOString(),
    elapsed_time: 3600,
    moving_time: 3600,
    distance: 10000,
  },
  ...extra,
});
const context = (rows) => ({
  athlete: { id: "synthetic", time_zone: "UTC" },
  history: rows,
  planned: [],
  synced_at: "2026-09-22T17:00:00Z",
  provider: "intervals",
  metrics: { fitness: 1 },
  comments: [],
});
test("unchanged content with new fetch timestamps makes no write batch", () => {
  const old = context([workout("a")]);
  const next = structuredClone(old);
  next.synced_at = "2026-09-22T18:00:00Z";
  const result = incrementalSnapshot(old, next, NOW);
  assert.equal(result.changed, false);
  assert.deepEqual(result.workouts, []);
  assert.equal(result.context, old);
});
test("only the new workout enters the write batch, not the archive", () => {
  const rows = [workout("old", 48), workout("recent", 2)];
  const result = incrementalSnapshot(context(rows), context([...rows, workout("new", 1)]), NOW);
  assert.deepEqual(
    result.workouts.map((w) => w.activity_id),
    ["new"]
  );
  assert.equal(result.context.history[0], rows[0]);
});
test("changed workouts inside 24h may settle when an import actually runs", () => {
  const row = workout("a", 23);
  const next = { ...row, raw_activity: { ...row.raw_activity, distance: 10100 } };
  assert.equal(incrementalSnapshot(context([row]), context([next]), NOW).workouts.length, 1);
});
test("exactly 24 hours after actual end is frozen", () => {
  const row = workout("a", 24);
  assert.equal(frozenWorkout(row, context([row]), NOW), true);
  assert.equal(frozenWorkout(row, context([row]), NOW - 1), false);
  const result = incrementalSnapshot(
    context([row]),
    context([
      {
        ...row,
        title: "Provider correction",
        raw_activity: { ...row.raw_activity, distance: 20000 },
      },
    ]),
    NOW
  );
  assert.deepEqual(result.workouts, []);
  assert.equal(result.context.history[0].title, row.title);
});
test("old completion stays in snapshot when provider omits/deletes it", () => {
  const row = workout("old", 48);
  const result = incrementalSnapshot(context([row]), context([]), NOW);
  assert.deepEqual(result.context.history, [row]);
  assert.deepEqual(result.workouts, []);
});
test("changed provider pairing cannot duplicate or rewrite frozen history", () => {
  const row = workout("a", 48);
  const result = incrementalSnapshot(
    context([row]),
    context([{ ...row, id: "event:999", title: "Repaired pairing" }]),
    NOW
  );
  assert.deepEqual(result.context.history, [row]);
  assert.deepEqual(result.workouts, []);
});
test("new late upload is inserted even if the actual activity is old", () => {
  const row = workout("late", 60);
  assert.deepEqual(incrementalSnapshot(context([]), context([row]), NOW).workouts, [
    { ...row, first_imported_at: context([row]).synced_at },
  ]);
});
test("calendar plans are not frozen merely because their date is old", () => {
  const row = { id: "event:1", workout_date: "2026-09-19", title: "Planned", completed: false };
  const next = { ...row, title: "Explicitly changed" };
  assert.deepEqual(incrementalSnapshot(context([row]), context([next]), NOW).workouts, [next]);
});
test("paired calendar date is not the activity completion clock", () => {
  const row = workout("a", 2, {
    workout_date: "2026-01-01",
    scheduled_start_at: "2026-01-01T01:00:00",
  });
  assert.equal(frozenWorkout(row, context([row]), NOW), false);
});
test("local provider timestamps use athlete zone across midnight", () => {
  const row = workout("a", 24);
  row.raw_activity = { id: "a", start_date_local: "2026-09-21T12:00:00", elapsed_time: 3600 };
  const ctx = { ...context([row]), athlete: { time_zone: "America/Chicago" } };
  assert.equal(frozenWorkout(row, ctx, NOW), true);
  assert.equal(frozenWorkout(row, ctx, NOW - 1), false);
});
test("missing recording clock uses saved import age without inventing start", () => {
  const row = workout("a");
  row.raw_activity = { id: "a" };
  const ctx = { ...context([row]), synced_at: "2026-09-20T18:00:00Z" };
  assert.equal(frozenWorkout(row, ctx, NOW), true);
});
test("initial import remains available", () =>
  assert.equal(incrementalSnapshot(null, context([workout("a")]), NOW).workouts.length, 1));
test("stable hashes ignore object ordering and import timestamps", () =>
  assert.equal(
    contentHash({ a: 1, b: 2, synced_at: "a" }),
    contentHash({ b: 2, a: 1, synced_at: "b" })
  ));
test("IDs deduplicate paired rows and comments are change filtered", () => {
  const row = workout("a");
  assert.deepEqual(completedIds({ ...context([row]), planned: [row] }), ["a"]);
  assert.deepEqual(
    changedComments(
      { comments: [{ id: "c", body: "same" }] },
      {
        comments: [
          { id: "c", body: "same" },
          { id: "d", body: "new" },
        ],
      }
    ),
    [{ id: "d", body: "new" }]
  );
});
test("a genuinely new activity reusing an old event ID is not lost", () => {
  const old = workout("old", 48, { id: "event:1" }),
    next = workout("new", 1, { id: "event:1" });
  const result = incrementalSnapshot(context([old]), context([next]), NOW);
  assert.deepEqual(completedIds(result.context), ["new", "old"]);
  assert.deepEqual(
    result.workouts.map((w) => w.activity_id),
    ["new"]
  );
});

// Import age must not reset whenever an unrelated new workout is imported.
test("missing recording clocks retain their first verified import age across new snapshots", () => {
  const now = Date.parse("2026-09-22T18:00:00Z");
  const old = {
    id: "activity:noclock",
    activity_id: "noclock",
    completed: true,
    status: "completed",
    workout_date: "2026-09-22",
    title: "Saved",
  };
  const previous = {
    athlete: { time_zone: "UTC" },
    history: [old],
    planned: [],
    synced_at: new Date(now - 23 * 3600000).toISOString(),
  };
  const newer = { ...old, id: "activity:newer", activity_id: "newer" };
  const first = incrementalSnapshot(
    previous,
    { ...previous, history: [old, newer], synced_at: new Date(now).toISOString() },
    now
  );
  const saved = first.context.history.find((w) => w.activity_id === "noclock");
  assert.equal(saved.first_imported_at, previous.synced_at);
  const later = now + 2 * 3600000;
  const next = incrementalSnapshot(
    first.context,
    {
      ...first.context,
      history: [{ ...old, title: "Must remain saved" }, newer],
      synced_at: new Date(later).toISOString(),
    },
    later
  );
  assert.equal(next.context.history.find((w) => w.activity_id === "noclock").title, "Saved");
});
