import { test } from "node:test";
import assert from "node:assert/strict";
import { swimCalendarDefinition } from "./swim-device-definition.mjs";
import {
  importWorkout,
  nativeWorkoutText,
  serializeWorkout,
  readEditorModel,
  verifyParsedWorkout,
} from "./workout-editor-model.mjs";
import { appWorkoutDescription } from "./workout-readable-description.mjs";
import { fixtureEvent, parseTestWorkout } from "./fixtures/workout-editor-fixtures.mjs";

test("calendar swims keep yard amounts and pace, including rest after the final repetition of every set", () => {
  const text = swimCalendarDefinition(
    "Main Set 3x\n- 50yd 1:40/100y Pace\n- 20s intensity=rest\nSecond Set 2x\n- 100mtr Z2 Pace\n- 30s intensity=rest"
  );
  const doc = parseTestWorkout(text);
  assert.match(text, /^Pool length: 25y/);
  assert.doesNotMatch(text, /\b[23]x\b|50y|\/100y/);
  assert.equal(doc.steps.length, 10);
  assert.deepEqual(
    doc.steps.map((step) => step.distance || step.duration),
    [50, 20, 50, 20, 50, 20, 100, 30, 100, 30]
  );
  assert.equal(doc.steps[0].pace.value, 100);
  assert.equal(doc.steps[0].duration, 50);
  assert.equal(doc.steps.at(-1).intensity, "rest");
});

test("editor swim exports 50 yd as 50mtr with final rest and reads back the exact yard prescription", () => {
  const model = importWorkout(fixtureEvent("Swim")).model;
  const repeat = model.steps[1];
  model.steps = [repeat];
  repeat.repetitions = 3;
  repeat.steps[0].end.value = 50;
  repeat.steps[0].target = { kind: "pace", unit: "secs/100y", mode: "single", value: 100 };
  const description = serializeWorkout(model);
  const doc = parseTestWorkout(description);
  assert.match(nativeWorkoutText(model), /50mtr 1:40 Pace/);
  assert.equal(doc.distance, 150);
  assert.equal(doc.steps.length, 6);
  assert.equal(doc.steps.at(-1).intensity, "rest");
  assert.deepEqual(verifyParsedWorkout(model, { workout_doc: doc }), []);
  assert.equal(readEditorModel(description).steps[0].steps[0].end.value, 50);
  assert.equal(readEditorModel(description).steps[0].steps[0].end.unit, "yd");
});

test("legacy editor swim documents remain readable and normalize metre labels without arithmetic", () => {
  const model = importWorkout(fixtureEvent("Swim")).model;
  model.steps = [model.steps[0]];
  model.steps[0].end = { kind: "distance", value: 50, unit: "m" };
  const current = serializeWorkout(model);
  const legacy = current.replace(nativeWorkoutText(model), nativeWorkoutText(model, true));
  assert.equal(readEditorModel(legacy).steps[0].end.value, 50);
  assert.equal(readEditorModel(legacy).steps[0].end.unit, "yd");
  const imported = importWorkout({
    ...fixtureEvent("Swim"),
    description: legacy,
    workout_doc: parseTestWorkout(legacy),
  });
  assert.deepEqual(imported.issues, []);
  assert.equal(imported.model.steps[0].end.value, 50);
  assert.equal(imported.model.steps[0].end.unit, "yd");
});

test("old cached and completed swim instructions regenerate exact yards from provider steps", () => {
  for (const status of ["planned", "completed"]) {
    const text = appWorkoutDescription({
      sport: "Swim",
      status,
      app_description_version: 1,
      details: "54.680665 yd",
      structure: JSON.stringify({
        steps: [{ distance: 50, duration: 50, pace: { units: "secs", value: 100 } }],
      }),
    });
    assert.match(text, /50 yd/);
    assert.match(text, /1:40 min\/100y/);
    assert.doesNotMatch(text, /54\.68/);
  }
});

test("swim repeat expansion rejects invalid or excessive groups", () => {
  assert.throws(() => swimCalendarDefinition("0x\n- 50yd\n- 20s rest"), /Invalid/);
  assert.throws(() => swimCalendarDefinition("1001x\n- 50yd\n- 20s rest"), /Invalid/);
});
