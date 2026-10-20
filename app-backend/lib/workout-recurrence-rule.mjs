const fail = (message) => {
  throw Object.assign(Error(message), { status: 400, code: "RECURRENCE_INVALID" });
};
const dateNumber = (value) => Date.parse(`${value}T12:00:00Z`);
const day = (value) => new Date(value).toISOString().slice(0, 10);
const validDate = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(dateNumber(value)) ||
    day(dateNumber(value)) !== value
  )
    fail("Choose a valid date.");
};
export function normalizeRecurrenceRule(input) {
  if (!input || typeof input !== "object") fail("Choose a repeat schedule.");
  if (!["daily", "weekly"].includes(input.frequency)) fail("Choose daily or weekly repeats.");
  validDate(input.startDate);
  const interval = Number(input.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 12)
    fail("Repeat intervals must be 1 to 12.");
  if (input.frequency === "weekly" && !Array.isArray(input.weekdays))
    fail("Select at least one weekday.");
  const weekdays = input.frequency === "daily" ? [] : [...new Set(input.weekdays)].sort();
  if (
    input.frequency === "weekly" &&
    (!weekdays.length ||
      weekdays.some((value) => !Number.isInteger(value) || value < 0 || value > 6))
  )
    fail("Select at least one weekday.");
  let end;
  if (input.end?.type === "count") {
    const count = Number(input.end.count);
    if (!Number.isInteger(count) || count < 2 || count > 52) fail("Choose 2 to 52 occurrences.");
    end = { type: "count", count };
  } else if (input.end?.type === "until") {
    validDate(input.end.until);
    if (
      input.end.until < input.startDate ||
      dateNumber(input.end.until) - dateNumber(input.startDate) > 730 * 86400000
    )
      fail("The last date must be within two years of the first date.");
    end = { type: "until", until: input.end.until };
  } else fail("Choose an occurrence count or an end date.");
  return { frequency: input.frequency, interval, weekdays, startDate: input.startDate, end };
}
export function recurrenceDates(input) {
  const rule = normalizeRecurrenceRule(input),
    dates = [];
  const start = dateNumber(rule.startDate),
    firstWeekday = new Date(start).getUTCDay();
  const monday = start - ((firstWeekday + 6) % 7) * 86400000;
  for (let offset = 0; offset <= 730; offset++) {
    const stamp = start + offset * 86400000,
      date = day(stamp);
    if (rule.end.type === "until" && date > rule.end.until) break;
    const selected =
      rule.frequency === "daily"
        ? offset % rule.interval === 0
        : Math.floor((stamp - monday) / (7 * 86400000)) % rule.interval === 0 &&
          rule.weekdays.includes(new Date(stamp).getUTCDay());
    if (!selected) continue;
    dates.push(date);
    if (dates.length > 52)
      fail("This schedule exceeds 52 occurrences. Choose an earlier end date.");
    if (rule.end.type === "count" && dates.length === rule.end.count) break;
  }
  if (dates.length < 2) fail("The schedule must include at least two occurrences.");
  if (rule.end.type === "count" && dates.length !== rule.end.count)
    fail("This schedule extends beyond two years. Reduce its interval or count.");
  return dates;
}
