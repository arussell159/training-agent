const titles = {
  "PHASE TIMELINE": "Phase Timeline",
  "VOLUME PROGRESSION": "Volume Progression",
  COMPLIANCE: "Compliance",
  "FITNESS PROGRESSION": "Fitness Progression",
  "POLARIZATION — BLOCK": "Block Intensity Distribution",
  "POLARIZATION BY WEEK": "Intensity by Week",
  "DURABILITY BY WEEK": "Durability",
  "EFFICIENCY FACTOR BY WEEK": "Efficiency Factor",
  "HR RECOVERY BY WEEK": "Heart-Rate Recovery",
  WELLNESS: "Wellness",
  "SECTION 11 FLAGS DURING BLOCK": "Section 11 Flags",
  "PHASE PROGRESSION CHECK": "Phase Progression Check",
  "NEXT BLOCK": "Next Block",
};

// Presentation only: captured strings are never converted, rounded or calculated.
export function parseBlockReportPresentation(text) {
  const sections = [];
  const summary = [];
  let current = { title: "Block Overview", headers: ["Metric", "Result"], rows: [], prose: [] };
  sections.push(current);
  for (const raw of String(text || "").replace(/\[\[\/?SECTION11_REPORT:[^\]]+\]\]/gi, "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^#{1,6}\s+/, "");
    if (!line || /^(?:SECTION\s+11\s*[—-]?\s*)?BLOCK REPORT\b/i.test(line)) continue;
    if (titles[line] || /^[A-Z][A-Z0-9 /&+()—-]{2,}$/.test(line)) {
      current = { title: titles[line] || line.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()), headers: ["Metric", "Result"], rows: [], prose: [] };
      sections.push(current);
      continue;
    }
    if (["Interpretation", "Coach Summary", "Block Summary"].includes(current.title)) {
      summary.push(line);
      continue;
    }
    let match;
    if (current.title === "Volume Progression" && (match = line.match(/^(Wk\s+\d+):\s*(.+?)\s+h\s*\/\s*(.+?)\s+TSS\s*\|\s*CTL\s+(.+)$/i))) {
      current.headers = ["Week", "Hours", "TSS", "CTL"];
      current.rows.push(match.slice(1));
    } else if (current.title === "Fitness Progression" && (match = line.match(/^([^:]+):\s*(.+?)\s*→\s*(.+?)\s*\(Δ\s*(.+?)\)$/))) {
      current.headers = ["Metric", "Start", "End", "Change"];
      current.rows.push(match.slice(1));
    } else if (current.title === "Phase Timeline" && (match = line.match(/^(Wk\s+\d+)\s*\(([^)]+)\):\s*(.+)$/i))) {
      current.headers = ["Week", "Dates", "Detected Phase"];
      current.rows.push(match.slice(1));
    } else if (current.title === "Intensity by Week" && (match = line.match(/^(Wk\s+\d+):\s*Z1\+Z2\s+(.+?)\s*\|\s*Z3\s+(.+?)\s*\|\s*Z4\+\s+(.+)$/i))) {
      current.headers = ["Week", "Z1–Z2", "Z3", "Z4+"];
      current.rows.push(match.slice(1));
    } else if (["Durability", "Efficiency Factor", "Heart-Rate Recovery"].includes(current.title) && (match = line.match(/^(Wk\s+\d+):\s*(.+?)(?:\s*\((\d+)\s+qualifying\))?$/i))) {
      current.headers = ["Week", current.title === "Durability" ? "Mean Decoupling" : current.title, "Qualifying Sessions"];
      current.rows.push([match[1], match[2], match[3] || "—"]);
    } else if ((match = line.match(/^([^:]{1,100}):\s*(.+)$/)) && current.headers.length === 2 && !["Compliance", "Section 11 Flags", "Phase Progression Check"].includes(current.title)) {
      current.rows.push(match.slice(1));
    } else {
      // Unrecognized structures and caveats remain visible verbatim.
      current.prose.push(line);
    }
  }
  return { summary, sections: sections.filter(s => s.rows.length || s.prose.length) };
}
