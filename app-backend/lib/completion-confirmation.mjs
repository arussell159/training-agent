export function applyCompletionConfirmation(context, confirmation) {
  const through = confirmation?.through;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through || "")) return context;
  const mark = (w) =>
    w.status === "completed" && w.workout_date && w.workout_date <= through
      ? { ...w, completion_grade: "good", completion_grade_source: "athlete-confirmed" }
      : w;
  return {
    ...context,
    history: (context.history || []).map(mark),
    planned: (context.planned || []).map(mark),
    workouts: (context.workouts || context.history || []).map(mark),
  };
}
