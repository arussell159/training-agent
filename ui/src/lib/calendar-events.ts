import type { PlannedWorkout } from "./training-context"

export const calendarAddTypes = [
  { label: "Swim", sport: "Swim" },
  { label: "Bike", sport: "Ride" },
  { label: "Run", sport: "Run" },
  { label: "Sauna", sport: "Other" },
  { label: "Strength", sport: "WeightTraining" },
  { label: "Note", sport: "Note" },
] as const

export function isCalendarNote(workout: PlannedWorkout) {
  return workout.category === "NOTE"
}

export function notesFirst<T extends { category?: string }>(events: T[]) {
  return [...events].sort(
    (a, b) => Number(b.category === "NOTE") - Number(a.category === "NOTE")
  )
}
