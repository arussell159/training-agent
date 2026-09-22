import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { refreshGithubOnStartup } from "./startup-workout-refresh.mjs";
import { freshWorkoutSync } from "./coach-workout-sync.mjs";
import { createBackgroundWorkoutSync } from "../../ui/src/lib/background-workout-sync.mjs";

function fixture({ ambiguous = false } = {}) {
  const state = freshWorkoutSync();
  const calls = [];
  const scopes = [];
  const store = {
    read: async () => structuredClone(state),
    update: async (fn) => structuredClone(fn(state)),
  };
  const input = {
    config: { repo: "example/training-data", branch: "main", githubToken: "dummy-test-only" },
    bootstrap: {},
    createStore: (bootstrap, scope, options) => {
      scopes.push({ scope, options });
      return store;
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", body: options.body });
      assert.ok(url.startsWith("https://api.github.com/repos/example/training-data/"));
      if (url.endsWith("/dispatches")) {
        if (ambiguous) throw Error("Synthetic response lost");
        return Response.json({
          workflow_run_id: 123,
          html_url: "https://github.com/example/training-data/actions/runs/123",
        });
      }
      if (url.endsWith("/actions/runs/123"))
        return Response.json({
          id: 123,
          event: "workflow_dispatch",
          head_branch: "main",
          path: ".github/workflows/auto-sync.yml",
          status: "in_progress",
        });
      if (url.includes("/runs?")) return Response.json({ workflow_runs: [] });
      throw Error("Unexpected provider/model request");
    },
  };
  return { state, calls, scopes, input };
}
test("startup dispatches the configured source workflow through the existing durable claim", async () => {
  const { input, calls, scopes } = fixture();
  const result = await refreshGithubOnStartup(input);
  assert.equal(result.status, "queued");
  assert.equal(result.runId, 123);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.ok(calls[0].url.endsWith("/actions/workflows/auto-sync.yml/dispatches"));
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.ref, "main");
  assert.equal(payload.inputs.request_id, result.requestId);
  assert.equal(scopes[0].scope, "example/training-data@main/");
  assert.equal(scopes[0].options.namespace, "coach-sync");
  assert.equal(scopes[0].options.name, "COACH_WORKOUT_SYNC");
  assert.equal(scopes[0].options.timestampCas, true);
});
test("simultaneous startups and a later startup reuse an active app-dispatched run", async () => {
  const { input, calls } = fixture();
  await Promise.all(Array.from({ length: 10 }, () => refreshGithubOnStartup(input)));
  const result = await refreshGithubOnStartup(input);
  assert.equal(result.status, "running");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});
test("an uncertain startup dispatch is reconciled without a blind duplicate write", async () => {
  const { input, calls } = fixture({ ambiguous: true });
  assert.equal((await refreshGithubOnStartup(input)).status, "checking");
  assert.equal((await refreshGithubOnStartup(input)).status, "checking");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});
test("missing startup GitHub configuration does not initialize storage or contact providers", async () => {
  const result = await refreshGithubOnStartup({
    config: {},
    bootstrap: {},
    createStore: () => {
      throw Error("Unexpected database access");
    },
    fetchImpl: () => {
      throw Error("Unexpected network access");
    },
  });
  assert.equal(result.status, "unavailable");
  assert.ok(result.error);
});
test("startup stays optimistic: no context replacement until a new workout is confirmed", async () => {
  let issues = 0,
    imports = 0,
    changed = false;
  const contexts = [];
  const sync = createBackgroundWorkoutSync({
    issue: async () => {
      issues++;
      return { probe: { token: "before", baseline: "before" }, startup_sync: { status: "queued" } };
    },
    probe: async (token) => ({ changed: changed && token === "before" }),
    importWorkouts: async () => {
      imports++;
      return { context: { verified: true }, probe: { token: "after", baseline: "after" } };
    },
    flushEdits: async () => ({}),
    onContext: (value) => contexts.push(value),
  });
  await Promise.all([sync.start(), sync.start(), sync.start()]);
  for (let i = 0; i < 1000; i++) await sync.check();
  assert.equal(issues, 1);
  assert.equal(imports, 0);
  assert.deepEqual(contexts, []);
  changed = true;
  await sync.check();
  await sync.check();
  assert.equal(imports, 1);
  assert.deepEqual(contexts, [{ verified: true }]);
});
test("the startup flag is sent once and only its authenticated lease route can dispatch", () => {
  const ui = fs.readFileSync(
    new URL("../../ui/src/components/background-sync.tsx", import.meta.url),
    "utf8"
  );
  assert.ok(ui.includes("startupRequested = useRef(false)"));
  assert.ok(ui.includes("const startup = !startupRequested.current"));
  const claim = ui.indexOf("startupRequested.current = true");
  assert.ok(claim > 0 && claim < ui.indexOf("?startup=1"));
  assert.ok(ui.includes('probe: (token) => request("/api/workout-changes", { token })'));
  assert.ok(ui.includes('importWorkouts: () => request("/api/sync?automatic=1")'));
  assert.ok(ui.includes("await check()"));
  const server = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const auth = server.indexOf("if (await handleAuth(req, res, pathname)) return;");
  const route = server.indexOf("if(pathname==='/api/sync/probe-lease'");
  const flag = server.indexOf("requestUrl.searchParams.get('startup')==='1'");
  assert.ok(auth >= 0 && route > auth && flag > route);
  assert.equal((server.match(/await refreshGithubOnStartup\(/g) || []).length, 1);
});
