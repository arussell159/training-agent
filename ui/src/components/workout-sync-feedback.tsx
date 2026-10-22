import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { useToastManager } from "@/components/ui/toast"
import { localCommittedWorkout } from "@/lib/workout-commits"
import { WorkoutSyncAction } from "./workout-sync-action"

const WorkoutConflictDialog = lazy(() => import("./workout-conflict-dialog"))

export function WorkoutSyncFeedback() {
  const toast = useToastManager()
  const notices = useRef(new Map<string, string>())
  const completed = useRef(new Map<string, string>())
  const delivered = useRef(new Map<string, string>())
  const [reviewId, setReviewId] = useState<string | null>(null)
  useEffect(() => {
    const review = (event: Event) =>
      setReviewId(
        (event as CustomEvent<{ workoutId: string }>).detail.workoutId
      )
    window.addEventListener("workout-conflict-review", review)
    return () => window.removeEventListener("workout-conflict-review", review)
  }, [])
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          operation: string
          workoutId?: string
          title: string
          state: "pending" | "queued" | "success" | "error"
          error?: string
          description?: string
        }>
      ).detail
      const signature = JSON.stringify([
        detail.state,
        detail.title,
        detail.error,
        detail.description,
      ])
      if (delivered.current.get(detail.operation) === signature) return
      delivered.current.set(detail.operation, signature)
      const value = {
        title: detail.title,
        description:
          detail.state === "pending" || detail.state === "queued" ? (
            detail.description || "Updating Intervals.icu…"
          ) : detail.state === "error" &&
            detail.workoutId &&
            localCommittedWorkout(detail.workoutId) ? (
            <>
              {detail.description || detail.error}{" "}
              <WorkoutSyncAction
                workoutId={detail.workoutId}
                onError={(description) => {
                  toast.add({
                    type: "error",
                    title: "Sync needs attention",
                    description,
                  })
                }}
              />
            </>
          ) : (
            detail.description || detail.error
          ),
        type:
          detail.state === "pending"
            ? "loading"
            : detail.state === "queued"
              ? "info"
              : detail.state,
        timeout:
          detail.state === "pending" ? 0 : detail.state === "error" ? 0 : 3500,
      }
      const id = notices.current.get(detail.operation)
      const previous = detail.workoutId
        ? completed.current.get(detail.workoutId)
        : undefined
      if (previous && previous !== id) toast.close(previous)
      // Upsert through every phase, including queued -> success after a
      // notification was dismissed. One operation never creates a second toast.
      if (id) toast.add({ ...value, id })
      else
        notices.current.set(
          detail.operation,
          toast.add({ ...value, id: `training-write:${detail.operation}` })
        )
      if (detail.state !== "pending") {
        if (detail.workoutId) {
          completed.current.set(
            detail.workoutId,
            notices.current.get(detail.operation)!
          )
          if (completed.current.size > 128)
            completed.current.delete(completed.current.keys().next().value!)
        }
      }
      if (notices.current.size > 128) {
        const oldest = notices.current.keys().next().value!
        notices.current.delete(oldest)
        delivered.current.delete(oldest)
      }
    }
    window.addEventListener("training-write-feedback", update)
    return () => window.removeEventListener("training-write-feedback", update)
  }, [toast])
  return (
    reviewId && (
      <Suspense fallback={null}>
        <WorkoutConflictDialog
          key={reviewId}
          workoutId={reviewId}
          onClose={() => setReviewId(null)}
        />
      </Suspense>
    )
  )
}
