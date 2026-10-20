import { useEffect, useRef } from "react"
import { useToastManager } from "@/components/ui/toast"

export function WorkoutSyncFeedback() {
  const toast = useToastManager()
  const notices = useRef(new Map<string, string>())
  const completed = useRef(new Map<string,string>())
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
      const value = {
        title: detail.title,
        description:
          detail.state === "pending" || detail.state === "queued"
            ? "Updating Intervals.icu…"
            : detail.description || detail.error,
        type:
          detail.state === "pending"
            ? "loading"
            : detail.state === "queued"
              ? "info"
              : detail.state,
        timeout:
          detail.state === "pending"
            ? 0
            : detail.state === "error"
              ? 9000
              : 3500,
      }
      const id = notices.current.get(detail.operation)
      const previous=detail.workoutId?completed.current.get(detail.workoutId):undefined
      if(previous && previous!==id)toast.close(previous)
      if (id) toast.update(id, value)
      else notices.current.set(detail.operation, toast.add(value))
      if (detail.state !== "pending") {
        if(detail.workoutId){
          completed.current.set(detail.workoutId,notices.current.get(detail.operation)!)
          if(completed.current.size>128)completed.current.delete(completed.current.keys().next().value!)
        }
        notices.current.delete(detail.operation)
      }
    }
    window.addEventListener("training-write-feedback", update)
    return () => window.removeEventListener("training-write-feedback", update)
  }, [toast])
  return null
}
