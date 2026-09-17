import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createCoachCalendar, validateCalendarWorkouts } from "./coach-calendar.mjs";
import { createCoachHttp } from "./coach-http.mjs";
import { coachConfig } from "./github-coach.mjs";
import { createEncryptedRecordStore } from "./app-auth-store.mjs";

const epoch = Date.parse("2026-09-17T15:00:00Z");
const id = "b53a8537-2399-48a7-9946-4c02acf164f1";
const env = {
  TRAINING_DATA_GITHUB_REPO: "test/athlete",
  TRAINING_DATA_GITHUB_TOKEN: "secret-gh",
  OPENAI_API_KEY: "secret-ai",
};
const config = coachConfig(env);
const workout = {
  name: "Easy run",
  date: "2026-09-18",
  type: "Run",
  description: "Easy\n- 30m Z2 HR",
  duration_minutes: 30,
  tss: null,
  target: "HR",
  indoor: false,
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
function harness() {
  let state = { proposals: [] },
    clock = epoch;
  const calls = [],
    runs = new Map();
  let onDispatch;
  const store = {
    read: async () => structuredClone(state),
    update: async (change) => {
      const next = structuredClone(state);
      const result = change(next);
      state = next;
      return structuredClone(result);
    },
  };
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(options.headers.Authorization, "Bearer secret-gh");
    assert.equal(options.redirect, "error");
    calls.push({ url, options });
    if (url.includes("/contents/"))
      return json({ content: Buffer.from("# training-agent-calendar-v1:").toString("base64") });
    if (url.endsWith("/push-workout.yml")) return json({ state: "active" });
    if (url.endsWith("/dispatches")) {
      const body = JSON.parse(options.body);
      if (onDispatch) return onDispatch(body);
      const runId = runs.size + 1;
      runs.set(runId, {
        id: runId,
        status: "queued",
        event: "workflow_dispatch",
        head_branch: "main",
        path: ".github/workflows/push-workout.yml",
        run_attempt: 1,
        display_title: `section11-${body.inputs.request_id}-${body.inputs.confirm}`,
      });
      return json({ workflow_run_id: runId });
    }
    if (url.includes("/workflows/push-workout.yml/runs?"))
      return json({ workflow_runs: [...runs.values()] });
    const match = url.match(/\/actions\/runs\/(\d+)(\/jobs)?/);
    if (match) {
      const run = runs.get(Number(match[1]));
      if (match[2])
        return json({
          jobs: [
            {
              steps: run.markers || [
                { name: `Calendar result: ${run.outcome}`, conclusion: "success" },
              ],
            },
          ],
        });
      return json(run);
    }
    throw new Error(`Unexpected endpoint ${url}`);
  };
  const calendar = createCoachCalendar({
    config,
    store,
    fetchImpl,
    now: () => clock,
    uuid: () => id,
  });
  return {
    calendar,
    calls,
    runs,
    store,
    advance: (ms) => {
      clock += ms;
    },
    setDispatch: (fn) => {
      onDispatch = fn;
    },
    complete: (runId, outcome) => Object.assign(runs.get(runId), { status: "completed", outcome }),
    dispatches: () =>
      calls.filter((c) => c.options.method === "POST").map((c) => JSON.parse(c.options.body)),
  };
}

test("preview validates exact workouts, correlates GitHub run and never confirms on behalf of athlete", async () => {
  const h = harness();
  const proposal = await h.calendar.propose([workout]);
  assert.equal(proposal.state, "preview_pending");
  assert.equal(h.dispatches()[0].inputs.confirm, "false");
  assert.equal(h.dispatches()[0].inputs.command, "push");
  assert.equal(h.dispatches()[0].inputs.time_zone, "America/Chicago");
  assert.equal(JSON.parse(h.dispatches()[0].inputs.workouts)[0].external_id, `section11:${id}:0`);
  await assert.rejects(h.calendar.confirm(id), /successful preview/);
  h.complete(1, "preview");
  assert.equal((await h.calendar.status(id)).state, "ready");
  assert.equal(h.dispatches().length, 1);
});

