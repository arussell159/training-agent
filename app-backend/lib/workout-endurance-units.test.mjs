import test from "node:test";
import assert from "node:assert/strict";
import { fakeProvider, fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";
import {
  createWorkoutEditor,
  loadNewWorkoutEditor,
  loadWorkoutEditor,
  saveWorkoutEditor,
} from "./workout-editor.mjs";
import { createProviderWorkoutMetadata } from "./provider-workout-metadata.mjs";
import {
  newStep,
  readEditorModel,
  serializeWorkout,
  verifyParsedWorkout,
  workoutTotals,
} from "./workout-editor-model.mjs";

function fixture() {
  const provider = fakeProvider(fixtureEvent("Swim")),
    records = new Map();
  const record = (key, fresh) => ({
    async read() {
      return structuredClone(records.get(key) ?? fresh());
    },
    async update(change) {
      const state = structuredClone(records.get(key) ?? fresh()),
        result = change(state);
      records.set(key, state);
      return structuredClone(result);
    },
  });
  return { provider, wrap: () => createProviderWorkoutMetadata({ record }).wrap(provider.request) };
}

for (const [unit, pace, pool, distance] of [
  ["m", "secs/100m", "25m", 400],
  ["yd", "secs/100y", "25y", 400],
  ["m", "secs/100m", "25y", 400],
  ["yd", "secs/100m", "50m", 200],
]) {
  test(`explicit swim ${unit}/${pace}/${pool} creates and reopens exact units, with only native text sent to the provider`, async () => {
    const f = fixture(),
      request = f.wrap(),
      loaded = await loadNewWorkoutEditor(request, "2026-10-25", {
        sport: "Swim",
        name: "Explicit swim units",
      });
    assert.equal(loaded.model.swimUnitMode, "explicit");
    const step = newStep("Swim");
    step.end = { kind: "distance", unit, value: distance, pressLap: true };
    step.target = { kind: "pace", unit: pace, mode: "range", start: 100, end: 110 };
    loaded.model.steps = [step];
    loaded.model.poolLength = pool;
    assert.deepEqual(readEditorModel(serializeWorkout(loaded.model)).steps, [step]);
    const created = await createWorkoutEditor(request, {
      model: loaded.model,
      creationId: crypto.randomUUID(),
      descriptionMode: "manual",
      description: "Plain swim coaching notes.",
    });
    const native = await f.provider.request(`/athlete/0/events/${created.event.id}`);
    assert.equal(native.workout_doc.steps[0].distance, distance * (unit === "yd" ? 0.9144 : 1));
    assert.equal(native.workout_doc.steps[0].pace.units, pace);
    assert.deepEqual(verifyParsedWorkout(loaded.model, created.event), []);
    const reopened = await loadWorkoutEditor(f.wrap(), created.workoutId);
    assert.deepEqual(reopened.issues, []);
    assert.deepEqual(reopened.model.steps, [step]);
    assert.equal(reopened.model.swimUnitMode, "explicit");
    assert.equal(workoutTotals(reopened.model).distance, distance * (unit === "yd" ? 0.9144 : 1));
    reopened.model.steps[0].notes = "Relax shoulders and breathe steadily";
    const changed = await saveWorkoutEditor(f.wrap(), created.workoutId, {
      model: reopened.model,
      revision: reopened.revision,
      descriptionMode: "manual",
      description: "Updated plain coaching notes.",
    });
    assert.equal(changed.verified, true);
    const again = await loadWorkoutEditor(f.wrap(), created.workoutId);
    assert.deepEqual(again.model.steps, reopened.model.steps);
    assert.equal(again.model.poolLength, pool);
    for (const call of f.provider.calls.filter((call) => call.method)) {
      const body = JSON.parse(call.body);
      assert.doesNotMatch(
        body.description,
        /Workout editor v1|"version"|"swimUnitMode"|"duration_seconds"/
      );
    }
  });
}

test("invalid cadence is rejected before any provider write", async () => {
  const f = fixture(),
    request = f.wrap(),
    loaded = await loadWorkoutEditor(request, "event:100");
  loaded.model.steps[0].cadence = { start: 95, end: 80 };
  await assert.rejects(
    saveWorkoutEditor(request, "event:100", { model: loaded.model, revision: loaded.revision }),
    /Cadence/
  );
  assert.equal(f.provider.calls.filter((call) => call.method).length, 0);
});
