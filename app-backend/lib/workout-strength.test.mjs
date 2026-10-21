import test from "node:test";
import assert from "node:assert/strict";
import {
  newStrengthExercise,
  newStrengthBlock,
  addStrengthParameter,
  setStrengthValue,
  validateStrengthPrescription,
  strengthTotals,
  copyStrengthPrescription,
  strengthPrescriptionText,
  strengthParameterFields,
  strengthSubtypes,
} from "./workout-strength-model.mjs";
import {
  validateWorkout,
  serializeWorkout,
  readEditorModel,
  importWorkout,
  verifyParsedWorkout,
  workoutTotals,
  workoutProviderWarnings,
} from "./workout-editor-model.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import { createProviderWorkoutMetadata } from "./provider-workout-metadata.mjs";
import {
  createWorkoutEditor,
  loadWorkoutEditor,
  saveWorkoutEditor,
  workoutRevision,
} from "./workout-editor.mjs";
import {
  serializeManualWorkout,
  readManualWorkoutDescription,
} from "./workout-manual-description.mjs";
import {
  fakeProvider,
  fixtureEvent,
  parseTestWorkout,
} from "./fixtures/workout-editor-fixtures.mjs";
import { encodeWorkoutFit } from "./workout-fit-export.mjs";
import { encodeWorkoutTextFormat } from "./workout-text-exports.mjs";
import { exportWorkoutFile } from "./workout-files.mjs";
import { mapIntervalsWorkout } from "./intervals.mjs";
import { updateWorkoutDescription } from "./workout-description.mjs";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";
import { readWorkoutLibrary } from "./workout-library.mjs";
import { createWorkoutTemplateService } from "./workout-template.mjs";
import { copyCalendarWorkout } from "./calendar-workout-copy.mjs";
import { scheduleLibraryWorkout } from "./workout-scheduling.mjs";

function model() {
  let exercise = addStrengthParameter(newStrengthExercise("Air Squat"), "weight", "lb");
  exercise = setStrengthValue(exercise, exercise.sets[0].id, exercise.parameters[0].id, 15);
  exercise = setStrengthValue(exercise, exercise.sets[0].id, exercise.parameters[1].id, 50);
  return {
    version: 1,
    name: "Strength session",
    sport: "WeightTraining",
    date: "2026-10-22",
    notes: "Controlled technique.",
    poolLength: "",
    steps: [],
    strength: { version: 1, blocks: [newStrengthBlock("single", exercise)] },
  };
}
const creationId = "e51873b9-fd89-4568-9fc0-c54bca471334";
async function saveExplicitLibrary(request, event) {
  const states = new Map(),
    service = createWorkoutTemplateService({
      request,
      accountScope: "a".repeat(64),
      record: (key, initial) => ({
        read: async () => structuredClone(states.get(key) ?? initial()),
        update: async (change) => {
          const state = structuredClone(states.get(key) ?? initial()),
            result = change(state);
          states.set(key, state);
          return structuredClone(result);
        },
      }),
    });
  const folder = (await service.listFolders()).folders[0],
    source = await request(`/athlete/0/events/${event.id}`);
  const result = await service.save(`event:${event.id}`, {
    accountScope: "a".repeat(64),
    sourceRevision: workoutRevision(source),
    folderId: folder.id,
    folderRevision: folder.revision,
    title: event.name,
    operationId: "3115f486-d9e5-4376-a5ac-8de097e8582c",
  });
  const libraryRequest = service.wrapLibraryReads(request);
  return {
    saved: await libraryRequest(`/athlete/0/workouts/${result.workoutId.slice(8)}`),
    libraryRequest,
  };
}
function metadata() {
  const records = new Map();
  return (request) =>
    createProviderWorkoutMetadata({
      record: (key, initial) => ({
        read: async () => structuredClone(records.get(key) ?? initial()),
        update: async (change) => {
          const state = structuredClone(records.get(key) ?? initial()),
            result = change(state);
          records.set(key, state);
          return structuredClone(result);
        },
      }),
    }).wrap(request);
}

test("private Strength time assignment accepts only booleans, keeps legacy absence and never leaks into readable or exported text", async () => {
  const original = model(),
    legacy = serializeWorkout(original),
    readable = providerWorkoutDescription(legacy);
  assert.equal(Object.hasOwn(readEditorModel(legacy).strength, "startTimeAssigned"), false);
  for (const startTimeAssigned of [false, true]) {
    const value = model();
    value.strength.startTimeAssigned = startTimeAssigned;
    assert.deepEqual(validateWorkout(value), []);
    assert.equal(
      readEditorModel(serializeWorkout(value)).strength.startTimeAssigned,
      startTimeAssigned
    );
    const copied = copyStrengthPrescription(value.strength);
    assert.equal(copied.startTimeAssigned, startTimeAssigned);
    assert.notEqual(copied.blocks[0].id, value.strength.blocks[0].id);
    assert.equal(providerWorkoutDescription(serializeWorkout(value)), readable);
    const exported = await exportWorkoutFile(
      { INTERVALS_API_KEY: "synthetic" },
      { model: value, format: "txt" }
    );
    assert.doesNotMatch(
      Buffer.from(exported.data, "base64").toString(),
      /startTimeAssigned|Workout editor v1|"blocks"/
    );
  }
  for (const startTimeAssigned of [undefined, null, 0, 1, "true", "false", "", {}, []]) {
    const value = model();
    value.strength.startTimeAssigned = startTimeAssigned;
    assert.ok(validateWorkout(value).length);
  }
});

