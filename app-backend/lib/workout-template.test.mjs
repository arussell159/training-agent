import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkoutTemplateService,
  workoutTemplateAccount,
  workoutTemplateService,
} from "./workout-template.mjs";
import { validateWorkoutTemplateInput } from "./workout-template-model.mjs";
import {
  serializeManualWorkout,
  readManualWorkoutDescription,
} from "./workout-manual-description.mjs";
import { readEditorModel, importWorkout } from "./workout-editor-model.mjs";
import { readPlannedValues, withPlannedValues } from "./planned-workout-values.mjs";
import { withWorkoutCommentText } from "./workout-comment-text.mjs";
import { workoutRevision } from "./workout-editor.mjs";
import { newStrengthBlock, newStrengthExercise } from "./workout-strength-model.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import { createProviderWorkoutMetadata } from "./provider-workout-metadata.mjs";
import { scheduleLibraryWorkout } from "./workout-scheduling.mjs";
import { readWorkoutLibrary } from "./workout-library.mjs";
import { validatedLibraryWorkout } from "../../ui/src/lib/training-context-validation.ts";

const operationId = "5ce59f36-9d4a-49d2-a198-ac3b02708749";
const config = { SETTINGS_SCOPE: "same-deployment", INTERVALS_API_KEY: "synthetic-provider-A" };
const actor = { id: "trusted-actor-A", origin: "https://app.example", readOnly: false };
function records() {
  const values = new Map();
  let failUpdate = null;
  return {
    values,
    set failUpdate(value) {
      failUpdate = value;
    },
    record: (key, initial) => ({
      read: async () => structuredClone(values.get(key) ?? initial()),
      update: async (change) => {
        const state = structuredClone(values.get(key) ?? initial()),
          result = change(state);
        if (failUpdate?.(state)) throw Error("Synthetic encrypted storage failure");
        values.set(key, state);
        return structuredClone(result);
      },
    }),
  };
}
function fixture() {
  const storage = records();
  const model = {
    version: 1,
    name: "Committed Strength",
    sport: "WeightTraining",
    date: "2026-10-23",
    notes: "Saved source instructions.",
    poolLength: "",
    steps: [],
    strength: {
      version: 1,
      subtype: "Mobility",
      startTimeAssigned: false,
      blocks: [newStrengthBlock("single", newStrengthExercise("Squat"))],
    },
  };
  let source = {
    id: 41,
    category: "WORKOUT",
    type: "WeightTraining",
    name: model.name,
    start_date_local: model.date + "T00:00:00",
    paired_activity_id: "i999",
    description: withPlannedValues(serializeManualWorkout(model, "Separate manual introduction."), {
      duration_seconds: 3600,
      tss: 0,
      intensity_factor: null,
    }),
    moving_time: 3600,
    icu_training_load: 0,
    attachments: [{ id: 999 }],
    uid: "calendar-uid",
    external_id: "training-agent:editor:source",
  };
  source.description = withWorkoutCommentText(source.description, [
    {
      id: "comment:source",
      type: "post",
      body: "Athlete recording feedback must not become a template instruction.",
      created_at: "2026-10-23T12:00:00.000Z",
    },
  ]);
  const folders = [
    {
      id: 1,
      name: "My Library",
      type: "FOLDER",
      athlete_id: "123",
      visibility: "PRIVATE",
      canEdit: true,
    },
    {
      id: 2,
      name: "Someone else's folder",
      type: "FOLDER",
      athlete_id: "456",
      visibility: "PRIVATE",
      canEdit: true,
    },
    {
      id: 3,
      name: "Public folder",
      type: "FOLDER",
      athlete_id: "123",
      visibility: "PUBLIC",
      canEdit: true,
    },
    {
      id: 4,
      name: "Training plan",
      type: "PLAN",
      athlete_id: "123",
      visibility: "PRIVATE",
      canEdit: true,
    },
    {
      id: 5,
      name: "Read-only folder",
      type: "FOLDER",
      athlete_id: "123",
      visibility: "PRIVATE",
      canEdit: false,
    },
    { id: 6, name: "Unknown permission", type: "FOLDER", athlete_id: "123", visibility: "PRIVATE" },
  ];
  const workouts = new Map(),
    events = new Map(),
    writes = [],
    reads = [];
  let behavior = "normal",
    nextId = 500;
  const request = async (path, options = {}) => {
    if (options.method) {
      const body = JSON.parse(options.body);
      writes.push({ path, method: options.method, body });
      if (path === "/athlete/0/events") {
        const row = { id: ++nextId, ...body, workout_doc: null };
        events.set(row.id, row);
        return structuredClone(row);
      }
      assert.equal(path, "/athlete/0/workouts");
      assert.equal(options.method, "POST");
      if (behavior === "403") throw Object.assign(Error("Denied"), { status: 403 });
      if (behavior === "unknown-before") throw Error("Lost before commit");
      assert.equal(
        providerWorkoutDescription(body.description),
        body.description,
        "Native template description contains only human prescription"
      );
      const row = { id: ++nextId, ...body, workout_doc: null };
      workouts.set(row.id, row);
      if (behavior === "lost-reply") throw Error("Lost after commit");
      if (behavior === "no-id") return null;
      return structuredClone(row);
    }
    reads.push(path);
    if (path === "/athlete/0") return { id: "123", secret: "must-not-be-projected" };
    if (path === "/athlete/0/folders") return structuredClone(folders);
    if (path === "/athlete/0/events/41") return structuredClone(source);
    if (path.startsWith("/athlete/0/events?"))
      return [...events.values()].map((row) => structuredClone(row));
    if (path.startsWith("/athlete/0/events/"))
      return structuredClone(events.get(Number(path.split("/").at(-1))));
    if (path === "/athlete/0/workouts")
      return [...workouts.values()].map((row) => structuredClone(row));
    if (path.startsWith("/athlete/0/workouts/")) {
      const row = workouts.get(Number(path.split("/").at(-1)));
      if (!row) throw Object.assign(Error("Not found"), { status: 404 });
      return structuredClone(row);
    }
    throw Error("Unexpected native path " + path);
  };
  const scope = workoutTemplateAccount(config, actor);
  const service = createWorkoutTemplateService({
    request,
    record: storage.record,
    accountScope: scope,
  });
  const input = async (overrides = {}) => {
    const selected = (await service.listFolders()).folders.find((row) => row.id === "folder:1");
    return {
      accountScope: scope,
      sourceRevision: workoutRevision(source),
      folderId: selected.id,
      folderRevision: selected.revision,
      title: "Independent snapshot",
      operationId,
      ...overrides,
    };
  };
  return {
    model,
    storage,
    service,
    scope,
    input,
    folders,
    workouts,
    writes,
    reads,
    request,
    get source() {
      return source;
    },
    set source(value) {
      source = value;
    },
    set behavior(value) {
      behavior = value;
    },
  };
}

