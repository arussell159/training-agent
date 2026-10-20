import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  cachedTrainingContext,
  scheduleLibraryWorkout,
  trainingCacheScope,
  type PlannedWorkout,
} from "@/lib/training-context"
import { randomId } from "@/lib/random-id"

type Intent = { date: string; creationId: string }
export function LibraryWorkoutSchedule({
  workout,
}: {
  workout: PlannedWorkout
}) {
  const [key] = useState(
    () => `library-schedule-v1:${trainingCacheScope()}:${workout.id}`
  )
  const [recovered] = useState<Intent | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null")
      return value &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
        /^[a-f0-9-]{36}$/i.test(value.creationId)
        ? value
        : null
    } catch {
      return null
    }
  })
  const [date, setDate] = useState(
    () =>
      recovered?.date ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone:
          cachedTrainingContext().athlete.time_zone || "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
  )
  const [creationId, setCreationId] = useState(
    () => recovered?.creationId || randomId()
  )
  const [state, setState] = useState<"ready" | "saving" | "unknown" | "saved">(
    recovered ? "unknown" : "ready"
  )
  const [error, setError] = useState("")
  const inFlight = useRef(false)
  async function schedule() {
    if (inFlight.current) return
    inFlight.current = true
    setError("")
    const recheck = state === "unknown"
    let attempted = false
    try {
      // Retain this exact identity across closing the preview or reloading.
      localStorage.setItem(key, JSON.stringify({ date, creationId }))
      attempted = true
      setState("saving")
      await scheduleLibraryWorkout(workout, date, creationId, recheck)
      try {
        localStorage.removeItem(key)
      } catch {
        /* A verified provider save remains successful. */
      }
      setState("saved")
    } catch (reason) {
      const failure = reason as Error & { status?: number }
      if (!attempted) setState("ready")
      else if (
        state === "ready" &&
        failure.status &&
        failure.status >= 400 &&
        failure.status < 500
      ) {
        try {
          localStorage.removeItem(key)
        } catch {
          /* Retain the same identity if storage is unavailable. */
        }
        setCreationId(randomId())
        setState("ready")
      } else setState("unknown")
      setError(
        failure.message ||
          "Scheduling could not be confirmed. Recheck this same request."
      )
    } finally {
      inFlight.current = false
    }
  }
  return (
    <section
      aria-label="Schedule saved workout"
      className="mx-auto my-4 flex w-full max-w-5xl flex-wrap items-end gap-3 rounded-lg border bg-card p-4 max-md:mt-16"
    >
      <label className="flex flex-col gap-1 text-sm">
        Calendar date
        <input
          aria-label="Schedule workout date"
          type="date"
          required
          disabled={state === "saving" || state === "unknown"}
          value={date}
          onChange={(event) => {
            setDate(event.target.value)
            if (state === "saved") {
              setCreationId(randomId())
              setState("ready")
            }
          }}
          className="h-10 rounded border bg-background px-3"
        />
      </label>
      {state === "saved" ? (
        <>
          <p role="status" className="text-sm">
            Added to your calendar.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setCreationId(randomId())
              setState("ready")
            }}
          >
            Add another
          </Button>
        </>
      ) : (
        <Button
          type="button"
          disabled={state === "saving" || !date}
          onClick={() => void schedule()}
        >
          {state === "saving"
            ? "Saving…"
            : state === "unknown"
              ? "Recheck save"
              : "Add to calendar"}
        </Button>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