test("same native Strength midnight retains private cleared versus explicit assignment across fresh reads, revisioned save and denied updates", async () => {
  const provider = fakeProvider(fixtureEvent()),
    wrap = metadata(),
    value = model();
  value.strength.startTimeAssigned = false;
  let deny = false;
  const raw = async (path, options = {}) => {
    if (deny && options.method === "PUT") throw Object.assign(Error("Forbidden"), { status: 403 });
    return provider.request(path, options);
  };
  const created = await createWorkoutEditor(wrap(raw), { model: value, creationId, time: "00:00" });
  let loaded = await loadWorkoutEditor(wrap(raw), created.workoutId);
  assert.equal(loaded.model.strength.startTimeAssigned, false);
  assert.equal(created.event.start_date_local, "2026-10-22T00:00:00");
  const firstNative = provider.calls.find((call) => call.method === "POST");
  loaded.model.strength.startTimeAssigned = true;
  await saveWorkoutEditor(wrap(raw), created.workoutId, {
    model: loaded.model,
    revision: loaded.revision,
    time: "00:00",
  });
  loaded = await loadWorkoutEditor(wrap(raw), created.workoutId);
  assert.equal(loaded.model.strength.startTimeAssigned, true);
  const explicitNative = provider.calls.filter((call) => call.method === "PUT").at(-1);
  assert.equal(
    JSON.parse(explicitNative.body).description,
    JSON.parse(firstNative.body).description,
    "private assignment must not alter native human prose"
  );
  assert.equal(JSON.parse(explicitNative.body).start_date_local, "2026-10-22T00:00:00");
  loaded.model.strength.startTimeAssigned = false;
  deny = true;
  await assert.rejects(
    saveWorkoutEditor(wrap(raw), created.workoutId, {
      model: loaded.model,
      revision: loaded.revision,
      time: "00:00",
    }),
    { status: 403 }
  );
  loaded = await loadWorkoutEditor(wrap(raw), created.workoutId);
  assert.equal(
    loaded.model.strength.startTimeAssigned,
    true,
    "denied identical native-body write cannot publish rejected private assignment"
  );
  deny = false;
  loaded.model.strength.startTimeAssigned = false;
  await saveWorkoutEditor(wrap(raw), created.workoutId, {
    model: loaded.model,
    revision: loaded.revision,
    time: "07:15",
  });
  const final = await loadWorkoutEditor(wrap(raw), created.workoutId);
  assert.equal(final.model.strength.startTimeAssigned, false);
  const native = provider.calls.filter((call) => call.method === "PUT").at(-1);
  assert.equal(
    JSON.parse(native.body).start_date_local,
    "2026-10-22T07:15:00",
    "native time remains authoritative, independently of the private display marker"
  );
});

test("both Strength assignment states survive native calendar and library clones while later changes stay isolated", async () => {
  for (const assigned of [false, true]) {
    const provider = fakeProvider(fixtureEvent()),
      wrap = metadata(),
      library = new Map(),
      value = model();
    value.strength.startTimeAssigned = assigned;
    const raw = async (path, options = {}) => {
      if (path === "/athlete/0") return { id: "fixture-athlete", sportSettings: [] };
      if (path === "/athlete/0/folders")
        return [
          {
            id: 1,
            name: "My Library",
            type: "FOLDER",
            athlete_id: "fixture-athlete",
            visibility: "PRIVATE",
            canEdit: true,
            read_only_workouts: false,
          },
        ];
      if (path.startsWith("/athlete/0/workouts")) {
        const id = Number(path.split("/").at(-1));
        if (options.method) {
          const patch = JSON.parse(options.body),
            row = {
              ...patch,
              id: Number.isFinite(id) ? id : 501,
              workout_doc: parseTestWorkout(patch.description),
            };
          assert.doesNotMatch(row.description, /startTimeAssigned|Workout editor v1|"blocks"/);
          library.set(row.id, row);
          return structuredClone(row);
        }
        return structuredClone(Number.isFinite(id) ? library.get(id) : [...library.values()]);
      }
      return provider.request(path, options);
    };
    const operation = () => {
      const state = { operation: null };
      return {
        read: async () => structuredClone(state),
        update: async (change) => structuredClone(change(state)),
      };
    };
    const created = await createWorkoutEditor(wrap(raw), {
      model: value,
      creationId,
      time: "00:00",
    });
    const copied = await copyCalendarWorkout(
      {},
      wrap(raw),
      created.workoutId,
      { date: "2026-10-24", creationId: "84096742-266f-4a4e-8931-269ad20951d0" },
      { record: operation() }
    );
    const copiedModel = await loadWorkoutEditor(wrap(raw), copied.workoutId);
    assert.equal(copiedModel.model.strength.startTimeAssigned, assigned);
    assert.equal(copied.event.start_date_local, "2026-10-24T00:00:00");
    const { saved, libraryRequest } = await saveExplicitLibrary(wrap(raw), created.event);
    assert.equal(
      (await readWorkoutLibrary(libraryRequest))[0].editor_model.strength.startTimeAssigned,
      assigned
    );
    const scheduled = await scheduleLibraryWorkout(
      {},
      libraryRequest,
      `library:${saved.id}`,
      { date: "2026-10-25", creationId: "28277ca8-9255-44fe-a6b1-21ae534fa7dc" },
      { record: operation() }
    );
    const reopened = await loadWorkoutEditor(wrap(raw), scheduled.workoutId);
    assert.equal(reopened.model.strength.startTimeAssigned, assigned);
    assert.equal(scheduled.event.start_date_local, "2026-10-25T00:00:00");
    copiedModel.model.strength.startTimeAssigned = !assigned;
    await saveWorkoutEditor(wrap(raw), copied.workoutId, {
      model: copiedModel.model,
      revision: copiedModel.revision,
      time: "00:00",
    });
    assert.equal(
      (await loadWorkoutEditor(wrap(raw), created.workoutId)).model.strength.startTimeAssigned,
      assigned
    );
    assert.equal(
      (await loadWorkoutEditor(wrap(raw), scheduled.workoutId)).model.strength.startTimeAssigned,
      assigned
    );
    assert.equal(
      (await readWorkoutLibrary(libraryRequest))[0].editor_model.strength.startTimeAssigned,
      assigned
    );
    for (const call of provider.calls.filter((call) => call.body))
      assert.doesNotMatch(
        JSON.parse(call.body).description,
        /startTimeAssigned|Workout editor v1|"blocks"/
      );
  }
});

