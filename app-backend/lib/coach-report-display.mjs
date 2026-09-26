export const REPORT_FILTERS = [
  { value: "pre_workout", label: "Pre" },
  { value: "post_workout", label: "Post" },
  { value: "weekly", label: "Weekly" },
  { value: "others", label: "Others" },
];

const workoutReportKinds = new Set(["pre_workout", "post_workout", "weekly"]);
const otherReportLabels = {
  season: "Season Reports",
  block: "Block Reports",
  nutrition: "Nutrition Reports",
};

export function filterCoachReports(reports, filter = "all", query = "") {
  const search = String(query).trim().toLowerCase();
  return reports.filter(
    (report) =>
      (filter === "all" ||
        (filter === "others" ? !workoutReportKinds.has(report.kind) : report.kind === filter)) &&
      (!search ||
        `${report.title} ${report.sport || ""} ${report.startDate} ${report.endDate}`
          .toLowerCase()
          .includes(search))
  );
}

export function reportDisplayTitle(report) {
  if (report.kind === "weekly") return "Weekly Report";
  if (report.kind === "block") return "Block Report";
  if (report.kind === "season") return "Season Report";
  if (report.kind === "nutrition") return "Nutrition Report";
  return report.title;
}

export function groupOtherReportsByType(reports) {
  const groups = new Map();
  for (const report of reports) {
    const kind = String(report.kind || "other");
    const label =
      otherReportLabels[kind] ||
      `${kind.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())} Reports`;
    if (!groups.has(kind)) groups.set(kind, { kind, label, reports: [] });
    groups.get(kind).reports.push(report);
  }
  const order = ["season", "block", "nutrition"];
  return [...groups.values()]
    .sort((a, b) => {
      const aOrder = order.indexOf(a.kind),
        bOrder = order.indexOf(b.kind);
      if (aOrder >= 0 || bOrder >= 0)
        return (aOrder < 0 ? order.length : aOrder) - (bOrder < 0 ? order.length : bOrder);
      return a.label.localeCompare(b.label);
    })
    .map((group) => ({
      ...group,
      startDate: group.kind,
      reports: group.reports.sort(
        (a, b) =>
          String(b.startDate || "").localeCompare(String(a.startDate || "")) ||
          String(b.generatedAt || "").localeCompare(String(a.generatedAt || ""))
      ),
    }));
}

export function reportPeriodLabel(report) {
  const short = (value) => {
    const [year, month, day] = String(value || "").split("-");
    return year && month && day ? `${month}/${day}/${year.slice(-2)}` : "";
  };
  if (report.kind === "pre_workout" || report.kind === "post_workout")
    return short(report.startDate);
  return `${short(report.startDate)} to ${short(report.endDate)}`;
}

export function groupWorkoutReportsByWeek(reports) {
  const groups = new Map();
  for (const report of reports) {
    const date = new Date(`${report.startDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) continue;
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const startDate = monday.toISOString().slice(0, 10);
    if (!groups.has(startDate)) {
      const label = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(monday);
      groups.set(startDate, { startDate, label: `Week of ${label}`, reports: [] });
    }
    groups.get(startDate).reports.push(report);
  }
  return [...groups.values()]
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((group) => ({
      ...group,
      reports: group.reports.sort(
        (a, b) =>
          b.startDate.localeCompare(a.startDate) ||
          String(b.generatedAt || "").localeCompare(String(a.generatedAt || ""))
      ),
    }));
}

export function groupWeeklyReportsByMonth(reports) {
  const groups = new Map();
  for (const report of reports) {
    const date = new Date(`${report.startDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) continue;
    const startDate = date.toISOString().slice(0, 7) + "-01";
    if (!groups.has(startDate)) {
      const label = new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
      groups.set(startDate, { startDate, label, reports: [] });
    }
    groups.get(startDate).reports.push(report);
  }
  return [...groups.values()]
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((group) => ({
      ...group,
      reports: group.reports.sort(
        (a, b) =>
          String(b.startDate || "").localeCompare(String(a.startDate || "")) ||
          String(b.generatedAt || "").localeCompare(String(a.generatedAt || ""))
      ),
    }));
}
