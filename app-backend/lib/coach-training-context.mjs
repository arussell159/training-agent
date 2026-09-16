export function athleteLocalDate(now, timeZone = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function coachTrainingContext(context, currentDate) {
  const shift = (days) => {
    const date = new Date(`${currentDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const historyStart = shift(-8);
  const tomorrow = shift(1);
  const history = context.history || context.workouts || [];
  const planned = context.planned || [];
  const workouts = new Map(
    [...history, ...planned].map((workout, index) => [
      String(workout.id || `${workout.workout_date}:${index}`),
      workout,
    ])
  );
  return {
    current_date: currentDate,
    athlete: context.athlete,
    today_workouts: [...workouts.values()].filter(
      (workout) => String(workout.workout_date || "").slice(0, 10) === currentDate
    ),
    metrics: context.metrics,
    wellness: context.wellness,
    tomorrow_workouts: planned.filter(
      (workout) => String(workout.workout_date || "").slice(0, 10) === tomorrow
    ),
    recent_training_history: history.filter(
      (workout) => workout.workout_date >= historyStart && workout.workout_date < currentDate
    ),
    history_window: { start: historyStart, end: shift(-1) },
    performance_history: (context.performance || []).filter((day) => {
      const date = String(day.workoutDay || day.date || "").slice(0, 10);
      return date >= historyStart && date <= currentDate;
    }),
    athlete_comments: context.comments || [],
    data_source: context.source,
    synced_at: context.synced_at,
    sync_error: context.sync_error || null,
  };
}
