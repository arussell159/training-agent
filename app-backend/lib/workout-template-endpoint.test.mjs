import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createWorkoutTemplateEndpoint } from "./workout-template-endpoint.mjs";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";
import { resolveApiRoute } from "./api-routing.mjs";
import { newStrengthBlock, newStrengthExercise } from "./workout-strength-model.mjs";
import { createWorkoutEditor, saveWorkoutEditor } from "./workout-editor.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import { readEditorModel } from "./workout-editor-model.mjs";
import { validatedLibraryWorkout } from "../../ui/src/lib/training-context-validation.ts";

const creationId = "438dd3ed-76e8-4dbb-b07c-c37d29ed7146",
  operationId = "0f158eb1-3f9b-4d5f-aafa-09b914d30b7b";
const model = (date) => ({
  version: 1,
  name: "Committed template source",
  sport: "WeightTraining",
  date,
  notes: "Saved source instructions.",
  poolLength: "",
  steps: [],
  strength: {
    version: 1,
    subtype: "Yoga",
    startTimeAssigned: true,
    blocks: [newStrengthBlock("single", newStrengthExercise("Squat"))],
  },
});
const fixture = (options = {}) => {
  const base = createDesktopPreviewFixtures(new Date("2026-10-21T12:00:00Z"));
  return { base, preview: createDesktopCalendarPreview(base, options) };
};
const actor = (id = "A", readOnly = false) => ({
  id: "synthetic-template-actor-" + id,
  origin: "http://localhost",
  readOnly,
});
const readBody = async (req) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  return JSON.parse(text || "{}");
};