test("approval dispatches the stored payload once across concurrent requests and new server instances", async () => {
  const h = harness();
  await h.calendar.propose([workout]);
  h.complete(1, "preview");
  await h.calendar.status(id);
  const results = await Promise.all([
    h.calendar.confirm(id),
    h.calendar.confirm(id),
    h.calendar.confirm(id),
  ]);
  assert.ok(results.every((r) => r.state === "queued"));
  assert.equal(h.dispatches().length, 2);
  assert.equal(h.dispatches()[1].inputs.confirm, "true");
  assert.equal(h.dispatches()[0].inputs.workouts, h.dispatches()[1].inputs.workouts);
  const otherInstance = createCoachCalendar({
    config,
    store: h.store,
    fetchImpl: () => {
      throw new Error("Must not dispatch again");
    },
  });
  assert.equal((await otherInstance.confirm(id)).phase, "push");
  h.complete(2, "applied");
  assert.equal((await h.calendar.status(id)).state, "applied");
  assert.equal((await h.calendar.confirm(id)).state, "applied");
});

test("ambiguous dispatch is retained and never blindly repeated; exact run can reconcile later", async () => {
  const h = harness();
  await h.calendar.propose([workout]);
  h.complete(1, "preview");
  await h.calendar.status(id);
  h.setDispatch((body) => {
    h.runs.set(2, {
      ...h.runs.get(1),
      id: 2,
      display_title: `section11-${id}-${body.inputs.confirm}`,
      status: "queued",
    });
    throw new Error("Connection lost after dispatch");
  });
  assert.equal((await h.calendar.confirm(id)).state, "unknown");
  await h.calendar.confirm(id);
  assert.equal(h.dispatches().length, 2);
  h.complete(2, "applied");
  assert.equal((await h.calendar.status(id)).state, "applied");
});

test("a green GitHub run alone is insufficient; missing, ambiguous and partial results remain unknown", async () => {
  for (const outcome of ["unknown", undefined, "not_applied"]) {
    const h = harness();
    await h.calendar.propose([workout]);
    h.complete(1, "preview");
    await h.calendar.status(id);
    await h.calendar.confirm(id);
    h.complete(2, outcome);
    assert.equal(
      (await h.calendar.status(id)).state,
      outcome === "not_applied" ? "not_applied" : "unknown"
    );
    await h.calendar.confirm(id);
    assert.equal(h.dispatches().length, 2);
  }
});

test("failed preview cannot be approved; expired preview cannot be approved", async () => {
  const h = harness();
  await h.calendar.propose([workout]);
  h.complete(1, "not_applied");
  assert.equal((await h.calendar.status(id)).state, "preview_failed");
  await assert.rejects(h.calendar.confirm(id), /successful preview/);
  const fresh = harness();
  await fresh.calendar.propose([workout]);
  fresh.complete(1, "preview");
  await fresh.calendar.status(id);
  fresh.advance(86400001);
  await assert.rejects(fresh.calendar.confirm(id), /expired/);
  assert.equal((await fresh.calendar.status(id)).state, "expired");
});

test("same plan uses the existing ID even when model property order changes", async () => {
  const h = harness();
  await h.calendar.propose([workout]);
  const reordered = Object.fromEntries(Object.entries(workout).reverse());
  assert.equal((await h.calendar.propose([reordered])).id, id);
  assert.equal(h.dispatches().length, 1);
});

test("calendar run correlation rejects other runs, reruns and mismatching branches", async () => {
  for (const patch of [
    { display_title: "unrelated" },
    { head_branch: "other" },
    { run_attempt: 2 },
    { path: ".github/workflows/auto-sync.yml" },
  ]) {
    const h = harness();
    await h.calendar.propose([workout]);
    Object.assign(h.runs.get(1), patch);
    await assert.rejects(h.calendar.status(id), /match|rerun/);
  }
});

