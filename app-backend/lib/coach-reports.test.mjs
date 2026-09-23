import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import {
  createCoachReports,
  createReportSnapshotCache,
  freshReport,
  reportEligibility,
} from "./coach-reports.mjs";
import { createWorkoutSync, freshWorkoutSync } from "./coach-workout-sync.mjs";
import { createReportsHttp } from "./coach-reports-http.mjs";
import { resolveReportTarget, planReportBlocks, validateReportRequest } from "./report-targets.mjs";
import { coachConfig } from "./github-coach.mjs";

const epoch = Date.parse("2026-09-17T15:00:00Z");
const env = {
  TRAINING_DATA_GITHUB_REPO: "test/athlete",
  TRAINING_DATA_GITHUB_TOKEN: "private",
  OPENAI_API_KEY: "private-ai",
};
const config = coachConfig(env);
function memory(fresh) {
  let value = fresh();
  return {
    read: async () => structuredClone(value),
    update: async (change) => {
      const next = structuredClone(value);
      const result = change(next);
      value = next;
      return structuredClone(result);
    },
  };
}
function harness() {
  let clock = epoch;
  const stores = new Map();
  const record = (key) => {
    if (!stores.has(key)) stores.set(key, memory(freshReport));
    return stores.get(key);
  };
  const index = memory(() => ({ reports: [] }));
  const latest = {
    metadata: { last_updated: "2026-09-17T14:55:00", extended_range_days: 28 },
    athlete_profile: { timezone: "America/Chicago" },
    wellness_data: [
      { date: "2026-09-17", sleep_hours: 7, weight_kg: 80 },
      { date: "2026-09-16", sleep_hours: 8 },
    ],
    recent_activities: [
      { id: "i2", date: "2026-09-17", has_intervals: true },
      { id: "walk", date: "2026-09-17" },
    ],
  };
  const history = {
    daily_90d: [
      { date: "2026-08-31" },
      { date: "2026-09-06" },
      { date: "2026-09-07" },
      { date: "2026-09-13" },
    ],
    weekly_180d: [{ week_start: "2026-08-31" }, { week_start: "2026-09-07" }],
  };
  const intervals = {
    activities: [{ activity_id: "i2", date: "2026-09-17" }],
    fetch_state: { i2: { streams: { status: "pending" } } },
  };
  const context = {
    history: [
      {
        id: "event:2",
        activity_id: "i2",
        workout_date: "2026-09-17",
        status: "completed",
        title: "Run",
      },
    ],
    planned: [{ id: "event:1", workout_date: "2026-09-17", status: "today", title: "Bike" }],
  };
  const plans = [
    {
      id: "plan1",
      name: "Triathlon",
      weeks: [
        { startDate: "2026-08-31", endDate: "2026-09-06", phase: "Base 1" },
        { startDate: "2026-09-07", endDate: "2026-09-13", phase: "Base 1", recovery: true },
        { startDate: "2026-09-14", endDate: "2026-09-20", phase: "Build 1" },
      ],
    },
  ];
  const read = async (file) =>
    ({ "latest.json": latest, "history.json": history, "intervals.json": intervals })[file];
  let snapshots = 0;
  const source = {
    snapshot: async () => {
      snapshots++;
      return { latest, read, sha: "data-sha" };
    },
    open: async () => ({
      latest,
      readData: read,
      metadata: () => ({ dataRevision: "data-sha", protocolRevision: "protocol-sha" }),
      readReference: async (file) => ({ file, text: `Exact ${file}`, revision: "protocol-sha" }),
    }),
  };
  let answers = 0,
    onAnswer;
  const argumentsSeen = [];
  const snapshotCache = createReportSnapshotCache(source, config, () => clock);
  const queues = [];
  let progress = { status: "queued" };
  const sync = { queue: async (...args) => queues.push(args), poll: async () => progress };
  const build = () =>
    createCoachReports({
      config,
      source,
      snapshotCache,
      sync,
      record,
      index,
      readContext: async () => context,
      readPlans: async () => plans,
      now: () => clock,
      answer: async (args) => {
        answers++;
        argumentsSeen.push(args);
        if (onAnswer) await onAnswer(args);
        return {
          text: "# Saved report\n" + "Source-based assessment. ".repeat(5),
          source: args.sourceSession.metadata(),
          model: "fixture",
        };
      },
    });
  return {
    build,
    context,
    plans,
    latest,
    intervals,
    history,
    record,
    index,
    queues,
    argumentsSeen,
    snapshotCache,
    source,
    snapshot: { latest, read },
    answers: () => answers,
    snapshots: () => snapshots,
    setClock: (value) => {
      clock = value;
    },
    onAnswer: (value) => {
      onAnswer = value;
    },
    progress: (value) => {
      progress = value;
    },
  };
}

