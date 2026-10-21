import test from "node:test";
import assert from "node:assert/strict";
import {
  createStrengthExerciseLibrary,
  strengthExerciseLibrary,
  strengthLibraryAccount,
} from "./strength-exercise-library.mjs";
import {
  newStrengthExerciseDefinition,
  validateStrengthExerciseDefinition,
  strengthExerciseVideo,
  strengthLibraryExerciseBlock,
  isStrengthLibraryExercise,
} from "./strength-exercise-library-model.mjs";
import {
  validateStrengthPrescription,
  copyStrengthPrescription,
} from "./workout-strength-model.mjs";
const operationId = "custom-exercise-operation-one",
  scope = "a".repeat(64);
const definition = () => ({
  ...newStrengthExerciseDefinition(),
  title: "Synthetic custom squat",
  muscleGroup: "Quads",
  instructions: "Keep a controlled movement",
  videoUrl: "https://youtu.be/dQw4w9WgXcQ",
});
function memory(options = {}) {
  let state,
    writes = 0;
  const record = (initial) => ({
    read: async () => {
      if (options.failRead) throw Error("private store body");
      return structuredClone(state ?? initial());
    },
    update: async (change) => {
      if (options.reject) throw Error("private failure");
      const copy = structuredClone(state ?? initial()),
        result = change(copy);
      state = copy;
      writes++;
      if (options.loseReply) {
        options.loseReply = false;
        throw Error("private lost response");
      }
      return result;
    },
  });
  return {
    service: (readOnly) =>
      createStrengthExerciseLibrary({
        record,
        accountScope: scope,
        readOnly: readOnly ?? false,
        now: () => new Date("2026-10-20T12:00:00Z"),
      }),
    get state() {
      return state;
    },
    get writes() {
      return writes;
    },
    options,
  };
}
const creation = async (f, extra = {}) => {
  const catalog = await f.service().list();
  return {
    operationId,
    accountScope: catalog.accountScope,
    catalogRevision: catalog.revision,
    definition: definition(),
    ...extra,
  };
};
test("custom exercise model uses exact defaults, independent parameters and safe HTTPS video descriptors", () => {
  const value = definition();
  assert.deepEqual(
    value.parameters.map((column) => [column.kind, column.unit]),
    [
      ["reps", "reps"],
      ["weight", "lb"],
    ]
  );
  assert.equal(validateStrengthExerciseDefinition(value).title, value.title);
  assert.equal(
    strengthExerciseVideo(value.videoUrl).embedUrl,
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
  );
  assert.equal(
    strengthExerciseVideo("https://vimeo.com/123456/abcdef").embedUrl,
    "https://player.vimeo.com/video/123456?h=abcdef"
  );
  assert.equal(strengthExerciseVideo(""), null);
  for (const videoUrl of [
    "http://youtu.be/dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://user@youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/channel/anything",
    "https://vimeo.com/not-a-video",
    "https://youtu.be:8443/dQw4w9WgXcQ",
  ])
    assert.throws(() => validateStrengthExerciseDefinition({ ...value, videoUrl }));
  for (const change of [
    { title: " " },
    { title: "x".repeat(129) },
    { instructions: "x".repeat(1001) },
    { muscleGroup: "Legs" },
    { parameters: [] },
    { parameters: [value.parameters[0], value.parameters[0]] },
    { owner: "someone" },
    { parameters: [{ ...value.parameters[0], unit: "kg" }] },
  ])
    assert.throws(() => validateStrengthExerciseDefinition({ ...value, ...change }));
});
test("catalog persists independently, filters exact custom records, revisioned edits and deletion never alter inserted workout snapshots", async () => {
  const f = memory(),
    input = await creation(f),
    saved = await f.service().create(input);
  assert.equal(saved.verified, true);
  assert.equal(isStrengthLibraryExercise(saved.exercise), true);
  const block = strengthLibraryExerciseBlock(saved.exercise),
    second = strengthLibraryExerciseBlock(saved.exercise),
    snapshot = structuredClone(block);
  assert.equal(block.kind, "single");
  assert.equal(block.exercises[0].sets.length, 3);
  assert.ok(
    block.exercises[0].sets.every((set) =>
      Object.values(set.values).every((value) => value === null)
    )
  );
  assert.equal(block.exercises[0].libraryExerciseId, saved.id);
  assert.notEqual(block.exercises[0].id, second.exercises[0].id);
  assert.notEqual(block.exercises[0].parameters[0].id, second.exercises[0].parameters[0].id);
  assert.deepEqual(validateStrengthPrescription({ version: 1, blocks: [block] }), []);
  assert.equal(
    copyStrengthPrescription({ version: 1, blocks: [block] }).blocks[0].exercises[0]
      .libraryExerciseId,
    saved.id
  );
  const loaded = await f.service().load(saved.id);
  assert.equal(loaded.instructions, input.definition.instructions);
  assert.equal(
    (await f.service().list({ query: "CUSTOM", muscleGroup: "Quads", owner: "me" })).exercises
      .length,
    1
  );
  assert.equal((await f.service().list({ muscleGroup: "Chest" })).exercises.length, 0);
  const edited = await f.service().update(saved.id, {
    operationId: "custom-exercise-operation-edit",
    accountScope: scope,
    revision: loaded.revision,
    definition: { ...input.definition, title: "Updated library title" },
  });
  assert.equal(edited.exercise.title, "Updated library title");
  assert.deepEqual(block, snapshot);
  const deleted = await f.service().delete(saved.id, {
    operationId: "custom-exercise-operation-delete",
    accountScope: scope,
    revision: edited.exercise.revision,
  });
  assert.equal(deleted.deleted, true);
  assert.equal((await f.service().list()).total, 0);
  assert.deepEqual(block, snapshot);
  await assert.rejects(f.service().load(saved.id), { status: 404 });
  await assert.rejects(f.service().create({ ...input, reconcileOnly: true }), {
    status: 409,
    code: "STRENGTH_LIBRARY_REPLAY_CHANGED",
  });
});
test("fresh readback, immutable replay and lost database replies recover one creation and do not revive later edits or deletes", async () => {
  const f = memory({ loseReply: true }),
    input = await creation(f);
  await assert.rejects(f.service().create(input), {
    status: 502,
    code: "STRENGTH_LIBRARY_UNCONFIRMED",
  });
  assert.equal(Object.keys(f.state.entries).length, 1);
  const confirmed = await f.service().create({ ...input, reconcileOnly: true });
  assert.equal(confirmed.id, Object.keys(f.state.entries)[0]);
  assert.match(confirmed.id, /^exercise:[a-f0-9]{64}$/);
  assert.equal(confirmed.operationId, operationId);
  assert.equal((await f.service().list()).total, 1);
  await assert.rejects(
    f.service().create({ ...input, definition: { ...input.definition, title: "Another intent" } }),
    { status: 409, code: "STRENGTH_LIBRARY_OPERATION_REUSED" }
  );
  await f.service().update(confirmed.id, {
    operationId: "custom-exercise-operation-edit",
    accountScope: scope,
    revision: confirmed.exercise.revision,
    definition: { ...input.definition, instructions: "Changed instructions" },
  });
  await assert.rejects(f.service().create({ ...input, reconcileOnly: true }), {
    status: 409,
    code: "STRENGTH_LIBRARY_REPLAY_CHANGED",
    exerciseId: confirmed.id,
    accountScope: scope,
    operationId,
  });
  const fresh = memory();
  await assert.rejects(
    fresh.service().create({ ...(await creation(fresh)), reconcileOnly: true }),
    { status: 502 }
  );
  assert.equal(fresh.writes, 0);
});
test("wrong account, read-only, stale, invalid and precommit store failures never mutate catalog; corrupt data fails closed", async () => {
  const f = memory(),
    input = await creation(f);
  await assert.rejects(f.service().create({ ...input, accountScope: "b".repeat(64) }), {
    status: 409,
    code: "STRENGTH_LIBRARY_ACCOUNT_CHANGED",
  });
  await assert.rejects(f.service(true).create(input), { status: 403 });
  await assert.rejects(
    f.service().create({ ...input, definition: { ...input.definition, owner: "another" } }),
    { status: 400 }
  );
  assert.equal(f.writes, 0);
  f.options.reject = true;
  await assert.rejects(
    f.service().create(input),
    (error) => error.status === 502 && !error.message.includes("private")
  );
  assert.equal(f.writes, 0);
  f.options.reject = false;
  const saved = await f.service().create(input);
  await assert.rejects(
    f.service().create({ ...input, operationId: "other-creation-with-old-catalog" }),
    { status: 409, code: "STRENGTH_LIBRARY_CONFLICT" }
  );
  await assert.rejects(
    f.service().update(saved.id, {
      operationId: "custom-exercise-stale-operation",
      accountScope: scope,
      revision: "0".repeat(64),
      definition: input.definition,
    }),
    { status: 409 }
  );
  f.state.entries[saved.id].definition.muscleGroup = "Corrupt group";
  await assert.rejects(f.service().list(), {
    status: 502,
    code: "STRENGTH_LIBRARY_STORAGE_INVALID",
  });
});
test("exact library identity history stays separate from same-title exercises and clearly labels unlinked legacy prescriptions", async () => {
  const f = memory(),
    first = await f.service().create(await creation(f)),
    second = await f
      .service()
      .create(await creation(f, { operationId: "another-same-title-exercise" })),
    block = strengthLibraryExerciseBlock(first.exercise),
    other = strengthLibraryExerciseBlock(second.exercise),
    legacy = structuredClone(block);
  delete legacy.exercises[0].libraryExerciseId;
  const context = {
    planned: [
      {
        id: "event:1",
        workout_date: "2026-10-20",
        title: "Exact saved prescription",
        editor_model: { strength: { version: 1, blocks: [block] } },
      },
      {
        id: "event:2",
        workout_date: "2026-10-21",
        title: "Different library identity",
        editor_model: { strength: { version: 1, blocks: [other] } },
      },
      {
        id: "event:3",
        workout_date: "2026-10-22",
        title: "Legacy name only",
        editor_model: { strength: { version: 1, blocks: [legacy] } },
      },
    ],
    history: [],
  };
  const result = await f.service().history(first.id, context);
  assert.deepEqual(
    result.records.map((row) => row.workoutId),
    ["event:1"]
  );
  assert.deepEqual(
    result.legacyMatches.map((row) => row.workoutId),
    ["event:3"]
  );
  assert.equal(result.actualResultsAvailable, false);
  assert.equal(result.coverage, "retained-calendar-context");
});
test("expired receipt cache cannot recreate a deleted custom exercise or silently accept a changed immutable create", async () => {
  const f = memory(),
    input = await creation(f),
    saved = await f.service().create(input);
  f.state.receipts = [];
  assert.equal((await f.service().create({ ...input, reconcileOnly: true })).id, saved.id);
  const deleted = await f.service().delete(saved.id, {
    operationId: "custom-exercise-operation-delete",
    accountScope: scope,
    revision: saved.exercise.revision,
  });
  f.state.receipts = [];
  await assert.rejects(f.service().create(input), {
    status: 409,
    code: "STRENGTH_LIBRARY_REPLAY_CHANGED",
  });
  assert.equal(
    (
      await f.service().delete(saved.id, {
        operationId: "custom-exercise-operation-delete",
        accountScope: scope,
        revision: saved.exercise.revision,
        reconcileOnly: true,
      })
    ).deleted,
    true
  );
  assert.equal(deleted.id, saved.id);
});

