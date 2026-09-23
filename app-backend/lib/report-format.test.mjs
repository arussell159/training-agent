import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readReportTemplate,
  reportSummary,
  validReportSummary,
  reportFollowsStructure,
} from "./report-format.mjs";

test("supplied templates are deployed exact resources with independently pinned revisions", async () => {
  for (const kind of ["WEEKLY", "BLOCK"]) {
    const result = await readReportTemplate(`${kind}_REPORT_TEMPLATE.md`);
    assert.match(result.revision, /^[a-f0-9]{64}$/);
    assert.match(result.text, /Data Freshness/);
    assert.match(result.text, /Display Units/);
  }
  assert.equal(await readReportTemplate("../../config.json"), null);
});

const weekly =
  "Week 2026-09-07 Summary\nCompliance: 100%\nSession Breakdown: Ride completed\nPolarization: Within plan\nFitness: Stable\nWellness Trends: Stable\nSection 11 Flags: None\nInterpretation:\nWorkload remains within the planned range. Recovery is stable.\nNext Week Preview: Continue as planned.";
test("report validation rejects generic, fenced, truncated and incomplete weekly reports", () => {
  const evidence = { activities: [{ id: "ride" }, { id: "walk" }] };
  assert.equal(reportFollowsStructure("weekly", weekly, evidence), true);
  assert.equal(reportFollowsStructure("weekly", "Here is your report. ".repeat(20), evidence), false);
  assert.equal(reportFollowsStructure("weekly", "```\n" + weekly + "\n```", evidence), false);
  assert.equal(
    reportFollowsStructure("weekly", weekly.replace("Section 11 Flags: None", "Flags: None"), evidence),
    false
  );
  assert.equal(reportFollowsStructure("weekly", weekly.split("Interpretation:")[0], evidence), false);
  assert.equal(reportSummary(weekly), "Workload remains within the planned range.");
  assert.equal(validReportSummary("Load rose by 1.5% while recovery stayed stable."), true);
  assert.equal(validReportSummary("Load is stable. Add more training."), false);
});
