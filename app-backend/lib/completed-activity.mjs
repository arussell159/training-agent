function nested(record, key) {
  const value = record?.[key];
  return value && typeof value === "object" ? value : undefined;
}
function numberValue(value) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
function firstNumber(...values) { return values.map(numberValue).find((value) => value != null); }
export function completedActivityKey(workout) {
  return String(workout?.activity_id ?? workout?.id ?? `${workout?.workout_date}:${workout?.title}:${workout?.sport}`);
}
export function completedActivityValues(workout) {
  const completed = nested(workout, "completed");
  const completedData = nested(workout, "completed_data");
  const summaryCompleted = nested(nested(workout, "workout_summary"), "completed");
  const seconds = firstNumber(completedData?.duration_seconds, completed?.duration_seconds, summaryCompleted?.duration_seconds, workout?.duration_seconds);
  const minutes = firstNumber(workout?.actualDurationMinutes, completedData?.duration_minutes, completed?.duration_minutes, summaryCompleted?.duration_minutes, workout?.duration_minutes);
  return {
    hours: seconds != null ? seconds / 3600 : (minutes ?? 0) / 60,
    distanceMeters: firstNumber(completedData?.distance_meters, completed?.distance_meters, summaryCompleted?.distance_meters, workout?.distance_meters) ?? 0,
    elevationMeters: firstNumber(completedData?.elevation_gain, completed?.elevation_gain, summaryCompleted?.elevation_gain, workout?.elevation_gain) ?? 0,
  };
}
