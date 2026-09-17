import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readReportTemplate,
  reportSummary,
  validReportSummary,
  reportFollowsStructure,
} from "./report-format.mjs";

test("supplied templates are deployed exact resources with independently pinned revisions", async () => {
  for (const kind of ["PRE_WORKOUT", "POST_WORKOUT", "WEEKLY", "BLOCK"]) {
    const result = await readReportTemplate(`${kind}_REPORT_TEMPLATE.md`);
    assert.match(result.revision, /^[a-f0-9]{64}$/);
    assert.match(result.text, /Data Freshness/);
    assert.match(result.text, /Display Units/);
  }
  assert.equal(await readReportTemplate("../../config.json"), null);
});

const post =
  "Data (last_updated UTC: 2026-09-17T14:55:00)\nExecution matched the planned intensity.\n\nCompleted workout: Ride\nDuration: 1h00m\n\nCompleted workout: Walk\nDuration: 20m\n\nWeekly totals (rolling 7d):\nHours: 4h00m\n\nInterpretation:\nWorkload remains within the planned range. Recovery is stable.";
test("report validation rejects generic, fenced, truncated and missing same-day activity reports", () => {
  const evidence = { activities: [{ id: "ride" }, { id: "walk" }] };
  assert.equal(reportFollowsStructure("post", post, evidence), true);
  assert.equal(reportFollowsStructure("post", "Here is your report. ".repeat(20), evidence), false);
  assert.equal(reportFollowsStructure("post", "```\n" + post + "\n```", evidence), false);
  assert.equal(
    reportFollowsStructure("post", post.replace("Completed workout: Walk", "Walk"), evidence),
    false
  );
  assert.equal(reportFollowsStructure("post", post.split("Interpretation:")[0], evidence), false);
});

test("continuation replaces the standard pre-workout body and preview is exactly one sentence", () => {
  const text =
    "Same-day continuation: Go\nMorning readiness: Go P3: baseline\nCompleted session: Ride, 1h00m: within intent\nResponse: not eligible\nCurrent state: strong, no soreness or symptoms\nRemaining session: easy run\nDecision: Proceed as planned.\nACWR: start-of-day 1.00; live post-session value excluded from this decision";
  assert.equal(reportFollowsStructure("pre", text), true);
  assert.equal(reportFollowsStructure("pre", text + "\nInterpretation:\nMore advice."), false);
  assert.equal(reportSummary(post), "Workload remains within the planned range.");
  assert.equal(validReportSummary("Load rose by 1.5% while recovery stayed stable."), true);
  assert.equal(validReportSummary("Load is stable. Add more training."), false);
});
