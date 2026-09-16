import test from "node:test";
import assert from "node:assert/strict";
import {
  loadNewWorkoutEditor,
  createWorkoutEditor,
  loadWorkoutEditor,
  saveWorkoutEditor,
} from "./workout-editor.mjs";
import { fakeProvider, fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";
import { newStep, importWorkout, expandSteps, serializeWorkout } from "./workout-editor-model.mjs";
const creationId = "172ce7bc-18be-4b1c-8e9f-8d13305490a2";

test("opening a new workout does not create an event; saving creates once and remains editable", async () => {
  const provider = fakeProvider(fixtureEvent());
  const loaded = await loadNewWorkoutEditor(provider.request, "2026-10-12");
  assert.equal(loaded.model.date, "2026-10-12");
  assert.equal(loaded.model.steps.length, 0);
  assert.ok(provider.calls.every((c) => !c.method));
  loaded.model.steps = [newStep("Ride")];
  loaded.model.steps[0].end.value = 180;
  const input = { model: loaded.model, creationId };
  const result = await createWorkoutEditor(provider.request, input);
  assert.equal(result.verified, true);
  assert.equal(result.event.start_date_local, "2026-10-12T00:00:00");
  assert.equal(result.event.workout_doc.steps[0].duration, 180);
  assert.equal(
    JSON.parse(provider.calls.find((c) => c.method === "POST").body).workout_doc,
    undefined
  );
  const retry = await createWorkoutEditor(provider.request, input);
  assert.equal(retry.workoutId, result.workoutId);
  assert.equal(provider.calls.filter((c) => c.method === "POST").length, 1);
  const reloaded = await loadWorkoutEditor(provider.request, result.workoutId);
  reloaded.model.steps[0].end.value = 240;
  await saveWorkoutEditor(provider.request, result.workoutId, {
    model: reloaded.model,
    revision: reloaded.revision,
  });
  assert.equal(
    (await loadWorkoutEditor(provider.request, result.workoutId)).model.steps[0].end.value,
    240
  );
});
test("an uncertain create reconciles the same external ID without a second POST", async () => {
  const provider = fakeProvider(fixtureEvent(), { uncertainCreate: true });
  const { model } = await loadNewWorkoutEditor(provider.request, "2026-10-12");
  model.steps = [newStep("Run")];
  model.sport = "Run";
  const created = await createWorkoutEditor(provider.request, { model, creationId });
  assert.equal(created.verified, true);
  await createWorkoutEditor(provider.request, { model, creationId, reconcileOnly: true });
  assert.equal(provider.calls.filter((c) => c.method === "POST").length, 1);
});
test("rechecking an unknown creation never sends another POST", async () => {
  const provider = fakeProvider(fixtureEvent());
  const { model } = await loadNewWorkoutEditor(provider.request, "2026-10-12");
  model.steps = [newStep("Swim")];
  model.sport = "Swim";
  model.poolLength = "25y";
  await assert.rejects(
    createWorkoutEditor(provider.request, { model, creationId, reconcileOnly: true }),
    (e) => e.code === "CREATE_UNCONFIRMED"
  );
  assert.equal(provider.calls.filter((c) => c.method === "POST").length, 0);
});
test("provider seconds preserve 30-second steps, 3-minute group totals and 3-minute work intervals", () => {
  const event = {
    ...fixtureEvent(),
    description: "",
    workout_doc: {
      steps: [
        {
          reps: 3,
          duration: 180,
          steps: [
            { duration: 30, power: { units: "w", value: 170 } },
            { duration: 30, power: { units: "w", value: 100 } },
          ],
        },
        {
          reps: 3,
          duration: 900,
          steps: [
            { duration: 180, power: { units: "w", value: 150 } },
            { duration: 120, power: { units: "w", value: 165 } },
          ],
        },
      ],
    },
  };
  const { model, issues } = importWorkout(event);
  assert.deepEqual(issues, []);
  assert.deepEqual(
    model.steps[0].steps.map((s) => s.end.value),
    [30, 30]
  );
  assert.equal(
    expandSteps([model.steps[0]]).reduce((n, { step }) => n + step.end.value, 0),
    180
  );
  assert.deepEqual(
    model.steps[1].steps.map((s) => s.end.value),
    [180, 120]
  );
  const text = serializeWorkout(model);
  assert.match(text, /- 180s 150w/);
  assert.match(text, /- 30s 170w/);
});