test("report targets reject client-authored facts and resolve saved workouts and complete phase blocks", () => {
  const h = harness();
  assert.throws(() => validateReportRequest({ kind: "pre", workoutId: "event:1" }), /supported report type/);
  assert.throws(() => validateReportRequest({ kind: "post", workoutId: "activity:i2" }), /supported report type/);
  assert.throws(() => validateReportRequest({ kind: "weekly", startDate: "2026-09-13" }), /Monday/);
  assert.throws(
    () => validateReportRequest({ kind: "weekly", startDate: "2026-02-30" }),
    /Invalid report date/
  );
  assert.equal(
    resolveReportTarget({ kind: "weekly", startDate: "2026-09-07" }, h.context).key,
    "weekly:2026-09-07"
  );
  const blocks = planReportBlocks(h.plans[0]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].endDate, "2026-09-13");
  assert.equal(blocks[0].weeks.length, 2);
  assert.equal(
    resolveReportTarget({ kind: "block", planId: "plan1", startDate: "2026-08-31" }, {}, h.plans)
      .endDate,
    "2026-09-13"
  );
  assert.throws(
    () =>
      resolveReportTarget({ kind: "block", planId: "plan1", startDate: "2026-09-07" }, {}, h.plans),
    /no longer/
  );
});

test("weekly and block reports wait for period end, later export and full history coverage", async () => {
  const h = harness(),
    reports = h.build();
  assert.equal((await reports.status({ kind: "weekly", startDate: "2026-09-07" })).eligible, true);
  assert.equal((await reports.status({ kind: "weekly", startDate: "2026-09-14" })).eligible, false);
  assert.equal(
    (await reports.status({ kind: "block", planId: "plan1", startDate: "2026-08-31" })).eligible,
    true
  );
  h.latest.metadata.last_updated = "2026-09-13T23:00:00Z";
  assert.match(
    (await reports.status({ kind: "weekly", startDate: "2026-09-07" })).reason,
    /after this period/
  );
  h.latest.metadata.last_updated = "2026-09-17T14:55:00Z";
  h.history.daily_90d = [];
  h.history.weekly_180d = [];
  assert.match(
    (await reports.status({ kind: "weekly", startDate: "2026-09-07" })).reason,
    /entire period/
  );
  assert.equal(h.answers(), 0);
});

test("concurrent manual clicks generate exactly once and a new service instance reads the immutable saved report", async () => {
  const h = harness();
  const block = { kind: "block", planId: "plan1", startDate: "2026-08-31" };
  let release, began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  h.onAnswer(async () => {
    began();
    await pending;
  });
  const first = h.build().generate(block);
  await started;
  assert.equal((await h.build().generate(block)).status, "running");
  assert.equal((await h.build().status(block)).status, "running");
  release();
  const completed = await first;
  assert.equal(completed.status, "complete");
  assert.equal(completed.eligible, false);
  h.latest.recent_activities = []; // Saved results do not disappear when source windows move.
  const reloaded = await h.build().generate(block);
  assert.equal(reloaded.text, completed.text);
  assert.equal(h.answers(), 1);
  assert.equal((await h.index.read()).reports.length, 1);
  h.context.history = [];
  assert.equal((await h.build().status(block)).text, completed.text);
  assert.equal((await h.build().generate(block)).status, "complete");
  assert.equal(h.answers(), 1);
  const args = h.argumentsSeen[0];
  assert.match(args.reportContext.template.text, /BLOCK_REPORT_TEMPLATE/);
  assert.match(args.reportContext.hierarchy.text, /REPORT_HIERARCHY/);
  assert.equal(args.reportContext.evidence.activities.length, 0);
  assert.equal(args.calendar, undefined);
});