test("actual HTTP endpoint binds actor, query routing and immutable save/inspection DTO; native description stays clean", async (t) => {
  const { base, preview } = fixture(),
    source = await preview.handle("workouts/editor", "POST", {
      model: model(base.today),
      creationId,
      description: "Saved source instructions.",
      descriptionMode: "manual",
      values: { duration_seconds: 3600, tss: 0 },
      time: "00:00",
    }),
    id = source.workoutId;
  const handle = createWorkoutTemplateEndpoint({
    readConfig: async () => ({}),
    readBody,
    service: (_config, current) => preview.templateService(current),
  });
  const server = http.createServer(async (req, res) => {
    req.url = resolveApiRoute(req.url);
    if (req.headers["x-test-auth"] !== "missing")
      req.appActor = actor(
        req.headers["x-test-actor"] || "A",
        req.headers["x-test-readonly"] === "true"
      );
    if (!(await handle(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`,
    call = async (path, body, headers = {}) => {
      const response = await fetch(origin + path, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { response, value: await response.json() };
    };
  const unauthorized = await call("/api/workout-library/folders", null, {
    "x-test-auth": "missing",
  });
  assert.equal(unauthorized.response.status, 401);
  const folders = await call("/api/handler?__api_route=workout-library%2Ffolders");
  assert.equal(folders.response.status, 200);
  assert.equal(folders.response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(
    folders.value.folders.map((row) => [row.id, row.editable]),
    [
      ["folder:1", true],
      ["folder:2", true],
      ["folder:5", false],
    ]
  );
  const editor = await preview.handle(`workouts/${id}/editor`, "GET"),
    chosen = folders.value.folders[1],
    input = {
      accountScope: folders.value.accountScope,
      sourceRevision: editor.revision,
      folderId: chosen.id,
      folderRevision: chosen.revision,
      title: "Independent template",
      operationId,
    };
  const saved = await call(
    `/api/handler?__api_route=${encodeURIComponent(`workouts/${id}/save-template`)}`,
    input
  );
  assert.equal(saved.response.status, 200);
  assert.equal(saved.value.verified, true);
  assert.equal(saved.value.intent.folderId, "folder:2");
  assert.equal(saved.value.intent.sourceWorkoutId, id);
  assert.ok(validatedLibraryWorkout(saved.value.workout));
  const records = await preview.handle("preview/provider-records", "GET"),
    native = records.libraryWorkouts.find((row) => `library:${row.id}` === saved.value.workoutId);
  assert.equal(native.folder_id, 2);
  assert.equal(native.description, providerWorkoutDescription(native.description));
  assert.deepEqual(
    saved.value.workout.editor_model.strength,
    source.event ? readEditorModel(source.event.description).strength : editor.model.strength
  );
  const inspection = await call(
    `/api/workout-template-operations/${operationId}?accountScope=${input.accountScope}`
  );
  assert.equal(inspection.value.status, "saved");
  assert.equal(inspection.value.workoutId, saved.value.workoutId);
  const other = await call(`/api/workouts/${id}/save-template`, input, { "x-test-actor": "B" });
  assert.equal(other.response.status, 409);
  assert.equal(other.value.code, "TEMPLATE_ACCOUNT_CHANGED");
  const readonly = await call(`/api/workouts/${id}/save-template`, input, {
    "x-test-readonly": "true",
  });
  assert.equal(readonly.response.status, 403);
  const invalid = await call("/api/workout-library/folders?unknown=1");
  assert.equal(invalid.response.status, 400);
  await preview.handle("preview/workout-template-state", "POST", {
    template: { id: saved.value.workoutId, name: "Later independent template edit" },
  });
  const replay = await call(`/api/workouts/${id}/save-template`, { ...input, reconcileOnly: true });
  assert.equal(replay.response.status, 409);
  assert.equal(replay.value.code, "TEMPLATE_REPLAY_CHANGED");
  assert.equal(replay.value.workoutId, saved.value.workoutId);
  assert.equal(replay.value.accountScope, input.accountScope);
  assert.equal(replay.value.operationId, operationId);
  const changed = await call(
    `/api/workout-template-operations/${operationId}?accountScope=${input.accountScope}`
  );
  assert.equal(changed.value.status, "changed");
  assert.equal(changed.value.workout.title, "Later independent template edit");
  const list = await call("/api/workout-library");
  assert.equal(list.response.status, 200);
  assert.equal(list.value.workouts.length, 3);
  assert.equal(list.value.metadataWarnings.length, 1);
  assert.equal(
    list.value.workouts.find((row) => row.id === saved.value.workoutId).structure_read_only,
    true
  );
  assert.equal(
    (await preview.handle("preview/provider-records", "GET")).writes.filter(
      (row) => row.method === "POST" && row.path === "/athlete/0/workouts"
    ).length,
    1
  );
});

test("genuine preview preserves ordinary native templates through one corrupt snapshot and blocks lossy scheduling", async () => {
  const { base, preview } = fixture(),
    source = await preview.handle("workouts/editor", "POST", {
      model: model(base.today),
      creationId,
    }),
    editor = await preview.handle(`workouts/${source.workoutId}/editor`, "GET"),
    folders = await preview.handle("workout-library/folders", "GET"),
    chosen = folders.folders[0];
  const input = {
      accountScope: folders.accountScope,
      sourceRevision: editor.revision,
      folderId: chosen.id,
      folderRevision: chosen.revision,
      title: "Corrupt only my test snapshot",
      operationId,
    },
    saved = await preview.handle(`workouts/${source.workoutId}/save-template`, "POST", input);
  await preview.handle("preview/workout-template-state", "POST", {
    corruptTemplateId: saved.workoutId,
  });
  const listed = await preview.handle("workout-library", "GET");
  assert.equal(listed.workouts.length, 3);
  assert.equal(listed.metadataWarnings.length, 1);
  assert.equal(listed.workouts.find((row) => row.id === saved.workoutId).structure_read_only, true);
  assert.match(
    listed.workouts.find((row) => row.id === saved.workoutId).template_metadata_error,
    /unavailable/
  );
  for (const row of listed.workouts) assert.ok(validatedLibraryWorkout(row));
  const before = (await preview.handle("preview/provider-records", "GET")).writes.length;
  await assert.rejects(
    preview.handle(`workout-library/${saved.workoutId}/schedule`, "POST", {
      date: "2026-11-01",
      creationId: "4f7afdd4-3956-4b5b-973d-35097931d86c",
    }),
    { status: 409, code: "TEMPLATE_METADATA_UNAVAILABLE" }
  );
  assert.equal((await preview.handle("preview/provider-records", "GET")).writes.length, before);
  const ordinary = await preview.handle("workout-library/library:15/schedule", "POST", {
    date: "2026-11-01",
    creationId: "14114447-060f-4235-972a-2caef491ebc2",
  });
  assert.equal(ordinary.verified, true);
});

test("actual production editor create and app-origin PUT branches never POST/PUT a library or mutate existing templates", async () => {
  const source = ts.createSourceFile(
      "server.mjs",
      readFileSync(new URL("../server.mjs", import.meta.url), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    ),
    branches = {};
  function find(node) {
    if (ts.isIfStatement(node)) {
      const condition = node.expression.getText(source);
      if (
        condition.includes("pathname==='/api/workouts/editor'") &&
        condition.includes("req.method==='POST'")
      )
        branches.create = node.thenStatement;
      if (condition.startsWith("editorRoute &&")) branches.update = node.thenStatement;
    }
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(branches.create);
  assert.ok(branches.update);
  const { base, preview } = fixture(),
    initial = await preview.handle("preview/provider-records", "GET");
  let input = { model: model(base.today), creationId },
    output = null;
  const context = {
    req: { method: "POST" },
    res: {
      writeHead: () => {},
      end: (body) => {
        throw Error(body);
      },
    },
    readConfig: async () => ({}),
    readBody: async () => input,
    createWorkoutEditor,
    saveWorkoutEditor,
    createIntervalsClient: () => preview.request,
    providerConnection: () => "synthetic-calendar",
    mapIntervalsWorkout: (row) => ({ id: `event:${row.id}`, title: row.name }),
    athleteLocalDate: () => base.today,
    loadSupabaseTrainingSnapshot: async () => null,
    fetchIntervalsTrainingContext: async () => null,
    sendJson: (_req, _res, value) => {
      output = value;
    },
    intervalsMemoryCache: null,
    providerReads: { clear: () => {} },
    localEditCacheEnabled: async () => false,
    decodeURIComponent,
    withDirectWorkoutWrite: async (_cfg, _id, action) => action(preview.request),
    updateLogs: () => {},
    saveLibraryWorkout: () => {
      throw Error("Automatic mirror must never run");
    },
  };
  await runInNewContext(`(async()=>${branches.create.getText(source)})()`, context);
  assert.equal(output.verified, true);
  const id = output.workoutId,
    editor = await preview.handle(`workouts/${id}/editor`, "GET");
  assert.ok(output.event.external_id.startsWith("training-agent:editor:"));
  input = {
    model: { ...editor.model, name: "Updated ordinary source" },
    revision: editor.revision,
  };
  context.req.method = "PUT";
  context.editorRoute = ["", id];
  await runInNewContext(`(async()=>${branches.update.getText(source)})()`, context);
  assert.equal(output.verified, true);
  assert.equal(output.event.name, "Updated ordinary source");
  const final = await preview.handle("preview/provider-records", "GET");
  assert.deepEqual(final.libraryWorkouts, initial.libraryWorkouts);
  assert.equal(
    final.writes.some(
      (row) =>
        row.path.startsWith("/athlete/0/workouts") || row.path.startsWith("/athlete/0/folders")
    ),
    false
  );
  assert.equal(
    final.writes.filter(
      (row) => row.path.startsWith("/athlete/0/events") && ["POST", "PUT"].includes(row.method)
    ).length,
    2
  );
});

test("retained uncertain scheduling resolves without the now-unavailable template and never creates a second calendar event", async () => {
  const { base, preview } = fixture({ loseLibraryScheduleResponseOnce: true });
  const source = await preview.handle("workouts/editor", "POST", {
      model: model(base.today),
      creationId,
    }),
    editor = await preview.handle(`workouts/${source.workoutId}/editor`, "GET"),
    folders = await preview.handle("workout-library/folders", "GET"),
    folder = folders.folders[0];
  const saved = await preview.handle(`workouts/${source.workoutId}/save-template`, "POST", {
    accountScope: folders.accountScope,
    sourceRevision: editor.revision,
    folderId: folder.id,
    folderRevision: folder.revision,
    title: "Recheck existing calendar copy",
    operationId,
  });
  const input = { date: "2026-11-02", creationId: "4064425d-538b-49af-8ad5-bd2464ca7216" },
    route = `workout-library/${saved.workoutId}/schedule`;
  await assert.rejects(preview.handle(route, "POST", input), { status: 502 });
  await preview.handle("preview/workout-template-state", "POST", {
    corruptTemplateId: saved.workoutId,
  });
  const before = (await preview.handle("preview/provider-records", "GET")).writes;
  const rechecked = await preview.handle(route, "POST", { ...input, reconcileOnly: true });
  assert.equal(rechecked.verified, true);
  assert.equal(rechecked.workout.workout_date, input.date);
  assert.deepEqual(rechecked.workout.editor_model.strength, editor.model.strength);
  assert.deepEqual((await preview.handle("preview/provider-records", "GET")).writes, before);
  await assert.rejects(
    preview.handle(route, "POST", {
      ...input,
      creationId: "a4f6ac89-87ec-4c21-a598-c30df8edda65",
      reconcileOnly: true,
    }),
    { code: "TEMPLATE_METADATA_UNAVAILABLE" }
  );
  assert.deepEqual((await preview.handle("preview/provider-records", "GET")).writes, before);
});
