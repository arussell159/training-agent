import test from "node:test";
import assert from "node:assert/strict";
import { fetchIntervalsContext, mapIntervalsWorkout } from "./intervals.mjs";
import { mergeTrainingSnapshot } from "./completed-workout-store.mjs";
import { preserveQueuedSnapshot } from "./queued-snapshot.mjs";
import { pendingMutationContext } from "./mutation-queue.mjs";
import { projectTrainingContext } from "./fast-context.mjs";

const now = new Date("2026-10-15T23:00:00Z");
const event = {
  id: 7,
  category: "WORKOUT",
  type: "Ride",
  name: "Active Recovery",
  start_date_local: "2026-10-14T18:00:00",
  moving_time: 2400,
  paired_activity_id: "i42",
};
const activity = {
  id: "i42",
  type: "VirtualRide",
  name: "Active Recovery",
  start_date_local: "2026-10-15T15:26:12",
  moving_time: 2000,
  distance: 15475.86,
  paired_event_id: 7,
  file_type: "fit",
};
const source = async () =>
  fetchIntervalsContext(
    async (path) =>
      path === "/athlete/0"
        ? { id: "1", timezone: "America/Chicago" }
        : path.includes("/activities?")
          ? [activity]
          : path.includes("/events?")
            ? [event]
            : [],
    { now, range: { start: "2026-10-12", end: "2026-10-18" } }
  );
const previous = (status) => ({
  athlete: { id: "1", time_zone: "America/Chicago" },
  history: [],
  planned: [
    {
      ...mapIntervalsWorkout({ ...event, paired_activity_id: null }, "2026-10-15"),
      workout_date: "2026-10-15",
      details: "Keep this queued description",
      editable_description: "Keep this queued description",
      sync_status: status,
      sync_sequence: 4,
      sync_operation: "pending-move",
      sync_mutations: {
        move: { sequence: 3, operationId: "pending-move", status },
        description: { sequence: 4, operationId: "pending-text", status },
      },
      app_updated_at: "2026-10-15T02:16:22.393Z",
    },
  ],
});
const rows = (context) => [
  ...new Map([...context.history, ...context.planned].map((w) => [w.id, w])).values(),
];

test("a cross-day linked recording belongs to its actual local day, retaining its planned date", async () => {
  const incoming = await source(),
    workout = rows(incoming)[0];
  assert.equal(rows(incoming).length, 1);
  assert.equal(workout.workout_date, "2026-10-15");
  assert.equal(workout.planned_workout_date, "2026-10-14");
  assert.equal(workout.recorded_start_local, activity.start_date_local);
  assert.equal(workout.workout_summary.planned.duration_seconds, 2400);
  assert.equal(workout.workout_summary.completed.duration_seconds, 2000);
});

test("pending and failed edits cannot erase a newly paired recording during refresh or CAS rebase", async () => {
  for (const status of ["pending", "failed"]) {
    const current = previous(status),
      incoming = await source();
    const merged = preserveQueuedSnapshot(current, mergeTrainingSnapshot(current, incoming));
    const final = projectTrainingContext(merged, "full", now),
      workout = rows(final).find((w) => w.id === "event:7");
    assert.equal(workout.completed, true, status);
    assert.equal(workout.status, "completed");
    assert.equal(workout.activity_id, "i42");
    assert.equal(workout.workout_date, "2026-10-15");
    assert.equal(workout.workout_summary.completed.duration_seconds, 2000);
    assert.equal(workout.workout_summary.completed.distance_meters, 15475.86);
    assert.equal(workout.details, "Keep this queued description");
    assert.equal(workout.sync_status, status);
    assert.equal(workout.sync_sequence, 4);
    assert.deepEqual(workout.sync_mutations, current.planned[0].sync_mutations);
    assert.equal(rows(final).filter((w) => w.activity_id === "i42").length, 1);
    const rebased = preserveQueuedSnapshot(current, incoming);
    assert.equal(rows(rebased)[0].activity_id, "i42");
  }
});

test("a delayed pending move projection never moves the recorded workout off its actual day", () => {
  const completed = mapIntervalsWorkout(event, "2026-10-15", activity);
  const current = { athlete: { time_zone: "America/Chicago" }, history: [completed], planned: [] };
  const projected = pendingMutationContext(
    current,
    { id: "event:7", type: "move", date: "2026-10-16", operationId: "move" },
    5
  );
  const workout = rows(projected)[0];
  assert.equal(workout.workout_date, "2026-10-15");
  assert.equal(workout.planned_workout_date, "2026-10-16");
  assert.equal(workout.completed, true);
  assert.equal(workout.activity_id, "i42");
});

test("completion survives a pending move across history and future collections", async () => {
  const incoming = await source();
  const past = { ...incoming, history: rows(incoming), planned: [] };
  const current = previous("pending");
  current.planned[0].workout_date = "2026-10-18";
  const merged = preserveQueuedSnapshot(current, mergeTrainingSnapshot(current, past));
  const final = projectTrainingContext(merged, "full", new Date("2026-10-16T23:00:00Z"));
  assert.equal(final.planned.length, 0);
  assert.equal(final.history.length, 1);
  assert.equal(final.history[0].workout_date, "2026-10-15");
  assert.equal(final.history[0].activity_id, "i42");
  assert.equal(final.history[0].planned_workout_date, "2026-10-18");
});

test("verified plan deletion rebases onto a concurrent completion without deleting its recording", () => {
  const completed = mapIntervalsWorkout(event, "2026-10-15", activity);
  completed.sync_status = "pending";
  completed.sync_operation = "old-plan-edit";
  const current = { athlete: { time_zone: "America/Chicago" }, history: [completed], planned: [] };
  const deleted = {
    ...current,
    history: [],
    app_deleted_workouts: { "event:7": "2026-10-16T12:00:01Z" },
  };
  const merged = preserveQueuedSnapshot(current, deleted, { verifiedIds: ["event:7"] });
  const recording = rows(merged)[0];
  assert.equal(rows(merged).length, 1);
  assert.equal(recording.id, "activity:i42");
  assert.equal(recording.activity_id, "i42");
  assert.equal(recording.completed, true);
  assert.equal(recording.workout_date, "2026-10-15");
  assert.equal(recording.workout_summary.completed.duration_seconds, 2000);
  assert.equal(recording.workout_summary.planned, null);
  assert.equal(recording.raw_activity.paired_event_id, null);
  assert.equal(recording.sync_operation, undefined);
  assert.equal(recording.editable, false);
});

test("a stale refresh cannot hide or duplicate a recording linked to a deleted plan", () => {
  const completed = mapIntervalsWorkout(event, "2026-10-15", activity);
  const recording = mapIntervalsWorkout(
    { ...activity, paired_event_id: null },
    "2026-10-15",
    null,
    true
  );
  const current = {
    athlete: { time_zone: "America/Chicago" },
    history: [recording],
    planned: [],
    app_deleted_workouts: { "event:7": "2026-10-16T12:00:01Z" },
  };
  const stale = {
    ...current,
    history: [completed, recording],
    sync_started_at: "2026-10-16T12:00:00Z",
  };
  const merged = preserveQueuedSnapshot(current, stale);
  assert.equal(rows(merged).length, 1);
  assert.equal(rows(merged)[0].id, "activity:i42");
  assert.equal(rows(merged)[0].workout_summary.completed.duration_seconds, 2000);
});
