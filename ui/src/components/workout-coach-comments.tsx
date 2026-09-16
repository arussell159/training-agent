import { useCallback, useEffect, useRef, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { StaticMarkdownText } from "@/components/markdown-text"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"
import type { PlannedWorkout } from "@/lib/training-context"

export function WorkoutCoachComments({ workout }: { workout: PlannedWorkout }) {
  const [coachComment, setCoachComment] = useState<{
    body: string
    created_at: string
  } | null>(null)
  const coachCommentRef = useRef<{ body: string; created_at: string } | null>(
    null
  )
  const [coachBusy, setCoachBusy] = useState(false)
  const [coachHydrating, setCoachHydrating] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)
  const requestCoachInput = useCallback(
    async (refresh = false) => {
      setCoachBusy(true)
      setCoachError(null)
      const controller = new AbortController()
      // The server may spend up to 35 seconds gathering coach context before it
      // persists the comment. Keep the browser request alive long enough to
      // receive that durable result instead of reporting a false timeout.
      const timeout = window.setTimeout(() => controller.abort(), 75_000)
      try {
        const response = await apiFetch(
          `/api/workouts/${encodeURIComponent(workout.id)}/coach-input`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh }),
            signal: controller.signal,
          }
        )
        const data = (await response.json()) as {
          comment?: { body: string; created_at: string }
          error?: string
        }
        if (!response.ok || !data.comment)
          throw Error(data.error || "Coach input is unavailable.")
        coachCommentRef.current = data.comment
        setCoachComment(data.comment)
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError" &&
          coachCommentRef.current
        )
          setCoachError(null)
        else
          setCoachError(
            error instanceof DOMException && error.name === "AbortError"
              ? "Coach input timed out. Please try again."
              : error instanceof Error
                ? error.message
                : "Coach input is unavailable."
          )
      } finally {
        window.clearTimeout(timeout)
        setCoachBusy(false)
      }
    },
    [workout.id]
  )
  const loadCoachInput = useCallback(async () => {
    setCoachHydrating(true)
    setCoachError(null)
    try {
      const response = await apiFetch(
        `/api/workouts/${encodeURIComponent(workout.id)}/coach-input`
      )
      const data = (await response.json()) as {
        comment?: { body: string; created_at: string } | null
        error?: string
      }
      if (!response.ok)
        throw Error(data.error || "Saved coach input is unavailable.")
      if (data.comment) {
        coachCommentRef.current = data.comment
        setCoachComment(data.comment)
      }
    } catch (error) {
      setCoachError(
        error instanceof Error
          ? error.message
          : "Saved coach input is unavailable."
      )
    } finally {
      setCoachHydrating(false)
    }
  }, [workout.id])
  useEffect(() => {
    coachCommentRef.current = null
    setCoachComment(null)
    setCoachError(null)
    if (workout.status === "completed") void requestCoachInput(false)
    else void loadCoachInput()
  }, [
    loadCoachInput,
    requestCoachInput,
    workout.status,
    workout.source_updated_at,
  ])
  const plannedRecommendationSaved =
    workout.status !== "completed" && Boolean(coachComment)
  return (
    <section
      aria-label="Coach comments"
      className="border-y bg-card px-1 py-3 md:rounded-lg md:border md:px-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Coach input</h2>
        {plannedRecommendationSaved ? (
          <span className="text-xs font-medium text-muted-foreground">
            Recommendation saved
          </span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-md px-3"
            disabled={coachBusy || coachHydrating}
            onClick={() =>
              void requestCoachInput(
                workout.status === "completed" && Boolean(coachComment)
              )
            }
          >
            {(coachBusy || coachHydrating) && (
              <LoaderCircle className="size-3.5 animate-spin" />
            )}
            {coachHydrating
              ? "Loading…"
              : coachBusy
                ? "Reviewing…"
                : coachComment
                  ? "Review again"
                  : "Get coach input"}
          </Button>
        )}
      </div>
      {coachBusy && !coachComment && (
        <p className="mt-2 text-xs text-muted-foreground">
          Reviewing this workout with your current training context…
        </p>
      )}
      {coachComment && (
        <div className="mt-3 border-t pt-3">
          <StaticMarkdownText className="text-sm leading-6">
            {coachComment.body}
          </StaticMarkdownText>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Updated {new Date(coachComment.created_at).toLocaleString()}
          </p>
        </div>
      )}
      {coachError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {coachError}
        </p>
      )}
    </section>
  )
}
