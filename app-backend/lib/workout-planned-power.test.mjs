import test from "node:test";
import assert from "node:assert/strict";
import {
  newStep,
  newRepeat,
  expandSteps,
  plannedPowerMetrics,
  workoutTotals,
} from "./workout-editor-model.mjs";

const model = (steps) => ({
  version: 1,
  name: "Power calculation",
  sport: "Ride",
  date: "2026-10-21",
  notes: "",
  poolLength: "",
  thresholds: { ftp: 197 },
  steps,
});
const step = (
  seconds,
  first,
  last = first,
  mode = first === last ? "single" : "ramp",
  unit = "%ftp"
) => ({
  ...newStep("Ride"),
  end: { kind: "time", value: seconds, unit: "s" },
  target:
    mode === "single"
      ? { kind: "power", unit, mode, value: first }
      : { kind: "power", unit, mode, start: first, end: last },
});
// Independent literal one-second reference. Each sample is the exact average
// of power over that second; the 30 preceding samples form each NP window.
function oracle(workout) {
  const spans = [];
  for (const { step: s } of expandSteps(workout.steps)) {
    const t = s.target,
      factor = t.unit === "w" ? workout.thresholds.ftp : 100;
    const first =
      (t.mode === "single" ? t.value : t.mode === "range" ? (t.start + t.end) / 2 : t.start) /
      factor;
    const last = t.mode === "ramp" ? t.end / factor : first;
    for (let second = 0; second < s.end.value; second++)
      spans.push(first + ((last - first) * (second + 0.5)) / s.end.value);
  }
  let fourth = 0,
    window = 0,
    count = 0;
  for (let i = 0; i < spans.length; i++) {
    window += spans[i];
    if (i >= 30) window -= spans[i - 30];
    if (i >= 29) {
      fourth += (window / 30) ** 4;
      count++;
    }
  }
  return (fourth / count) ** 0.25;
}

test("fresh native four-repeat bike example matches normalized IF, stress and physical work", () => {
  const repeat = {
    ...newRepeat([step(360, 85, 95, "range"), step(180, 50, 60, "range")]),
    repetitions: 4,
  };
  const workout = model([repeat]),
    power = plannedPowerMetrics(workout),
    totals = workoutTotals(workout);
  assert.ok(Math.abs(power.normalizedIntensity - 0.8247863254214068) < 1e-12);
  assert.equal(power.samples, 2131, "the first NP sample uses seconds0–30, with no zero padding");
  assert.equal(power.normalizedIntensity.toFixed(2), "0.82");
  assert.equal(Math.round(totals.load), 41);
  assert.equal(Math.round(power.workKilojoules), 333);
  assert.ok(Math.abs(power.workKilojoules - 333.324) < 1e-8);
});

test("bounded calculation agrees with independent second-by-second windows across ramps, rests and short changes", () => {
  for (const steps of [
    [step(3600, 50, 100)],
    [step(300, 100, 20), step(120, 20, 80), step(600, 80)],
    [step(15, 0, 150), step(10, 150, 50), step(90, 50, 100), step(120, 100, 0)],
    [step(30, 100)],
    [step(31, 75)],
    [step(30, 200, 200, "single", "w"), step(120, 150, 250, "ramp", "w")],
  ]) {
    const workout = model(steps),
      result = plannedPowerMetrics(workout);
    assert.ok(
      Math.abs(result.normalizedIntensity - oracle(workout)) < 1e-10,
      JSON.stringify(steps.map((s) => s.target))
    );
  }
});

test("unknown thresholds, open time and non-power targets never manufacture normalized power", () => {
  assert.equal(
    plannedPowerMetrics({ ...model([step(600, 200, 200, "single", "w")]), thresholds: {} }),
    null
  );
  const open = step(300, 80);
  open.end.kind = "lap";
  assert.equal(plannedPowerMetrics(model([open])), null);
  const pace = step(300, 80);
  pace.target = { kind: "pace", unit: "%pace", mode: "single", value: 80 };
  assert.equal(plannedPowerMetrics(model([pace])), null);
  const short = plannedPowerMetrics(model([step(20, 100)]));
  assert.equal(short.normalizedPower, null);
  assert.equal(short.normalizedIntensity, null);
  assert.equal(short.samples, 0);
});

test("long valid drafts use bounded interval work rather than allocating millions of samples", () => {
  const workout = model([step(999 * 3600, 50, 100), step(999 * 3600, 100)]);
  const result = plannedPowerMetrics(workout);
  assert.ok(Number.isFinite(result.normalizedIntensity));
  assert.equal(result.samples, 999 * 7200 - 29);
  assert.ok(result.normalizedIntensity > 0.75 && result.normalizedIntensity < 1);
});
