import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchIntervalsReportCatalog,
  parseIntervalsReportNote,
  parseIntervalsReportNotes,
} from "./intervals-report-catalog.mjs";

test('weekly and block reports sharing the same note remain separate', () => {
  const reports = parseIntervalsReportNotes({id:1,category:'NOTE',description:'[[SECTION11_REPORT:WEEKLY:2026-09-14]]\nWeekly text\n[[/SECTION11_REPORT:WEEKLY:2026-09-14]]\n[[SECTION11_REPORT:BLOCK:2026-09-07:2026-09-20]]\nBlock text\n[[/SECTION11_REPORT:BLOCK:2026-09-07:2026-09-20]]'});
  assert.equal(reports.length,2);
  assert.equal(reports[0].text,'Weekly text');
  assert.equal(reports[0].endDate,'2026-09-20');
  assert.equal(reports[1].text,'Block text');
  assert.notEqual(reports[0].id,reports[1].id);
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

test("Intervals report catalog is read-only, filtered and newest first", async () => {
  let requested = "";
  const catalog = await fetchIntervalsReportCatalog(async (path) => {
    requested = path;
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
  assert.equal(requested, "/athlete/0/events?oldest=2020-01-01&newest=2026-09-18");
  assert.deepEqual(
    catalog.reports.map((report) => report.id),
    ["intervals-note:3", "intervals-note:1"]
  );
});
