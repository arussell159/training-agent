import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasWorkoutStructure,
  structuredWorkoutProfile,
  workoutProfileSegments,
  workoutStepLabel,
} from "../../ui/src/lib/workout-structure.ts";
import { racePlan, nativeWorkoutDefinition } from "./race-plan-import.mjs";
test("recognizes the real Intervals workout_doc.steps schema", () => {
  assert.equal(hasWorkoutStructure(JSON.stringify({ steps: [{ duration: 60 }] })), true);
  assert.equal(hasWorkoutStructure(JSON.stringify({ steps: [] })), false);
  assert.equal(hasWorkoutStructure("invalid"), false);
});

test("hover metadata retains actual repetition groups and sport-specific target units", () => {
  const work = {
    text: "Steady",
    distance: 400,
    duration: 400,
    pace: { value: 3, units: "pace_zone" },
  };
  const rest = { duration: 30, intensity: "rest" };
  const segments = workoutProfileSegments(
    JSON.stringify({ steps: [{ reps: 3, steps: [work, rest] }] })
  );
  assert.equal(segments.length, 6);
  assert.equal(segments[2].repeatCount, 3);
  assert.equal(segments[2].group.length, 2);
  assert.ok(segments.every((segment) => segment.repeatCount === 3 && segment.group.length === 2));
  assert.equal(new Set(segments.map((segment) => segment.setId)).size, 1);
  assert.equal(workoutStepLabel(work, "Swim"), "400 yd at Z3");
  assert.equal(
    workoutStepLabel({ distance: 400, duration: 439, pace: { value: 100, units: "secs" } }, "Swim"),
    "400 yd at 1:40 /100 yd"
  );
  assert.equal(workoutStepLabel(rest, "Swim"), "30 secs rest");
  assert.equal(workoutStepLabel({ duration: 60, intensity: "rest" }, "Swim"), "1 min rest");
  assert.equal(workoutStepLabel({ duration: 75, intensity: "rest" }, "Swim"), "1:15 rest");
  assert.equal(
    workoutStepLabel({ duration: 90, power: { value: 173, units: "w" } }, "Bike"),
    "1:30 at 173w"
  );
  assert.equal(
    workoutStepLabel({ duration: 120, pace: { value: 450, units: "secs/mi" } }, "Run"),
    "2 min at 7:30 min/mile"
  );
  assert.equal(
    workoutStepLabel({ duration: 300, power: { value: 180, units: "w" } }, "Bike"),
    "5 min at 180w"
  );
});
test("actual repeat durations, recoveries, ramps and targets drive the profile", () => {
  const value = JSON.stringify({
    steps: [
      { duration: 60, power: { value: 100 } },
      {
        reps: 2,
        steps: [
          { duration: 120, power: { value: 200 } },
          { duration: 30, intensity: "rest" },
        ],
      },
      { duration: 60, ramp: true, power: { start: 100, end: 200 } },
    ],
  });
  const points = structuredWorkoutProfile(value);
  assert.equal(points.at(-1).position, 420);
  assert.equal(points[2].intensity, 95);
  assert.equal(points[4].intensity, 5);
  assert.ok(points.at(-1).intensity > points.at(-16).intensity);
});
test("every imported plan has a real profile and swim native definitions use yards and seconds", () => {
  for (const p of racePlan) {
    const points = structuredWorkoutProfile(JSON.stringify(p.workout_doc));
    assert.ok(points.length > 0);
    assert.ok(Math.abs(points.at(-1).position - p.workout_doc.duration) < 0.01);
  }
  const swim = racePlan.find((p) => p.name === "Swim 12x100 CSS");
  assert.match(nativeWorkoutDefinition(swim), /Pool length: 25y/);
  assert.match(nativeWorkoutDefinition(swim), /100mtr 1:32 Pace/);
  assert.match(nativeWorkoutDefinition(swim), /Rest 20s intensity=rest/);
});
