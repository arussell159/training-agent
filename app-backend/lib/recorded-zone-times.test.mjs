import test from "node:test";
import assert from "node:assert/strict";
import { recordedZoneTimes, validRecordedZoneTimes } from "./recorded-zone-times.mjs";
import { mapIntervalsWorkout } from "./intervals.mjs";
import { fetchWorkoutHistoryPage } from "./intervals-history.mjs";
import { projectTrainingContext } from "./fast-context.mjs";

const source = () => ({
  id: "i123",
  type: "Ride",
  name: "Recording",
  start_date_local: "2026-10-19T09:00:00",
  moving_time: 60,
  icu_power_zones: [55, 75, 999],
  icu_ftp: 240,
  icu_zone_times: [
    { id: "Z3", secs: 30 },
    { id: "Z1", secs: 0 },
    { id: "SS", secs: 15 },
    { id: "Z2", secs: 30 },
  ],
  pace_zones: [80, 100, 999],
  threshold_pace: 4,
  pace_zone_times: [0, 20, 40],
  gap_zone_times: [10, 20, 30],
  use_gap_zone_times: false,
  calories: 0,
  total_elevation_gain: 12.5,
  total_elevation_loss: 0,
  icu_joules: 12000,
  max_speed: 5,
  max_heartrate: 180,
});

test("native power ZoneTime IDs order standard zones and exclude overlapping sweet spot", () => {
  const activity = source(),
    before = structuredClone(activity);
  assert.deepEqual(recordedZoneTimes(activity, "power"), {
    basis: "power",
    unit: "%ftp",
    boundaries_percent: [55, 75, 999],
    seconds: [0, 30, 30],
    threshold: 240,
  });
  assert.deepEqual(activity, before);
  assert.equal(
    recordedZoneTimes(
      { ...activity, icu_power_zones: undefined, power_zones: [55, 75, 999] },
      "power"
    ),
    null
  );
  assert.equal(recordedZoneTimes({ ...activity, icu_ftp: null }, "power").threshold, null);
});
test("ordinary and gradient-adjusted speed zone sources remain distinct and never substitute missing GAP", () => {
  const activity = source();
  assert.deepEqual(recordedZoneTimes(activity, "pace"), {
    basis: "speed",
    unit: "%threshold-speed",
    boundaries_percent: [80, 100, 999],
    seconds: [0, 20, 40],
    threshold: 4,
  });
  assert.equal(
    recordedZoneTimes({ ...activity, use_gap_zone_times: true }, "pace").basis,
    "gap-speed"
  );
  assert.deepEqual(
    recordedZoneTimes({ ...activity, use_gap_zone_times: true }, "pace").seconds,
    [10, 20, 30]
  );
  assert.equal(
    recordedZoneTimes({ ...activity, use_gap_zone_times: true, gap_zone_times: null }, "pace"),
    null
  );
});
test("malformed native zones fail bounded validation instead of becoming invented zeroes", () => {
  const activity = source();
  for (const icu_zone_times of [
    null,
    [],
    [{ id: "Z1", secs: 60 }],
    activity.icu_zone_times.concat({ id: "Z1", secs: 0 }),
    [{ id: "Z1", secs: -1 }],
    activity.icu_zone_times.concat({ id: "Z4", secs: 0 }),
    activity.icu_zone_times.concat({ id: "other", secs: 0 }),
  ])
    assert.equal(recordedZoneTimes({ ...activity, icu_zone_times }, "power"), null);
  for (const pace_zone_times of [null, [], [0, 10], [0, -1, 60], [0, NaN, 60]])
    assert.equal(recordedZoneTimes({ ...activity, pace_zone_times }, "pace"), null);
  for (const pace_zones of [[100, 80, 999], [80, 80, 999], Array(101).fill(1)])
    assert.equal(recordedZoneTimes({ ...activity, pace_zones }, "pace"), null);
  assert.equal(
    validRecordedZoneTimes({ ...recordedZoneTimes(activity, "power"), unit: "watts" }),
    false
  );
});
test("historical report requests native aggregate fields and paired summaries retain only actual source", async () => {
  let path;
  const page = await fetchWorkoutHistoryPage(
    async (value) => {
      path = value;
      return [source()];
    },
    { start: "2026-10-01", end: "2026-10-20" }
  );
  const fields = new URL(`https://fixture.invalid${path}`).searchParams.get("fields").split(",");
  for (const field of [
    "icu_zone_times",
    "icu_power_zones",
    "pace_zones",
    "pace_zone_times",
    "gap_zone_times",
    "use_gap_zone_times",
    "calories",
    "total_elevation_gain",
    "icu_joules",
  ])
    assert.ok(fields.includes(field), field);
  assert.equal(fields.includes("power_zones"), false);
  const planned = {
    ...source(),
    id: 10,
    type: "Run",
    category: "WORKOUT",
    calories: 999,
    icu_zone_times: null,
  };
  const row = mapIntervalsWorkout(planned, "2026-10-20", source());
  assert.equal(row.workout_summary.completed.calories, 0);
  assert.equal(row.workout_summary.completed.work_kj, 12);
  assert.equal(row.workout_summary.completed.elevation_gain, 12.5);
  assert.equal(row.workout_summary.planned.calories, 999);
  assert.deepEqual(row.workout_summary.completed.power_zone_times.seconds, [0, 30, 30]);
  const context = projectTrainingContext(
    { athlete: {}, metrics: {}, history: [row], planned: [] },
    "full",
    new Date("2026-10-20T12:00:00Z")
  );
  assert.deepEqual(
    context.history[0].workout_summary.completed.power_zone_times,
    page.workouts[0].workout_summary.completed.power_zone_times
  );
});
