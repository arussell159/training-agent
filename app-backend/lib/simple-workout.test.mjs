import test from "node:test";
import assert from "node:assert/strict";
import { simpleWorkoutModel } from "./simple-workout.mjs";
import { createWorkoutEditor, loadWorkoutEditor, saveWorkoutEditor } from "./workout-editor.mjs";
import { fakeProvider, fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";
import { readPlannedValues } from "./planned-workout-values.mjs";
import { readWorkoutCommentText } from "./workout-comment-text.mjs";
import { newStep, verifyParsedWorkout } from "./workout-editor-model.mjs";
const creationId = "ac264d2c-cbef-494a-846d-22fc082544cb";
const base = {
  name: "Easy miles",
  sport: "Run",
  date: "2026-10-17",
  description: "Keep this relaxed.",
  values: { duration_seconds: 2700 },
};

test("duration-only sessions for all calendar sports export an untargeted verified native step", async () => {
  for (const sport of ["Run", "Ride", "Swim", "Other", "WeightTraining"]) {
    const model = simpleWorkoutModel({ ...base, sport });
    assert.equal(model.steps.length, 1);
    assert.deepEqual(model.steps[0].target, { kind: "none" });
    const p = fakeProvider(fixtureEvent(sport));
    const saved = await createWorkoutEditor(p.request, {
      model,
      creationId,
      values: base.values,
      time: "06:30",
      comment: "Easy effort today.",
    });
    assert.equal(saved.verified, true);
    assert.equal(saved.event.workout_doc.steps[0].duration, 2700);
    assert.equal(saved.event.start_date_local, "2026-10-17T06:30:00");
    assert.equal(saved.event.time_target, 2700);
    assert.deepEqual(verifyParsedWorkout(model, saved.event), []);
    assert.equal(
      readWorkoutCommentText(saved.event.description, saved.workoutId)[0].body,
      "Easy effort today."
    );
  }
});

test("distance-only easy sessions preserve run metres and the existing swim yard convention", async () => {
  for (const [sport, distance, unit] of [
    ["Run", 8046.72, "m"],
    ["Swim", 1000, "yd"],
  ]) {
    const model = simpleWorkoutModel({ ...base, sport, values: { distance_meters: distance } });
    assert.deepEqual(model.steps[0].end, { kind: "distance", value: distance, unit });
    const p = fakeProvider(fixtureEvent(sport));
    const saved = await createWorkoutEditor(p.request, {
      model,
      creationId,
      values: { distance_meters: distance },
    });
    assert.deepEqual(verifyParsedWorkout(model, saved.event), []);
    assert.equal(saved.event.distance_target, distance);
  }
});

test("a lost simple-session response retains one comment and one creation across retries", async () => {
  const p = fakeProvider(fixtureEvent("Run"), { uncertainCreate: true });
  const model = simpleWorkoutModel(base);
  const input = {
    model,
    creationId,
    comment: "Use the same comment on recheck.",
    values: {
      duration_seconds: 2700,
      distance_meters: 8046.72,
      tss: 40,
      intensity_factor: 0.7,
      calories: 440,
    },
    time: "17:45",
  };
  const first = await createWorkoutEditor(p.request, input);
  const again = await createWorkoutEditor(p.request, { ...input, reconcileOnly: true });
  assert.equal(again.workoutId, first.workoutId);
  assert.equal(p.calls.filter((c) => c.method === "POST").length, 1);
  assert.deepEqual(
    readWorkoutCommentText(first.event.description, first.workoutId),
    readWorkoutCommentText(again.event.description, again.workoutId)
  );
  assert.deepEqual(readPlannedValues(again.event.description), input.values);
});

test("a simple workout remains editable and can become structured without losing planned values or comments", async () => {
  const p = fakeProvider(fixtureEvent("Run"));
  const saved = await createWorkoutEditor(p.request, {
    model: simpleWorkoutModel(base),
    creationId,
    values: base.values,
    comment: "Plan comment.",
  });
  const loaded = await loadWorkoutEditor(p.request, saved.workoutId);
  loaded.model.steps.push(newStep("Run"));
  loaded.model.steps[1].end.value = 120;
  const edited = await saveWorkoutEditor(p.request, saved.workoutId, {
    model: loaded.model,
    revision: loaded.revision,
  });
  assert.equal(edited.event.workout_doc.steps.length, 2);
  assert.equal(readPlannedValues(edited.event.description).duration_seconds, 2700);
  assert.equal(
    readWorkoutCommentText(edited.event.description, saved.workoutId)[0].body,
    "Plan comment."
  );
});

test("invalid simple-session inputs and creation metadata cannot create an event", async () => {
  for (const values of [
    {},
    { duration_seconds: 0 },
    { duration_seconds: -1 },
    { duration_seconds: 1.5 },
  ])
    assert.throws(() => simpleWorkoutModel({ ...base, values }));
  for (const extra of [
    { time: "24:01" },
    { values: { normalized_power: 120 } },
    { comment: "x".repeat(2001) },
  ]) {
    const p = fakeProvider(fixtureEvent("Run"));
    await assert.rejects(
      createWorkoutEditor(p.request, { model: simpleWorkoutModel(base), creationId, ...extra })
    );
    assert.equal(p.calls.filter((c) => c.method === "POST").length, 0);
  }
});

test("a provider that loses planned values cannot report a verified create or duplicate on recheck", async () => {
  const p = fakeProvider(fixtureEvent("Run"));
  let posts = 0;
  const request = async (path, options = {}) => {
    const result = await p.request(path, options);
    if (options.method === "POST") posts++;
    if (path.startsWith("/athlete/0/events/") && !options.method)
      return { ...result, time_target: null };
    return result;
  };
  const input = { model: simpleWorkoutModel(base), creationId, values: base.values };
  await assert.rejects(createWorkoutEditor(request, input), (e) => e.code === "CREATE_UNCONFIRMED");
  await assert.rejects(
    createWorkoutEditor(request, { ...input, reconcileOnly: true }),
    (e) => e.code === "CREATE_UNCONFIRMED"
  );
  assert.equal(posts, 1);
});