test("Strength subtypes accept only the six observed exact labels, preserve absence and readable text without changing sport", () => {
  assert.deepEqual(strengthSubtypes, [
    "Mobility",
    "Functional Fitness",
    "Yoga",
    "Rock Climbing",
    "Hybrid Strength",
    "Stretching",
  ]);
  const plain = model();
  assert.equal(plain.strength.subtype, undefined);
  assert.doesNotMatch(strengthPrescriptionText(plain.strength), /Subtype:/);
  for (const subtype of strengthSubtypes) {
    const value = model();
    value.strength.subtype = subtype;
    assert.deepEqual(validateWorkout(value), []);
    const privateDescription = serializeWorkout(value),
      native = providerWorkoutDescription(privateDescription);
    assert.match(native, new RegExp(`Subtype: ${subtype}`));
    assert.doesNotMatch(native, /Workout editor v1|"subtype"|"blocks"|"version"/);
    assert.equal(readEditorModel(privateDescription).strength.subtype, subtype);
    assert.equal(copyStrengthPrescription(value.strength).subtype, subtype);
    assert.equal(value.sport, "WeightTraining");
  }
  for (const subtype of [
    null,
    "",
    "None",
    "yoga",
    "Yoga ",
    "FunctionalFitness",
    "Cycling",
    5,
    {},
    [],
  ]) {
    const value = model();
    value.strength.subtype = subtype;
    assert.ok(validateWorkout(value).length);
  }
  const incompatible = model();
  incompatible.strength.subtype = "Yoga";
  incompatible.sport = "Yoga";
  assert.ok(validateWorkout(incompatible).length);
});

test("Strength subtype persists through fresh private create/reopen, revisioned changes and explicit None clearing; canceled drafts cannot mutate it", async () => {
  const provider = fakeProvider(fixtureEvent()),
    wrap = metadata(),
    value = model();
  value.strength.subtype = "Yoga";
  const created = await createWorkoutEditor(wrap(provider.request), {
    model: value,
    creationId,
    descriptionMode: "manual",
    description: "Human introduction.",
  });
  const native = JSON.parse(provider.calls.find((call) => call.method === "POST").body);
  assert.equal(native.type, "WeightTraining");
  assert.match(native.description, /Subtype: Yoga/);
  assert.doesNotMatch(native.description, /Workout editor v1|"subtype"/);
  let loaded = await loadWorkoutEditor(wrap(provider.request), created.workoutId);
  assert.equal(loaded.model.strength.subtype, "Yoga");
  assert.deepEqual(loaded.issues, []);
  const canceled = structuredClone(loaded.model);
  canceled.strength.subtype = "Mobility";
  assert.equal(
    (await loadWorkoutEditor(wrap(provider.request), created.workoutId)).model.strength.subtype,
    "Yoga"
  );
  const changed = structuredClone(loaded.model);
  changed.strength.subtype = "Rock Climbing";
  await saveWorkoutEditor(wrap(provider.request), created.workoutId, {
    model: changed,
    revision: loaded.revision,
  });
  await assert.rejects(
    saveWorkoutEditor(wrap(provider.request), created.workoutId, {
      model: canceled,
      revision: loaded.revision,
    }),
    { status: 409 }
  );
  loaded = await loadWorkoutEditor(wrap(provider.request), created.workoutId);
  assert.equal(loaded.model.strength.subtype, "Rock Climbing");
  assert.equal(loaded.manualDescription, "Human introduction.");
  const count = provider.calls.filter((call) => call.method === "PUT").length,
    invalid = structuredClone(loaded.model);
  invalid.strength.subtype = "None";
  await assert.rejects(
    saveWorkoutEditor(wrap(provider.request), created.workoutId, {
      model: invalid,
      revision: loaded.revision,
    }),
    /subtype/
  );
  assert.equal(provider.calls.filter((call) => call.method === "PUT").length, count);
  delete loaded.model.strength.subtype;
  await saveWorkoutEditor(wrap(provider.request), created.workoutId, {
    model: loaded.model,
    revision: loaded.revision,
  });
  const cleared = await loadWorkoutEditor(wrap(provider.request), created.workoutId);
  assert.equal(Object.hasOwn(cleared.model.strength, "subtype"), false);
  assert.doesNotMatch(
    providerWorkoutDescription(cleared.event?.description || serializeWorkout(cleared.model)),
    /Subtype:/
  );
  assert.equal(cleared.model.sport, "WeightTraining");
});

