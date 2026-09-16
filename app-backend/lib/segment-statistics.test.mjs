import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentStatistics } from "../../ui/src/lib/segment-statistics.ts";
test("segment averages weight real elapsed time, clip boundaries, include zeros and ignore missing values", () => {
  const result = segmentStatistics(
    [
      { time: 0, power: 0, heartRate: 140, speed: 4, cadence: 90, distance: 0 },
      { time: 2, power: 200, heartRate: null, speed: 6, cadence: 100, distance: 8 },
      { time: 10, power: null, heartRate: 150, speed: null, cadence: null, distance: 56 },
    ],
    1,
    6
  );
  assert.deepEqual(result, { power: 160, heartRate: 140, speed: 5.6, cadence: 98, duration: 5 });
});
test("empty or unavailable segment signals are null, never invented zero averages", () => {
  assert.deepEqual(segmentStatistics([], 1, 5), {
    power: null,
    heartRate: null,
    speed: null,
    cadence: null,
    duration: 4,
  });
});
