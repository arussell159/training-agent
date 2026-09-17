export function validReportDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function shiftReportDate(value, days) {
  return new Date(Date.parse(value) + days * 86400000).toISOString().slice(0, 10);
}
export function planReportBlocks(plan) {
  const blocks = [];
  const weeks = (plan?.weeks || []).filter(
    (w) => validReportDate(w.startDate) && validReportDate(w.endDate)
  );
  for (const week of [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const previous = blocks.at(-1);
    if (
      previous &&
      previous.phase === week.phase &&
      shiftReportDate(previous.endDate, 1) === week.startDate
    ) {
      previous.endDate = week.endDate;
      previous.weeks.push(week);
    } else
      blocks.push({
        startDate: week.startDate,
        endDate: week.endDate,
        phase: week.phase,
        weeks: [week],
      });
  }
  return blocks.filter((b) => b.phase && b.phase !== "Not Set");
}
