import { test } from "node:test";
import assert from "node:assert/strict";
import { reportLines } from "./report-presentation.mjs";
test("report reader strips decorative headings and bold values, preserving field labels and data", () => {
  assert.deepEqual(
    reportLines(
      "## Current Status Summary:\n**RHR:** **48 bpm**\nSleep: 7:30\n---\n08:30 workout\nInterpretation: Normal recovery."
    ),
    [
      { label: "Current Status Summary:", text: "" },
      { label: "RHR:", text: " 48 bpm" },
      { label: "Sleep:", text: " 7:30" },
      { label: "", text: "" },
      { label: "", text: "08:30 workout" },
      { label: "Interpretation:", text: " Normal recovery." },
    ]
  );
});
