import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCompletedWorkoutStore,
  mergeTrainingSnapshot,
  snapshotCoversRange,
} from "./completed-workout-store.mjs";

function memoryStore() {
  const rows = new Map();
  return {
    ready: true,
    rows,
    async getSyncRecord(id) {
      return rows.get(id)?.cursor || null;
    },
    async upsert(table, values) {
      assert.equal(table, "sync_state");
      for (const row of values) rows.set(row.athlete_id, row);
    },
  };
}
const config = { INTERVALS_API_KEY: "test-connection" };
test("completed workouts retain full provider totals and paired prescriptions in durable archive rows", async () => {
  const store = memoryStore(),
    archive = createCompletedWorkoutStore(config, store);
  const workout = {
    id: "event:1",
    activity_id: "i42",
    completed: true,
    workout_date: "2026-09-15",
    raw_activity: { distance: 365.76, moving_time: 412, average_heartrate: 141 },
    workout_summary: { planned: { distance: 400 }, completed: { distance: 365.76 } },
    structure: "prescription",
  };
  await archive.saveWorkouts({
    history: [workout],
    planned: [workout, { id: "event:2", completed: false }],
  });
  assert.equal(store.rows.size, 1);
  const row = [...store.rows.values()][0];
  assert.equal(row.status, "archived");
  assert.deepEqual(row.cursor.workout, workout);
  assert.equal(row.cursor.activity.distance, 365.76);
  assert.ok(!row.athlete_id.includes(config.INTERVALS_API_KEY));
});
test("chart, route and summary downloads survive a fresh process without contacting the provider again", async () => {
  const store = memoryStore();
  let calls = 0;
  for (const kind of ["analysis", "summary", "route"]) {
    const data = {
      kind,
      distance: 2651.76,
      points: [{ time: 0, speed: 1 }],
      laps: [{ distance: 365.76 }],
    };
    assert.deepEqual(
      await createCompletedWorkoutStore(config, store).load("i42", kind, async () => {
        calls++;
        return data;
      }),
      data
    );
    assert.deepEqual(
      await createCompletedWorkoutStore(config, store).load("i42", kind, async () => {
        throw Error("must not contact Intervals");
      }),
      data
    );
  }
  assert.equal(calls, 3);
});
test("provider corrections invalidate downloaded data and connections never share cached activities", async () => {
  const store = memoryStore(),
    archive = createCompletedWorkoutStore(config, store);
  const workout = {
    id: "activity:i42",
    activity_id: "i42",
    completed: true,
    raw_activity: { distance: 100 },
  };
  await archive.saveWorkouts({ history: [workout] });
  await archive.load("i42", "summary", async () => ({ distance: 100 }));
  await archive.saveWorkouts({ history: [{ ...workout, raw_activity: { distance: 200 } }] });
  assert.deepEqual(await archive.load("i42", "summary", async () => ({ distance: 200 })), {
    distance: 200,
  });
  assert.deepEqual(
    await createCompletedWorkoutStore({ INTERVALS_API_KEY: "other" }, store).load(
      "i42",
      "summary",
      async () => ({ distance: 300 })
    ),
    { distance: 300 }
  );
});
test("failed saves are not treated as durable successes", async () => {
  const store = memoryStore();
  store.upsert = async () => {
    throw Error("write rejected");
  };
  await assert.rejects(
    createCompletedWorkoutStore(config, store).load("i42", "analysis", async () => ({
      points: [],
    })),
    /write rejected/
  );
});
test("week sync preserves older completed workouts and wellness, and removes deleted events inside its range", () => {
  const previous = {
    history: [
      { id: "old", workout_date: "2026-08-01" },
      { id: "deleted", workout_date: "2026-09-15" },
    ],
    planned: [{ id: "future", workout_date: "2026-10-01" }],
    wellness_history: [{ date: "2026-09-01", hrv: 50 }],
  };
  const incoming = {
    history: [{ id: "new", workout_date: "2026-09-15" }],
    planned: [],
    wellness_history: [{ date: "2026-09-15", hrv: 62 }],
  };
  const merged = mergeTrainingSnapshot(previous, incoming, {
    start: "2026-09-14",
    end: "2026-09-20",
  });
  assert.deepEqual(
    merged.history.map((w) => w.id),
    ["old", "new"]
  );
  assert.equal(merged.planned[0].id, "future");
  assert.equal(merged.wellness_history.length, 2);
});

test("unloaded calendar ranges must be synced, rather than displayed as empty cached weeks", () => {
  const snapshot = { cached_ranges: [{ start: "2026-09-01", end: "2026-10-01" }] };
  assert.equal(snapshotCoversRange(snapshot, { start: "2026-09-14", end: "2026-09-20" }), true);
  assert.equal(snapshotCoversRange(snapshot, { start: "2026-08-01", end: "2026-08-07" }), false);
  assert.equal(snapshotCoversRange(snapshot, { start: "2026-09-28", end: "2026-10-04" }), false);
});

test("large recordings are compressed in Supabase and decode losslessly after restart", async () => {
  const store = memoryStore(),
    data = {
      streams: [{ type: "time", data: Array.from({ length: 20000 }, (_, i) => i) }],
      file: Buffer.alloc(100000, 42).toString("base64"),
    };
  await createCompletedWorkoutStore(config, store).load("i42", "bundle", async () => data);
  const saved = [...store.rows.values()][0].cursor;
  assert.equal(saved.encoding, "gzip-json-v1");
  assert.ok(saved.data.length < JSON.stringify(data).length);
  assert.deepEqual(
    await createCompletedWorkoutStore(config, store).load("i42", "bundle", async () => {
      throw Error("provider must not be called");
    }),
    data
  );
});

test("rolling full syncs preserve older archived workouts and wellness", () => {
  const merged = mergeTrainingSnapshot(
    {
      history: [{ id: "old", workout_date: "2025-01-01" }],
      planned: [],
      wellness_history: [{ date: "2025-01-01", hrv: 50 }],
      performance: [{ workoutDay: "2025-01-01", ctl: 40 }],
    },
    {
      history: [],
      planned: [],
      wellness_history: [],
      performance: [],
      cached_ranges: [{ start: "2026-07-01", end: "2026-11-01" }],
    }
  );
  assert.equal(merged.history[0].id, "old");
  assert.equal(merged.wellness_history[0].hrv, 50);
  assert.equal(merged.performance[0].ctl, 40);
});
