export function parseWorkoutReport(text, kind) {
  const groups = [];
  const section = (title) => {
    let s = groups.find((s) => s.title === title);
    if (!s) groups.push((s = { title, rows: [], prose: [] }));
    return s;
  };
  let current = section(kind === "pre" ? "Readiness" : "Primary Session");
  const verdict = [];
  for (const raw of String(text || "")
    .replace(/\[\[\/?SECTION11_REPORT:[^\]]+\]\]/gi, "")
    .split(/\r?\n/)) {
    const line = raw
      .trim()
      .replace(/^#{1,6}\s+/, "")
      .replace(/\*\*/g, "");
    if (
      !line ||
      /^(?:SECTION\s+11\s*[—-]?\s*)?(?:PRE|POST)[ -]WORKOUT REPORT\b/i.test(line) ||
      /^```/.test(line)
    )
      continue;
    const field = line.match(/^([^:]{1,110}):\s*(.*)$/);
    const label = field?.[1] || "",
      value = field?.[2] || "";
    if (/^Data(?:\s|\()/i.test(line)) {
      section("Source").prose.push(line);
      continue;
    }
    if (/^(Interpretation|Overall|Coach Note|Execution Guidance)$/i.test(label) && value) {
      current = section(kind === "pre" ? "Execution Guidance" : "Coach Note");
      current.prose.push(value);
      if (kind === "post" && /^Overall$/i.test(label)) verdict.push(["Session Result", value]);
      continue;
    }
    if (kind === "post" && /^Completed workout$/i.test(label)) {
      current = { title: value, rows: [], prose: [] };
      groups.push(current);
      continue;
    }
    if (/^(Recommendation|Decision Level|Priority|Session Result|Verdict)$/i.test(label)) {
      verdict.push([label, value]);
      continue;
    }
    if (/^(Interpretation|Overall|Coach Note|Execution Guidance):?$/i.test(line)) {
      current = section(kind === "pre" ? "Execution Guidance" : "Coach Note");
      continue;
    }
    if (
      /^(?:Current Status Summary|Weekly totals \(rolling 7d\)|Rolling.*|Last 7 Days|Recent Training):?$/i.test(
        line
      )
    ) {
      current = section(kind === "pre" ? "Load Context" : "Rolling 7-Day Context");
      continue;
    }
    if (/^Planned Workouts for Today/i.test(line)) {
      current = section("Today's Workout");
      current.prose.push(line);
      continue;
    }
    if (/^(Tomorrow|Next session|Next Up)$/i.test(label)) {
      section("Next Up").prose.push(value);
      continue;
    }
    if ((field && !value) || /^[A-Z][A-Z /&—-]{3,}$/.test(line)) {
      // Repeated activity headings intentionally create separate sections.
      current = { title: label || line, rows: [], prose: [] };
      groups.push(current);
      continue;
    }
    if (
      kind === "post" &&
      current.title === "Primary Session" &&
      !/^#{1,6}/.test(raw.trim()) &&
      !/^(Outdoor context|Start time|Duration|Distance|Power|IF|HR|TSS|Calories|Cadence)$/i.test(
        label
      )
    ) {
      verdict.push(["Session Result", line]);
      continue;
    }
    if (
      kind === "pre" &&
      field &&
      !["Today's Workout", "Execution Guidance"].includes(current.title)
    ) {
      const title = /^(HRV|RHR|Resting HR|Sleep|Sleep Quality|Recovery Index)$/i.test(label)
        ? "Readiness"
        : /last 7 days/i.test(label)
          ? "Recent Training"
          : /^(Polarization|TID|Grey Zone|Quality)/i.test(label)
            ? "Intensity Distribution"
            : /^(Durability|EF|HRRc)/i.test(label)
              ? "Durability & Efficiency"
              : "Load Context";
      section(title).rows.push([label, value]);
    } else if (field && !["Coach Note", "Execution Guidance"].includes(current.title))
      current.rows.push([label, value]);
    else current.prose.push(line);
  }
  const sections = groups.filter((s) => s.rows.length || s.prose.length);
  for (const group of sections) {
    group.headers = ["Metric", "Result"];
    group.tables = [];
    group.rows = group.rows.filter(([label, value]) => {
      if (!/^(HR zones|Power zones)$/i.test(label)) return true;
      const parts = value
        .split(/,\s*/)
        .map((part) => part.match(/^(\d+(?:\.\d+)?%)\s+(Zone\s+\d+)$/i));
      if (!parts.length || parts.some((part) => !part)) return true;
      group.tables.push({
        title: label === "HR zones" ? "Heart Rate Distribution" : "Power Distribution",
        headers: ["Zone", "Time"],
        rows: parts.map((part) => [part[2], part[1]]),
      });
      return false;
    });
    if (group.title === "Readiness") {
      group.headers = ["Metric", "Current", "Baseline / Context"];
      group.rows = group.rows.map(([label, value]) => {
        const parts = value.match(
          /^(.*?)\s*\((.*(?:baseline|yesterday|prior.day|average|avg).*)\)$/i
        );
        return parts ? [label, parts[1], parts[2]] : [label, value, "—"];
      });
    } else if (
      kind === "post" &&
      group.rows.some(([, value]) => /\(planned\s+[^)]+\)/i.test(value))
    ) {
      group.headers = ["Metric", "Actual", "Planned"];
      group.rows = group.rows.map(([label, value]) => {
        const parts = value.match(/^(.*?)\s*\(planned\s+([^)]+)\)(.*)$/i);
        return parts ? [label, (parts[1] + parts[3]).trim(), parts[2]] : [label, value, "—"];
      });
    }
  }
  if (kind === "pre") {
    const order = [
      "Readiness",
      "Load Context",
      "Recent Training",
      "Intensity Distribution",
      "Durability & Efficiency",
      "Today's Workout",
      "Execution Guidance",
    ];
    sections.sort(
      (a, b) =>
        (order.includes(a.title) ? order.indexOf(a.title) : order.length) -
        (order.includes(b.title) ? order.indexOf(b.title) : order.length)
    );
  }
  sections.sort((a, b) => Number(a.title === "Source") - Number(b.title === "Source"));
  return { verdict, sections };
}
