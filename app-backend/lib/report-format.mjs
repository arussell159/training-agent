import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const files = new Set([
  "WEEKLY_REPORT_TEMPLATE.md",
  "BLOCK_REPORT_TEMPLATE.md",
]);

// These are the athlete's exact supplied templates, deployed with the app.
export async function readReportTemplate(file) {
  if (!files.has(file)) return null;
  const text = await readFile(new URL(`../coach/reports/${file}`, import.meta.url), "utf8");
  return { file, text, revision: createHash("sha256").update(text).digest("hex") };
}

export function reportSummary(text) {
  const interpretation = String(text || "").split(/(?:^|\n)[#*\s]*Interpretation\s*:[*\s]*\n?/i)[1];
  const paragraph =
    (interpretation || String(text || "")).split(/\n\s*\n/).find((s) => s.trim()) || "";
  const plain = paragraph
    .replace(/[*#_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (
    [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(plain)][0]?.segment.trim() ||
    ""
  );
}

export function validReportSummary(summary) {
  return (
    typeof summary === "string" &&
    summary.trim().length > 10 &&
    summary.length <= 500 &&
    !/[\r\n]/.test(summary) &&
    [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(summary.trim())].length === 1
  );
}

// Reject a generic chat reply or truncated output before making the saved report immutable.
// Optional fields and sports-specific omissions remain governed by the exact template.
export function reportFollowsStructure(kind, markdown, evidence = {}) {
  if (
    typeof markdown !== "string" ||
    markdown.trim().length < 80 ||
    /```|\[(?:XX|X\.XX|placeholders?)[^\]]*\]/i.test(markdown)
  )
    return false;
  const text = markdown.replace(/[*#`]/g, "").trim();
  const required = kind === "weekly"
    ? [
        /^Week .+ Summary/i,
        /Compliance:/i,
        /Session Breakdown:/i,
        /Polarization:/i,
        /Fitness:/i,
        /Wellness Trends:/i,
        /Section 11 Flags:/i,
        /Interpretation:/i,
        /Next Week Preview:/i,
      ]
    : [
        /^Block .+ Report/i,
        /Volume Progression:/i,
        /Compliance:/i,
        /Fitness Progression:/i,
        /Polarization/i,
        /Wellness/i,
        /Section 11 Flags/i,
        /Phase Progression Check:/i,
        /Interpretation:/i,
        /Next Block Plan:/i,
      ];
  let cursor = 0;
  for (const pattern of required) {
    const match = text.slice(cursor).match(pattern);
    if (!match) return false;
    cursor += match.index + match[0].length;
  }
  return true;
}
