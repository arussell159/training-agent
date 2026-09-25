export const REPORT_FILTERS = [
  { value: "pre_workout", label: "Pre" },
  { value: "post_workout", label: "Post" },
  { value: "weekly", label: "Weekly" },
  { value: "block", label: "Blocks" },
];

export function filterCoachReports(reports, filter = "all", query = "") {
  const search = String(query).trim().toLowerCase();
  return reports.filter(report =>
    (filter === "all" || report.kind === filter) &&
    (!search || `${report.title} ${report.sport || ""} ${report.startDate} ${report.endDate}`
      .toLowerCase().includes(search))
  );
}

export function reportDisplayTitle(report) {
  if (report.kind === "weekly") return "Weekly Report";
  if (report.kind === "block") return "Block Report";
  return report.title;
}

export function reportPeriodLabel(report) {
  const short = value => {
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
    monday.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const startDate = monday.toISOString().slice(0, 10);
    if (!groups.has(startDate)) {
      const label = new Intl.DateTimeFormat("en-US", {
        month: "short", day: "numeric", timeZone: "UTC",
      }).format(monday);
      groups.set(startDate, { startDate, label: `Week of ${label}`, reports: [] });
    }
    groups.get(startDate).reports.push(report);
  }
  return [...groups.values()]
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map(group => ({
      ...group,
      reports: group.reports.sort((a, b) =>
        b.startDate.localeCompare(a.startDate) ||
        String(b.generatedAt || "").localeCompare(String(a.generatedAt || ""))
      ),
    }));
}
