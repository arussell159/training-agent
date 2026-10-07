import type { PlannedWorkout } from "@/lib/training-context"
import { validatedTrainingWorkout } from "./training-context-validation.ts"

const STORAGE_KEY = "training-agent-open-workout-v1"

export function workoutRouteId() {
  const value = new URLSearchParams(window.location.search).get("workout")
  // Older pasted links accidentally appended an unexpanded Intervals template.
  // Recover only an unambiguous existing activity ID, never arbitrary templates.
  return value?.replace(/^(activity:i\d+)\$external_id\$$/, "$1") || null
}

export function restoreOpenWorkout(candidates: unknown[] = []) {
  const id = workoutRouteId()
  if (!id) return null
  const current = candidates.find((workout): workout is PlannedWorkout =>
    Boolean(
      workout &&
      typeof workout === "object" &&
      "id" in workout &&
      (workout as { id?: unknown }).id === id
    )
  )
  if (current) {
    try {
      return validatedTrainingWorkout(current)
    } catch {
      /* Try the saved snapshot next. */
    }
  }
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(STORAGE_KEY) || "null"
    ) as PlannedWorkout | null
    return saved?.id === id ? validatedTrainingWorkout(saved) : null
  } catch {
    return null
  }
}

export function rememberOpenWorkout(workout: PlannedWorkout) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(workout))
  } catch {
    /* URL restoration still works from loaded context. */
  }
  const url = new URL(window.location.href)
  url.searchParams.set("workout", workout.id)
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`)
}

export function forgetOpenWorkout() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* Session storage is optional. */
  }
  const url = new URL(window.location.href)
  url.searchParams.delete("workout")
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
}