test("Strength subtype survives real calendar copy and saved-library scheduling without native JSON or sharing later edits", async () => {
  const provider = fakeProvider(fixtureEvent()),
    wrap = metadata(),
    library = new Map(),
    nativeLibraryWrites = [],
    value = model();
  value.strength.subtype = "Hybrid Strength";
  const raw = async (path, options = {}) => {
    if (path === "/athlete/0") return { id: "fixture-athlete", sportSettings: [] };
    if (path === "/athlete/0/folders")
      return [
        {
          id: 1,
          name: "My Library",
          type: "FOLDER",
          athlete_id: "fixture-athlete",
          visibility: "PRIVATE",
          canEdit: true,
          read_only_workouts: false,
        },
      ];
    if (path.startsWith("/athlete/0/workouts")) {
      const id = Number(path.split("/").at(-1));
      if (options.method) {
        const patch = JSON.parse(options.body),
          row = {
            ...patch,
            id: Number.isFinite(id) ? id : 501,
            workout_doc: parseTestWorkout(patch.description),
          };
        nativeLibraryWrites.push(structuredClone(row));
        library.set(row.id, row);
        return structuredClone(row);
      }
      return structuredClone(Number.isFinite(id) ? library.get(id) : [...library.values()]);
    }
    return provider.request(path, options);
  };
  const operation = () => {
    let state = { operation: null };
    return {
      read: async () => structuredClone(state),
      update: async (change) => {
        const result = change(state);
        return structuredClone(result);
      },
    };
  };
  const created = await createWorkoutEditor(wrap(raw), { model: value, creationId });
  const copied = await copyCalendarWorkout(
    {},
    wrap(raw),
    created.workoutId,
    { date: "2026-10-24", creationId: "84096742-266f-4a4e-8931-269ad20951d0" },
    { record: operation() }
  );
  const copiedModel = await loadWorkoutEditor(wrap(raw), copied.workoutId);
  assert.equal(copiedModel.model.strength.subtype, "Hybrid Strength");
  assert.equal(copiedModel.model.date, "2026-10-24");
  const { saved, libraryRequest } = await saveExplicitLibrary(wrap(raw), created.event);
  assert.equal(saved.type, "WeightTraining");
  const listed = await readWorkoutLibrary(libraryRequest);
  assert.equal(listed[0].editor_model.strength.subtype, "Hybrid Strength");
  const scheduled = await scheduleLibraryWorkout(
    {},
    libraryRequest,
    `library:${saved.id}`,
    { date: "2026-10-25", creationId: "28277ca8-9255-44fe-a6b1-21ae534fa7dc" },
    { record: operation() }
  );
  const reopened = await loadWorkoutEditor(wrap(raw), scheduled.workoutId);
  assert.equal(reopened.model.strength.subtype, "Hybrid Strength");
  assert.equal(reopened.model.date, "2026-10-25");
  assert.deepEqual(reopened.issues, []);
  reopened.model.strength.subtype = "Stretching";
  await saveWorkoutEditor(wrap(raw), scheduled.workoutId, {
    model: reopened.model,
    revision: reopened.revision,
  });
  assert.equal(
    (await loadWorkoutEditor(wrap(raw), created.workoutId)).model.strength.subtype,
    "Hybrid Strength"
  );
  assert.equal(
    (await readWorkoutLibrary(libraryRequest))[0].editor_model.strength.subtype,
    "Hybrid Strength"
  );
  for (const native of [
    ...nativeLibraryWrites,
    ...provider.calls.filter((call) => call.body).map((call) => JSON.parse(call.body)),
  ]) {
    assert.equal(native.type, "WeightTraining");
    assert.doesNotMatch(native.description, /Workout editor v1|"subtype"|"blocks"/);
  }
  const exported = await exportWorkoutFile(
    { INTERVALS_API_KEY: "synthetic" },
    { model: reopened.model, format: "txt" }
  );
  assert.match(Buffer.from(exported.data, "base64").toString(), /Subtype: Stretching/);
});

test("explicit empty Strength remains a valid title-only prescription without relaxing incomplete nonempty blocks or fabricating totals", () => {
  const value = { ...model(), notes: "", strength: { version: 1, blocks: [] } };
  assert.deepEqual(validateWorkout(value), []);
  assert.deepEqual(strengthTotals(value.strength), {
    exercises: 0,
    sets: 0,
    reps: null,
    volume: null,
    durationSeconds: null,
    tss: null,
    intensityFactor: null,
  });
  assert.deepEqual(copyStrengthPrescription(value.strength), value.strength);
  assert.deepEqual(readEditorModel(serializeWorkout(value)).strength, value.strength);
  for (const strength of [
    { version: 1, blocks: [{}] },
    { version: 1, blocks: [newStrengthBlock("single")] },
    { version: 1, blocks: null },
    { version: 1 },
    { version: 1, blocks: [], unstructured: true },
  ]) {
    assert.ok(validateStrengthPrescription(strength).length);
  }
  assert.ok(
    validateWorkout({ ...value, strength: undefined }).length,
    "ordinary empty interval builder remains invalid"
  );
  for (const format of ["fit", "mrc", "erg", "zwo"]) {
    assert.throws(
      () => (format === "fit" ? encodeWorkoutFit(value) : encodeWorkoutTextFormat(value, format)),
      /Strength|exercise|interval|steps|supported/i
    );
  }
});

