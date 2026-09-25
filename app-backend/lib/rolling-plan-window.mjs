const DAY = 86_400_000;

function shiftMonth(value, months) {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

function weekBoundary(date, dayOfWeek) {
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() + (dayOfWeek - offset) * DAY).toISOString().slice(0, 10);
}

export function rollingPlanWindow(today) {
  const value = String(today).slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())
  ) {
    throw new Error("A valid current date is required for the rolling training plan.");
  }
  return {
    startDate: weekBoundary(shiftMonth(value, -6), 0),
    endDate: weekBoundary(shiftMonth(value, 6), 6),
  };
}
