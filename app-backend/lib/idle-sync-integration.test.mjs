import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { createWorkoutChangeProbe } from "./workout-change-probe.mjs";
import { providerConnection } from "./completed-workout-store.mjs";

// These integration tests use the actual HTTP router/persistence, not a mocked
// replacement implementation. All network responses are synthetic.
test("cold server and 25 actual idle HTTP requests do not access Supabase", async () => {
  const previousEnv = { ...process.env },
    previousFetch = globalThis.fetch;
  const now = Date.now(),
    cookie = "a".repeat(43),
    hash = (v) => createHash("sha256").update(v).digest("base64url");
  Object.assign(process.env, {
    APP_PASSWORD: "synthetic-password-longer-than-twenty",
    APP_ORIGIN: "https://example.test",
    SUPABASE_URL: "https://database.invalid",
    SUPABASE_SECRET_KEY: "synthetic-supabase-secret-longer-than-thirty-two",
    SETTINGS_ENCRYPTION_KEY: "synthetic-signing-material-longer-than-thirty-two",
    TRAINING_DATA_GITHUB_REPO: "test/training-data",
    TRAINING_DATA_GITHUB_TOKEN: "synthetic-github-key",
    TRAINING_DATA_GITHUB_BRANCH: "main",
  });
  const attempts = [];
  globalThis.fetch = async (url, options = {}) => {
    attempts.push({ url: String(url), method: options.method || "GET" });
    assert.ok(
      String(url).startsWith(
        "https://api.github.com/repos/test/training-data/contents/latest.json?"
      ),
      `Unexpected network host in idle route: ${new URL(url).host}`
    );
    return new Response(
      JSON.stringify({
        encoding: "base64",
        content: Buffer.from(
          JSON.stringify({
            metadata: { last_updated: new Date(now).toISOString() },
            recent_activities: [{ id: "one" }],
          })
        ).toString("base64"),
      }),
      { status: 200 }
    );
  };
  try {
    const { handleRequest } = await import("../server.mjs");
    assert.equal(
      attempts.length,
      0,
      "Module import must not access Supabase, even on a cold instance"
    );
    const { authConfig } = await import("./app-auth.mjs");
    const makeReq = (payload) =>
      Object.assign(Readable.from([JSON.stringify(payload)]), {
        url: "/api/workout-changes",
        method: "POST",
        headers: {
          host: "example.test",
          origin: "https://example.test",
          cookie: `training_app_session=${cookie}`,
          "content-type": "application/json",
        },
        appSession: {
          id: hash(cookie),
          epoch: hash(`app-password-v1:${process.env.APP_PASSWORD}`),
          expires: now + 86400000,
        },
      });
    const issuer = createWorkoutChangeProbe({
      readBootstrap: async () => process.env,
      getConfig: () => ({
        repo: process.env.TRAINING_DATA_GITHUB_REPO,
        githubToken: process.env.TRAINING_DATA_GITHUB_TOKEN,
        branch: "main",
      }),
      getAuthConfig: (req) => authConfig(process.env, req),
    });
    const lease = await issuer.issue(makeReq({}), {
      history: [
        { id: "activity:one", activity_id: "one", completed: true, workout_date: "2026-09-22" },
      ],
    });
    for (let i = 0; i < 25; i++) {
      let status, result;
      await handleRequest(makeReq({ token: lease.token }), {
        writeHead: (s) => {
          status = s;
        },
        end: (v) => {
          result = JSON.parse(v);
        },
      });
      assert.equal(status, 200);
      assert.deepEqual(result, { changed: false });
    }
    assert.ok(attempts.length >= 1);
    assert.ok(attempts.every((a) => new URL(a.url).host === "api.github.com"));
  } finally {
    globalThis.fetch = previousFetch;
    for (const k of Object.keys(process.env)) if (!(k in previousEnv)) delete process.env[k];
    Object.assign(process.env, previousEnv);
  }
});

test("actual persistence writes only new/recent changed rows; never frozen archive or pruning", async () => {
  const original = globalThis.fetch;
  const now = Date.now(),
    today = new Date(now).toISOString().slice(0, 10);
  const config = {
    SUPABASE_URL: "https://database.invalid",
    SUPABASE_SECRET_KEY: "synthetic-secret",
    INTERVALS_API_KEY: "synthetic-provider-key",
  };
  const row = (id, age) => ({
    id: `activity:${id}`,
    activity_id: id,
    completed: true,
    status: "completed",
    provider: "intervals",
    source: "intervals",
    workout_date: new Date(now - age * 3600000).toISOString().slice(0, 10),
    title: "Synthetic workout",
    sport: "Run",
    raw_activity: {
      id,
      start_date: new Date(now - (age + 1) * 3600000).toISOString(),
      elapsed_time: 3600,
      moving_time: 3600,
      distance: 10000,
    },
    completed_data: { duration_minutes: 60 },
    planned: { duration_minutes: 0 },
  });
  const old = row("old", 48),
    recent = row("recent", 1);
  const previous = {
    athlete: { id: "synthetic", time_zone: "UTC" },
    provider: "intervals",
    provider_connection: providerConnection(config),
    metrics: { fitness: 1 },
    comments: [],
    history: [old, recent],
    planned: [],
    synced_at: new Date(now - 3600000).toISOString(),
    archived_activity_versions: {},
    cached_ranges: [{ start: "2026-01-01", end: "2027-01-01" }],
  };
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(new URL(url).host, "database.invalid");
    requests.push({
      url: String(url),
      method: options.method || "GET",
      body: options.body ? JSON.parse(options.body) : null,
    });
    if (!options.method || options.method === "GET")
      return new Response(JSON.stringify([{ cursor: { context: previous } }]), { status: 200 });
    return new Response("", { status: 200 });
  };
  try {
    const { persistTrainingContext } = await import("../server.mjs");
    await persistTrainingContext(
      config,
      { ...previous, synced_at: new Date(now).toISOString() },
      { archiveActivities: false, notifySource: false }
    );
    assert.equal(
      requests.filter((r) => r.method !== "GET").length,
      0,
      "Unchanged persistence must not upsert"
    );
    requests.length = 0;
    const added = row("new", 0),
      incoming = {
        ...previous,
        synced_at: new Date(now).toISOString(),
        history: [{ ...old, title: "Should not replace saved history" }, recent, added],
      };
    const saved = await persistTrainingContext(config, incoming, {
      archiveActivities: false,
      notifySource: false,
    });
    const workoutWrite = requests.find(
      (r) => r.url.endsWith("/workout_context") && r.method === "POST"
    );
    assert.deepEqual(
      workoutWrite.body.map((r) => r.id),
      ["activity:new"]
    );
    const archiveWrites = requests.filter(
      (r) => r.method === "POST" && r.body.some?.((row) => row.status === "archived")
    );
    assert.equal(archiveWrites.length, 1);
    assert.equal(archiveWrites[0].body.length, 1);
    assert.ok(archiveWrites[0].body[0].athlete_id.endsWith(":new:metadata"));
    assert.equal(saved.history.find((w) => w.activity_id === "old").title, old.title);
    assert.ok(!requests.some((r) => r.url.includes("/rpc/")));
    assert.equal(saved.history.find((w) => w.activity_id === "new").workout_date, today);
  } finally {
    globalThis.fetch = original;
  }
});