test("empty Strength creates and freshly reloads its exact private mode, retains manual prose through edit/clear and blocks replacement when private metadata is absent", async () => {
  const provider = fakeProvider(fixtureEvent()),
    wrap = metadata(),
    value = {
      ...model(),
      name: "Title-only Strength",
      notes: "",
      strength: { version: 1, blocks: [] },
    };
  const created = await createWorkoutEditor(wrap(provider.request), {
    model: value,
    creationId,
    description: "A plain introduction.",
    descriptionMode: "manual",
  });
  assert.equal(created.verified, true);
  const native = JSON.parse(provider.calls.find((call) => call.method === "POST").body);
  assert.equal(native.type, "WeightTraining");
  assert.doesNotMatch(
    native.description,
    /Workout editor v1|"blocks"|"version"|Intervals\.icu device definition/
  );
  assert.match(native.description, /A plain introduction/);
  let loaded = await loadWorkoutEditor(wrap(provider.request), created.workoutId);
  assert.deepEqual(loaded.issues, []);
  assert.deepEqual(loaded.model.strength, { version: 1, blocks: [] });
  assert.equal(loaded.model.unstructured, undefined);
  assert.deepEqual(loaded.model.steps, []);
  assert.equal(loaded.manualDescription, "A plain introduction.");
  assert.equal(workoutTotals(loaded.model).unknownTime, true);
  assert.equal(workoutTotals(loaded.model).load, null);
  assert.deepEqual(verifyParsedWorkout(loaded.model, { workout_doc: { steps: [] } }), []);
  for (const description of ["Changed introduction.", ""]) {
    await updateWorkoutDescription(wrap(provider.request), created.workoutId, description);
    loaded = await loadWorkoutEditor(wrap(provider.request), created.workoutId);
    assert.deepEqual(loaded.issues, []);
    assert.deepEqual(loaded.model.strength, { version: 1, blocks: [] });
    assert.equal(loaded.manualDescription, description);
  }
  const missing = await loadWorkoutEditor(metadata()(provider.request), created.workoutId);
  assert.equal(missing.reviewRequired, true);
  assert.equal(missing.model.unstructured, undefined);
  assert.ok(missing.issues.length);
  const before = provider.calls.filter((call) => call.method === "PUT").length;
  await assert.rejects(
    updateWorkoutDescription(metadata()(provider.request), created.workoutId, "Replacement"),
    { status: 409, code: "PRIVATE_WORKOUT_MODEL_UNAVAILABLE" }
  );
  assert.equal(provider.calls.filter((call) => call.method === "PUT").length, before);
});

test("same native Strength record with a missing rotated metadata namespace stays review-only and cannot be replaced as freeform", async () => {
  const provider = fakeProvider(fixtureEvent("WeightTraining")),
    original = metadata()(provider.request),
    rotated = metadata()(provider.request),
    source = model();
  const created = await createWorkoutEditor(
    original,
    { model: source, creationId },
    "synthetic-original-account"
  );
  const known = await loadWorkoutEditor(original, created.workoutId);
  assert.ok(known.model.strength);
  assert.deepEqual(known.issues, []);
  const missing = await loadWorkoutEditor(rotated, created.workoutId);
  assert.equal(missing.model.strength, undefined);
  assert.equal(missing.model.unstructured, undefined);
  assert.equal(missing.reviewRequired, true);
  assert.match(missing.issues.join(" "), /private exercise model is unavailable/);
  assert.ok(missing.originalDescription.includes("Air Squat"));
  const before = provider.calls.filter((call) =>
    ["POST", "PUT", "PATCH", "DELETE"].includes(call.method)
  ).length;
  const rawBefore = await provider.request("/athlete/0/events/" + created.workoutId.slice(6));
  for (const replacement of [
    source,
    {
      version: 1,
      name: "Unsafe freeform replacement",
      sport: "WeightTraining",
      date: source.date,
      notes: "Replacement",
      poolLength: "",
      steps: [],
      unstructured: true,
    },
  ])
    await assert.rejects(
      saveWorkoutEditor(
        rotated,
        created.workoutId,
        { model: replacement, revision: missing.revision },
        "synthetic-rotated-account"
      ),
      /private exercise model is unavailable/
    );
  assert.equal(
    provider.calls.filter((call) => ["POST", "PUT", "PATCH", "DELETE"].includes(call.method))
      .length,
    before
  );
  assert.deepEqual(
    await provider.request("/athlete/0/events/" + created.workoutId.slice(6)),
    rawBefore
  );
  const plain = importWorkout({
    ...fixtureEvent("WeightTraining"),
    description: "A plain freeform Strength note",
    workout_doc: null,
  });
  assert.equal(plain.model.unstructured, true);
  assert.deepEqual(plain.issues, []);
});

test("description-only Strength edit and clear preserve exact private exercises and instructions; missing metadata or rejected readback never deletes the native prescription", async () => {
  const options = { fail: false },
    provider = fakeProvider(fixtureEvent("WeightTraining")),
    original = metadata()(async (path, input) => {
      if (options.fail && input?.method === "PUT") throw Error("Synthetic offline provider");
      return provider.request(path, input);
    }),
    rotated = metadata()(provider.request),
    source = model();
  const created = await createWorkoutEditor(
      original,
      { model: source, creationId },
      "synthetic-original-account"
    ),
    path = "/athlete/0/events/" + created.workoutId.slice(6);
  for (const introduction of ["Meet at the gym before starting.", ""]) {
    const result = await updateWorkoutDescription(original, created.workoutId, introduction, {
      descriptionMode: "manual",
    });
    assert.equal(result.verified, true);
    const loaded = await loadWorkoutEditor(original, created.workoutId);
    assert.deepEqual(loaded.model.strength, source.strength);
    assert.equal(loaded.model.notes, source.notes);
    assert.equal(readManualWorkoutDescription(await original(path)), introduction);
    assert.deepEqual(loaded.issues, []);
    const raw = await provider.request(path);
    assert.equal((raw.description.match(/Air Squat/g) || []).length, 1);
    assert.ok(raw.description.includes("15"));
    assert.doesNotMatch(raw.description, /Workout editor v1|"blocks"/);
  }
  const rawBefore = await provider.request(path),
    writes = () =>
      provider.calls.filter((call) => ["PUT", "POST", "PATCH", "DELETE"].includes(call.method))
        .length,
    before = writes();
  await assert.rejects(
    updateWorkoutDescription(rotated, created.workoutId, "Unsafe replacement", {
      descriptionMode: "manual",
    }),
    { status: 409, code: "PRIVATE_WORKOUT_MODEL_UNAVAILABLE" }
  );
  assert.equal(writes(), before);
  assert.deepEqual(await provider.request(path), rawBefore);
  options.fail = true;
  await assert.rejects(
    updateWorkoutDescription(original, created.workoutId, "Unconfirmed introduction", {
      descriptionMode: "manual",
    }),
    /did not confirm/
  );
  assert.deepEqual(await provider.request(path), rawBefore);
  assert.deepEqual(
    (await loadWorkoutEditor(original, created.workoutId)).model.strength,
    source.strength
  );
});

