import { useEffect, useState } from "react"
import {
  cachedTrainingContext,
  rememberWorkoutForEditing,
  type PlannedWorkout,
} from "@/lib/training-context"

export function useEditedWorkout<T extends PlannedWorkout | null>(
  initial: T
): T {
  const [updated, setUpdated] = useState<PlannedWorkout | null>(null)
  useEffect(() => {
    if (initial) rememberWorkoutForEditing(initial)
    const listener = (event: Event) => {
      const workout = (event as CustomEvent<PlannedWorkout>).detail
      if (workout.id === initial?.id) setUpdated(workout)
    }
    const refresh = () => {
      const context = cachedTrainingContext()
      const workout = [...context.planned, ...context.history].find(
        (item): item is PlannedWorkout =>
          "id" in item && item.id === initial?.id
      )
      setUpdated(workout || null)
    }
    window.addEventListener("workout-editor-saved", listener)
    window.addEventListener("training-context-updated", refresh)
    // This dialog may have been closed while its save completed. Reconcile
    // immediately on reopen instead of retaining an old "Syncing" snapshot.
    refresh()
    return () => {
      window.removeEventListener("workout-editor-saved", listener)
      window.removeEventListener("training-context-updated", refresh)
    }
  }, [initial])
  return (updated?.id === initial?.id ? updated : initial) as T
}