test("template title, operation, folder and request shape are strictly bounded", () => {
  const value = {
    accountScope: "a".repeat(64),
    sourceRevision: "b".repeat(64),
    folderId: "folder:1",
    folderRevision: "c".repeat(64),
    title: "a".repeat(128),
    operationId,
  };
  assert.deepEqual(validateWorkoutTemplateInput(value), []);
  for (const patch of [
    { title: " " },
    { title: "a".repeat(129) },
    { title: 1 },
    { folderId: "folder:9007199254740993" },
    { operationId: "retry" },
    { reconcileOnly: "true" },
    { model: {} },
    { accountScope: "" },
  ])
    assert.ok(validateWorkoutTemplateInput({ ...value, ...patch }).length);
});
test("folder catalog exposes only owned private folders and retains strict unknown/read-only permissions without writes", async () => {
  const h = fixture(),
    catalog = await h.service.listFolders();
  assert.deepEqual(
    catalog.folders.map((row) => [row.id, row.editable]),
    [
      ["folder:1", true],
      ["folder:5", false],
      ["folder:6", false],
    ]
  );
  assert.deepEqual(Object.keys(catalog).sort(), ["accountScope", "folders", "readOnly"]);
  assert.deepEqual(Object.keys(catalog.folders[0]).sort(), ["editable", "id", "name", "revision"]);
  assert.equal(h.writes.length, 0);
});
test("explicit template save preserves exact private Strength and planned values with an independent selected-folder identity and clean native text", async () => {
  const h = fixture(),
    original = structuredClone(h.source),
    input = await h.input(),
    result = await h.service.save("event:41", input);
  assert.equal(result.verified, true);
  assert.equal(result.operationId, operationId);
  assert.equal(result.workoutId, "library:501");
  assert.deepEqual(result.intent, {
    sourceWorkoutId: "event:41",
    sourceRevision: input.sourceRevision,
    folderId: input.folderId,
    folderRevision: input.folderRevision,
    title: input.title,
  });
  const native = h.workouts.get(501),
    stored = await h.service.hydrateTemplate(native),
    exact = readEditorModel(stored.description);
  assert.deepEqual(exact.strength, h.model.strength);
  assert.equal(exact.name, input.title);
  assert.equal(readManualWorkoutDescription(stored), "Separate manual introduction.");
  assert.deepEqual(readPlannedValues(stored.description), {
    duration_seconds: 3600,
    tss: 0,
    intensity_factor: null,
  });
  assert.equal(native.folder_id, 1);
  assert.equal(native.icu_training_load, 0);
  assert.ok(native.description.includes("Subtype: Mobility"));
  assert.ok(native.description.includes("Squat"));
  for (const internal of [
    "Workout editor v1",
    "startTimeAssigned",
    "training-agent-planned-values",
    '"blocks"',
    '"version"',
    "Athlete recording feedback",
  ])
    assert.equal(native.description.includes(internal), false);
  for (const field of [
    "start_date_local",
    "paired_activity_id",
    "uid",
    "external_id",
    "attachments",
  ])
    assert.equal(Object.hasOwn(native, field), false);
  assert.deepEqual(h.source, original);
  assert.ok(validatedLibraryWorkout(result.workout));
  assert.equal(h.writes.length, 1);
});
test("last committed snapshot is independent of later source and template changes; replay never overwrites changed template", async () => {
  const h = fixture(),
    input = await h.input(),
    first = await h.service.save("event:41", input);
  h.source.name = "Later calendar title";
  h.source.description = "Later calendar prose";
  const replay = await h.service.save("event:41", { ...input, reconcileOnly: true });
  assert.equal(replay.workout.title, first.workout.title);
  assert.equal(h.writes.length, 1);
  h.workouts.get(501).name = "Independently edited template";
  await assert.rejects(
    h.service.save("event:41", { ...input, reconcileOnly: true }),
    (error) =>
      error.status === 409 &&
      error.code === "TEMPLATE_REPLAY_CHANGED" &&
      error.workoutId === "library:501" &&
      error.accountScope === h.scope &&
      error.operationId === operationId
  );
  assert.equal(h.workouts.get(501).name, "Independently edited template");
  assert.equal(h.writes.length, 1);
});
test("lost committed response reconciles exact native identity once, including fresh service instance private hydration", async () => {
  const h = fixture(),
    input = await h.input();
  h.behavior = "lost-reply";
  const saved = await h.service.save("event:41", input);
  const fresh = createWorkoutTemplateService({
    request: h.request,
    record: h.storage.record,
    accountScope: h.scope,
  });
  assert.equal(
    (await fresh.save("event:41", { ...input, reconcileOnly: true })).workoutId,
    saved.workoutId
  );
  const [listed] = await readWorkoutLibrary(fresh.wrapLibraryReads(h.request));
  assert.deepEqual(listed.editor_model.strength, h.model.strength);
  assert.equal(h.writes.length, 1);
});
test("unknown precommit response retains immutable intent and reconcile-only never sends a second POST", async () => {
  const h = fixture(),
    input = await h.input();
  h.behavior = "unknown-before";
  await assert.rejects(h.service.save("event:41", input), { code: "TEMPLATE_UNCONFIRMED" });
  h.behavior = "normal";
  await assert.rejects(h.service.save("event:41", { ...input, reconcileOnly: true }), {
    code: "TEMPLATE_UNCONFIRMED",
  });
  await assert.rejects(h.service.save("event:41", input), { code: "TEMPLATE_UNCONFIRMED" });
  assert.equal(h.writes.length, 1);
  assert.equal(h.workouts.size, 0);
});
test("simultaneous same-operation claims permit only one native POST", async () => {
  const h = fixture(),
    input = await h.input(),
    results = await Promise.allSettled([
      h.service.save("event:41", input),
      h.service.save("event:41", input),
    ]);
  assert.equal(h.writes.length, 1);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  assert.equal(
    (await h.service.save("event:41", { ...input, reconcileOnly: true })).verified,
    true
  );
});
test("stale source or folder, readonly source/folder and malformed native folders reject before any library write", async () => {
  for (const mutation of [
    "source",
    "folder",
    "sourceReadonly",
    "folderReadonly",
    "folderMissing",
    "duplicateFolders",
    "missingStrength",
  ]) {
    const h = fixture(),
      input = await h.input();
    if (mutation === "source") h.source.name = "Changed";
    if (mutation === "folder") h.folders[0].name = "Renamed";
    if (mutation === "sourceReadonly") h.source.athlete_cannot_edit = true;
    if (mutation === "folderReadonly") h.folders[0].canEdit = false;
    if (mutation === "folderMissing") h.folders.splice(0, 1);
    if (mutation === "duplicateFolders") h.folders.push(structuredClone(h.folders[0]));
    if (mutation === "missingStrength") {
      h.source.description = providerWorkoutDescription(h.source.description);
      input.sourceRevision = workoutRevision(h.source);
    }
    await assert.rejects(h.service.save("event:41", input));
    assert.equal(h.writes.length, 0, mutation);
  }
});
test("same settings scope but different trusted actor/provider cannot replay old queued intent or hydrate its private snapshot", async () => {
  const h = fixture(),
    input = await h.input();
  await h.service.save("event:41", input);
  const bScope = workoutTemplateAccount(config, { ...actor, id: "trusted-actor-B" });
  assert.notEqual(bScope, h.scope);
  assert.notEqual(
    workoutTemplateAccount({ ...config, INTERVALS_API_KEY: "rotated-key" }, actor),
    h.scope
  );
  const other = createWorkoutTemplateService({
    request: h.request,
    record: h.storage.record,
    accountScope: bScope,
  });
  await assert.rejects(other.save("event:41", input), {
    status: 409,
    code: "TEMPLATE_ACCOUNT_CHANGED",
  });
  await assert.rejects(other.hydrateTemplate(h.workouts.get(501)), {
    code: "TEMPLATE_METADATA_UNAVAILABLE",
  });
  assert.equal(h.writes.length, 1);
});
test("definite provider rejection stays authoritative even if storage cannot persist rejection, and no private snapshot is published", async () => {
  const h = fixture(),
    input = await h.input();
  h.behavior = "403";
  h.storage.failUpdate = (state) => state.operation?.state === "rejected";
  await assert.rejects(h.service.save("event:41", input), {
    status: 403,
    code: "TEMPLATE_REJECTED",
  });
  h.behavior = "normal";
  h.storage.failUpdate = null;
  await assert.rejects(h.service.save("event:41", { ...input, reconcileOnly: true }), {
    code: "TEMPLATE_UNCONFIRMED",
  });
  assert.equal(h.workouts.size, 0);
  assert.equal(h.writes.length, 1);
});
test("successful native save plus failed receipt write recovers by independent matching readback without duplicate POST", async () => {
  const h = fixture(),
    input = await h.input();
  h.storage.failUpdate = (state) => state.operation?.state === "verified";
  await assert.rejects(h.service.save("event:41", input));
  await assert.rejects(h.service.hydrateTemplate(h.workouts.get(501)), {
    code: "TEMPLATE_METADATA_UNAVAILABLE",
  });
  h.storage.failUpdate = null;
  assert.equal(
    (await h.service.save("event:41", { ...input, reconcileOnly: true })).verified,
    true
  );
  assert.deepEqual(
    readEditorModel((await h.service.hydrateTemplate(h.workouts.get(501))).description).strength,
    h.model.strength
  );
  assert.equal(h.writes.length, 1);
});
test("changed operation, duplicate marker or deleted verified template cannot silently create or overwrite", async () => {
  const h = fixture(),
    input = await h.input();
  await h.service.save("event:41", input);
  await assert.rejects(h.service.save("event:41", { ...input, title: "Another" }), {
    code: "TEMPLATE_INTENT_CHANGED",
  });
  h.workouts.delete(501);
  await assert.rejects(h.service.save("event:41", { ...input, reconcileOnly: true }), {
    code: "TEMPLATE_REPLAY_CHANGED",
  });
  const fresh = fixture(),
    freshInput = await fresh.input();
  fresh.behavior = "unknown-before";
  await assert.rejects(fresh.service.save("event:41", freshInput));
  const [retained] = fresh.storage.values.values(),
    body = retained.operation.body;
  fresh.workouts.set(700, { id: 700, ...body });
  fresh.workouts.set(701, { id: 701, ...body });
  await assert.rejects(
    fresh.service.save("event:41", { ...freshInput, reconcileOnly: true }),
    /Multiple templates/
  );
  assert.equal(h.writes.length, 1);
  assert.equal(fresh.writes.length, 1);
});
test("template hydration never replaces newer attached private metadata or attaches to a copied/changed native identity", async () => {
  const h = fixture();
  await h.service.save("event:41", await h.input());
  const native = h.workouts.get(501),
    newer = structuredClone(h.model);
  newer.strength.startTimeAssigned = true;
  const enriched = { ...native, description: serializeManualWorkout(newer, "Newer") };
  assert.deepEqual(await h.service.hydrateTemplate(enriched), enriched);
  for (const changed of [
    { ...native, id: 999 },
    { ...native, description: "Changed prose" },
    { ...native, folder_id: 99 },
  ])
    await assert.rejects(h.service.hydrateTemplate(changed), {
      code: "TEMPLATE_METADATA_UNAVAILABLE",
    });
});
test("exact template metadata survives independent calendar scheduling without leaking JSON or mutating either snapshot", async () => {
  const h = fixture(),
    saved = await h.service.save("event:41", await h.input()),
    copyRecords = records(),
    metadata = records();
  const request = createProviderWorkoutMetadata({ record: metadata.record }).wrap(
    h.service.wrapLibraryReads(h.request)
  );
  const copyStore = copyRecords.record("copy", () => ({ operation: null }));
  const scheduled = await scheduleLibraryWorkout(
    {},
    request,
    saved.workoutId,
    { date: "2026-11-02", creationId: "53830c1b-588d-47cb-9af9-e90a7dfc0d98" },
    { record: copyStore }
  );
  const event = await request(`/athlete/0/events/${scheduled.event.id}`),
    imported = importWorkout(event);
  assert.deepEqual(imported.issues, []);
  assert.equal(imported.model.date, "2026-11-02");
  assert.deepEqual(imported.model.strength, h.model.strength);
  const eventWrite = h.writes.find((write) => write.path === "/athlete/0/events");
  assert.equal(
    eventWrite.body.description,
    providerWorkoutDescription(eventWrite.body.description)
  );
  imported.model.strength.startTimeAssigned = true;
  assert.equal(
    readEditorModel((await h.service.hydrateTemplate(h.workouts.get(501))).description).strength
      .startTimeAssigned,
    false
  );
  assert.equal(readEditorModel(h.source.description).strength.startTimeAssigned, false);
});
test("blocked write-ahead storage prevents native mutation; reconcileOnly without intent cannot create", async () => {
  const h = fixture(),
    input = await h.input();
  h.storage.failUpdate = () => true;
  await assert.rejects(h.service.save("event:41", input));
  assert.equal(h.writes.length, 0);
  h.storage.failUpdate = null;
  await assert.rejects(h.service.save("event:41", { ...input, reconcileOnly: true }), {
    code: "TEMPLATE_UNCONFIRMED",
  });
  assert.equal(h.writes.length, 0);
});
test("retained prepared intent revalidates folder ownership/privacy/revision immediately before any native POST", async () => {
  for (const kind of ["visibility", "owner", "name", "permission"]) {
    const h = fixture(),
      input = await h.input();
    // Emulate a committed write-ahead CAS whose response was lost, before any
    // native claim. The next service call sees a real retained prepared intent.
    let failed = false;
    const service = createWorkoutTemplateService({
      request: h.request,
      accountScope: h.scope,
      record: (key, initial) => {
        const original = h.storage.record(key, initial);
        return {
          read: original.read,
          update: async (change) => {
            const result = await original.update(change);
            if (!failed && (await original.read()).operation?.state === "prepared") {
              failed = true;
              throw Error("Lost write-ahead CAS response");
            }
            return result;
          },
        };
      },
    });
    await assert.rejects(service.save("event:41", input));
    assert.equal(h.writes.length, 0);
    if (kind === "visibility") h.folders[0].visibility = "PUBLIC";
    if (kind === "owner") h.folders[0].athlete_id = "another-owner";
    if (kind === "name") h.folders[0].name = "Changed folder";
    if (kind === "permission") h.folders[0].canEdit = false;
    await assert.rejects(
      h.service.save("event:41", input),
      (error) => error.code === "TEMPLATE_FOLDER_CHANGED" || error.code === "TEMPLATE_READ_ONLY"
    );
    assert.equal(h.writes.length, 0, kind);
  }
});
test("scoped read-only operation inspection supplies saved/changed/deleted proof but never treats an uncertain attempt as committed", async () => {
  const h = fixture(),
    input = await h.input();
  await assert.rejects(h.service.inspect(operationId, "b".repeat(64)), {
    code: "TEMPLATE_ACCOUNT_CHANGED",
  });
  await assert.rejects(h.service.inspect(operationId, h.scope), { status: 404 });
  await h.service.save("event:41", input);
  const saved = await h.service.inspect(operationId, h.scope);
  assert.equal(saved.status, "saved");
  assert.equal(saved.workoutId, "library:501");
  assert.ok(validatedLibraryWorkout(saved.workout));
  h.workouts.get(501).name = "Current native template";
  const changed = await h.service.inspect(operationId, h.scope);
  assert.equal(changed.status, "changed");
  assert.equal(changed.workout.title, "Current native template");
  assert.deepEqual(changed.intent, saved.intent);
  h.workouts.delete(501);
  const deleted = await h.service.inspect(operationId, h.scope);
  assert.equal(deleted.status, "deleted");
  assert.equal(deleted.workoutId, "library:501");
  assert.equal(deleted.workout, null);
  const uncertain = fixture();
  uncertain.behavior = "unknown-before";
  await assert.rejects(uncertain.service.save("event:41", await uncertain.input()));
  const unknown = await uncertain.service.inspect(operationId, uncertain.scope);
  assert.equal(unknown.status, "unconfirmed");
  assert.equal(unknown.workoutId, null);
  assert.equal(unknown.workout, null);
  assert.equal(h.writes.length, 1);
  assert.equal(uncertain.writes.length, 1);
});
test("production encrypted adapter isolates two trusted actors in the same deployment and never stores plaintext prescription", async () => {
  const h = fixture(),
    db = new Map(),
    settings = {
      ...config,
      SUPABASE_URL: "https://synthetic-template-store.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_synthetic_templates_only",
      SETTINGS_ENCRYPTION_KEY: "synthetic-encryption-material-templates",
    };
  const fetchImpl = async (url, options = {}) => {
    assert.ok(url.startsWith(settings.SUPABASE_URL));
    const params = new URL(url).searchParams;
    if (options.method === "POST") {
      const [row] = JSON.parse(options.body),
        key = row.scope + ":" + row.name;
      if (db.has(key)) return { ok: false, status: 409, json: async () => [] };
      db.set(key, row);
      return { ok: true, json: async () => [row] };
    }
    const key = params.get("scope").slice(3) + ":" + params.get("name").slice(3),
      row = db.get(key);
    if (options.method === "PATCH") {
      if (row?.updated_at !== params.get("updated_at")?.slice(3))
        return { ok: true, json: async () => [] };
      const next = JSON.parse(options.body);
      db.set(key, next);
      return { ok: true, json: async () => [next] };
    }
    return { ok: true, json: async () => (row ? [row] : []) };
  };
  const service = workoutTemplateService(settings, actor, h.request, fetchImpl),
    input = await h.input();
  // The configured provider/actor binding is identical to the pure service.
  assert.equal(input.accountScope, workoutTemplateAccount(settings, actor));
  await service.save("event:41", input);
  const other = workoutTemplateService(
    settings,
    { ...actor, id: "trusted-actor-B" },
    h.request,
    fetchImpl
  );
  await assert.rejects(other.save("event:41", input), { code: "TEMPLATE_ACCOUNT_CHANGED" });
  await assert.rejects(
    other.inspect(
      operationId,
      workoutTemplateAccount(settings, { ...actor, id: "trusted-actor-B" })
    ),
    { status: 404 }
  );
  await assert.rejects(other.hydrateTemplate(h.workouts.get(501)), {
    code: "TEMPLATE_METADATA_UNAVAILABLE",
  });
  for (const row of db.values()) {
    assert.ok(row.encrypted_value.startsWith("v1."));
    assert.equal(row.encrypted_value.includes("Saved source instructions"), false);
    assert.equal(row.encrypted_value.includes("Separate manual introduction"), false);
  }
  assert.equal(h.writes.length, 1);
});
test("read-only trusted actor cannot prepare or publish a template", async () => {
  const h = fixture(),
    service = createWorkoutTemplateService({
      request: h.request,
      record: h.storage.record,
      accountScope: h.scope,
      readOnly: true,
    });
  assert.equal(
    (await service.listFolders()).folders.every((row) => !row.editable),
    true
  );
  await assert.rejects(service.save("event:41", await h.input()), {
    status: 403,
    code: "TEMPLATE_READ_ONLY",
  });
  assert.equal(h.storage.values.size, 0);
  assert.equal(h.writes.length, 0);
  for (const invalid of [
    null,
    { ...actor, readOnly: undefined },
    { ...actor, origin: "https://app.example/path" },
  ])
    assert.throws(() => workoutTemplateAccount(config, invalid), { status: 401 });
});
