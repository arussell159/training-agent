import test from "node:test";
import assert from "node:assert/strict";
import {
  recordedAnalysisThresholds,
  validRecordedAnalysisThresholds,
  historicalAnalysisThresholds,
} from "./recorded-analysis-thresholds.mjs";
import { mapIntervalsWorkout } from "./intervals.mjs";
import { loadActivityView } from "./activity-bundle.mjs";

test("completed and paired summaries use recorded activity thresholds rather than planned/current settings", () => {
  const activity = {
    id: "i77",
    type: "Ride",
    start_date_local: "2026-10-01T09:00:00",
    moving_time: 1800,
    icu_ftp: 240,
    icu_power_zones: [55, 75, 90, 105, 120, 150, 999],
    threshold_pace: 3.2,
    pace_zones: [80, 90, 100, 110, 999],
  };
  const event = {
    id: 7,
    type: "Ride",
    category: "WORKOUT",
    start_date_local: "2026-10-01T09:00:00",
    icu_ftp: 390,
    moving_time: 2400,
  };
  const expected = {
    version: 1,
    source: "intervals-activity",
    ftp: 240,
    powerZones: [55, 75, 90, 105, 120, 150, 999],
    thresholdPace: 3.2,
    paceZones: [80, 90, 100, 110, 999],
  };
  assert.deepEqual(
    mapIntervalsWorkout(activity, "2026-10-02", null, true).workout_summary.completed
      .recorded_thresholds,
    expected
  );
  const paired = mapIntervalsWorkout(event, "2026-10-02", activity);
  assert.deepEqual(paired.workout_summary.completed.recorded_thresholds, expected);
  assert.equal(paired.workout_summary.planned.recorded_thresholds, undefined);
  assert.equal(historicalAnalysisThresholds({ recorded_thresholds: expected }).ftp, 240);
});

test("missing historical thresholds remain missing; load/intensity and device fields cannot invent FTP", () => {
  const result = recordedAnalysisThresholds({
    ftp: 300,
    thresholdPower: 400,
    normalized_power: 200,
    intensity_factor: 0.8,
    icu_ftp: null,
    threshold_pace: null,
    power_zones: [55, 75, 100, 999], // Athlete settings are not the Activity schema.
  });
  assert.deepEqual(result, {
    version: 1,
    source: "intervals-activity",
    ftp: null,
    powerZones: [],
    thresholdPace: null,
    paceZones: [],
  });
  assert.equal(
    historicalAnalysisThresholds({ normalized_power: 200, intensity_factor: 0.8 }),
    null
  );
  for (const bad of [0, -1, Infinity, NaN, "240", {}, []]) {
    assert.equal(recordedAnalysisThresholds({ icu_ftp: bad }).ftp, null);
    assert.equal(validRecordedAnalysisThresholds({ ...result, ftp: bad }), false);
  }
});

test("historical percentage boundaries are ordered, finite, isolated copies", () => {
  const activity = { icu_ftp: 250, icu_power_zones: [55, 75, 100, 999] };
  const result = recordedAnalysisThresholds(activity);
  result.powerZones[0] = 30;
  assert.equal(activity.icu_power_zones[0], 55);
  for (const zones of [
    [0, 100],
    [55, 55],
    [100, 75],
    [55, "75"],
    [55, Infinity],
    Array.from({ length: 101 }, (_, i) => i + 1),
  ]) {
    assert.deepEqual(recordedAnalysisThresholds({ icu_power_zones: zones }).powerZones, []);
    assert.equal(validRecordedAnalysisThresholds({ ...result, powerZones: zones }), false);
  }
  assert.equal(validRecordedAnalysisThresholds({ ...result, source: "current-settings" }), false);
});

test("older cached summary upgrades from archived activity, without loading current settings or overwriting recorded totals", async () => {
  const view = {
    duration_seconds: 1234,
    elapsed_time_seconds: 1300,
    normalized_power: 199,
    tss: 42,
  };
  let stored;
  const result = await loadActivityView(
    {
      ready: true,
      loadView: async () => view,
      load: async () => ({
        activity: {
          icu_ftp: 220,
          icu_power_zones: [55, 75, 100, 999],
          elapsed_time: 1300,
          icu_weighted_avg_watts: 199,
        },
        route: [],
      }),
      saveViews: async (_id, views) => {
        stored = views.summary;
      },
    },
    {},
    async () => {
      throw Error("must not read current athlete settings");
    },
    "i77",
    "summary"
  );
  assert.equal(result.duration_seconds, 1234);
  assert.equal(result.tss, 42);
  assert.equal(result.recorded_thresholds.ftp, 220);
  assert.deepEqual(result.recorded_thresholds.powerZones, [55, 75, 100, 999]);
  assert.deepEqual(stored.recorded_thresholds, result.recorded_thresholds);
});
