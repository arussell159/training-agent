import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAnalysis } from "./activity-analysis.mjs";
import { loadActivityView } from "./activity-bundle.mjs";
import { METERS_PER_100_YARDS, recordedSwimYards } from "./swim-units.mjs";
import { intervalSignals, formatSignalClock } from "../../ui/src/lib/interval-signals.ts";
import { plannedDistanceLabel } from "../../ui/src/lib/workout-distance.ts";

const start = "2026-09-18T12:00:00Z";
const timestamp = Date.parse(start) / 1000 - Date.UTC(1989, 11, 31) / 1000;

test("a recorded 100-yard swim in 1:31 displays 100 yd and 1:31 per 100 yd", () => {
  const analysis = normalizeAnalysis(
    { id: "i1", type: "Swim", start_date: start },
    [
      { type: "time", data: [0, 91] },
      { type: "distance", data: [0, 91.44] },
      { type: "velocity_smooth", data: [91.44 / 91, 91.44 / 91] },
    ],
    [{ timestamp, duration: 91, distance: 91.44 }]
  );
  const [interval] = intervalSignals(analysis.points, analysis.laps);
  assert.equal(recordedSwimYards(interval.lap.distance), 100);
  assert.equal(formatSignalClock(METERS_PER_100_YARDS / interval.point.speed), "1:31");
  assert.equal(analysis.laps[0].label, "100 yd · Lap 1");
  assert.equal(analysis.points[1].distance, 91.44); // Keep raw recording units intact.
  assert.equal(analysis.points[1].distance / METERS_PER_100_YARDS, 1); // Exactly one 100-yard split.
  assert.equal(
    plannedDistanceLabel({ sport: "Swim", status: "completed", distance_meters: 91.44 }),
    "100 yds"
  );
  assert.equal(
    plannedDistanceLabel({
      sport: "Swim",
      status: "planned",
      workout_summary: { planned: { distance_meters: 100 } },
    }),
    "~100 yds"
  );
});

test("watch FIT lap distances and precise times win over inferred Intervals boundaries", () => {
  const analysis = normalizeAnalysis(
    {
      id: "i1",
      type: "Swim",
      start_date: start,
      icu_intervals: [
        { type: "WORK", start_time: 0, end_time: 310, distance: 274.32 },
        { type: "WORK", start_time: 337, end_time: 390, distance: 45.72 },
      ],
    },
    [{ type: "time", data: [0, 309, 311, 364] }],
    [
      { timestamp, duration: 308.623, distance: 274.32 },
      { timestamp: timestamp + 309, duration: 2.641, distance: 0 },
      { timestamp: timestamp + 312, duration: 52.036, distance: 45.72 },
    ]
  );
  const intervals = intervalSignals(analysis.points, analysis.laps);
  assert.equal(intervals.length, 2);
  assert.deepEqual(
    intervals.map(({ lap, point }) => ({
      yards: Math.round(recordedSwimYards(lap.distance)),
      time: formatSignalClock(lap.end - lap.start),
      pace: formatSignalClock(METERS_PER_100_YARDS / point.speed),
    })),
    [
      { yards: 300, time: "5:09", pace: "1:43" },
      { yards: 50, time: "0:52", pace: "1:44" },
    ]
  );
});

test("existing version 4 swim views rebuild from archived SI data with corrected watch laps", async () => {
  let saved;
  const bundle = {
    activity: { id: "i1", type: "Swim", start_date: start },
    streams: [{ type: "time", data: [0, 91] }],
    fitLaps: [{ timestamp, duration: 91, distance: 91.44 }],
  };
  const archive = {
    ready: true,
    loadView: async () => ({ version: 4, laps: [{ label: "91 yd · Interval 1" }] }),
    load: async () => bundle,
    saveViews: async (_id, views) => {
      saved = views.analysis;
    },
  };
  const view = await loadActivityView(
    archive,
    {},
    () => {
      throw Error("No new provider request needed");
    },
    "i1",
    "analysis"
  );
  assert.equal(view.version, 5);
  assert.equal(view.laps[0].label, "100 yd · Lap 1");
  assert.equal(formatSignalClock(METERS_PER_100_YARDS / view.laps[0].speed), "1:31");
  assert.deepEqual(saved, view);
});
