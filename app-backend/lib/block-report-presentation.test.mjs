import assert from "node:assert/strict";
import test from "node:test";
import { parseBlockReportPresentation } from "./block-report-presentation.mjs";

test("block presentation preserves exact values, missing evidence and cautious recommendations", () => {
  const result = parseBlockReportPresentation(`[[SECTION11_REPORT:BLOCK:2026-08-10]]
BLOCK REPORT — 2026-08-10 to 2026-09-06
Weeks in block: 4
VOLUME PROGRESSION
Wk 1: 8.53 h / 857 TSS | CTL 47.4
FITNESS PROGRESSION
CTL: 47.4 → 66.3 (Δ +18.9)
DURABILITY BY WEEK
Wk 1: mean decoupling 4.54% (1 qualifying)
Wk 4: no qualifying durability session
Block trend: mixed; limited sample.
COMPLIANCE
ATP: 29.67 h; history.json: 30.37 h. No combined percentage.
PHASE PROGRESSION CHECK
Recommendation: progress with caution.
INTERPRETATION
Evidence is mixed and sparse.
ADDITIONAL METRIC
Novel metric: 1.23400
[[/SECTION11_REPORT:BLOCK:2026-08-10]]`);
  assert.deepEqual(result.summary, ["Evidence is mixed and sparse."]);
  const section = (title) => result.sections.find((s) => s.title === title);
  assert.deepEqual(section("Volume Progression").rows[0], ["Wk 1", "8.53", "857", "47.4"]);
  assert.deepEqual(section("Fitness Progression").rows[0], ["CTL", "47.4", "66.3", "+18.9"]);
  assert.deepEqual(section("Durability").rows[1], [
    "Wk 4",
    "no qualifying durability session",
    "—",
  ]);
  assert.match(section("Compliance").prose[0], /29.67 h; history.json: 30.37 h/);
  assert.deepEqual(section("Phase Progression Check").prose, [
    "Recommendation: progress with caution.",
  ]);
  assert.equal(section("Additional Metric").rows[0][1], "1.23400");
  assert.ok(!JSON.stringify(result).includes("SECTION11_REPORT"));
});

test("no summary or numerical values are fabricated for missing sections", () => {
  assert.deepEqual(parseBlockReportPresentation("COMPLIANCE\nNo data retained."), {
    summary: [],
    sections: [
      {
        title: "Compliance",
        headers: ["Metric", "Result"],
        rows: [],
        prose: ["No data retained."],
      },
    ],
  });
});