test("two trusted actors on the same settings scope have encrypted isolated catalogs; late A intent under B cannot mutate B even at equal empty revision", async () => {
  const rows = new Map(),
    writes = [];
  const fetchImpl = async (href, options = {}) => {
    const params = new URL(href).searchParams,
      key = `${params.get("scope")}|${params.get("name")}`;
    let result;
    if (options.method === "POST") {
      const row = JSON.parse(options.body)[0],
        id = `eq.${row.scope}|eq.${row.name}`;
      result = rows.has(id) ? [] : [row];
      if (result.length) {
        rows.set(id, row);
        writes.push(row);
      }
    } else if (options.method === "PATCH") {
      const current = rows.get(key);
      result =
        current?.updated_at === params.get("updated_at")?.slice(3)
          ? [JSON.parse(options.body)]
          : [];
      if (result.length) {
        rows.set(key, result[0]);
        writes.push(result[0]);
      }
    } else result = rows.has(key) ? [rows.get(key)] : [];
    const copy = structuredClone(result);
    await Promise.resolve();
    return { ok: true, json: async () => copy };
  };
  const bootstrap = {
      SETTINGS_SCOPE: "same-settings-scope",
      SUPABASE_URL: "https://synthetic-db.invalid",
      SUPABASE_SECRET_KEY: "sb_secret_synthetic_only",
    },
    a = { id: "trusted-actor-A", origin: "https://training.example.test", readOnly: false },
    b = { ...a, id: "trusted-actor-B" };
  const one = () => strengthExerciseLibrary(bootstrap, a, fetchImpl),
    two = () => strengthExerciseLibrary(bootstrap, b, fetchImpl),
    emptyA = await one().list(),
    emptyB = await two().list();
  assert.equal(emptyA.revision, emptyB.revision);
  assert.notEqual(emptyA.accountScope, emptyB.accountScope);
  const input = {
    operationId,
    accountScope: emptyA.accountScope,
    catalogRevision: emptyA.revision,
    definition: definition(),
  };
  await assert.rejects(two().create(input), {
    status: 409,
    code: "STRENGTH_LIBRARY_ACCOUNT_CHANGED",
  });
  assert.equal(writes.length, 0);
  const [first, repeated] = await Promise.all([one().create(input), one().create(input)]);
  assert.equal(first.id, repeated.id);
  assert.equal((await one().list()).total, 1);
  assert.equal((await two().list()).total, 0);
  await assert.rejects(two().load(first.id), { status: 404 });
  const actorB = await two().create({
    ...input,
    accountScope: emptyB.accountScope,
    catalogRevision: emptyB.revision,
    definition: { ...input.definition, title: "Other actor same operation" },
  });
  assert.notEqual(actorB.id, first.id);
  await assert.rejects(one().load(actorB.id), { status: 404 });
  assert.equal((await one().list()).exercises[0].title, input.definition.title);
  assert.doesNotMatch(
    JSON.stringify([...rows.values()]),
    /Synthetic custom squat|Keep a controlled movement|trusted-actor-A|youtu\.be/
  );
  assert.equal(
    strengthLibraryAccount({ ...bootstrap, INTERVALS_API_KEY: "rotated" }, a),
    emptyA.accountScope
  );
  assert.notEqual(
    strengthLibraryAccount({ ...bootstrap, SETTINGS_SCOPE: "different" }, a),
    emptyA.accountScope
  );
});
