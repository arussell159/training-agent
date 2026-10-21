import test from "node:test";
import assert from "node:assert/strict";
import {
  loadNewWorkoutEditor,
  createWorkoutEditor,
  loadWorkoutEditor,
  saveWorkoutEditor,
} from "./workout-editor.mjs";
import { fakeProvider, fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";
import { createProviderWorkoutMetadata } from "./provider-workout-metadata.mjs";
import { readPlannedValues } from "./planned-workout-values.mjs";
import { newStep, importWorkout, expandSteps, serializeWorkout } from "./workout-editor-model.mjs";
const creationId = "172ce7bc-18be-4b1c-8e9f-8d13305490a2";

test("desktop calendar drafts create and verify all five workout choices", async () => {
  for (const sport of ["Swim", "Ride", "Run", "Other", "WeightTraining"]) {
    const provider = fakeProvider(fixtureEvent());
    const { model } = await loadNewWorkoutEditor(provider.request, "2026-10-14", {
      sport,
      name: sport === "Other" ? "Sauna" : sport,
    });
    assert.equal(model.sport, sport);
    model.steps = [newStep(sport)];
    const saved = await createWorkoutEditor(provider.request, { model, creationId });
    assert.equal(saved.verified, true);
    assert.equal(saved.event.type, sport);
    if (["Other", "WeightTraining"].includes(sport))
      assert.equal(model.steps[0].target.kind, "none");
  }
});

test("the Walk sport-picker choice creates, saves and reopens without a cycling power target", async () => {
  const provider = fakeProvider(fixtureEvent());
  const loaded = await loadNewWorkoutEditor(provider.request, "2026-10-21", {
    sport: "Walk",
    name: "Easy walk",
  });
  loaded.model.steps = [newStep("Walk")];
  assert.equal(loaded.model.steps[0].target.kind, "none");
  const saved = await createWorkoutEditor(provider.request, { model: loaded.model, creationId });
  assert.equal(saved.verified, true);
  assert.equal(saved.event.type, "Walk");
  const reopened = await loadWorkoutEditor(provider.request, saved.workoutId);
  assert.equal(reopened.model.sport, "Walk");
  assert.deepEqual(reopened.issues, []);
  reopened.model.steps[0].end.value = 1200;
  const edited = await saveWorkoutEditor(provider.request, saved.workoutId, {
    model: reopened.model,
    revision: reopened.revision,
  });
  assert.equal(edited.verified, true);
  assert.equal(edited.event.workout_doc.steps[0].duration, 1200);
});

for (const sport of ["MountainBikeRide", "Rowing", "NordicSki", "Workout"])
  test(`${sport}: a supported provider sport creates, reloads and edits without changing its identity`, async () => {
    const provider = fakeProvider(fixtureEvent());
    const loaded = await loadNewWorkoutEditor(provider.request, "2026-10-21", {
      sport,
      name: `Disposable ${sport}`,
    });
    loaded.model.steps = [newStep(sport)];
    assert.equal(
      loaded.model.steps[0].target.kind,
      sport === "MountainBikeRide" ? "power" : "none"
    );
    const saved = await createWorkoutEditor(provider.request, { model: loaded.model, creationId });
    assert.equal(saved.verified, true);
    assert.equal(saved.event.type, sport);
    const reopened = await loadWorkoutEditor(provider.request, saved.workoutId);
    assert.equal(reopened.model.sport, sport);
    assert.deepEqual(reopened.issues, []);
    reopened.model.steps[0].end.value = 1200;
    const edited = await saveWorkoutEditor(provider.request, saved.workoutId, {
      model: reopened.model,
      revision: reopened.revision,
    });
    assert.equal(edited.verified, true);
    assert.equal(edited.event.type, sport);
    assert.equal(edited.event.workout_doc.steps[0].duration, 1200);
    assert.equal(edited.event.id, saved.event.id);
    assert.equal((await loadWorkoutEditor(provider.request, saved.workoutId)).model.sport, sport);
  });

test("unsupported TrainingPeaks labels and invented provider identifiers fail before creating a record", async () => {
  for (const sport of [
    "Brick",
    "Day off",
    "Custom",
    "CrossTraining",
    "MountainBike",
    "NordicSkiing",
  ]) {
    const provider = fakeProvider(fixtureEvent());
    await assert.rejects(
      loadNewWorkoutEditor(provider.request, "2026-10-21", { sport }),
      /supported workout sport/
    );
    assert.equal(provider.calls.length, 0);
  }
});

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

function privateDerivedProvider({ uncertainCreate = false, corrupt } = {}) {
  const provider = fakeProvider(fixtureEvent(), { uncertainCreate }),
    records = new Map();
  const raw = async (path, options) => {
    const result = await provider.request(path, options);
    const project = (event) => {
      if (event?.external_id?.startsWith("training-agent:editor:")) {
        event.icu_intensity = 73.484695;
        corrupt?.(event);
      }
      return event;
    };
    return Array.isArray(result) ? result.map(project) : project(result);
  };
  const wrap = () =>
    createProviderWorkoutMetadata({
      record: (key, fresh) => ({
        read: async () => structuredClone(records.get(key) ?? fresh()),
        update: async (change) => {
          const state = structuredClone(records.get(key) ?? fresh());
          change(state);
          records.set(key, state);
          return structuredClone(state);
        },
      }),
    }).wrap(raw);
  return { provider, records, wrap };
}
function exactIfInput() {
  const step = newStep("Ride");
  step.end = { kind: "time", value: 600, unit: "s" };
  step.target = { kind: "power", unit: "%ftp", mode: "range", start: 70, end: 80 };
  return {
    model: {
      version: 1,
      name: "Derived native intensity",
      sport: "Ride",
      date: "2026-11-01",
      notes: "Ride steadily.",
      poolLength: "",
      steps: [step],
    },
    creationId,
    values: { duration_seconds: 600, tss: 9, intensity_factor: 0.75 },
    descriptionMode: "manual",
    description: "Ride steadily.",
    time: "07:00",
    comment: "",
  };
}
test("provider-derived intensity never overrides exact private planned IF on create, reload, replay or editor update", async () => {
  const fixture = privateDerivedProvider(),
    input = exactIfInput(),
    saved = await createWorkoutEditor(fixture.wrap(), input);
  assert.equal(saved.verified, true);
  assert.equal(saved.event.icu_intensity, 73.484695);
  assert.equal(saved.event.time_target, 600);
  assert.equal(saved.event.load_target, 9);
  assert.equal(readPlannedValues(saved.event.description).intensity_factor, 0.75);
  const posts = fixture.provider.calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 1);
  const native = JSON.parse(posts[0].body);
  assert.equal(Object.hasOwn(native, "icu_intensity"), false);
  assert.doesNotMatch(native.description, /Workout editor v1|training-agent-planned-values/);
  assert.match(native.description, /600s 70-80%/);
  const replay = await createWorkoutEditor(fixture.wrap(), { ...input, reconcileOnly: true });
  assert.equal(replay.workoutId, saved.workoutId);
  assert.equal(fixture.provider.calls.filter((call) => call.method === "POST").length, 1);
  const loaded = await loadWorkoutEditor(fixture.wrap(), saved.workoutId);
  assert.equal(loaded.plannedValues.intensity_factor, 0.75);
  const edit = {
    model: loaded.model,
    revision: loaded.revision,
    values: { intensity_factor: 0.81 },
  };
  const updated = await saveWorkoutEditor(fixture.wrap(), saved.workoutId, edit);
  assert.equal(updated.verified, true);
  assert.equal(updated.event.icu_intensity, 73.484695);
  assert.equal(readPlannedValues(updated.event.description).intensity_factor, 0.81);
  assert.equal(
    Object.hasOwn(
      JSON.parse(fixture.provider.calls.find((call) => call.method === "PUT").body),
      "icu_intensity"
    ),
    false
  );
  await saveWorkoutEditor(fixture.wrap(), saved.workoutId, edit);
  assert.equal(fixture.provider.calls.filter((call) => call.method === "PUT").length, 1);
});
test("lost create acknowledgement reconciles private IF against exact native targets without duplicate POST", async () => {
  const fixture = privateDerivedProvider({ uncertainCreate: true }),
    input = exactIfInput();
  const saved = await createWorkoutEditor(fixture.wrap(), input);
  assert.equal(saved.verified, true);
  const replay = await createWorkoutEditor(fixture.wrap(), { ...input, reconcileOnly: true });
  assert.equal(replay.workoutId, saved.workoutId);
  assert.equal(
    (await loadWorkoutEditor(fixture.wrap(), saved.workoutId)).plannedValues.intensity_factor,
    0.75
  );
  assert.equal(fixture.provider.calls.filter((call) => call.method === "POST").length, 1);
});
test("explicit private planned IF zero and null remain exact beside nonzero derived native intensity", async () => {
  for (const value of [0, null]) {
    const fixture = privateDerivedProvider(),
      input = exactIfInput();
    input.values.intensity_factor = value;
    const saved = await createWorkoutEditor(fixture.wrap(), input);
    assert.equal(saved.verified, true);
    assert.equal(saved.event.icu_intensity, 73.484695);
    assert.equal(
      (await loadWorkoutEditor(fixture.wrap(), saved.workoutId)).plannedValues.intensity_factor,
      value
    );
  }
});
test("derived intensity handling does not accept mismatched native targets, identities or parsed prescription", async () => {
  for (const corrupt of [
    (event) => (event.time_target = 601),
    (event) => (event.load_target = 10),
    (event) => (event.name = "Different"),
    (event) => (event.workout_doc.steps[0].power.start = 65),
    (event) => (event.description += " changed"),
  ]) {
    const fixture = privateDerivedProvider({ corrupt });
    await assert.rejects(
      createWorkoutEditor(fixture.wrap(), exactIfInput()),
      (error) => error.code === "CREATE_UNCONFIRMED"
    );
    assert.equal(fixture.provider.calls.filter((call) => call.method === "POST").length, 1);
  }
});
