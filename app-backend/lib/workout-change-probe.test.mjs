import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { createWorkoutChangeProbe } from "./workout-change-probe.mjs";

const NOW = Date.parse("2026-09-22T18:00:00Z");
const cookie = "a".repeat(43),
  subject = createHash("sha256").update(cookie).digest("base64url");
const auth = { origin: "https://example.test", configured: true, epoch: "test-epoch" };
const config = { githubToken: "synthetic-github-key", repo: "test/training-data", branch: "main" };
const bootstrap = { SETTINGS_ENCRYPTION_KEY: "synthetic-signing-material-32-characters-long" };
const context = {
  history: [
    { id: "activity:one", activity_id: "one", status: "completed", workout_date: "2026-09-22" },
  ],
  planned: [],
};
function req(payload = {}, override = {}) {
  return Object.assign(Readable.from([JSON.stringify(payload)]), {
    method: "POST",
    headers: {
      host: "example.test",
      origin: auth.origin,
      cookie: `training_app_session=${cookie}`,
      "content-type": "application/json",
      ...override.headers,
    },
    appSession: { id: subject, epoch: auth.epoch, expires: NOW + 86400000 },
    ...Object.fromEntries(Object.entries(override).filter(([key]) => key !== "headers")),
  });
}
async function send(probe, request, path = "/api/workout-changes") {
  let status, result;
  const handled = await probe.handle(
    request,
    {
      writeHead: (s) => {
        status = s;
      },
      end: (body) => {
        result = JSON.parse(body);
      },
    },
    path
  );
  return { handled, status, result };
}
function setup({
  ids = ["one"],
  planned = [],
  updated = NOW,
  time = NOW,
  responseStatus = 200,
  ...deps
} = {}) {
  const calls = [];
  const make = () =>
    createWorkoutChangeProbe({
      readBootstrap: async () => bootstrap,
      getConfig: () => config,
      getAuthConfig: () => auth,
      now: () => time,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        assert.ok(
          url.startsWith("https://api.github.com/repos/test/training-data/contents/latest.json?")
        );
        return {
          ok: responseStatus === 200,
          status: responseStatus,
          json: async () => ({
            encoding: "base64",
            content: Buffer.from(
              JSON.stringify({
                metadata: { last_updated: new Date(updated).toISOString() },
                recent_activities: ids.map((id) => ({ id })),
                planned_workouts: planned,
              })
            ).toString("base64"),
          }),
        };
      },
      ...deps,
    });
  return { make, calls };
}
test("cold-instance idle hints make GitHub reads only, never Supabase/Intervals/model calls", async () => {
  const { make, calls } = setup();
  const lease = await make().issue(req(), context);
  for (let i = 0; i < 25; i++)
    assert.deepEqual((await send(make(), req({ token: lease.token }))).result, { changed: false });
  assert.equal(calls.length, 25);
  assert.ok(calls.every((c) => c.options.method === undefined && c.options.redirect === "error"));
});
test("a new ID creates only a boolean hint; no data or credentials returned", async () => {
  const { make } = setup({ ids: ["one", "two"] });
  const probe = make(),
    lease = await probe.issue(req(), context);
  assert.deepEqual((await send(probe, req({ token: lease.token }))).result, { changed: true });
  const decoded = Buffer.from(lease.token.split(".")[0], "base64url").toString();
  assert.ok(!decoded.includes(config.githubToken));
  assert.ok(!decoded.includes(bootstrap.SETTINGS_ENCRYPTION_KEY));
});