test("strict planned-workout validation rejects hidden write fields and impossible values", () => {
  for (const patch of [
    { external_id: "existing" },
    { category: "NOTE" },
    { type: "DELETE" },
    { date: "2026-02-30" },
    { date: "2026-09-16" },
    { duration_minutes: 0 },
    { duration_minutes: 721 },
    { tss: 501 },
    { target: "BOGUS" },
    { indoor: "true" },
    { description: "No steps" },
    { description: "-\n- 30m" },
  ])
    assert.throws(() => validateCalendarWorkouts([{ ...workout, ...patch }], "2026-09-17"));
  assert.throws(() => validateCalendarWorkouts(Array(29).fill(workout), "2026-09-17"));
  assert.equal(
    validateCalendarWorkouts(
      [{ ...workout, type: "Swim", description: "- 400mtr 80% Pace" }],
      "2026-09-17"
    )[0].category,
    "WORKOUT"
  );
});

test("local calendar date is used around UTC midnight", async () => {
  const h = harness();
  h.advance(10 * 3600000); // Sep 18 UTC, Sep 17 Chicago
  const result = await h.calendar.propose([{ ...workout, date: "2026-09-17" }]);
  assert.equal(result.state, "preview_pending");
});

test("large calendar records use short atomic revisions, retain concurrent updates and encrypt workouts", async () => {
  let row;
  const requests = [];
  const bootstrap = { SUPABASE_URL: "https://db.test", SUPABASE_SECRET_KEY: "sb_secret_fixture" };
  const fetchImpl = async (url, options) => {
    requests.push(url);
    const params = new URL(url).searchParams;
    let rows;
    if (options.method === "POST") {
      rows = row ? [] : JSON.parse(options.body);
      row ||= rows[0];
    } else if (options.method === "PATCH") {
      rows =
        row.updated_at === params.get("updated_at")?.slice(3) ? [JSON.parse(options.body)] : [];
      if (rows.length) {
        assert.notEqual(rows[0].updated_at, row.updated_at);
        row = rows[0];
      }
    } else rows = row ? [row] : [];
    const snapshot = structuredClone(rows);
    await Promise.resolve();
    return { ok: true, json: async () => snapshot };
  };
  const options = {
    namespace: "coach-calendar",
    name: "COACH_CALENDAR",
    timestampCas: true,
    fresh: () => ({ proposals: [] }),
  };
  const a = createEncryptedRecordStore(bootstrap, "test-repo", options, fetchImpl);
  const b = createEncryptedRecordStore(bootstrap, "test-repo", options, fetchImpl);
  await a.update((s) => {
    s.proposals.push({ description: "private workout ".repeat(3000) });
  });
  // Force a future microsecond timestamp: next versions must advance it exactly.
  row.updated_at = "2099-01-01T00:00:00.123456+00:00";
  await Promise.all([
    a.update((s) => {
      s.proposals.push({ id: "a" });
    }),
    b.update((s) => {
      s.proposals.push({ id: "b" });
    }),
  ]);
  assert.equal((await a.read()).proposals.length, 3);
  assert.equal(row.updated_at, "2099-01-01T00:00:00.123458Z");
  assert.ok(requests.every((url) => url.length < 400));
  assert.doesNotMatch(JSON.stringify(row), /private workout/);
});

test("GitHub rejection is explicit and does not release a write claim", async () => {
  const h = harness();
  await h.calendar.propose([workout]);
  h.complete(1, "preview");
  await h.calendar.status(id);
  h.setDispatch(() => json({ message: "token body must not leak" }, 403));
  const result = await h.calendar.confirm(id);
  assert.equal(result.state, "not_applied");
  assert.match(result.error, /Actions read and write/);
  assert.ok(!JSON.stringify(result).includes("token body"));
  await h.calendar.confirm(id);
  assert.equal(h.dispatches().length, 2);
});

