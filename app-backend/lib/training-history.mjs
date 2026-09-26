import { athleteLocalDate } from "./athlete-date.mjs";
import { completedActivityKey, completedActivityValues } from "./completed-activity.mjs";
import { twelveWeekStart } from "./training-retention.mjs";

function weekStart(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function sportFor(workout) {
  const sport = String(workout.sport || workout.type || workout.activity_type || "").toLowerCase();
  if (sport.includes("run")) return "run";
  if (/ride|bike|cycl/.test(sport)) return "bike";
  if (sport.includes("swim")) return "swim";
  return null;
}

function emptyTotals() {
  return { hours: 0, distanceMeters: 0, elevationMeters: 0 };
}

export function buildTwelveWeekTrainingHistory(context, now = new Date()) {
  const zone = context.athlete?.time_zone || "America/Chicago";
  const start = twelveWeekStart(now, zone);
  const today = athleteLocalDate(now, zone);
  const weeks = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(`${start}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index * 7);
    return {
      week: date.toISOString().slice(0, 10),
      all: emptyTotals(),
      run: emptyTotals(),
      bike: emptyTotals(),
      swim: emptyTotals(),
    };
  });
  const byWeek = new Map(weeks.map((row) => [row.week, row]));
  const activities = new Map();
  for (const workout of context.history || []) {
    const day = String(workout.workout_date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < start || day > today) continue;
    const key = completedActivityKey(workout);
    const values = completedActivityValues(workout);
    if (values.hours <= 0) continue;
    const previous = activities.get(key);
    if (!previous || values.hours > previous.values.hours) activities.set(key, { workout, values });
  }
  for (const { workout, values } of activities.values()) {
    const row = byWeek.get(weekStart(workout.workout_date));
    if (!row) continue;
    for (const totals of [row.all, row[sportFor(workout)]].filter(Boolean)) {
      totals.hours += values.hours;
      totals.distanceMeters += values.distanceMeters;
      totals.elevationMeters += values.elevationMeters;
    }
  }
  return weeks;
}
