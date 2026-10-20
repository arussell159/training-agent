import test from "node:test";
import assert from "node:assert/strict";
import { pairIntervalsWorkout, pairedWorkoutContext } from "./workout-pairing.mjs";
import { mapIntervalsWorkout } from "./intervals.mjs";
import { preserveQueuedSnapshot } from "./queued-snapshot.mjs";

function provider({ lostReply = false, rejected = false, unconfirmed = false } = {}) {
  const event = {
    id: 7,
    category: "WORKOUT",
    type: "Ride",
    name: "Plan",
    start_date_local: "2026-10-14T18:00:00",
    moving_time: 2400,
  };
  let activity = {
    id: "i42",
    type: "VirtualRide",
    name: "Ride",
    start_date_local: "2026-10-15T15:00:00",
    moving_time: 2000,
    distance: 15475.86,
  };
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, method: options.method || "GET" });
    if (options.method === "PUT") {
      assert.equal(path, "/activity/i42");
      assert.deepEqual(JSON.parse(options.body), { paired_event_id: 7 });
      if (rejected) throw Object.assign(Error("Denied"), { status: 403 });
      if (!unconfirmed) activity = { ...activity, paired_event_id: 7 };
      if (lostReply) throw Error("Reply lost");
      return { ...activity, paired_event_id: 7 }; // Even a successful body needs GET verification.
    }
    if (path === "/athlete/0/events/7") return structuredClone(event);
    if (path === "/activity/i42") return structuredClone(activity);
    throw Error("Unexpected provider list request");
  };
  return {
    event,
    request,
    calls,
    change: (patch) => {
      activity = { ...activity, ...patch };
    },
  };
}

test("pairing verifies the exact recording and immediately joins it to a cross-day plan", async () => {
  const p = provider();
  const result = await pairIntervalsWorkout(p.request, "event:7", "activity:i42");
  assert.equal(result.activity.paired_event_id, 7);
  assert.equal(p.calls.filter((c) => c.method === "PUT").length, 1);
  assert.equal(p.calls.at(-1).method, "GET");
  const pending = {
    ...mapIntervalsWorkout(p.event, "2026-10-15"),
    workout_date: "2026-10-15",
    sync_status: "pending",
    sync_sequence: 4,
    sync_mutations: { move: { status: "pending", sequence: 4 } },
    details: "Pending instructions",
  };
  const current = {
    athlete: { time_zone: "America/Chicago" },
    history: [mapIntervalsWorkout(result.activity, "2026-10-15", null, true)],
    planned: [pending, { id: "event:9", workout_date: "2026-10-17" }],
  };
  const joined = pairedWorkoutContext(current, result, new Date("2026-10-15T23:00:00Z"));
  const saved = preserveQueuedSnapshot(current, joined);
  const rows = [...new Map([...saved.history, ...saved.planned].map((w) => [w.id, w])).values()];
  assert.equal(rows.filter((w) => w.activity_id === "i42").length, 1);
  const workout = rows.find((w) => w.id === "event:7");
  assert.equal(workout.completed, true);
  assert.equal(workout.workout_date, "2026-10-15");
  assert.equal(workout.details, "Pending instructions");
  assert.equal(workout.sync_status, "pending");
  assert.equal(workout.workout_summary.completed.duration_seconds, 2000);
  assert.ok(rows.some((w) => w.id === "event:9"));
});

test("a lost pairing reply is reconciled by readback without another write", async () => {
  const p = provider({ lostReply: true });
  const result = await pairIntervalsWorkout(p.request, "event:7", "activity:i42");
  assert.equal(result.completedId, "activity:i42");
  assert.equal(p.calls.filter((c) => c.method === "PUT").length, 1);
  await pairIntervalsWorkout(p.request, "event:7", "activity:i42");
  assert.equal(p.calls.filter((c) => c.method === "PUT").length, 1);
});

test("unconfirmed or rejected links cannot be reported as a completed merge", async () => {
  const missing = provider({ unconfirmed: true });
  await assert.rejects(pairIntervalsWorkout(missing.request, "event:7", "activity:i42"), {
    status: 502,
  });
  const denied = provider({ rejected: true });
  await assert.rejects(pairIntervalsWorkout(denied.request, "event:7", "activity:i42"), {
    status: 403,
  });
  for (const p of [missing, denied])
    assert.equal(p.calls.filter((c) => c.method === "PUT").length, 1);
});

test("different sports, existing links and mismatched provider identities reject before writing", async () => {
  for (const patch of [{ type: "Run" }, { paired_event_id: 8 }, { id: "i43" }]) {
    const p = provider();
    p.change(patch);
    await assert.rejects(pairIntervalsWorkout(p.request, "event:7", "activity:i42"));
    assert.equal(p.calls.filter((c) => c.method === "PUT").length, 0);
  }
  const p = provider();
  p.event.paired_activity_id = "i99";
  await assert.rejects(pairIntervalsWorkout(p.request, "event:7", "activity:i42"), { status: 409 });
  assert.equal(p.calls.filter((c) => c.method === "PUT").length, 0);
});