test("home report catalog includes only closed periods and retains saved blocks after ATP edits", async () => {
  const h = harness();
  await h.index.update((state) => {
    state.reports = [
      { kind: "block", planId: "old", startDate: "2025-01-06", endDate: "2025-02-02" },
    ];
  });
  const catalog = await h.build().catalog();
  assert.equal(catalog.weeks[0].startDate, "2026-09-07");
  assert.equal(catalog.blocks.length, 2);
  assert.equal(catalog.blocks[0].endDate, "2026-09-13");
  assert.equal(catalog.blocks[1].planId, "old");
  assert.equal(h.answers(), 0);
});

test("snapshot cache coalesces parallel reads and invalidates after sync", async () => {
  const h = harness();
  await Promise.all([h.snapshotCache.read(), h.snapshotCache.read(), h.snapshotCache.read()]);
  assert.equal(h.snapshots(), 1);
  h.snapshotCache.invalidate();
  await h.snapshotCache.read();
  assert.equal(h.snapshots(), 2);
});

function syncHarness() {
  const store = memory(freshWorkoutSync),
    runs = [];
  let clock = epoch,
    dispatches = 0,
    uncertain = false;
  const sync = createWorkoutSync({
    config,
    store,
    now: () => clock,
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).origin, "https://api.github.com");
      assert.equal(options.redirect, "error");
      if (url.endsWith("/dispatches")) {
        dispatches++;
        const input = JSON.parse(options.body);
        runs.push({
          id: dispatches,
          event: "workflow_dispatch",
          head_branch: "main",
          path: ".github/workflows/auto-sync.yml",
          status: "queued",
          display_title: `section11-sync-${input.inputs.request_id}`,
        });
        if (uncertain) throw new Error("Connection interrupted after dispatch");
        return new Response(JSON.stringify({ workflow_run_id: dispatches }));
      }
      if (url.includes("/workflows/auto-sync.yml/runs?"))
        return Response.json({ workflow_runs: runs });
      return Response.json(runs.find((r) => r.id === Number(url.split("/").at(-1))));
    },
  });
  return {
    sync,
    runs,
    store,
    dispatches: () => dispatches,
    uncertain: () => {
      uncertain = true;
    },
    advance: (ms) => {
      clock += ms;
    },
  };
}

test("completion observation dispatches one sync across repeated observations and queues later completions", async () => {
  const h = syncHarness();
  const context = (ids) => ({
    history: ids.map((id) => ({ id: `activity:${id}`, activity_id: id, status: "completed" })),
  });
  await h.sync.observe(null, context(["old"]));
  assert.equal(h.dispatches(), 0);
  await Promise.all([
    h.sync.observe(context(["old"]), context(["old", "new"])),
    h.sync.observe(context(["old"]), context(["old", "new"])),
  ]);
  assert.equal(h.dispatches(), 1);
  await h.sync.observe(context(["old", "new"]), context(["old", "new", "later"]));
  assert.equal(h.dispatches(), 1);
  h.runs[0].status = "completed";
  h.runs[0].conclusion = "success";
  await h.sync.poll();
  assert.equal(h.dispatches(), 2);
  assert.deepEqual((await h.store.read()).active.ids, ["later"]);
});

