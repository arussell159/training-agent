import test from "node:test";
import assert from "node:assert/strict";
import { mapIntervalsWorkout } from "./intervals.mjs";
import { fetchWorkoutHistoryPage } from "./intervals-history.mjs";
import { projectTrainingContext } from "./fast-context.mjs";

const activity = (extra = {}) => ({
  id: "i123",
  type: "VirtualRide",
  name: "Synthetic recording",
  start_date_local: "2026-10-19T09:00:00",
  moving_time: 1200,
  distance: 5000,
  icu_training_load: 0,
  power_load: 0,
  hr_load: 12,
  pace_load: null,
  hr_load_type: "HRSS",
  pace_load_type: null,
  icu_hr_zones: [130, 150, 180],
  icu_hr_zone_times: [0, 300, 900],
  lthr: 170,
  ...extra,
});

test("compact recorded summaries preserve zero loads, source algorithms and historical HR zone schemes", () => {
  const row = mapIntervalsWorkout(activity(), "2026-10-20", null, true);
  assert.equal(row.provider_type, "VirtualRide");
  assert.equal(row.activity_type, "VirtualRide");
  const summary = row.workout_summary.completed;
  assert.equal(summary.tss, 0);
  assert.equal(summary.power_load, 0);
  assert.equal(summary.hr_load, 12);
  assert.equal(summary.pace_load, null);
  assert.equal(summary.hr_load_type, "HRSS");
  assert.deepEqual(summary.heart_rate_zones, {
    seconds: [0, 300, 900],
    boundaries_bpm: [130, 150, 180],
    threshold_bpm: 170,
  });
  const context = projectTrainingContext(
    { athlete: {}, metrics: {}, history: [row], planned: [] },
    "full",
    new Date("2026-10-20T12:00:00Z")
  );
  assert.equal(context.history[0].raw_activity, undefined);
  assert.deepEqual(
    context.history[0].workout_summary.completed.heart_rate_zones,
    summary.heart_rate_zones
  );
});

test("paired records project actual sport, loads and HR zones independently of the planned prescription", () => {
  const planned = {
    id: 10,
    type: "Ride",
    category: "WORKOUT",
    name: "Plan",
    start_date_local: "2026-10-19T09:00:00",
    moving_time: 3600,
    load_target: 80,
    hr_load: 99,
    icu_hr_zones: [110],
    icu_hr_zone_times: [3600],
  };
  const row = mapIntervalsWorkout(planned, "2026-10-20", activity(), false);
  assert.equal(row.provider_type, "Ride");
  assert.equal(row.activity_type, "VirtualRide");
  assert.equal(row.workout_summary.planned.hr_load, 99);
  assert.equal(row.workout_summary.completed.hr_load, 12);
  assert.deepEqual(row.workout_summary.completed.heart_rate_zones.seconds, [0, 300, 900]);
});

test("missing or malformed HR schemes remain unavailable instead of fabricated zero zones", () => {
  for (const extra of [
    { icu_hr_zone_times: null },
    { icu_hr_zones: null },
    { icu_hr_zone_times: [] },
    { icu_hr_zone_times: [1, 2] },
    { icu_hr_zone_times: [0, -1, 100] },
    { icu_hr_zones: [130, 120, 180] },
    { icu_hr_zones: [130, NaN, 180] },
  ])
    assert.equal(
      mapIntervalsWorkout(activity(extra), "2026-10-20", null, true).workout_summary.completed
        .heart_rate_zones,
      null
    );
  const row = mapIntervalsWorkout(
    activity({ icu_hr_zone_times: [0, 0, 0], lthr: null }),
    "2026-10-20",
    null,
    true
  );
  assert.deepEqual(row.workout_summary.completed.heart_rate_zones, {
    seconds: [0, 0, 0],
    boundaries_bpm: [130, 150, 180],
    threshold_bpm: null,
  });
});

test("historical report requests explicitly select compact aggregate measurements without requesting streams", async () => {
  const paths = [];
  const page = await fetchWorkoutHistoryPage(
    async (path) => {
      paths.push(path);
      return [activity()];
    },
    { start: "2026-10-01", end: "2026-10-20" }
  );
  const fields = new URL(`https://fixture.invalid${paths[0]}`).searchParams
    .get("fields")
    .split(",");
  for (const key of [
    "power_load",
    "hr_load",
    "pace_load",
    "hr_load_type",
    "pace_load_type",
    "icu_hr_zones",
    "icu_hr_zone_times",
    "lthr",
  ])
    assert.ok(fields.includes(key), `${key} is selected`);
  assert.equal(paths.length, 1);
  assert.doesNotMatch(paths[0], /streams|\/file/);
  assert.equal(page.workouts[0].raw_activity, undefined);
  assert.equal(page.workouts[0].activity_type, "VirtualRide");
  assert.equal(page.workouts[0].workout_summary.completed.hr_load, 12);
});
