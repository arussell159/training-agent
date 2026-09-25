import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import {
  createCoachReportStore,
  normalizeCoachReport,
  reportTitle,
} from "./coach-report-store.mjs";
import { createCoachReportCatalog } from "./coach-report-migration.mjs";
import { createReportsHttp } from "./coach-reports-http.mjs";
import {
  filterCoachReports,
  groupWorkoutReportsByWeek,
  reportDisplayTitle,
  reportPeriodLabel,
  REPORT_FILTERS,
} from "./coach-report-display.mjs";

function harness() {
  const rows = new Map();
  const bootstrap = {
    SUPABASE_URL: "https://database.example",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    SETTINGS_SCOPE: "training",
  };
  const fetchImpl = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    assert.equal(url.pathname, "/rest/v1/coach_reports");
    assert.equal(options.headers.apikey, bootstrap.SUPABASE_SECRET_KEY);
    const scope = url.searchParams.get("scope")?.slice(3) || "training";
    if (!options.method || options.method === "GET") {
      const found = [...rows.values()].filter(
        (row) =>
          row.scope === scope &&
          (!url.searchParams.has("id") || row.id === url.searchParams.get("id").slice(3))
      );
      return Response.json(
        found.sort(
          (a, b) =>
            b.end_date.localeCompare(a.end_date) || b.generated_at.localeCompare(a.generated_at)
        )
      );
    }
    assert.equal(options.method, "POST");
    assert.equal(url.searchParams.get("on_conflict"), "scope,source_key");
    const incoming = JSON.parse(options.body);
    for (const row of incoming) rows.set(`${row.scope}:${row.source_key}`, row);
    return Response.json(incoming);
  };
  return {
    rows,
    store: createCoachReportStore(bootstrap, fetchImpl, () => new Date("2026-09-25T12:00:00Z")),
  };
}

test("workout titles include sport and period labels use the workout date", () => {
  for (const [sport, label] of [
    ["Swim", "Swim"],
    ["Cycling", "Bike"],
    ["Run", "Run"],
    ["Rowing", "Rowing"],
  ]) {
    assert.equal(reportTitle("pre_workout", sport), `${label} Pre-Workout Report`);
    assert.equal(reportTitle("post_workout", sport), `${label} Post-Workout Report`);
  }
  assert.equal(reportPeriodLabel({ kind: "pre_workout", startDate: "2026-09-25" }), "09/25/26");
  assert.equal(
    reportPeriodLabel({ kind: "weekly", startDate: "2026-09-21", endDate: "2026-09-27" }),
    "09/21/26 to 09/27/26"
  );
  assert.equal(
    reportDisplayTitle({ kind: "weekly", title: "Section 11 weekly report — 2026-09-21" }),
    "Weekly Report"
  );
  assert.equal(
    reportDisplayTitle({ kind: "block", title: "Section 11 block report — 2026-09-01" }),
    "Block Report"
  );
  assert.throws(
    () => normalizeCoachReport({ kind: "pre_workout", startDate: "2026-09-25", body: "Report" }),
    /sport/
  );
  assert.equal(
    normalizeCoachReport({
      kind: "weekly",
      startDate: "2026-09-21",
      endDate: "2026-09-27",
      body: "  Label: value\n\n",
    }).body,
    "  Label: value\n\n"
  );
});

test("Supabase upsert replaces the same source key without duplicating reports", async () => {
  const h = harness();
  const original = await h.store.upsert({
    kind: "pre_workout",
    sport: "Swim",
    workoutId: "event:42",
    startDate: "2026-09-25",
    body: "First",
  });
  const updated = await h.store.upsert({
    kind: "pre_workout",
    sport: "Swim",
    workoutId: "event:42",
    startDate: "2026-09-26",
    body: "Revised",
  });
  assert.equal(updated.id, original.id);
  assert.equal(updated.text, "Revised");
  assert.equal(updated.startDate, "2026-09-26");
  assert.equal((await h.store.list()).reports.length, 1);
  assert.equal((await h.store.get(original.id)).text, "Revised");
  await h.store.upsert({
    kind: "post_workout",
    sport: "Swim",
    workoutId: "event:42",
    startDate: "2026-09-26",
    body: "After",
  });
  assert.equal((await h.store.list()).reports.length, 2);
});

test("catalog filters cover Pre, Post, Weekly and Others", () => {
  assert.deepEqual(
    REPORT_FILTERS.map((item) => item.label),
    ["Pre", "Post", "Weekly", "Others"]
  );
  const reports = ["pre_workout", "post_workout", "weekly", "block"].map((kind) => ({
    kind,
    title: kind,
    startDate: "2026-09-25",
    endDate: "2026-09-25",
  }));
  assert.equal(filterCoachReports(reports, "all").length, 4);
  for (const kind of ["pre_workout", "post_workout", "weekly"])
    assert.deepEqual(
      filterCoachReports(reports, kind).map((report) => report.kind),
      [kind]
    );
  assert.deepEqual(
    filterCoachReports(reports, "others").map((report) => report.kind),
    ["block"]
  );
  assert.equal(filterCoachReports([{ ...reports[0], sport: "Swim" }], "all", "swim").length, 1);
});

