import test from "node:test";
import assert from "node:assert/strict";
import { simpleWorkoutModel } from "./simple-workout.mjs";
import { createWorkoutEditor, loadWorkoutEditor, saveWorkoutEditor } from "./workout-editor.mjs";
import { fakeProvider, fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";
import { readPlannedValues } from "./planned-workout-values.mjs";
import { readWorkoutCommentText } from "./workout-comment-text.mjs";
import {
  newStep,
  verifyParsedWorkout,
  validateWorkout,
  importWorkout,
  workoutTotals,
  serializeWorkout,
} from "./workout-editor-model.mjs";
import {
  createProviderWorkoutMetadata,
  providerWorkoutDescription,
} from "./provider-workout-metadata.mjs";
import { mapIntervalsWorkout } from "./intervals.mjs";
import { updateWorkoutDescription } from "./workout-description.mjs";
import { readManualWorkoutDescription } from "./workout-manual-description.mjs";
import { encodeWorkoutFit } from "./workout-fit-export.mjs";
import { encodeWorkoutTextFormat } from "./workout-text-exports.mjs";
import { exportWorkoutFile } from "./workout-files.mjs";
import { savePlannedWorkoutMetrics } from "./planned-workout-metrics.mjs";
const creationId = "ac264d2c-cbef-494a-846d-22fc082544cb";
const base = {
  name: "Easy miles",
  sport: "Run",
  date: "2026-10-17",
  description: "Keep this relaxed.",
  values: { duration_seconds: 2700 },
};

test("duration-only sessions for all calendar sports export an untargeted verified native step", async () => {
  for (const sport of [
    "Run",
    "Ride",
    "Swim",
    "Other",
    "WeightTraining",
    "Walk",
    "MountainBikeRide",
    "Rowing",
    "NordicSki",
    "Workout",
  ]) {
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
    assert.equal(saved.event.type, sport);
    assert.equal(saved.event.workout_doc.steps[0].duration, 2700);
    assert.equal(saved.event.start_date_local, "2026-10-17T06:30:00");
    assert.equal(saved.event.time_target, 2700);
    assert.deepEqual(verifyParsedWorkout(model, saved.event), []);
    assert.equal(
      readWorkoutCommentText(saved.event.description, saved.workoutId)[0].body,
      "Easy effort today."
    );
    const loaded = await loadWorkoutEditor(p.request, saved.workoutId);
    assert.equal(loaded.model.sport, sport);
    assert.deepEqual(loaded.model.steps[0].target, { kind: "none" });
  }
});

test("distance-only easy sessions preserve run metres and the existing swim yard convention", async () => {
  for (const [sport, distance, unit] of [
    ["Run", 8046.72, "m"],
    ["Swim", 1000, "yd"],
    ["MountainBikeRide", 12000, "m"],
    ["Rowing", 2000, "m"],
    ["NordicSki", 8000, "m"],
    ["Workout", 1000, "m"],
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
  for (const values of [{ duration_seconds: -1 }, { duration_seconds: 1.5 }])
    assert.throws(() => simpleWorkoutModel({ ...base, values }));
  for (const extra of [
    { time: "24:01" },
    { values: { unsupported_planned_power: 120 } },
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

function privateStore() {
  const records = new Map();
  const record = (key, fresh) => ({
    read: async () => structuredClone(records.get(key) ?? fresh()),
    update: async (change) => {
      const state = structuredClone(records.get(key) ?? fresh());
      const result = change(state);
      records.set(key, state);
      return structuredClone(result);
    },
  });
  return (request) => createProviderWorkoutMetadata({ record }).wrap(request);
}

test("title-only plans and private presentation categories survive clean provider save and process restart", async () => {
  for (const [sport, variant] of [
    ["Run", undefined],
    ["Swim", undefined],
    ["Other", "brick"],
    ["Other", "day-off"],
    ["Other", "custom"],
  ]) {
    const p = fakeProvider(fixtureEvent(sport)),
      wrap = privateStore();
    const model = simpleWorkoutModel({ name: "Title-only plan", sport, date: base.date, variant });
    assert.equal(model.unstructured, true);
    assert.deepEqual(model.steps, []);
    const request = wrap(p.request);
    const saved = await createWorkoutEditor(request, { model, creationId });
    const rawPost = JSON.parse(p.calls.find((c) => c.method === "POST").body);
    assert.equal(rawPost.description, "");
    assert.equal(rawPost.type, sport);
    assert.equal(rawPost.category, "WORKOUT");
    assert.equal(Object.hasOwn(rawPost, "time_target"), false);
    assert.equal(Object.hasOwn(rawPost, "distance_target"), false);
    const restart = wrap(p.request),
      loaded = await loadWorkoutEditor(restart, saved.workoutId);
    assert.equal(loaded.model.unstructured, true);
    assert.equal(loaded.model.variant, variant);
    assert.deepEqual(loaded.issues, []);
    assert.deepEqual(loaded.model.steps, []);
    const projected = mapIntervalsWorkout(
      await restart(`/athlete/0/events/${saved.event.id}`),
      base.date
    );
    assert.equal(projected.unstructured, true);
    assert.equal(projected.display_variant, variant);
    assert.equal(projected.duration, "");
    assert.equal(projected.structure, null);
    assert.equal(projected.planned_time_label, null);
    assert.equal(projected.workout_summary.planned.duration_seconds, null);
    assert.equal(projected.workout_summary.planned.distance_meters, null);
    const totals = workoutTotals(loaded.model);
    assert.equal(totals.unknownTime, true);
    assert.equal(totals.unknownDistance, true);
    assert.equal(totals.load, null);
  }
});

test("freeform manual targets preserve omitted/null/zero/positive values without executable intervals", async () => {
  for (const values of [
    {},
    { duration_seconds: null, distance_meters: null },
    { duration_seconds: 0, distance_meters: 0 },
    { duration_seconds: 600, distance_meters: 1609.344 },
  ]) {
    const model = simpleWorkoutModel({ ...base, values, unstructured: true });
    const p = fakeProvider(fixtureEvent("Run")),
      request = privateStore()(p.request);
    const saved = await createWorkoutEditor(request, { model, creationId, values });
    assert.equal(saved.event.workout_doc.steps.length, 0);
    assert.deepEqual(readPlannedValues(saved.event.description), values);
    const summary = mapIntervalsWorkout(saved.event, base.date).workout_summary.planned;
    assert.equal(
      summary.duration_seconds,
      values.duration_seconds ?? (values.duration_seconds === 0 ? 0 : null)
    );
    assert.equal(
      summary.distance_meters,
      values.distance_meters ?? (values.distance_meters === 0 ? 0 : null)
    );
  }
});

test("freeform prose edits preserve private identity and cannot create native intervals", async () => {
  const p = fakeProvider(fixtureEvent("Other")),
    wrap = privateStore(),
    request = wrap(p.request);
  const model = simpleWorkoutModel({
    name: "A custom plan",
    sport: "Other",
    variant: "custom",
    date: base.date,
  });
  const saved = await createWorkoutEditor(request, {
    model,
    creationId,
    comment: "Bring water.",
    values: { tss: 12 },
  });
  const prose = "- 300s 200w\n\n```\nDo this at your own pace.";
  await updateWorkoutDescription(request, saved.workoutId, prose, { descriptionMode: "manual" });
  const loaded = await loadWorkoutEditor(wrap(p.request), saved.workoutId);
  assert.equal(loaded.model.variant, "custom");
  assert.equal(loaded.model.unstructured, true);
  assert.equal(loaded.manualDescription, prose);
  const event = await request(`/athlete/0/events/${saved.event.id}`);
  assert.deepEqual(event.workout_doc.steps, []);
  assert.equal(readPlannedValues(event.description).tss, 12);
  assert.equal(readWorkoutCommentText(event.description, saved.workoutId)[0].body, "Bring water.");
  for (const call of p.calls.filter((c) => c.body))
    assert.doesNotMatch(
      JSON.parse(call.body).description,
      /Workout editor v1|"variant"|"duration_seconds"|"text":/
    );
});

test("an empty structured builder stays invalid and converting a paired plan to freeform preserves actual identity", async () => {
  const event = fixtureEvent("Run");
  event.paired_activity_id = "i987";
  const p = fakeProvider(event),
    request = privateStore()(p.request);
  const loaded = await loadWorkoutEditor(request, "event:100");
  const model = { ...loaded.model, steps: [] };
  assert.match(validateWorkout(model).join(";"), /Add at least one step/);
  await assert.rejects(
    saveWorkoutEditor(request, "event:100", { model, revision: loaded.revision })
  );
  assert.equal(p.calls.filter((c) => c.method === "PUT").length, 0);
  model.unstructured = true;
  const saved = await saveWorkoutEditor(request, "event:100", {
    model,
    revision: loaded.revision,
    description: "",
    values: { duration_seconds: null, distance_meters: null },
  });
  assert.equal(saved.verified, true);
  assert.equal(saved.event.paired_activity_id, "i987");
  assert.deepEqual(saved.event.custom_metadata, { keep: true });
  assert.equal(providerWorkoutDescription(saved.event.description), "");
  assert.deepEqual(saved.event.workout_doc.steps, []);
  const projected = mapIntervalsWorkout(saved.event, base.date, {
    id: "i987",
    type: "Run",
    start_date_local: saved.event.start_date_local,
    moving_time: 123,
    distance: 456,
  });
  assert.equal(projected.workout_summary.planned.duration_seconds, null);
  assert.equal(projected.workout_summary.completed.duration_seconds, 123);
  assert.equal(projected.workout_summary.completed.distance_meters, 456);
  const reopened = await loadWorkoutEditor(request, "event:100");
  reopened.model.steps = [newStep("Run")];
  assert.match(validateWorkout(reopened.model).join(";"), /cannot contain device steps/);
  delete reopened.model.unstructured;
  assert.equal(
    (
      await saveWorkoutEditor(request, "event:100", {
        model: reopened.model,
        revision: reopened.revision,
      })
    ).event.workout_doc.steps.length,
    1
  );
});

test("freeform imports accept only empty native documents and reject positive or malformed parsed data", () => {
  const blank = {
    id: 100,
    name: "An empty plan",
    type: "Run",
    category: "WORKOUT",
    start_date_local: `${base.date}T00:00:00`,
    description: "",
  };
  for (const workout_doc of [
    undefined,
    null,
    {},
    { steps: null },
    { steps: [] },
    { steps: [], duration: 0, distance: 0 },
  ]) {
    const loaded = importWorkout({ ...blank, workout_doc });
    assert.equal(loaded.model.unstructured, true);
    assert.deepEqual(loaded.issues, []);
  }
  const model = simpleWorkoutModel({ ...base, values: {} });
  for (const workout_doc of [
    [],
    "bad",
    { steps: {} },
    { steps: [{ duration: 10 }] },
    { steps: [], duration: 10 },
    { steps: [], distance: 1 },
    { steps: [], num_steps: 1 },
  ])
    assert.notEqual(verifyParsedWorkout(model, { ...blank, workout_doc }).length, 0);
  for (const unstructured of [null, "true", 1])
    assert.notEqual(validateWorkout({ ...model, unstructured }).length, 0);
  for (const variant of ["Brick", "rest", null])
    assert.notEqual(validateWorkout({ ...model, sport: "Other", variant }).length, 0);
  assert.notEqual(validateWorkout({ ...model, variant: "brick" }).length, 0);
  const mismatched = importWorkout({
    ...blank,
    description: serializeWorkout({ ...model, sport: "Other", variant: "brick" }),
  });
  assert.match(mismatched.issues.join(";"), /presentation category/);
});

test("athlete_cannot_edit blocks loading and saving before provider writes", async () => {
  const event = fixtureEvent("Run"),
    p = fakeProvider(event),
    loaded = await loadWorkoutEditor(p.request, "event:100");
  p.setEvent({ ...event, athlete_cannot_edit: true });
  await assert.rejects(loadWorkoutEditor(p.request, "event:100"), (e) => e.code === "READ_ONLY");
  await assert.rejects(
    saveWorkoutEditor(p.request, "event:100", { model: loaded.model, revision: loaded.revision }),
    (e) => e.code === "READ_ONLY"
  );
  assert.equal(p.calls.filter((c) => c.method === "PUT").length, 0);
});

test("unstructured plans export plain text and reject every executable device format", async () => {
  const model = simpleWorkoutModel({ ...base, values: {} });
  assert.throws(() => encodeWorkoutFit(model), /device steps/);
  for (const format of ["zwo", "erg", "mrc"])
    assert.throws(() => encodeWorkoutTextFormat(model, format), /device steps/);
  for (const format of ["fit", "zwo", "erg", "mrc"])
    await assert.rejects(
      exportWorkoutFile({ INTERVALS_API_KEY: "fixture-key" }, { model, format }),
      /device steps/
    );
  const file = await exportWorkoutFile(
    { INTERVALS_API_KEY: "fixture-key" },
    { model, format: "txt" }
  );
  assert.equal(Buffer.from(file.data, "base64").toString(), `${base.name}\n\n${base.description}`);
  const blankFile = await exportWorkoutFile(
    { INTERVALS_API_KEY: "fixture-key" },
    { model: { ...model, notes: "" }, format: "txt" }
  );
  assert.equal(Buffer.from(blankFile.data, "base64").toString(), base.name);
  assert.equal(
    readManualWorkoutDescription({
      description: serializeWorkout(model),
      workout_doc: { steps: [] },
    }),
    base.description
  );
});

test("lost freeform creation replies reconcile once and empty provider null descriptions retain private variant", async () => {
  const p = fakeProvider(fixtureEvent("Other"), { uncertainCreate: true }),
    wrap = privateStore();
  const raw = async (path, options = {}) => {
    const result = await p.request(path, options);
    return result?.description === "" ? { ...result, description: null } : result;
  };
  const input = {
    model: simpleWorkoutModel({
      name: "Rest",
      sport: "Other",
      variant: "day-off",
      date: base.date,
    }),
    creationId,
  };
  const saved = await createWorkoutEditor(wrap(raw), input);
  const replay = await createWorkoutEditor(wrap(raw), { ...input, reconcileOnly: true });
  assert.equal(replay.workoutId, saved.workoutId);
  assert.equal(p.calls.filter((c) => c.method === "POST").length, 1);
  assert.equal((await loadWorkoutEditor(wrap(raw), saved.workoutId)).model.variant, "day-off");
});

test("freeform provider readback cannot claim success if the provider retains executable steps", async () => {
  const p = fakeProvider(fixtureEvent("Run")),
    wrap = privateStore();
  const raw = async (path, options = {}) => {
    const result = await p.request(path, options);
    if (!options.method && /\/events\/\d+$/.test(path))
      return { ...result, workout_doc: { steps: [{ duration: 60 }], duration: 60 } };
    return result;
  };
  const input = { model: simpleWorkoutModel({ ...base, values: {} }), creationId };
  await assert.rejects(
    createWorkoutEditor(wrap(raw), input),
    (e) => e.code === "CREATE_UNCONFIRMED"
  );
  await assert.rejects(
    createWorkoutEditor(wrap(raw), { ...input, reconcileOnly: true }),
    (e) => e.code === "CREATE_UNCONFIRMED"
  );
  assert.equal(p.calls.filter((c) => c.method === "POST").length, 1);
});

test("summary rename and move refresh canonical calendar model without overwriting private freeform identity", async () => {
  const p = fakeProvider(fixtureEvent("Other")),
    wrap = privateStore(),
    request = wrap(p.request);
  const created = await createWorkoutEditor(request, {
    model: simpleWorkoutModel({
      name: "Original title",
      sport: "Other",
      variant: "custom",
      date: base.date,
    }),
    creationId,
  });
  const loaded = await loadWorkoutEditor(request, created.workoutId);
  const edited = await savePlannedWorkoutMetrics(request, created.workoutId, {
    name: "Renamed title",
    date: "2026-11-01",
    revision: loaded.revision,
  });
  const projected = mapIntervalsWorkout(edited.event, "2026-11-01");
  assert.equal(projected.editor_model.name, "Renamed title");
  assert.equal(projected.editor_model.date, "2026-11-01");
  assert.equal(projected.editor_model.variant, "custom");
  assert.equal(projected.editor_model.unstructured, true);
  const reopened = await loadWorkoutEditor(wrap(p.request), created.workoutId);
  assert.equal(reopened.model.name, "Renamed title");
  assert.equal(reopened.model.date, "2026-11-01");
  const file = await exportWorkoutFile(
    { INTERVALS_API_KEY: "fixture-key" },
    { model: projected.editor_model, format: "txt" }
  );
  assert.equal(Buffer.from(file.data, "base64").toString(), "Renamed title");
  const saved = await saveWorkoutEditor(request, created.workoutId, {
    model: reopened.model,
    revision: reopened.revision,
  });
  assert.equal(saved.event.name, "Renamed title");
  assert.equal(saved.event.start_date_local, "2026-11-01T00:00:00");
});
