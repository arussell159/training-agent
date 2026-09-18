import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimatedPlannedDistance,
  plannedDistanceLabel,
} from "../../ui/src/lib/workout-distance.ts";
test("estimated distance multiplies planned average speed by planned time, never completed values", () => {
  const workout = {
    sport: "Run",
    workout_summary: {
      planned: { average_speed: 3, duration_seconds: 1200 },
      completed: { average_speed: 5, duration_seconds: 3000 },
    },
  };
  assert.equal(estimatedPlannedDistance(workout), 3600);
  assert.equal(plannedDistanceLabel(workout), "~2.24 mi");
});
test("swim summaries use yards and other sports use miles; power-only workouts do not fabricate distance", () => {
  assert.equal(
    plannedDistanceLabel({
      sport: "Swim",
      workout_summary: { planned: { distance_meters: 2900 } },
    }),
    "~2,900 yds"
  );
  assert.equal(
    plannedDistanceLabel({ sport: "Swim", status: "completed", distance_meters: 45.72 }),
    "50 yds"
  );
  assert.equal(
    estimatedPlannedDistance({
      sport: "Bike",
      workout_summary: { planned: { average_power: 180, duration_seconds: 3600 } },
    }),
    null
  );
  assert.equal(plannedDistanceLabel({ sport: "Bike" }), "—");
});
