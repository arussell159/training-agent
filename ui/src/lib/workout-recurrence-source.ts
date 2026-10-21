/** Recurrence endpoints require the linked numeric provider event identity. */
export function recurrenceProviderSource(workoutId?: string, providerWorkoutId?: string): string | undefined {
  if (/^event:[1-9]\d*$/.test(workoutId || "")) return workoutId
  return /^app:[0-9a-f-]+$/i.test(workoutId || "") && /^event:[1-9]\d*$/.test(providerWorkoutId || "") ? providerWorkoutId : undefined
}