test("HTTP approval requires app auth, same origin, dedicated route and unchanged preview", async (t) => {
  let confirmations = 0,
    declines = 0;
  const handler = createCoachHttp({
    env: () => env,
    getCalendar: async () => ({
      confirm: async (id) => {
        confirmations++;
        return { id, state: "queued" };
      },
      decline: async (id) => {
        declines++;
        return { id, state: "declined" };
      },
      list: async () => [],
      checkSetup: async () => ({ available: true }),
    }),
  });
  const server = http.createServer(async (req, res) => {
    if (req.headers["x-test-auth"] === "yes") req.appSession = {};
    if (!(await handler(req, res, new URL(req.url, "http://localhost").pathname))) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const path = `${origin}/api/coach/calendar/${id}/confirm`;
  const headers = {
    "x-test-auth": "yes",
    origin,
    "content-type": "application/json",
    "x-coach-request": "1",
  };
  assert.equal(
    (
      await fetch(path, {
        method: "POST",
        headers: { ...headers, "x-test-auth": "no" },
        body: "{}",
      })
    ).status,
    401
  );
  assert.equal(
    (
      await fetch(path, {
        method: "POST",
        headers: { ...headers, origin: "https://evil.test" },
        body: "{}",
      })
    ).status,
    403
  );
  assert.equal(
    (await fetch(path, { method: "POST", headers, body: JSON.stringify({ workouts: [workout] }) }))
      .status,
    400
  );
  assert.equal((await fetch(path, { headers })).status, 405);
  assert.equal((await fetch(path, { method: "POST", headers, body: "{}" })).status, 200);
  assert.equal(confirmations, 1);
  const declinedPath = path.replace("/confirm", "/decline");
  assert.equal(
    (
      await fetch(declinedPath, {
        method: "POST",
        headers: { ...headers, "x-test-auth": "no" },
        body: "{}",
      })
    ).status,
    401
  );
  assert.equal(
    (
      await fetch(declinedPath, {
        method: "POST",
        headers: { ...headers, origin: "https://evil.test" },
        body: "{}",
      })
    ).status,
    403
  );
  assert.equal(
    (
      await fetch(declinedPath, {
        method: "POST",
        headers,
        body: JSON.stringify({ workouts: [workout] }),
      })
    ).status,
    400
  );
  assert.equal((await fetch(declinedPath, { headers })).status, 405);
  assert.equal((await fetch(declinedPath, { method: "POST", headers, body: "{}" })).status, 200);
  assert.equal(declines, 1);
});

test("decline persists, cannot be confirmed and does not dispatch a write", async () => {
  const h = harness();
  await h.calendar.propose([workout]);
  assert.equal((await h.calendar.decline(id)).state, "declined");
  h.complete(1, "preview");
  assert.equal((await h.calendar.status(id)).state, "declined");
  assert.equal((await h.calendar.list())[0].state, "declined");
  assert.equal((await h.calendar.decline(id)).state, "declined");
  await assert.rejects(h.calendar.confirm(id), /successful preview/);
  assert.equal(h.dispatches().length, 1);
});

test("decline survives an in-flight preview poll", async () => {
  const h = harness();
  await h.calendar.propose([workout]);
  h.complete(1, "preview");
  await Promise.all([h.calendar.status(id), h.calendar.decline(id)]);
  assert.equal((await h.calendar.status(id)).state, "declined");
  assert.equal(h.dispatches().length, 1);
});

test("approval and decline are atomic; a submitted write cannot be dismissed as declined", async () => {
  for (const declineFirst of [true, false]) {
    const h = harness();
    await h.calendar.propose([workout]);
    h.complete(1, "preview");
    await h.calendar.status(id);
    const results = await Promise.allSettled(
      declineFirst
        ? [h.calendar.decline(id), h.calendar.confirm(id)]
        : [h.calendar.confirm(id), h.calendar.decline(id)]
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(h.dispatches().length, declineFirst ? 1 : 2);
    assert.equal((await h.store.read()).proposals[0].state, declineFirst ? "declined" : "queued");
  }
});
