import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { toFunctionUrl } from "./api-routing.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import {
  newStrengthExerciseDefinition,
  strengthLibraryExerciseBlock,
} from "./strength-exercise-library-model.mjs";
const preview = () =>
  createDesktopCalendarPreview(createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z")));
const definition = () => ({
  ...newStrengthExerciseDefinition(),
  title: "Synthetic independent exercise",
  instructions: "Controlled movement",
  muscleGroup: "Quads",
});
const prepare = async (source) => {
  const catalog = await source.handle(
    "strength-exercises",
    "GET",
    {},
    new URL("http://localhost/api/strength-exercises")
  );
  return {
    operationId: "preview-strength-library-create",
    accountScope: catalog.accountScope,
    catalogRevision: catalog.revision,
    definition: definition(),
  };
};

test(
  "actual localhost preview accepts hosted library routing and still rejects unsupported public filters",
  { timeout: 20000 },
  async (t) => {
    const reservation = createServer();
    await new Promise((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", resolve);
    });
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(
      process.execPath,
      ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    t.after(async () => {
      if (child.exitCode === null) {
        const closed = once(child, "exit");
        child.kill();
        await closed;
      }
    });
    await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Synthetic preview startup timed out.")), 10000);
      const finish = (error) => {
        clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      child.once("error", finish);
      child.once("exit", () => finish(Error("Synthetic preview exited before serving.")));
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes(`http://127.0.0.1:${port}/calendar`)) finish();
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    const request = (route, init) => fetch(origin + toFunctionUrl(route), init);
    const catalogResponse = await request(
      "/api/strength-exercises?query=&muscleGroup=all&owner=me"
    );
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.match(catalog.accountScope, /^[a-f0-9]{64}$/);
    const savedResponse = await request("/api/strength-exercises", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "http-routing-library-create",
        accountScope: catalog.accountScope,
        catalogRevision: catalog.revision,
        definition: definition(),
      }),
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    const loaded = await request(`/api/strength-exercises/${encodeURIComponent(saved.id)}`);
    assert.equal(loaded.status, 200);
    assert.equal((await loaded.json()).title, definition().title);
    const filtered = await request(
      "/api/strength-exercises?query=independent&muscleGroup=Quads&owner=me"
    );
    assert.equal((await filtered.json()).exercises[0].id, saved.id);
    const invalid = await request("/api/strength-exercises?unexpected=value");
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "STRENGTH_LIBRARY_INVALID");
    assert.equal((await (await request("/api/preview/provider-records")).json()).writes.length, 0);
    const sourceResponse = await request("/api/preview/pace-sources");
    assert.equal(sourceResponse.status, 200);
    const sourceOracle = await sourceResponse.json();
    const raw = sourceOracle.sources.find((row) => row.activity.id === "i700000001");
    assert.equal(raw.streams.find((row) => row.type === "distance").data[200], 800);
    const analysis = await (await request("/api/activities/i700000001/analysis")).json();
    assert.equal(analysis.points[200].time, 200);
    assert.equal(analysis.points[200].distance, 800);
    const bound = await (
      await request("/api/activities/i700000001/performance-effort?type=Run&distance=800")
    ).json();
    assert.equal(bound.available, true);
    assert.equal(bound.chart_start_seconds, 0);
    assert.equal(bound.chart_end_seconds, 200);
    for (const [id, type, distance, seconds] of [
      ["i700000001", "Run", 800, 200],
      ["i700000002", "Swim", 100, 100],
    ]) {
      const workout = await (await request(`/api/workout-history/${id}`)).json();
      assert.equal(workout.workout.activity_id, id);
      assert.equal(typeof workout.workout.duration, "string");
      const personal = await request(
        `/api/workouts/${encodeURIComponent(`activity:${id}`)}/personal`
      );
      assert.equal(personal.status, 200);
      assert.deepEqual((await personal.json()).attachments, []);
      const comments = await request(
        `/api/comments?workoutId=${encodeURIComponent(`activity:${id}`)}`
      );
      assert.equal(comments.status, 200);
      assert.deepEqual(await comments.json(), { comments: [], needsSync: false });
      const summary = await request(`/api/activities/${id}/summary`);
      assert.equal(summary.status, 200);
      assert.equal((await summary.json()).duration_seconds, 400);
      const analysisResponse = await request(`/api/activities/${id}/analysis`);
      assert.equal(analysisResponse.status, 200);
      const sourceAnalysis = await analysisResponse.json();
      assert.equal(sourceAnalysis.points[seconds].time, seconds);
      assert.equal(sourceAnalysis.points[seconds].distance, distance);
      const route = await request(`/api/activities/${id}/route`);
      assert.equal(route.status, 200);
      assert.deepEqual(await route.json(), { points: [] });
      const effort = await request(
        `/api/activities/${id}/performance-effort?type=${type}&distance=${distance}`
      );
      assert.equal(effort.status, 200);
      assert.equal((await effort.json()).available, true);
    }
    assert.equal(
      (await request("/api/comments?workoutId=activity%3Ai700000099")).status,
      404,
      "unrecognized recording is not masked as an empty comment thread"
    );
    const hrOracle = await (await request("/api/preview/heart-rate-sources")).json(),
      hrDay = hrOracle.sources[0].activity.start_date_local.slice(0, 10);
    const hrResponse = await request(
      `/api/performance-curves?kind=heartRate&sport=all&start=${hrDay}&end=${hrOracle.today}`
    );
    assert.equal(hrResponse.status, 200);
    const hrCurve = await hrResponse.json();
    assert.equal(hrCurve.kind, "heartRate");
    assert.deepEqual(
      hrCurve.points.map((point) => point.value),
      [240, 210, null, null, 210, 180]
    );
    const hrId = hrCurve.points[1].activity_id;
    assert.equal((await request(`/api/workout-history/${hrId}`)).status, 200);
    assert.equal((await request(`/api/activities/${hrId}/analysis`)).status, 200);
    const hrComments = await request(`/api/comments?workoutId=activity%3A${hrId}`);
    assert.equal(hrComments.status, 200);
    assert.deepEqual((await hrComments.json()).comments, []);
    assert.equal((await request(`/api/workouts/activity%3A${hrId}/personal`)).status, 200);
    assert.equal(
      (
        await request(
          `/api/performance-curves?kind=heartRate&sport=all&sport=Run&start=${hrDay}&end=${hrOracle.today}`
        )
      ).status,
      400
    );
  }
);
test("synthetic library persists independently of workout, preserves exact snapshot through canonical save/readback and deletion, and records exact identity history", async () => {
  const source = preview(),
    input = await prepare(source),
    saved = await source.handle("strength-exercises", "POST", input);
  assert.equal(source.canWrite("strength-exercises", "POST"), true);
  assert.equal((await source.handle("preview/provider-records", "GET")).writes.length, 0);
  const route = `strength-exercises/${encodeURIComponent(saved.id)}`,
    loaded = await source.handle(route, "GET");
  assert.equal(loaded.title, input.definition.title);
  const block = strengthLibraryExerciseBlock(loaded),
    model = {
      version: 1,
      name: "Synthetic library prescription",
      sport: "WeightTraining",
      date: "2026-10-20",
      notes: "",
      poolLength: "",
      steps: [],
      strength: { version: 1, blocks: [block] },
    };
  const workout = await source.handle("workouts/editor", "POST", {
    model,
    creationId: "62efea2a-b703-4ef2-a9a0-a879bdc34a62",
    description: "",
    descriptionMode: "manual",
  });
  const reloaded = await source.handle(
    `workouts/${encodeURIComponent(workout.workout.id)}/editor`,
    "GET",
    {},
    new URL("http://localhost")
  );
  assert.equal(reloaded.model.strength.blocks[0].exercises[0].libraryExerciseId, saved.id);
  const history = await source.handle(route + "/history", "GET");
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].workoutId, workout.workout.id);
  assert.equal(history.actualResultsAvailable, false);
  const edited = await source.handle(route, "PUT", {
    operationId: "preview-strength-library-update",
    accountScope: saved.accountScope,
    revision: saved.exercise.revision,
    definition: { ...input.definition, title: "Changed catalog title" },
  });
  await source.handle(route, "DELETE", {
    operationId: "preview-strength-library-delete",
    accountScope: saved.accountScope,
    revision: edited.exercise.revision,
  });
  const after = await source.handle(
    `workouts/${encodeURIComponent(workout.workout.id)}/editor`,
    "GET",
    {},
    new URL("http://localhost")
  );
  assert.equal(after.model.strength.blocks[0].exercises[0].title, input.definition.title);
  assert.equal((await source.handle("strength-exercises", "GET")).total, 0);
  assert.equal((await source.handle(route + "/history", "GET")).records.length, 1);
  const raw = await source.handle("preview/provider-records", "GET");
  assert.doesNotMatch(
    raw.events.find((row) => `event:${row.id}` === workout.workout.id).description,
    /libraryExerciseId|Workout editor v1|"parameters"/
  );
});
test("synthetic library actual readonly, rejected/lost store replies and actor transition exercise production recovery guards", async () => {
  const source = preview(),
    input = await prepare(source);
  await source.handle("preview/strength-library-state", "POST", { readOnly: true });
  await assert.rejects(source.handle("strength-exercises", "POST", input), { status: 403 });
  await source.handle("preview/strength-library-state", "POST", {
    readOnly: false,
    failNextWrite: "before",
  });
  await assert.rejects(source.handle("strength-exercises", "POST", input), { status: 400 });
  assert.equal((await source.handle("strength-exercises", "GET")).total, 0);
  await source.handle("preview/strength-library-state", "POST", { failNextWrite: "after" });
  await assert.rejects(source.handle("strength-exercises", "POST", input), { status: 502 });
  assert.equal((await source.handle("strength-exercises", "GET")).total, 1);
  const saved = await source.handle("strength-exercises", "POST", {
    ...input,
    reconcileOnly: true,
  });
  assert.equal(saved.id, (await source.handle("strength-exercises", "GET")).exercises[0].id);
  assert.match(saved.id, /^exercise:[a-f0-9]{64}$/);
  assert.equal(saved.operationId, input.operationId);
  await source.handle("preview/strength-library-state", "POST", { actor: "B" });
  await assert.rejects(source.handle("strength-exercises", "POST", input), {
    status: 409,
    code: "STRENGTH_LIBRARY_ACCOUNT_CHANGED",
  });
  assert.equal((await source.handle("strength-exercises", "GET")).total, 0);
  assert.equal((await source.handle("preview/provider-records", "GET")).writes.length, 0);
});
