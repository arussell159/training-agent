import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceSplits } from "../../ui/src/lib/distance-splits.ts";
import { canEditWorkout } from "../../ui/src/lib/workout-permissions.ts";

test("only uncompleted saved calendar workouts offer editing and deletion", () => {
  assert.equal(canEditWorkout({ id: "event:12", status: "upcoming" }), true);
  assert.equal(canEditWorkout({ id: "event:12", status: "today" }), true);
  assert.equal(canEditWorkout({ id: "event:12", status: "completed" }), false);
  assert.equal(canEditWorkout({ id: "event:12", status: "today", activity_id: "i34" }), false);
  assert.equal(canEditWorkout({ id: "activity:i34", status: "completed" }), false);
  assert.equal(canEditWorkout({ id: "library:12", status: "upcoming" }), false);
});

const point = (time, distance, heartRate, elevation) => ({
  time,
  distance,
  heartRate,
  elevation,
  speed: null,
  power: null,
});
test("distance splits interpolate boundaries, retain the final fraction and time-weight heart rate", () => {
  const splits = distanceSplits(
    [point(0, 0, 100, 10), point(100, 800, 150, 18), point(300, 2400, 180, 34)],
    1600
  );
  assert.equal(splits.length, 2);
  assert.deepEqual(splits[0], {
    number: 1,
    start: 0,
    end: 200,
    distance: 1600,
    pace: 200,
    power: null,
    heartRate: 125,
    elevation: 16,
  });
  assert.deepEqual(splits[1], {
    number: 2,
    start: 200,
    end: 300,
    distance: 800,
    pace: 200,
    power: null,
    heartRate: 150,
    elevation: 8,
  });
});
test("missing split signals remain unavailable and net descent stays negative", () => {
  const splits = distanceSplits([point(0, 0, null, 30), point(600, 1609.344, null, 10)], 1609.344);
  assert.equal(splits[0].elevation, -20);
  assert.equal(splits[0].heartRate, null);
  assert.equal(
    distanceSplits([point(0, 0, null, null), point(100, 1000, null, null)], 1000)[0].elevation,
    null
  );
  assert.deepEqual(distanceSplits([], 1609.344), []);
  assert.deepEqual(distanceSplits([point(0, 0, null, null)], 1609.344), []);
});
