import { useMemo } from "react"
import { calendarProfilePath } from "@/lib/calendar-profile"
import type { PlannedWorkout } from "@/lib/training-context"

export function CalendarWorkoutProfile({
  workout,
}: {
  workout: PlannedWorkout
}) {
  const path = useMemo(() => calendarProfilePath(workout), [workout])
  if (!path) return null
  return (
    <svg
      className="calendar-workout-profile-chart"
      role="img"
      aria-label="Intervals.icu workout profile"
      viewBox="0 0 1000 20"
      preserveAspectRatio="none"
    >
      <title>Workout interval profile. Open the workout for details.</title>
      <path d={path} fill="currentColor" />
    </svg>
  )
}
