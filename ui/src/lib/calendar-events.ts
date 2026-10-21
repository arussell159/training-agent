import type { PlannedWorkout } from "./training-context"

export const calendarAddTypes = [
  { label: "Run", sport: "Run" },
  { label: "Bike", sport: "Ride" },
  { label: "Swim", sport: "Swim" },
  { label: "Brick", sport: "Other", variant: "brick" },
  { label: "Crosstrain", sport: "Workout" },
  { label: "Day off", sport: "Other", variant: "day-off" },
  { label: "Mtn Bike", sport: "MountainBikeRide" },
  { label: "Strength", sport: "WeightTraining" },
  { label: "Custom", sport: "Other", variant: "custom" },
  { label: "XC-Ski", sport: "NordicSki" },
  { label: "Rowing", sport: "Rowing" },
  { label: "Walk", sport: "Walk" },
  { label: "Other", sport: "Other" },
  { label: "Sauna", sport: "Other" },
  { label: "Note", sport: "Note" },
] as const

export function calendarSportType(sport: string) {
  return calendarAddTypes.find((type) => type.label === sport)?.sport || sport
}

export function calendarSportLabel(sport: string) {
  return (
    calendarAddTypes.find(
      (type) => type.sport === sport && !("variant" in type)
    )?.label || sport
  )
}

export function isCalendarNote(workout: PlannedWorkout) {
  return workout.category === "NOTE" && !workout.calendar_event_key
}

export function notesFirst<
  T extends { category?: string; calendar_event_key?: string },
>(events: T[]) {
  return [...events].sort(
    (a, b) =>
      Number(b.category === "NOTE" && !b.calendar_event_key) -
      Number(a.category === "NOTE" && !a.calendar_event_key)
  )
}
