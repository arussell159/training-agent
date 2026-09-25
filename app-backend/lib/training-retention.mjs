import { athleteLocalDate } from "./athlete-date.mjs";

function shift(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function twelveWeekStart(now = new Date(), timeZone = "America/Chicago") {
  const today = athleteLocalDate(now, timeZone);
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  return shift(today, -((day + 6) % 7) - 77);
}

// Keep the fast app snapshot bounded. Older completed activities remain in the
// separate archive and calendar weeks can still be fetched from Intervals.icu.
export function retainRecentTrainingContext(context, now = new Date()) {
  const start = twelveWeekStart(now, context.athlete?.time_zone);
  const wellnessStart = shift(start, -29);
  const keepWorkout = (workout) => String(workout?.workout_date || "") >= start;
  const activeIds = new Set(
    [...(context.history || []), ...(context.planned || [])]
      .filter(keepWorkout)
      .map((workout) => String(workout.activity_id || ""))
      .filter(Boolean)
  );
  return {
    ...context,
    history: (context.history || []).filter(keepWorkout),
    planned: (context.planned || []).filter(keepWorkout),
    wellness_history: (context.wellness_history || []).filter(
      (row) => String(row.date || row.id || "") >= wellnessStart
    ),
    performance: (context.performance || []).filter(
      (row) => String(row.workoutDay || row.date || "") >= wellnessStart
    ),
    cached_ranges: (context.cached_ranges || [])
      .filter((range) => range?.end >= start)
      .map((range) => ({ ...range, start: range.start < start ? start : range.start })),
    archived_activity_versions: Object.fromEntries(
      Object.entries(context.archived_activity_versions || {}).filter(([id]) => activeIds.has(id))
    ),
    retention_days: 90,
  };
}