test("observed Strength defaults distinguish fresh Circuit from retained converted exercise sets", () => {
  const single = newStrengthBlock("single", newStrengthExercise("Squat"));
  assert.equal(single.exercises[0].sets.length, 3);
  assert.equal(single.timeSeconds, 0);
  const circuit = newStrengthBlock("circuit");
  assert.equal(circuit.title, "Circuit");
  assert.equal(circuit.timeSeconds, 600);
  assert.equal(circuit.exercises[0].sets.length, 1);
  assert.equal(circuit.recordMode, "completion");
  assert.equal(circuit.exercises[0].sets[0].values[circuit.exercises[0].parameters[0].id], null);
  for (const [kind, title] of [
    ["warmup", "Warm Up"],
    ["cooldown", "Cool Down"],
  ]) {
    const block = newStrengthBlock(kind);
    assert.equal(block.title, title);
    assert.equal(block.timeSeconds, 600);
    assert.equal(block.exercises[0].sets.length, 1);
  }
  const superset = newStrengthBlock("superset");
  assert.equal(superset.title, "Superset");
  assert.equal(superset.timeSeconds, null);
  assert.deepEqual(
    superset.exercises.map((exercise) => exercise.sets.length),
    [3, 3]
  );
  const converted = { ...single, kind: "circuit" };
  assert.equal(converted.timeSeconds, 0);
  assert.equal(converted.exercises[0].sets.length, 3);
  assert.deepEqual(validateStrengthPrescription({ version: 1, blocks: [converted] }), []);
});

test("first-set edits overwrite later overrides without mutating the original; duplicate Reps columns remain independent", () => {
  const source = model().strength.blocks[0].exercises[0],
    reps = source.parameters[0].id;
  const override = setStrengthValue(source, source.sets[1].id, reps, 7);
  assert.deepEqual(
    override.sets.map((set) => set.values[reps]),
    [15, 7, 15]
  );
  const propagated = setStrengthValue(override, override.sets[0].id, reps, 12);
  assert.deepEqual(
    propagated.sets.map((set) => set.values[reps]),
    [12, 12, 12]
  );
  assert.deepEqual(
    source.sets.map((set) => set.values[reps]),
    [15, 15, 15]
  );
  const duplicate = addStrengthParameter(propagated);
  assert.equal(duplicate.parameters.at(-1).kind, "reps");
  assert.notEqual(duplicate.parameters.at(-1).id, reps);
  assert.equal(duplicate.sets[0].values[duplicate.parameters.at(-1).id], null);
  assert.throws(() => setStrengthValue(source, source.sets[0].id, reps, 1.5), /supported Strength/);
});

test("Strength volume uses exact compatible weight and reps without guessing per-side or duplicate semantics", () => {
  const value = model().strength;
  assert.deepEqual(strengthTotals(value), {
    exercises: 1,
    sets: 3,
    reps: 45,
    volume: { lb: 2250, kg: 0 },
    durationSeconds: null,
    tss: null,
    intensityFactor: null,
  });
  const mixed = structuredClone(value),
    kg = copyStrengthPrescription(value).blocks[0];
  kg.exercises[0].parameters[1].unit = "kg";
  mixed.blocks.push(kg);
  assert.deepEqual(strengthTotals(mixed).volume, { lb: 2250, kg: 2250 });
  mixed.blocks[0].exercises[0] = addStrengthParameter(mixed.blocks[0].exercises[0], "repsPerSide");
  assert.equal(strengthTotals(mixed).volume, null);
  const duplicate = structuredClone(value);
  duplicate.blocks[0].exercises[0] = addStrengthParameter(duplicate.blocks[0].exercises[0]);
  assert.equal(strengthTotals(duplicate).reps, null);
  assert.equal(strengthTotals(duplicate).volume, null);
});

test("Strength rejects malformed structures, unsupported fields, invalid units, missing cells and excessive limits", () => {
  const valid = model();
  assert.deepEqual(validateWorkout(valid), []);
  const variants = [
    (value) => {
      value.sport = "Ride";
    },
    (value) => {
      value.unstructured = true;
    },
    (value) => {
      value.name = "x".repeat(129);
    },
    (value) => {
      value.notes = "x".repeat(1001);
    },
    (value) => {
      value.strength.blocks[0].exercises[0].title = " ";
    },
    (value) => {
      value.strength.blocks[0].exercises[0].sets = Array(16).fill(
        value.strength.blocks[0].exercises[0].sets[0]
      );
    },
    (value) => {
      value.strength.blocks[0].exercises[0].parameters[0] = null;
    },
    (value) => {
      value.strength.blocks[0].exercises[0].parameters[0].unit = "w";
    },
    (value) => {
      value.strength.blocks[0].exercises[0].sets[0].values = {};
    },
    (value) => {
      value.strength.blocks[0].exercises[0].parameters[0].nativeJson = {};
    },
    (value) => {
      value.strength.blocks[0].recordMode = "amrap";
    },
    (value) => {
      value.strength.blocks[0].timeSeconds = -1;
    },
    (value) => {
      value.strength.blocks[0].exercises[0].notes = "Workout editor v1";
    },
    (value) => {
      const exercise = value.strength.blocks[0].exercises[0];
      exercise.sets[0].values[exercise.parameters[1].id] = Infinity;
    },
  ];
  for (const mutate of variants) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.notEqual(validateWorkout(invalid).length, 0);
  }
  for (const field of strengthParameterFields) {
    const exercise = addStrengthParameter(
      newStrengthExercise("Exercise"),
      field.kind,
      field.units[0]
    );
    const invalid = model();
    invalid.strength.blocks[0].exercises[0] = exercise;
    exercise.sets[0].values[exercise.parameters[1].id] = field.min - 1;
    assert.notEqual(validateWorkout(invalid).length, 0, field.kind);
  }
});

