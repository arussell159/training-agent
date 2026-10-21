import test from "node:test";
import assert from "node:assert/strict";
import { simpleWorkoutModel } from "./simple-workout.mjs";
import {
  importWorkout,
  nativeWorkoutText,
  readEditorModel,
  serializeWorkout,
  validateWorkout,
  workoutTotals,
} from "./workout-editor-model.mjs";
import { createWorkoutEditor, loadWorkoutEditor, saveWorkoutEditor } from "./workout-editor.mjs";
import { fakeProvider, fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";
import { createProviderWorkoutMetadata } from "./provider-workout-metadata.mjs";

const model = () =>
  simpleWorkoutModel({
    name: "Pool length integrity",
    sport: "Swim",
    date: "2026-10-21",
    description: "Keep the prescribed distance.",
    values: { distance_meters: 1000 },
  });

test("valid pool lengths retain their own units without changing legacy yard steps", () => {
  for (const poolLength of ["25y", "25m", "50m", "33.33m"]) {
    const original = { ...model(), poolLength };
    const loaded = readEditorModel(serializeWorkout(original));
    assert.equal(loaded.poolLength, poolLength);
    assert.deepEqual(loaded.steps, original.steps);
    assert.equal(loaded.steps[0].end.value, 1000);
    assert.equal(loaded.steps[0].end.unit, "yd");
    assert.equal(workoutTotals(loaded).distance, 914.4);
    assert.match(
      nativeWorkoutText(loaded),
      new RegExp(`^Pool length: ${poolLength.replace(".", "\\.")}`)
    );
  }
});

test("a metric pool survives native create, reload, change and save with identical distances", async () => {
  const p = fakeProvider(fixtureEvent("Swim"));
  const records = new Map();
  const record = (key, fresh) => ({
    async read() {
      return structuredClone(records.get(key) ?? fresh());
    },
    async update(change) {
      const state = structuredClone(records.get(key) ?? fresh());
      const result = change(state);
      records.set(key, state);
      return structuredClone(result);
    },
  });
  const request = createProviderWorkoutMetadata({ record }).wrap(p.request);
  const original = { ...model(), poolLength: "25m" };
  const created = await createWorkoutEditor(request, {
    model: original,
    values: { distance_meters: 1000 },
    creationId: "ac264d2c-cbef-494a-846d-22fc082544cb",
  });
  assert.equal(created.event.workout_doc.options.pool_length, "25m");
  const loaded = await loadWorkoutEditor(request, created.workoutId);
  assert.equal(loaded.model.poolLength, "25m");
  loaded.model.poolLength = "50m";
  const changed = await saveWorkoutEditor(request, created.workoutId, {
    model: loaded.model,
    revision: loaded.revision,
  });
  const restarted = createProviderWorkoutMetadata({ record }).wrap(p.request);
  const reloaded = await loadWorkoutEditor(restarted, created.workoutId);
  assert.equal(changed.event.workout_doc.options.pool_length, "50m");
  assert.equal(reloaded.model.poolLength, "50m");
  assert.deepEqual(reloaded.model.steps, original.steps);
  assert.equal(workoutTotals(reloaded.model).distance, 914.4);
  assert.equal(changed.event.distance_target, 1000);
  assert.equal(changed.event.workout_doc.steps[0].distance, 1000);
  for (const call of p.calls.filter((call) => call.method))
    assert.doesNotMatch(
      JSON.parse(call.body).description,
      /Workout editor v1|"poolLength"|"version":1/
    );
});

test("native pool import preserves metric equipment length and the existing yard-distance convention", () => {
  const event = fixtureEvent("Swim");
  event.workout_doc.options.pool_length = "50m";
  event.description = event.description.replace("Pool length: 25y", "Pool length: 50m");
  const imported = importWorkout(event);
  assert.equal(imported.model.poolLength, "50m");
  const initialDistance = workoutTotals(imported.model).distance;
  const reloaded = readEditorModel(serializeWorkout(imported.model));
  assert.equal(reloaded.poolLength, "50m");
  assert.equal(workoutTotals(reloaded).distance, initialDistance);
});

test("missing legacy pool defaults remain 25 yards", () => {
  const original = model();
  original.poolLength = "";
  assert.deepEqual(validateWorkout(original), []);
  assert.equal(readEditorModel(serializeWorkout(original)).poolLength, "25y");
  assert.equal(workoutTotals(original).distance, 914.4);
});

test("malformed, zero and nonfinite pool lengths fail before any provider mutation", async () => {
  for (const poolLength of [
    "0m",
    "0.0y",
    "-25m",
    "25",
    "25 yards",
    "Infinitym",
    "NaNm",
    `${"9".repeat(400)}m`,
    0,
    25,
    false,
    [],
    {},
  ]) {
    const invalid = { ...model(), poolLength };
    assert.match(validateWorkout(invalid).join(" "), /Pool length must be a positive number/);
    const p = fakeProvider(fixtureEvent("Swim"));
    await assert.rejects(
      createWorkoutEditor(p.request, {
        model: invalid,
        creationId: "ac264d2c-cbef-494a-846d-22fc082544cb",
      }),
      /Pool length/
    );
    assert.equal(p.calls.filter((call) => call.method).length, 0);
  }
});
