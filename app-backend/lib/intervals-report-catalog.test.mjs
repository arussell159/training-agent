import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchIntervalsReportCatalog,
  fetchIntervalsWorkoutReports,
  parseIntervalsReportNote,
  parseIntervalsReportNotes,
} from "./intervals-report-catalog.mjs";

test("workout reports read activity comments, preserve local date and exclude other workouts", async () => {
  const calls = [];
  const activity = { id: "i42", start_date_local: "2026-09-19T07:00:00", paired_event_id: 10 };
  const request = async (path) => {
    calls.push(path);
    if (path === "/activity/i42") return activity;
    if (path === "/athlete/0/events/10") return { id: 10, paired_activity_id: "i42" };
    if (path === "/activity/i42/messages")
      return [
        { content: "An ordinary comment" },
        {
          content:
            "[[SECTION11_REPORT:PRE_WORKOUT:i42]]\nData last_updated (UTC): 2026-09-18T23:00:00\nArchived baseline\n[[/SECTION11_REPORT:PRE_WORKOUT:i42]]",
        },
        {
          content:
            "[[SECTION11_REPORT:POST_WORKOUT:i42]]\nCompleted\n[[/SECTION11_REPORT:POST_WORKOUT:i42]]",
        },
        { content: "[[SECTION11_REPORT:POST_WORKOUT:activity:other]]\nWrong workout" },
      ];
    throw new Error(`Unexpected ${path}`);
  };
  const actual = await fetchIntervalsWorkoutReports(request, "activity:i42");
  assert.deepEqual(
    actual.reports.map((r) => [r.kind, r.workoutId, r.startDate]),
    [
      ["pre", "activity:i42", "2026-09-19"],
      ["post", "activity:i42", "2026-09-19"],
    ]
  );
  assert.equal(actual.reports[1].text, "Completed");
  assert.deepEqual(calls, ["/activity/i42", "/activity/i42/messages", "/athlete/0/events/10"]);
  const paired = await fetchIntervalsWorkoutReports(request, "event:10");
  assert.equal(paired.reports.length, 2);
  assert.ok(paired.reports.every((r) => r.workoutId === "event:10"));
});

test("unpaired plans read descriptions and comment failures are not treated as missing reports", async () => {
  const report = await fetchIntervalsWorkoutReports(async (path) => {
    assert.equal(path, "/athlete/0/events/10");
    return {
      id: 10,
      start_date_local: "2026-09-19T07:00:00",
      description: "[[SECTION11_REPORT:PRE_WORKOUT:event:10]]\nSaved",
    };
  }, "event:10");
  assert.equal(report.reports[0].text, "Saved");
  await assert.rejects(
    fetchIntervalsWorkoutReports(async (path) => {
      if (path.endsWith("messages")) throw new Error("Network unavailable");
      return { id: "i42" };
    }, "activity:i42"),
    /Network unavailable/
  );
  await assert.rejects(
    fetchIntervalsWorkoutReports(() => {
      throw new Error("Must not request");
    }, "activity:../bad"),
    /Invalid/
  );
});

test("weekly and block reports sharing the same note remain separate", () => {
  const reports = parseIntervalsReportNotes({
    id: 1,
    category: "NOTE",
    description:
      "[[SECTION11_REPORT:WEEKLY:2026-09-14]]\nWeekly text\n[[/SECTION11_REPORT:WEEKLY:2026-09-14]]\n[[SECTION11_REPORT:BLOCK:2026-09-07:2026-09-20]]\nBlock text\n[[/SECTION11_REPORT:BLOCK:2026-09-07:2026-09-20]]",
  });
  assert.equal(reports.length, 2);
  assert.equal(reports[0].text, "Weekly text");
  assert.equal(reports[0].endDate, "2026-09-20");
  assert.equal(reports[1].text, "Block text");
  assert.notEqual(reports[0].id, reports[1].id);
});

test("Intervals report notes expose weekly content without the storage marker", () => {
  const report = parseIntervalsReportNote({
    id: 12,
    category: "NOTE",
    name: "Section 11 Weekly Report — 2026-09-07",
    start_date_local: "2026-09-07T00:00:00",
    description:
      "[[SECTION11_REPORT:WEEKLY:2026-09-07]]\nSECTION 11 WEEKLY REPORT — 2026-09-07 to 2026-09-13\nHours: 8.73\n[[/SECTION11_REPORT:WEEKLY:2026-09-07]]",
  });
  assert.deepEqual(report, {
    id: "intervals-note:12",
    kind: "weekly",
    title: "Section 11 Weekly Report — 2026-09-07",
    startDate: "2026-09-07",
    endDate: "2026-09-13",
    text: "SECTION 11 WEEKLY REPORT — 2026-09-07 to 2026-09-13\nHours: 8.73",
    source: "intervals",
  });
});

test("Intervals block report notes support a dated marker and unrelated notes are ignored", () => {
  assert.equal(parseIntervalsReportNote({ category: "NOTE", name: "Remember this" }), null);
  const report = parseIntervalsReportNote({
    id: 24,
    category: "NOTE",
    name: "Section 11 Block Report — Base 2",
    start_date_local: "2026-08-03T00:00:00",
    description:
      "[[SECTION11_REPORT:BLOCK:2026-08-03:2026-08-30]]\nSECTION 11 BLOCK REPORT\nInterpretation: Consistent.",
  });
  assert.equal(report.kind, "block");
  assert.equal(report.startDate, "2026-08-03");
  assert.equal(report.endDate, "2026-08-30");
});

test("pre and post workout reports are read from their Intervals records", () => {
  const pre = parseIntervalsReportNote({
    id: 42,
    category: "WORKOUT",
    __reportSource: "event",
    start_date_local: "2026-09-18T07:00:00",
    description: "[[SECTION11_REPORT:PRE_WORKOUT:event:42]]\nRecommendation: Go",
  });
  const post = parseIntervalsReportNote({
    id: "activity-7",
    category: "ACTIVITY",
    __reportSource: "activity",
    start_date_local: "2026-09-18T08:00:00",
    description: "[[SECTION11_REPORT:POST_WORKOUT:activity:activity-7]]\nOutcome: Complete",
  });
  assert.equal(pre.kind, "pre");
  assert.equal(pre.workoutId, "event:42");
  assert.equal(pre.text, "Recommendation: Go");
  assert.equal(post.kind, "post");
  assert.equal(post.workoutId, "activity:activity-7");
  assert.equal(post.text, "Outcome: Complete");
});

test("Intervals report catalog is read-only, filtered and newest first", async () => {
  const requested = [];
  const catalog = await fetchIntervalsReportCatalog(async (path) => {
    requested.push(path);
    return [
      {
        id: 1,
        category: "NOTE",
        name: "Section 11 Weekly Report — 2026-08-31",
        description: "[[SECTION11_REPORT:WEEKLY:2026-08-31]]\nOlder report",
      },
      { id: 2, category: "ACTIVITY", name: "Not a note", description: "ignored" },
      {
        id: 3,
        category: "NOTE",
        name: "Section 11 Weekly Report — 2026-09-07",
        description: "[[SECTION11_REPORT:WEEKLY:2026-09-07]]\nNewer report",
      },
    ];
  }, new Date("2026-09-18T12:00:00Z"));
  assert.equal(requested[0], "/athlete/0/events?oldest=2020-01-01&newest=2026-09-18");
  assert.equal(requested[1], "/athlete/0/activities?oldest=2026-03-22&newest=2026-09-18");
  assert.deepEqual(
    catalog.reports.map((report) => report.id),
    ["intervals-note:3", "intervals-note:1"]
  );
});