test("readable Strength text is parser-inert and exact private model has no fabricated intervals or physiological totals", () => {
  const value = model(),
    description = serializeWorkout(value),
    clean = providerWorkoutDescription(description),
    doc = parseTestWorkout(clean);
  assert.match(clean, /Air Squat/);
  assert.match(clean, /Set 1: Reps: 15; Weight: 50 lb/);
  assert.doesNotMatch(
    clean,
    /Workout editor v1|"blocks"|"version"|Intervals\.icu device definition/
  );
  assert.deepEqual(doc.steps, []);
  assert.deepEqual(readEditorModel(description).strength, value.strength);
  assert.deepEqual(verifyParsedWorkout(value, { workout_doc: doc }), []);
  assert.notEqual(
    verifyParsedWorkout(value, { workout_doc: { steps: [], duration: 600 } }).length,
    0
  );
  assert.equal(workoutTotals(value).unknownTime, true);
  assert.equal(workoutTotals(value).load, null);
  assert.equal(workoutProviderWarnings(value).length, 1);
  const text = strengthPrescriptionText(value.strength);
  assert.match(text, /Record: For Completion/);
});

test("Strength create, fresh-wrapper reopen, revisioned edit and manual prose preserve exact encrypted prescription", async () => {
  const provider = fakeProvider(fixtureEvent()),
    wrap = metadata(),
    request = wrap(provider.request),
    value = model();
  const created = await createWorkoutEditor(request, {
    model: value,
    creationId,
    descriptionMode: "manual",
    description: "Session introduction.",
  });
  assert.equal(created.verified, true);
  const post = JSON.parse(provider.calls.find((call) => call.method === "POST").body);
  assert.equal(post.type, "WeightTraining");
  assert.match(post.description, /Session introduction/);
  assert.match(post.description, /Air Squat/);
  assert.doesNotMatch(post.description, /Workout editor v1|"blocks"/);
  const reloaded = await loadWorkoutEditor(wrap(provider.request), created.workoutId);
  assert.deepEqual(reloaded.issues, []);
  assert.deepEqual(reloaded.model.strength, value.strength);
  assert.equal(reloaded.manualDescription, "Session introduction.");
  const changed = structuredClone(reloaded.model),
    exercise = changed.strength.blocks[0].exercises[0];
  changed.strength.blocks[0].exercises[0] = setStrengthValue(
    exercise,
    exercise.sets[0].id,
    exercise.parameters[1].id,
    60
  );
  const saved = await saveWorkoutEditor(wrap(provider.request), created.workoutId, {
    model: changed,
    revision: reloaded.revision,
  });
  assert.equal(saved.verified, true);
  const final = await loadWorkoutEditor(wrap(provider.request), created.workoutId);
  assert.deepEqual(final.issues, []);
  assert.equal(strengthTotals(final.model.strength).volume.lb, 2700);
  assert.equal(final.manualDescription, "Session introduction.");
  await assert.rejects(
    saveWorkoutEditor(wrap(provider.request), created.workoutId, {
      model: value,
      revision: reloaded.revision,
    }),
    (error) => error.status === 409
  );
});

test("identical Strength instructions appear once natively and retain the exact Description through create/edit/reload", async () => {
  const provider = fakeProvider(fixtureEvent()),
    wrap = metadata(),
    value = model();
  const created = await createWorkoutEditor(wrap(provider.request), {
    model: value,
    creationId,
    descriptionMode: "manual",
    description: value.notes,
  });
  const post = JSON.parse(provider.calls.find((call) => call.method === "POST").body);
  assert.equal(post.description.split(value.notes).length - 1, 1);
  const reopened = await loadWorkoutEditor(wrap(provider.request), created.workoutId);
  assert.deepEqual(reopened.issues, []);
  assert.equal(reopened.model.notes, value.notes);
  assert.equal(reopened.manualDescription, value.notes);
  const changed = structuredClone(reopened.model);
  changed.notes = "Updated controlled instructions.";
  await saveWorkoutEditor(wrap(provider.request), created.workoutId, {
    model: changed,
    revision: reopened.revision,
    descriptionMode: "manual",
    description: changed.notes,
  });
  const put = JSON.parse(provider.calls.filter((call) => call.method === "PUT").at(-1).body);
  assert.equal(put.description.split(changed.notes).length - 1, 1);
  const final = await loadWorkoutEditor(wrap(provider.request), created.workoutId);
  assert.deepEqual(final.issues, []);
  assert.equal(final.model.notes, changed.notes);
  assert.equal(final.manualDescription, changed.notes);
  const distinct = serializeManualWorkout(changed, "A distinct session introduction.");
  assert.match(providerWorkoutDescription(distinct), /A distinct session introduction/);
  assert.match(providerWorkoutDescription(distinct), /Updated controlled instructions/);
  assert.equal(
    readManualWorkoutDescription({ description: distinct }),
    "A distinct session introduction."
  );
});

