const KNOWN_SECTIONS = new Map([
  ["TRAINING LOAD", "Training Load"],
  ["SPORT LOAD", "Sport Load"],
  ["INTENSITY DISTRIBUTION", "Intensity Distribution"],
  ["RECOVERY / DURABILITY", "Recovery & Durability"],
  ["BODY / SUBJECTIVE", "Body & Subjective"],
  ["COACH SUMMARY", "Coach Summary"],
]);

const WRAPPER = /\[\[\/?SECTION11_REPORT:[^\]]+\]\]/gi;

function humanTitle(value) {
  return value
    .toLowerCase()
    .replace(/(^|\s|\/)\p{L}/gu, (letter) => letter.toUpperCase())
    .replace(" / ", " & ");
}

export function parseWeeklyReportPresentation(text) {
  const lines = String(text || "")
    .replace(WRAPPER, "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const titleIndex = lines.findIndex((line) => /SECTION\s+11\s+WEEKLY\s+REPORT/i.test(line));
  const title = titleIndex >= 0 ? lines[titleIndex] : "";
  const dates = title.match(/(\d{4}-\d{2}-\d{2})\s+(?:to|–|—)\s+(\d{4}-\d{2}-\d{2})/i);
  const sections = [];
  let current = null;

  for (const line of lines.slice(titleIndex >= 0 ? titleIndex + 1 : 0)) {
    if (!line) continue;
    const known = KNOWN_SECTIONS.get(line.toUpperCase());
    const heading =
      known || (/^[A-Z][A-Z0-9 /&+()-]{2,}$/.test(line) && !line.includes(":"))
        ? known || humanTitle(line)
        : null;
    if (heading) {
      current = { title: heading, entries: [], prose: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    if (current.title === "Coach Summary") {
      current.prose.push(line);
      continue;
    }
    const field = line.match(/^([^:]{1,120}):\s*(.*)$/);
    if (field) current.entries.push({ label: field[1].trim(), value: field[2].trim() });
    else current.prose.push(line);
  }

  return {
    heading: "SECTION 11 — WEEKLY REPORT",
    startDate: dates?.[1] || null,
    endDate: dates?.[2] || null,
    summary: sections.find((section) => section.title === "Coach Summary")?.prose || [],
    sections: sections.filter((section) => section.title !== "Coach Summary"),
  };
}
