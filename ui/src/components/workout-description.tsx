import { useEffect, useState } from "react"
import { canEditWorkout } from "@/lib/workout-permissions"
import {
  queueWorkoutMutation,
  cachedTrainingContext,
} from "@/lib/training-context"
import { appWorkoutDescription } from "../../../app-backend/lib/workout-readable-description.mjs"
import type { SportZoneSettings } from "../../../app-backend/lib/workout-editor-zones.mjs"
import type { PlannedWorkout } from "@/lib/training-context"
import { Button } from "@/components/ui/button"
import { ChevronRight, Pencil } from "lucide-react"
export function WorkoutDescription({
  workout,
  title = "Workout instructions",
  mobileCompact = false,
  collapsible = false,
  hideTitle = false,
}: {
  workout: PlannedWorkout
  title?: string
  mobileCompact?: boolean
  collapsible?: boolean
  hideTitle?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const showContent = !collapsible || expanded
  useEffect(() => setExpanded(false), [workout.id])
  const athlete = cachedTrainingContext().athlete as {
    sport_settings?: SportZoneSettings[]
  }
  const sourceDescription =
    appWorkoutDescription(workout, athlete.sport_settings || []) ??
    workout.details ??
    workout.goal ??
    ""
  const original = /swim/i.test(workout.sport) ? sourceDescription.replace(/(\d+(?:\.\d+)?)\s*(?:mtr|meters?|metres?)\b/gi, "$1 yd") : sourceDescription
  const [saved, setSaved] = useState(original),
    [draft, setDraft] = useState(original),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  useEffect(() => {
    setSaved(original)
    setDraft(original)
    setEditing(false)
    setError("")
  }, [workout.id, original])
  const save = async () => {
    setBusy(true)
    setError("")
    try {
      await queueWorkoutMutation({
        type: "description",
        id: workout.id,
        description: draft,
      })
      setSaved(draft)
      setEditing(false)
      window.dispatchEvent(
        new CustomEvent("workout-description-updated", {
          detail: { id: workout.id, description: draft },
        })
      )
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Description could not be saved"
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className={`w-full min-w-0 ${mobileCompact && !collapsible ? "space-y-0" : "space-y-2"}`}
      aria-label="Workout description"
    >
      <div className={`relative flex w-full min-w-0 items-center ${hideTitle ? "h-0 justify-end" : mobileCompact && !collapsible ? "min-h-0" : "min-h-8 px-1"}`}>
        {!hideTitle && <h3
          className={
            collapsible
              ? "min-w-0 whitespace-nowrap pr-10 text-sm text-muted-foreground"
              : mobileCompact
              ? "min-w-0 whitespace-nowrap pr-10 text-[11px] leading-4 text-muted-foreground"
              : "min-w-0 whitespace-nowrap pr-10 text-sm font-semibold"
          }
        >
          {collapsible ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="flex items-center gap-1.5 text-left"
            >
              <ChevronRight
                className={`size-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
              />
              {title}
            </button>
          ) : (
            title
          )}
        </h3>}
        {showContent && !editing && canEditWorkout(workout) && (
          <button
            type="button"
            className={`absolute ${hideTitle ? "top-0 translate-y-0" : "top-1/2 -translate-y-1/2"} right-0 flex shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${mobileCompact ? "size-8" : "h-8 gap-1 px-2.5 text-sm"}`}
            style={mobileCompact ? { width: 32, minWidth: 32, maxWidth: 32, height: 32 } : undefined}
            onClick={() => {
              setDraft(saved)
              setEditing(true)
            }}
            aria-label="Edit workout details"
          >
            <Pencil className="size-3.5" />
            {mobileCompact ? <span className="sr-only">Edit</span> : "Edit"}
          </button>
        )}
      </div>
      <div hidden={!showContent} className="space-y-3">
        {editing ? (
          <>
            <textarea
              aria-label="Workout description"
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              className="mobile-workout-description-chatgpt-type box-border min-h-[22rem] w-full max-w-full resize-y rounded-xl border bg-background p-3 text-base leading-6 tracking-normal md:min-h-64 md:text-sm md:leading-6"
            />
            <div className="grid w-full min-w-0 grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-10 w-full rounded-full"
                disabled={busy}
                onClick={() => {
                  setDraft(saved)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                className="h-10 w-full min-w-0 rounded-full"
                disabled={busy || draft === saved}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save to Intervals.icu"}
              </Button>
            </div>
          </>
        ) : (
          <p
            className={`mobile-workout-description-chatgpt-type whitespace-pre-wrap text-foreground ${hideTitle ? "pr-10" : ""} ${mobileCompact ? "text-sm leading-5" : "text-[1.0625rem] leading-7 md:text-sm md:leading-6"}`}
          >
            {saved}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
