import type { WorkoutSummaryValues } from "./training-context"
import { changedPlannedValues, plannedValueDraft, type PlannedValueDraft, type PlannedValueKey } from "./planned-workout-values.ts"

// Unlike historical planned swims, completed Intervals measurements are SI.
const swim = (sport: string) => /swim/i.test(sport)
export const editableCompletedValue = (key: PlannedValueKey) =>
  ["duration_seconds", "distance_meters", "tss", "calories", "elevation_gain"].includes(key)

export function completedValueDraft(values: WorkoutSummaryValues | null | undefined, sport: string) {
  const presentation = { ...values }
  if (swim(sport)) {
    for (const key of ["distance_meters", "average_speed"] as const)
      if (presentation[key] != null) presentation[key] = presentation[key]! / 0.9144
  }
  return plannedValueDraft(presentation, sport)
}

export function changedCompletedValues(draft: PlannedValueDraft, saved: PlannedValueDraft, sport: string) {
  const patch = changedPlannedValues(draft, saved, sport)
  for (const key of Object.keys(patch) as PlannedValueKey[]) {
    if (!editableCompletedValue(key)) throw Error("This value is calculated from the recorded activity.")
    if ((key === "duration_seconds" || key === "distance_meters") && patch[key] === null)
      throw Error(`Enter a completed ${key === "duration_seconds" ? "duration" : "distance"}; use zero for no distance.`)
    if (swim(sport) && key === "distance_meters" && patch[key] != null) patch[key] = patch[key]! * 0.9144
  }
  return patch
}
