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
}: {
  workout: PlannedWorkout
  title?: string
  mobileCompact?: boolean
  collapsible?: boolean
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
      className={`w-full min-w-0 ${mobileCompact ? "space-y-2" : "space-y-3"}`}
      aria-label="Workout description"
    >
      <div className="relative flex min-h-8 w-full min-w-0 items-center">
        <h3
          className={
            mobileCompact
              ? "min-w-0 whitespace-nowrap pr-10 text-base font-bold"
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
        </h3>
        {showContent && !editing && canEditWorkout(workout) && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-1/2 right-0 size-8 -translate-y-1/2 p-0"
            onClick={() => {
              setDraft(saved)
              setEditing(true)
            }}
            aria-label="Edit workout details"
          >
            <Pencil className="size-3.5" />
            {mobileCompact ? <span className="sr-only">Edit</span> : "Edit"}
          </Button>
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
              className="box-border min-h-[22rem] w-full max-w-full resize-y rounded-xl border bg-background p-3 text-[1.0625rem] leading-7 md:min-h-64 md:text-sm md:leading-6"
            />
            <div className="grid w-full min-w-0 grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDraft(saved)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="min-w-0 w-full"
                disabled={busy || draft === saved}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save to Intervals.icu"}
              </Button>
            </div>
          </>
        ) : (
          <p
            className={`whitespace-pre-wrap text-foreground ${mobileCompact ? "text-sm leading-5" : "text-[1.0625rem] leading-7 md:text-sm md:leading-6"}`}
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