test("a planned calendar change creates a boolean import hint", async () => {
  const plannedContext = {
    ...context,
    planned: [
      {
        id: "event:10",
        workout_date: "2026-09-24",
        title: "Existing",
        sport: "Run",
        category: "WORKOUT",
        planned: { duration_minutes: 30, tss: 20 },
        raw: {
          id: 10,
          start_date_local: "2026-09-24T00:00:00",
          name: "Existing",
          type: "Run",
          category: "WORKOUT",
          moving_time: 1800,
          icu_training_load: 20,
        },
      },
    ],
  };
  const { make } = setup({
    planned: [
      {
        id: 10,
        date: "2026-09-25",
        name: "Existing",
        sport_type: "Run",
        type: "WORKOUT",
        duration_hours: 0.5,
        planned_tss: 20,
      },
    ],
  });
  const probe = make(),
    lease = await probe.issue(req(), plannedContext);
  assert.deepEqual((await send(probe, req({ token: lease.token }))).result, { changed: true });
});

test("deleted or changed historical IDs do not trigger an import", async () => {
  const { make } = setup({ ids: [] });
  const probe = make(),
    lease = await probe.issue(req(), context);
  assert.deepEqual((await send(probe, req({ token: lease.token }))).result, { changed: false });
});
test("tampered capability is rejected before any remote call", async () => {
  const { make, calls } = setup();
  const probe = make(),
    lease = await probe.issue(req(), context);
  assert.equal((await send(probe, req({ token: "x" + lease.token }))).status, 401);
  assert.equal(calls.length, 0);
});
test("another session cookie or a cleared logout cookie cannot use the hint", async () => {
  const { make, calls } = setup();
  const probe = make(),
    lease = await probe.issue(req(), context);
  for (const value of ["", `training_app_session=${"b".repeat(43)}`])
    assert.equal(
      (await send(probe, req({ token: lease.token }, { headers: { cookie: value } }))).status,
      401
    );
  assert.equal(calls.length, 0);
});
test("changed password epoch, repo or branch invalidates a lease", async () => {
  const { make } = setup();
  const lease = await make().issue(req(), context);
  for (const deps of [
    { getAuthConfig: () => ({ ...auth, epoch: "changed" }) },
    { getConfig: () => ({ ...config, repo: "test/other" }) },
    { getConfig: () => ({ ...config, branch: "other" }) },
  ]) {
    const { make: other, calls } = setup(deps);
    assert.equal((await send(other(), req({ token: lease.token }))).status, 401);
    assert.equal(calls.length, 0);
  }
});
test("cross-origin requests fail before GitHub", async () => {
  const { make, calls } = setup();
  const probe = make(),
    lease = await probe.issue(req(), context);
  assert.equal(
    (await send(probe, req({ token: lease.token }, { headers: { origin: "https://evil.test" } })))
      .status,
    403
  );
  assert.equal(calls.length, 0);
});
test("expired lease never renews itself or reads auth database", async () => {
  const initial = setup(),
    lease = await initial.make().issue(req(), context);
  const { make, calls } = setup({ time: NOW + 86400001 });
  const result = await send(make(), req({ token: lease.token }));
  assert.equal(result.status, 401);
  assert.equal(result.result.paused, true);
  assert.equal(calls.length, 0);
});
test("stale or future source is not claimed to have no new activity", async () => {
  for (const updated of [NOW - 86400001, NOW + 300001]) {
    const { make } = setup({ updated });
    const probe = make(),
      lease = await probe.issue(req(), context);
    assert.equal((await send(probe, req({ token: lease.token }))).status, 503);
  }
});
test("provider failure is explicit and never a database fallback", async () => {
  const { make, calls } = setup({ responseStatus: 403 });
  const probe = make(),
    lease = await probe.issue(req(), context);
  assert.equal((await send(probe, req({ token: lease.token }))).status, 503);
  assert.equal(calls.length, 1);
});
test("unverified sessions cannot mint a hint", async () => {
  const { make } = setup();
  await assert.rejects(make().issue(req({}, { appSession: undefined }), context));
});
test("hint cannot authorize another API and GET is rejected", async () => {
  const { make, calls } = setup(),
    probe = make();
  assert.equal((await send(probe, req(), "/api/workouts")).handled, false);
  assert.equal((await send(probe, req({}, { method: "GET" }))).status, 405);
  assert.equal(calls.length, 0);
});