test("uncertain dispatch is recovered by request ID, not blindly repeated", async () => {
  const h = syncHarness();
  h.uncertain();
  await h.sync.queue(["one"]);
  assert.equal((await h.store.read()).active.status, "checking");
  await h.sync.poll();
  assert.equal((await h.store.read()).active.runId, 1);
  assert.equal(h.dispatches(), 1);
  h.runs[0].status = "completed";
  h.runs[0].conclusion = "failure";
  await h.sync.poll();
  await h.sync.queue(["one"]);
  assert.equal(h.dispatches(), 1);
  await h.sync.queue(["one"], true);
  assert.equal(h.dispatches(), 2);
});

test("morning Refresh dispatches without a workout completion and coalesces simultaneous clicks", async () => {
  const h = syncHarness();
  await Promise.all([h.sync.refresh(), h.sync.refresh(), h.sync.refresh()]);
  assert.equal(h.dispatches(), 1);
  assert.deepEqual((await h.store.read()).active.ids, []);
  assert.equal((await h.store.read()).active.manual, true);
  h.runs[0].status = "completed";
  h.runs[0].conclusion = "success";
  assert.equal((await h.sync.poll()).status, "complete");
  await h.sync.refresh();
  assert.equal(h.dispatches(), 2);
});

test("manual Refresh recovers an uncertain dispatch and permits retry after a failed run", async () => {
  const h = syncHarness();
  h.uncertain();
  assert.equal((await h.sync.refresh()).status, "checking");
  await h.sync.refresh();
  assert.equal(h.dispatches(), 1);
  h.runs[0].status = "completed";
  h.runs[0].conclusion = "failure";
  assert.equal((await h.sync.poll()).status, "failed");
  await h.sync.refresh();
  assert.equal(h.dispatches(), 2);
});

test("report HTTP requires app login, same-origin POST and a validated target", async (t) => {
  let generated = 0;
  const catalogReport = {
    id: "intervals-note:1",
    kind: "weekly",
    startDate: "2026-09-07",
    endDate: "2026-09-13",
    text: "Saved Intervals report",
    title: "Weekly report",
  };
  const handler = createReportsHttp({
    env: () => env,
    getCatalog: async () => ({
      reports: [catalogReport],
    }),
    getReports: async () => ({
      status: async () => ({ eligible: true }),
      generate: async () => {
        generated++;
        return { status: "complete" };
      },
    }),
  });
  const server = http.createServer(async (req, res) => {
    if (req.headers["x-test-login"]) req.appSession = {};
    await handler(req, res, req.url);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    origin,
    "Content-Type": "application/json",
    "X-Coach-Request": "1",
    "X-Test-Login": "1",
  };
  const call = (route, h = headers, data = { kind: "weekly", startDate: "2026-09-07" }) =>
    fetch(origin + "/api/coach/reports/" + route, {
      method: "POST",
      headers: h,
      body: JSON.stringify(data),
    });
  assert.equal((await call("generate", { ...headers, "X-Test-Login": "" })).status, 401);
  assert.equal((await call("generate", { ...headers, origin: "https://other.test" })).status, 403);
  assert.equal((await call("generate", headers, { kind: "post", workoutId: "activity:1" })).status, 400);
  const catalog = await call("catalog");
  assert.equal(catalog.status, 200);
  assert.deepEqual((await catalog.json()).reports, [catalogReport]);
  const weekly = await (
    await call("status", headers, { kind: "weekly", startDate: "2026-09-07" })
  ).json();
  assert.equal(weekly.status, "complete");
  assert.equal(weekly.text, "Saved Intervals report");
  const missing = await (
    await call("status", headers, { kind: "weekly", startDate: "2026-08-31" })
  ).json();
  assert.equal(missing.eligible, false);
  assert.equal(generated, 0);
  assert.equal(
    (await call("generate", headers, { kind: "weekly", startDate: "2026-09-07" })).status,
    200
  );
  assert.equal(generated, 1);
  assert.equal((await call("generate")).status, 200);
  assert.equal(generated, 2);
});
