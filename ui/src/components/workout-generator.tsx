import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
import { calendarAddTypes } from "@/lib/calendar-events"
import { workoutSelection } from "@/lib/workout-presentation"
import { readPendingWorkoutCreation } from "@/lib/pending-workout-creation"
import { trainingCacheScope } from "@/lib/training-context"
import {
  generatorProblem,
  workoutGeneratorClient,
  type WorkoutGeneratorInput,
  type WorkoutGeneratorResult,
} from "@/lib/workout-generator"
import "./workout-generator.css"

const intensityChoices = [
  ["percentOfFtp", "% Functional Threshold Power"],
  ["percentOfMaxHr", "% Max Heart Rate"],
  ["percentOfThresholdHr", "% Threshold Heart Rate"],
  ["percentOfThresholdPace", "% Threshold Pace"],
  ["RPE", "RPE"],
] as const
const generatorSports = calendarAddTypes.filter(
  (type) => type.sport !== "Note" && type.label !== "Sauna"
)

export function WorkoutGenerator({
  date,
  onClose,
  onGenerated,
}: {
  date: string
  onClose: () => void
  onGenerated: (result: WorkoutGeneratorResult) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const currentRequest = useRef<AbortController | null>(null)
  const active = useRef(true)
  const [sport, setSport] = useState("Run")
  const [intensity, setIntensity] =
    useState<WorkoutGeneratorInput["intensity"]>("percentOfFtp")
  const [length, setLength] =
    useState<WorkoutGeneratorInput["length"]>("duration")
  const [target, setTarget] = useState<WorkoutGeneratorInput["target"]>("range")
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const input = {
    date,
    ...workoutSelection(sport),
    intensity,
    length,
    target,
    prompt,
  }
  const problem = generatorProblem(input)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      currentRequest.current?.abort()
    }
  }, [])
  const close = () => {
    active.current = false
    currentRequest.current?.abort()
    onClose()
  }
  const generate = async () => {
    if (currentRequest.current || busy || problem) return
    try {
      if (readPendingWorkoutCreation(localStorage, trainingCacheScope())) {
        setError(
          "Another workout save still needs confirmation. Close this window and reopen Add Workout to recheck that draft before generating another workout."
        )
        return
      }
    } catch {
      /* Blocked storage does not prevent an ordinary generation request. */
    }
    const request = new AbortController()
    currentRequest.current = request
    setBusy(true)
    setError("")
    try {
      const result = await workoutGeneratorClient.generate(
        input,
        request.signal
      )
      if (
        active.current &&
        currentRequest.current === request &&
        !request.signal.aborted
      ) {
        // Another tab may have started a provider save while AI was working.
        // Keep this prompt visible rather than replacing that retained draft.
        try {
          if (readPendingWorkoutCreation(localStorage, trainingCacheScope())) {
            setError(
              "Another workout save now needs confirmation. Your prompt is retained. Recheck that saved draft before generating another workout."
            )
            return
          }
        } catch {
          /* Optional storage may be unavailable. */
        }
        onGenerated(result)
      }
    } catch (reason) {
      if (active.current && !request.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "The workout could not be generated. Your prompt is retained."
        )
    } finally {
      if (currentRequest.current === request) currentRequest.current = null
      if (active.current) setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        ref={root}
        className="workout-generator-dialog"
        showCloseButton={false}
        initialFocus={() =>
          root.current?.querySelector<HTMLSelectElement>(
            '[aria-label="Sport Type"]'
          ) || false
        }
      >
        <header className="wg-header">
          <DialogTitle>Workout Generator</DialogTitle>
          <button
            type="button"
            className="wg-build"
            disabled={busy || Boolean(problem)}
            onClick={() => void generate()}
          >
            {busy ? "Generating workout…" : "Build workout"}
          </button>
          <button
            type="button"
            className="wg-close"
            aria-label="Close workout generator"
            onClick={close}
          >
            <X size={24} />
          </button>
        </header>
        <div className="wg-content" aria-busy={busy}>
          <DialogDescription>
            Transform plain text into a structured workout instantly.
          </DialogDescription>
          {error && (
            <p className="wg-status wg-error" role="alert">
              {error}
            </p>
          )}
          <label className="wg-field">
            <span>Sport Type</span>
            <select
              aria-label="Sport Type"
              disabled={busy}
              value={sport}
              onChange={(event) => {
                setSport(event.target.value)
                setError("")
              }}
            >
              {generatorSports.map((type) => (
                <option
                  key={type.label}
                  value={
                    "variant" in type ? `variant:${type.variant}` : type.sport
                  }
                >
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="wg-field">
            <span>Intensity</span>
            <select
              aria-label="Intensity"
              disabled={busy}
              value={intensity}
              onChange={(event) => {
                setIntensity(
                  event.target.value as WorkoutGeneratorInput["intensity"]
                )
                setError("")
              }}
            >
              {intensityChoices.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="wg-radios" disabled={busy}>
            <legend>Build Intervals By</legend>
            <div className="wg-radio-options">
              {(
                [
                  ["duration", "Duration"],
                  ["distance", "Distance"],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    name="generator-length"
                    type="radio"
                    value={value}
                    checked={length === value}
                    onChange={() => {
                      setLength(value)
                      setError("")
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="wg-radios" disabled={busy}>
            <legend>Block Type</legend>
            <div className="wg-radio-options">
              {(
                [
                  ["range", "Range"],
                  ["target", "Target"],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    name="generator-target"
                    type="radio"
                    value={value}
                    checked={target === value}
                    onChange={() => {
                      setTarget(value)
                      setError("")
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="wg-field wg-prompt">
            <span>Workout Prompt</span>
            <textarea
              aria-label="Workout Prompt"
              aria-describedby="workout-generator-counter"
              disabled={busy}
              value={prompt}
              maxLength={1000}
              placeholder="10 min warm up, 4x 5min hard 1 min rest, 20 min cool down"
              onChange={(event) => {
                setPrompt(event.target.value)
                setError("")
              }}
            />
            <small id="workout-generator-counter">{prompt.length}/1000</small>
          </label>
          {busy && (
            <p className="wg-status" role="status">
              Generating workout…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
