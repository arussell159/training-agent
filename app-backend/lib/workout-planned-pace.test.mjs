import test from "node:test";
import assert from "node:assert/strict";
import { newStep, workoutTotals, paceFactors } from "./workout-editor-model.mjs";

const paceStep = (
  sport,
  seconds,
  first,
  last = first,
  mode = first === last ? "single" : "range",
  unit = "%pace"
) => ({
  ...newStep(sport),
  end: { kind: "time", value: seconds, unit: "s" },
  target:
    mode === "single"
      ? { kind: "pace", unit, mode, value: first }
      : { kind: "pace", unit, mode, start: first, end: last },
});
const model = (sport, steps) => ({
  version: 1,
  name: "Pace calculation",
  sport,
  date: "2026-10-21",
  notes: "",
  poolLength: "",
  thresholds: { pace: 1609.344 / 530 },
  steps,
});

test("Run duration correction reproduces all four fresh native target probes", () => {
  for (const [seconds, target, expected] of [
    [600, 100, 18],
    [1200, 100, 36],
    [3600, 100, 111],
    [600, 110, 21],
  ]) {
    const totals = workoutTotals(model("Run", [paceStep("Run", seconds, target)]));
    assert.equal(Math.round(totals.load), expected);
    assert.equal(totals.intensityFactor, target / 100);
  }
});

test("Run weights interval speed factors by time before applying sport duration correction", () => {
  const totals = workoutTotals(
    model("Run", [paceStep("Run", 600, 105, 115), paceStep("Run", 300, 70, 90)])
  );
  assert.equal(totals.intensityFactor, 1);
  assert.equal(totals.load, Math.round(((100 * 15 ** 1.025) / 60) * 10) / 10);
  assert.notEqual(totals.load, Math.round(((600 * 1.1 ** 2 + 300 * 0.8 ** 2) / 36) * 10) / 10);
});

test("Swim cubic stress and displayed factor reproduce fresh 200-yard range", () => {
  const workout = model("Swim", [paceStep("Swim", 168, 105, 115)]);
  workout.thresholds.pace = 91.44 / 93;
  workout.steps[0].end = { kind: "distance", value: 200, unit: "yd" };
  const totals = workoutTotals(workout, { plannedDistanceTime: "whole-metres" });
  assert.ok(Math.abs(totals.seconds - 168) < 1e-10);
  assert.equal(Math.round(totals.load), 6);
  assert.equal(totals.intensityFactor, 1.15);
});

test("native planned whole-metre timing preserves canonical distance and the original prescription", () => {
  for (const [yards, target, expected] of [
    [200, 110, 168],
    [200, 100, 185],
    [10000, 100, 9299],
  ]) {
    const workout = model("Swim", [paceStep("Swim", 1, target)]);
    workout.thresholds.pace = 91.44 / 93;
    workout.steps[0].end = { kind: "distance", value: yards, unit: "yd" };
    const before = structuredClone(workout),
      canonical = workoutTotals(workout),
      planned = workoutTotals(workout, { plannedDistanceTime: "whole-metres" });
    assert.equal(planned.seconds, expected);
    assert.equal(planned.distance, yards * 0.9144);
    assert.ok(Math.abs(canonical.seconds - ((yards / 100) * 93) / (target / 100)) < 1e-9);
    assert.deepEqual(workout, before);
  }
});

test("absolute reciprocal pace ranges preserve sport stress and IF", () => {
  for (const sport of ["Run", "Swim"]) {
    const percentage = model(sport, [paceStep(sport, 600, 105, 115)]),
      expected = workoutTotals(percentage);
    for (const unit of ["secs/km", "secs/mi", "secs/100m", "secs/100y"]) {
      const physical = structuredClone(percentage),
        first = paceFactors[unit] / (physical.thresholds.pace * 1.15),
        last = paceFactors[unit] / (physical.thresholds.pace * 1.05);
      physical.steps[0].target = { kind: "pace", unit, mode: "range", start: first, end: last };
      const actual = workoutTotals(physical);
      assert.equal(actual.load, expected.load);
      assert.equal(actual.intensityFactor, expected.intensityFactor);
      assert.ok(Math.abs(actual.distance - expected.distance) < 1e-9);
    }
  }
});

test("unknown/open pace prescriptions keep stress unknown", () => {
  const workout = model("Run", [paceStep("Run", 600, 500, 500, "single", "secs/km")]);
  workout.thresholds = {};
  assert.equal(workoutTotals(workout).load, null);
  workout.steps[0].end.kind = "lap";
  assert.equal(workoutTotals(workout).load, null);
});
