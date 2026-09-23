import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchIntervalsReportCatalog,
  parseIntervalsReportNote,
  parseIntervalsReportNotes,
} from "./intervals-report-catalog.mjs";

test("weekly and block reports sharing one note remain separate", () => {
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

test("unrelated and workout records are ignored", () => {
  assert.equal(parseIntervalsReportNote({ category: "NOTE", name: "Remember this" }), null);
  assert.equal(
    parseIntervalsReportNote({
      id: 42,
      category: "WORKOUT",
      description: "[[SECTION11_REPORT:WEEKLY:2026-09-14]]\nWrong record",
    }),
    null
  );
  assert.equal(
    parseIntervalsReportNote({
      id: 43,
      category: "NOTE",
      description: "[[SECTION11_REPORT:PRE_WORKOUT:event:42]]\nRemoved report",
    }),
    null
  );
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
  assert.deepEqual(catalog.reports.map((report) => report.id), ["intervals-note:3", "intervals-note:1"]);
});
