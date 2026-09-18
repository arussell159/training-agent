import assert from "node:assert/strict";
import test from "node:test";

import { parseWeeklyReportPresentation } from "./weekly-report-presentation.mjs";

test("weekly presentation preserves source values and moves the coach summary to the top", () => {
  const result = parseWeeklyReportPresentation(`
[[SECTION11_REPORT:WEEKLY:2026-09-07]]
SECTION 11 WEEKLY REPORT — 2026-09-07 to 2026-09-13

TRAINING LOAD
Hours: 8.73
TSS: 781

RECOVERY / DURABILITY
Durability mean decoupling: 11.75%
Durability qualifying sessions: 1

COACH SUMMARY
Limited evidence should be treated as a flag rather than a firm trend.
The next-week decision should come from fresh readiness data.
[[/SECTION11_REPORT:WEEKLY:2026-09-07]]
`);
  assert.equal(result.heading, "SECTION 11 — WEEKLY REPORT");
  assert.equal(result.startDate, "2026-09-07");
  assert.equal(result.endDate, "2026-09-13");
  assert.deepEqual(result.summary, [
    "Limited evidence should be treated as a flag rather than a firm trend.",
    "The next-week decision should come from fresh readiness data.",
  ]);
  assert.deepEqual(result.sections[0].entries, [
    { label: "Hours", value: "8.73" },
    { label: "TSS", value: "781" },
  ]);
  assert.equal(result.sections[1].entries[0].value, "11.75%");
  assert.equal(
    result.sections.some((section) => section.title === "Coach Summary"),
    false
  );
});