test("Strength externally edited readable prescription retains a reviewable private model and blocks silent overwrite", async () => {
  const value = model(),
    provider = fakeProvider({
      ...fixtureEvent("WeightTraining"),
      description: serializeWorkout(value),
      name: value.name,
      start_date_local: value.date + "T00:00:00",
      workout_doc: { steps: [], duration: 0, distance: 0 },
    });
  const wrap = metadata(),
    request = wrap(provider.request);
  const loaded = await loadWorkoutEditor(request, "event:100");
  const saved = await saveWorkoutEditor(request, "event:100", {
    model: loaded.model,
    revision: loaded.revision,
    descriptionMode: "manual",
    description: "Intro",
  });
  provider.setEvent({
    ...provider.event(),
    description: providerWorkoutDescription(saved.event.description).replace(
      "Weight: 50 lb",
      "Weight: 99 lb"
    ),
  });
  const changed = await loadWorkoutEditor(wrap(provider.request), "event:100");
  assert.ok(changed.model.strength);
  assert.match(changed.issues.join(" "), /Strength prescription changed/);
  const before = provider.calls.filter((call) => call.method === "PUT").length;
  await assert.rejects(
    saveWorkoutEditor(wrap(provider.request), "event:100", {
      model: changed.model,
      revision: changed.revision,
    }),
    /Strength prescription changed/
  );
  assert.equal(provider.calls.filter((call) => call.method === "PUT").length, before);
});

test("Strength plain Text export retains prescription and all unsupported device formats explicitly reject", async () => {
  const value = model();
  assert.throws(() => encodeWorkoutFit(value), /device steps/);
  for (const format of ["zwo", "mrc", "erg"])
    assert.throws(() => encodeWorkoutTextFormat(value, format), /device steps/);
  const file = await exportWorkoutFile(
    { INTERVALS_API_KEY: "synthetic" },
    { model: value, format: "txt" }
  );
  const text = Buffer.from(file.data, "base64").toString();
  assert.match(text, /Strength session/);
  assert.match(text, /Air Squat/);
  assert.doesNotMatch(text, /Workout editor v1|"blocks"|"version"/);
  const manual = serializeManualWorkout(value, "Intro");
  assert.match(providerWorkoutDescription(manual), /Intro/);
  assert.match(providerWorkoutDescription(manual), /Air Squat/);
  assert.equal(readManualWorkoutDescription({ description: manual }), "Intro");
});

test("Strength native projection keeps absent planned totals unknown while paired actuals stay independent", () => {
  const value = model(),
    event = {
      ...fixtureEvent("WeightTraining"),
      name: value.name,
      description: serializeWorkout(value),
      start_date_local: value.date + "T00:00:00",
      moving_time: 0,
      workout_doc: { steps: [], duration: 0, distance: 0 },
    },
    actual = { id: "recorded", moving_time: 1800, distance: 0, icu_training_load: 24 };
  const projected = mapIntervalsWorkout(event, value.date, actual);
  assert.equal(projected.planned_time_label, null);
  assert.equal(projected.workout_summary.planned.duration_seconds, null);
  assert.equal(projected.workout_summary.planned.distance_meters, null);
  assert.equal(projected.structure, null);
  assert.equal(projected.workout_summary.completed.duration_seconds, 1800);
  assert.equal(projected.workout_summary.completed.tss, 24);
  assert.deepEqual(projected.editor_model.strength, value.strength);
});

test("Strength calendar copy preserves private structure under a new event identity/date and edit stays independent", async () => {
  const preview = createDesktopCalendarPreview(
      createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z"))
    ),
    value = model();
  const created = await preview.handle("workouts/editor", "POST", { model: value, creationId });
  const copied = await preview.handle(`workouts/${created.workoutId}/copy`, "POST", {
    date: "2026-10-23",
    creationId: "8ea7234c-5894-4ccd-ad8d-447f8a2c50ea",
  });
  assert.equal(copied.verified, true);
  assert.notEqual(copied.workoutId, created.workoutId);
  const loaded = await preview.handle(`workouts/${copied.workoutId}/editor`, "GET");
  assert.deepEqual(loaded.issues, []);
  assert.deepEqual(loaded.model.strength, value.strength);
  assert.equal(loaded.model.date, "2026-10-23");
  loaded.model.strength.blocks[0].exercises[0].title = "Copied Squat";
  await preview.handle(`workouts/${copied.workoutId}/editor`, "PUT", {
    model: loaded.model,
    revision: loaded.revision,
  });
  const original = await preview.handle(`workouts/${created.workoutId}/editor`, "GET");
  assert.equal(original.model.strength.blocks[0].exercises[0].title, "Air Squat");
  const writes = (await preview.handle("preview/provider-records", "GET")).writes;
  for (const write of writes)
    for (const row of Array.isArray(write.body) ? write.body : [write.body])
      if (typeof row?.description === "string")
        assert.doesNotMatch(row.description, /Workout editor v1|"blocks"/);
});

test("lost Strength create response reconciles the same exact prescription without another provider POST", async () => {
  const provider = fakeProvider(fixtureEvent(), { uncertainCreate: true }),
    wrap = metadata(),
    value = model();
  const first = await createWorkoutEditor(wrap(provider.request), { model: value, creationId });
  assert.equal(first.verified, true);
  const retried = await createWorkoutEditor(wrap(provider.request), {
    model: value,
    creationId,
    reconcileOnly: true,
  });
  assert.equal(retried.workoutId, first.workoutId);
  assert.deepEqual(
    (await loadWorkoutEditor(wrap(provider.request), first.workoutId)).model.strength,
    value.strength
  );
  assert.equal(provider.calls.filter((call) => call.method === "POST").length, 1);
});

test("read-only Strength events deny load and save before any provider mutation", async () => {
  const value = model(),
    initial = {
      ...fixtureEvent("WeightTraining"),
      name: value.name,
      description: serializeWorkout(value),
      start_date_local: value.date + "T00:00:00",
      workout_doc: { steps: [] },
      athlete_cannot_edit: true,
    },
    provider = fakeProvider(initial);
  await assert.rejects(
    loadWorkoutEditor(provider.request, "event:100"),
    (error) => error.status === 403
  );
  await assert.rejects(
    saveWorkoutEditor(provider.request, "event:100", { model: value, revision: "stale" }),
    (error) => error.status === 403
  );
  assert.equal(provider.calls.filter((call) => call.method).length, 0);
});
