import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalsOnlyContext } from "./intervals-only-context.mjs";
import { mapIntervalsWorkout } from "./intervals.mjs";

test("planned/completed summary preserves exact seconds, provider units and missing data", () => {
  const event = {
    id: 456,
    start_date_local: "2026-09-15T00:00:00",
    type: "Swim",
    moving_time: 3265,
    distance: 2900 * 0.9144,
    icu_training_load: 63,
    icu_intensity: 83,
  };
  const actual = {
    id: "i123",
    moving_time: 3200,
    distance: 2900 * 0.9144,
    average_heartrate: 140,
    max_heartrate: 165,
    icu_joules: 120000,
    icu_weighted_avg_watts: 180,
    max_watts: 350,
    max_cadence: 95,
  };
  const mapped = mapIntervalsWorkout(event, "2026-09-15", actual);
  assert.equal(mapped.workout_summary.planned.duration_seconds, 3265);
  assert.equal(mapped.workout_summary.planned.intensity_factor, 0.83);
  assert.equal(mapped.workout_summary.planned.calories, null);
  assert.equal(mapped.workout_summary.completed.average_hr, 140);
  assert.equal(mapped.workout_summary.completed.work_kj, 120);
  assert.equal(mapped.workout_summary.completed.normalized_power, 180);
  assert.equal(mapped.workout_summary.completed.max_power, 350);
  assert.equal(mapped.workout_summary.completed.max_cadence, 95);
  assert.equal(mapIntervalsWorkout(event, "2026-09-15").workout_summary.completed, null);
  assert.equal(
    mapIntervalsWorkout({ ...event, id: "i999" }, "2026-09-15", null, true).workout_summary.planned,
    null
  );
});
test("training views expose only Intervals sessions, never demo or archived workouts", () => {
  const history = [
    { id: "activity:i123", activity_file_type: "fit" },
    { id: "event:456", activity_id: "i456", activity_file_type: "fit" },
    { id: "history-1" },
    { id: "mon" },
    { id: "tp-history:789", read_only: true },
  ];
  const result = intervalsOnlyContext({ history, planned: history, workouts: history });
  for (const key of ["history", "planned", "workouts"])
    assert.deepEqual(
      result[key].map((w) => w.id),
      ["activity:i123", "event:456"]
    );
  assert.equal(history.length, 5);
});

test("historical cleanup keeps only FIT recordings, including paired events and legacy cached activities", () => {
  const actual = {
    id: "i123",
    start_date_local: "2026-09-13T08:00:00",
    type: "Ride",
    file_type: "fit",
    moving_time: 3600,
  };
  const event = { id: 456, start_date_local: actual.start_date_local, type: "Ride" };
  const history = [
    mapIntervalsWorkout(actual, "2026-09-15", null, true),
    mapIntervalsWorkout(event, "2026-09-15", actual),
    mapIntervalsWorkout(event, "2026-09-15"),
    mapIntervalsWorkout({ ...actual, id: "i124", file_type: null }, "2026-09-15", null, true),
    { id: "activity:i125", raw: { file_type: "FIT" } },
    { id: "activity:i126", activity_file_type: "tcx" },
    { id: "activity:i127" },
    { id: "event:789", raw: { file_type: "fit" } },
  ];
  const result = intervalsOnlyContext({
    history,
    planned: history,
    workouts: history,
    metrics: { fitness: 42 },
  });
  for (const key of ["history", "planned", "workouts"])
    assert.deepEqual(
      result[key].map((w) => w.id),
      ["activity:i123", "event:456", "activity:i125"]
    );
  assert.deepEqual(result.metrics, { fitness: 42 });
  assert.equal(history.length, 8);
});

test("from the fixed cleanup boundary onward, planned and completed sessions need no FIT file", () => {
  const history = [
    { id: "event:1", workout_date: "2026-09-14", status: "upcoming" },
    { id: "activity:i2", workout_date: "2026-09-14", completed: true },
    { id: "event:3", workout_date: "2026-09-15", status: "today" },
    { id: "activity:i4", workout_date: "2026-09-15", completed: true },
    { id: "event:5", workout_date: "2026-10-04", status: "upcoming" },
    { id: "activity:i6", workout_date: "2026-10-05", completed: true },
    { id: "history-7", workout_date: "2026-10-05" },
    { id: "event:8", workout_date: "2026-10-05", source: "trainingpeaks-archive" },
  ];
  const result = intervalsOnlyContext({ history, planned: history, workouts: history });
  for (const key of ["history", "planned", "workouts"])
    assert.deepEqual(
      result[key].map((w) => w.id),
      ["event:3", "activity:i4", "event:5", "activity:i6"]
    );
});