test("workout reports group by Monday week and sort newest first within each week", () => {
  const reports = [
    { id: "sunday", startDate: "2026-09-27" },
    { id: "monday", startDate: "2026-09-21" },
    { id: "next", startDate: "2026-09-28" },
    { id: "friday", startDate: "2026-09-25" },
  ];
  const groups = groupWorkoutReportsByWeek(reports);
  assert.deepEqual(
    groups.map((group) => [group.startDate, group.label]),
    [
      ["2026-09-28", "Week of Sep 28"],
      ["2026-09-21", "Week of Sep 21"],
    ]
  );
  assert.deepEqual(
    groups[1].reports.map((report) => report.id),
    ["sunday", "friday", "monday"]
  );
  assert.equal(groupWorkoutReportsByWeek([{ startDate: "2027-01-01" }])[0].startDate, "2026-12-28");
});

test("legacy weekly and block reports copy once and catalog reads only app storage", async () => {
  const h = harness();
  let notesRead = 0,
    savedRead = 0,
    complete = false;
  const marker = {
    read: async () => ({ complete }),
    update: async (change) => {
      const state = { complete };
      change(state);
      complete = state.complete;
    },
  };
  const catalog = createCoachReportCatalog({
    store: h.store,
    marker,
    legacyNotes: async () => {
      notesRead++;
      return {
        reports: [
          {
            kind: "weekly",
            startDate: "2026-09-21",
            endDate: "2026-09-27",
            title: "Old note",
            text: "Old weekly note",
          },
        ],
      };
    },
    legacySaved: async () => {
      savedRead++;
      return [
        {
          kind: "weekly",
          startDate: "2026-09-21",
          endDate: "2026-09-27",
          title: "Weekly Report",
          body: "Saved app report",
        },
        {
          kind: "block",
          startDate: "2026-09-01",
          endDate: "2026-09-21",
          title: "Block Report",
          body: "Saved block",
        },
      ];
    },
  });
  const first = await catalog.list();
  assert.equal(first.reports.length, 2);
  assert.equal(first.reports.find((report) => report.kind === "weekly").text, "Saved app report");
  await catalog.list();
  assert.equal(notesRead, 1);
  assert.equal(savedRead, 1);
});

test("legacy app reports stay readable when the one-time Intervals import is unavailable", async () => {
  const h = harness();
  const catalog = createCoachReportCatalog({
    store: h.store,
    marker: {
      read: async () => ({ complete: false }),
      update: async () => {
        throw Error("should not mark complete");
      },
    },
    legacyNotes: async () => {
      throw Error("Intervals unavailable");
    },
    legacySaved: async () => [
      { kind: "weekly", startDate: "2026-09-21", endDate: "2026-09-27", body: "Preserved weekly" },
    ],
  });
  assert.equal((await catalog.list()).reports[0].text, "Preserved weekly");
});

test("migration leaves an existing app report unchanged", async () => {
  const h = harness();
  await h.store.upsert({
    kind: "weekly",
    startDate: "2026-09-21",
    endDate: "2026-09-27",
    body: "Current app report",
  });
  let complete = false;
  const catalog = createCoachReportCatalog({
    store: h.store,
    marker: {
      read: async () => ({ complete }),
      update: async (change) => {
        const state = { complete };
        change(state);
        complete = state.complete;
      },
    },
    legacyNotes: async () => ({
      reports: [
        { kind: "weekly", startDate: "2026-09-21", endDate: "2026-09-27", text: "Old note" },
      ],
    }),
    legacySaved: async () => [
      { kind: "weekly", startDate: "2026-09-21", endDate: "2026-09-27", body: "Old saved report" },
    ],
  });
  assert.equal((await catalog.list()).reports[0].text, "Current app report");
  assert.equal((await catalog.list()).reports.length, 1);
});

test("report API authenticates reads and writes and returns an idempotent record", async (t) => {
  const h = harness();
  const handler = createReportsHttp({
    getStore: async () => h.store,
    getCatalog: () => h.store.list(),
    getReports: async () => ({ status: async () => ({}), generate: async () => ({}) }),
    env: () => ({ TRAINING_DATA_GITHUB_REPO: "test/reports", TRAINING_DATA_GITHUB_TOKEN: "test" }),
  });
  const server = http.createServer(async (req, res) => {
    if (req.headers["x-test-login"]) req.appSession = {};
    await handler(req, res, new URL(req.url, "http://localhost").pathname);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const path = `${origin}/api/coach/reports`;
  const input = {
    kind: "post_workout",
    sport: "Run",
    workoutId: "event:5",
    startDate: "2026-09-25",
    body: "Completed",
  };
  assert.equal((await fetch(path)).status, 401);
  const headers = {
    origin,
    "x-test-login": "1",
    "content-type": "application/json",
    "x-coach-request": "1",
  };
  assert.equal(
    (
      await fetch(path, {
        method: "POST",
        headers: { ...headers, origin: "https://other.test" },
        body: JSON.stringify(input),
      })
    ).status,
    403
  );
  const first = await (
    await fetch(path, { method: "POST", headers, body: JSON.stringify(input) })
  ).json();
  const second = await (
    await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, body: "Updated" }),
    })
  ).json();
  assert.equal(first.id, second.id);
  assert.equal(second.title, "Run Post-Workout Report");
  assert.equal((await (await fetch(path, { headers })).json()).reports.length, 1);
  assert.equal((await (await fetch(`${path}/${first.id}`, { headers })).json()).text, "Updated");
});
