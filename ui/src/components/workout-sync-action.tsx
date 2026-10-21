import { localCommittedWorkout, retryWorkoutSynchronization } from "@/lib/workout-commits"

export function reviewWorkoutConflict(workoutId: string) {
  window.dispatchEvent(new CustomEvent("workout-conflict-review", { detail: { workoutId } }))
}

/** Recovery stays in the existing status surface; ordinary edits have no extra controls. */
export function WorkoutSyncAction({ workoutId, onError }: { workoutId: string; onError: (message: string) => void }) {
  const conflict = Boolean(localCommittedWorkout(workoutId)?.externalConflict)
  return <button type="button" className="underline" onClick={() => {
    if (conflict) reviewWorkoutConflict(workoutId)
    else void retryWorkoutSynchronization(workoutId).catch(error => onError(error instanceof Error ? error.message : "Synchronization could not be retried."))
  }}>{conflict ? "Review changes" : "Retry sync"}</button>
}
