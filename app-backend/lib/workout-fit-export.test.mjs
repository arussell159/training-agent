import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { Decoder, Stream } from "@garmin/fitsdk";
import { encodeWorkoutFit } from "./workout-fit-export.mjs";
import { readFitWorkoutSteps, readFitWorkoutMetadata } from "./fit-workout-verification.mjs";
import { importWorkout, newStep, newRepeat, expandSteps } from "./workout-editor-model.mjs";
import { fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";

const model = (steps, sport = "Run") => ({
  version: 1,
  name: "Device workout",
  sport,
  date: "2026-10-22",
  notes: "",
  poolLength: sport === "Swim" ? "25y" : "",
  steps,
});
function decoded(bytes) {
  const decoder = new Decoder(Stream.fromBuffer(bytes));
  assert.equal(decoder.checkIntegrity(), true);
  const result = decoder.read({
    expandSubFields: false,
    expandComponents: false,
    mergeHeartRates: false,
  });
  assert.deepEqual(result.errors, []);
  return result.messages;
}
test("official SDK emits a valid FIT workout with every repeated run step and pace range", () => {
  const imported = importWorkout(fixtureEvent("Run")).model;
  const bytes = encodeWorkoutFit(imported);
  const messages = decoded(bytes);
  const steps = readFitWorkoutSteps(bytes);
  assert.equal(messages.fileIdMesgs[0].type, "workout");
  assert.equal(messages.workoutMesgs[0].sport, "running");
  assert.equal(messages.workoutMesgs[0].numValidSteps, 10);
  assert.equal(steps.length, 10);
  assert.equal(steps[0].durationValue, 300000);
  assert.deepEqual([steps[1].targetLow, steps[1].targetHigh], [3353, 3576]);
  assert.equal(steps[2].intensity, 4);
  assert.equal(steps[9].intensity, 3);
});
test("the reported two-mile 10:30-per-mile workout exports distance and speed without provider conversion", () => {
  const step = newStep("Run");
  step.end = { kind: "distance", value: 2, unit: "mi" };
  step.target = { kind: "pace", unit: "secs/mi", mode: "single", value: 630 };
  const steps = readFitWorkoutSteps(encodeWorkoutFit(model([step])));
  assert.equal(steps[0].durationType, 1);
  assert.equal(steps[0].durationValue, 321869);
  assert.equal(steps[0].targetType, 0);
  assert.equal(steps[0].targetLow, 2555);
  assert.equal(steps[0].targetHigh, 2555);
});
test("percentage pace uses the athlete's explicit threshold and rejects unknown thresholds", () => {
  const step = newStep("Run");
  step.target = { kind: "pace", unit: "%pace", mode: "range", start: 80, end: 90 };
  const source = model([step]);
  assert.throws(() => encodeWorkoutFit(source), /Set your threshold pace/);
  source.thresholds = { pace: 3 };
  const result = readFitWorkoutSteps(encodeWorkoutFit(source))[0];
  assert.deepEqual([result.targetLow, result.targetHigh], [2400, 2700]);
});
test("FIT distinguishes absolute watts/bpm from percentages and retains secondary cadence bounds", () => {
  const targets = [
    { kind: "power", unit: "w", mode: "single", value: 200 },
    { kind: "power", unit: "%ftp", mode: "single", value: 95 },
    { kind: "hr", unit: "bpm", mode: "single", value: 150 },
    { kind: "hr", unit: "%hr", mode: "single", value: 85 },
    { kind: "hr", unit: "%lthr", mode: "single", value: 100 },
  ];
  const source = model(
    targets.map((target) => ({ ...newStep("Ride"), target, cadence: { start: 85, end: 95 } })),
    "Ride"
  );
  const bytes = encodeWorkoutFit(source, { lthr: 170 });
  assert.deepEqual(
    readFitWorkoutSteps(bytes).map((step) => step.targetLow),
    [1200, 95, 250, 85, 270]
  );
  const step = decoded(bytes).workoutStepMesgs[0];
  assert.equal(step.secondaryTargetType, "cadence");
  assert.equal(step.secondaryCustomTargetValueLow, 85);
  assert.equal(step.secondaryCustomTargetValueHigh, 95);
});
test("manual lap endings stay open and planned swim distance remains in the device instructions", () => {
  const swim = newStep("Swim");
  swim.label = "100 yards easy";
  swim.target = { kind: "pace", unit: "pace_zone", mode: "single", value: 2 };
  const bytes = encodeWorkoutFit(model([swim], "Swim"));
  assert.deepEqual(readFitWorkoutMetadata(bytes)[0], {
    sport: 5,
    poolLengthMeters: 22.86,
    poolLengthUnit: "yards",
  });
  const step = readFitWorkoutSteps(bytes)[0];
  assert.equal(step.durationType, 5);
  assert.equal(step.targetValue, 2);
  assert.match(decoded(bytes).workoutStepMesgs[0].notes, /100 yd.*press lap/);
});
test("nested sets keep all between-set recoveries and the omitted final recovery choice", () => {
  const work = newStep("Run");
  const recovery = { ...newStep("Run", "recovery"), label: "Between efforts" };
  const setRecovery = { ...newStep("Run", "rest"), label: "Between sets" };
  const group = {
    ...newRepeat([work]),
    repetitions: 3,
    sets: 2,
    recovery,
    finalRecovery: false,
    setRecovery,
  };
  const outer = { ...newRepeat([group]), repetitions: 2 };
  const source = model([outer]);
  const expected = expandSteps(source.steps).map(({ step }) => step.label);
  const result = readFitWorkoutSteps(encodeWorkoutFit(source));
  assert.deepEqual(
    result.map((step) => step.name),
    expected
  );
  assert.equal(result.filter((step) => step.name === "Between sets").length, 2);
});
test("format limits never change continuous ramps or zone ranges into a different target", () => {
  const step = newStep("Ride");
  step.target = { kind: "power", unit: "w", mode: "ramp", start: 100, end: 200 };
  assert.throws(() => encodeWorkoutFit(model([step], "Ride")), /continuous target ramp/);
  step.target = { kind: "power", unit: "power_zone", mode: "range", start: 2, end: 4 };
  assert.throws(() => encodeWorkoutFit(model([step], "Ride")), /one zone per step/);
});
test("FIT labels and notes respect byte limits without splitting Unicode or compromising integrity", () => {
  const step = newStep("Run");
  step.notes = "🏃".repeat(100);
  const source = model([step]);
  source.notes = "É".repeat(1000);
  const bytes = encodeWorkoutFit(source);
  const messages = decoded(bytes);
  assert.equal(Buffer.byteLength(messages.workoutStepMesgs[0].notes), 252);
  assert.equal(Buffer.byteLength(messages.workoutMesgs[0].wktDescription), 254);
  assert.equal(messages.workoutStepMesgs[0].notes.includes("\ufffd"), false);
  bytes[bytes.length - 1] ^= 1;
  assert.equal(new Decoder(Stream.fromBuffer(bytes)).checkIntegrity(), false);
});
