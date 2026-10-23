import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react"
import { Dumbbell, History, Paperclip, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
import {
  cachedActivitySummary,
  loadActivitySummary,
} from "../lib/activity-analysis"
import {
  projectStrengthCompletedSummary,
  strengthRecordedIdentity,
  type StrengthRecordedSnapshot,
  type StrengthSummaryProvenance,
} from "../lib/strength-completed-summary"
import { apiSessionRevision } from "../lib/api-client"
import { deviceCacheScope } from "../lib/device-cache"
import { useWorkoutAccountBoundary } from "../hooks/use-workout-account-boundary"
import type { PlannedWorkout } from "../lib/training-context"
import { strengthParameterFields } from "../../../app-backend/lib/workout-strength-model.mjs"
import "./desktop-strength-completed.css"

export type DesktopStrengthCompletedProps = {
  workout: PlannedWorkout
  onClose: () => void
  onFiles?: () => void | Promise<void>
  /** Mount nested file dialogs here, inside this modal's React portal tree. */
  fileDialogs?: ReactNode
  /** Supplied only when the caller has an actual history view to open. */
  onHistory?: (workout: PlannedWorkout) => void
  onAnalyze?: () => void
  onDetails?: () => void
  /** Existing real comments/personal fields, mounted inside this modal tree. */
  details?: ReactNode
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"]
}

export function StrengthCompletedSummaryContent({
  workout,
  snapshot,
  provenance,
  allowContextCompleted = true,
}: {
  workout: PlannedWorkout
  snapshot?: StrengthRecordedSnapshot | null
  provenance?: StrengthSummaryProvenance
  allowContextCompleted?: boolean
}) {
  const summary = projectStrengthCompletedSummary(
    workout,
    snapshot,
    provenance,
    allowContextCompleted
  )
  return (
    <>
      <aside className="dsc-summary" aria-label="Strength summary">
        <h2>Summary</h2>
        <div className="dsc-summary-scroll">
          <h3>{workout.title}</h3>
          {workout.device_name && (
            <p className="dsc-device">{workout.device_name}</p>
          )}
          <table aria-label="Planned and completed Strength values">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Metric</span>
                </th>
                <th scope="col">Planned</th>
                <th scope="col">Completed</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{row.planned}</td>
                  <td>{row.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="dsc-availability">
            Completed exercise results are unavailable.
          </p>
        </div>
      </aside>
      <main className="dsc-main">
        <section className="dsc-workout-title" aria-label="Workout title">
          <span>Workout Title</span>
          <h1>{workout.title}</h1>
        </section>
        {summary.prescriptionUnavailable && (
          <p role="alert">
            The saved exercise prescription could not be read. Reload the
            workout before editing.
          </p>
        )}
        {summary.prescription ? (
          <section
            className="dsc-prescription"
            aria-label="Saved exercise prescription"
          >
            <h2>Prescribed exercises</h2>
            {summary.prescription.blocks.length ? (
              summary.prescription.blocks.map((block) => (
                <article key={block.id}>
                  <h3>
                    {block.title ||
                      {
                        single: "Single Exercise",
                        circuit: "Circuit",
                        warmup: "Warm Up",
                        cooldown: "Cool Down",
                        superset: "Superset",
                      }[block.kind]}
                  </h3>
                  {block.instructions && <p>{block.instructions}</p>}
                  {block.exercises.map((exercise) => (
                    <section
                      key={exercise.id}
                      aria-label={`Prescribed ${exercise.title}`}
                    >
                      <h4>{exercise.title}</h4>
                      {exercise.instructions && <p>{exercise.instructions}</p>}
                      <div className="dsc-set-table">
                        <table
                          aria-label={`Prescribed sets: ${exercise.title}`}
                        >
                          <thead>
                            <tr>
                              <th scope="col">Set</th>
                              {exercise.parameters.map((parameter) => (
                                <th scope="col" key={parameter.id}>
                                  {strengthParameterFields.find(
                                    (field) => field.kind === parameter.kind
                                  )?.label || parameter.kind}{" "}
                                  ({parameter.unit})
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {exercise.sets.map((set, index) => (
                              <tr key={set.id}>
                                <th scope="row">{index + 1}</th>
                                {exercise.parameters.map((parameter) => (
                                  <td key={parameter.id}>
                                    {set.values[parameter.id] ?? "--"}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </article>
              ))
            ) : (
              <p>No prescribed exercises.</p>
            )}
          </section>
        ) : (
          <p className="dsc-empty">
            No saved exercise prescription is available for this recording.
          </p>
        )}
      </main>
    </>
  )
}

export function DesktopStrengthCompleted({
  workout,
  onClose,
  onFiles,
  fileDialogs,
  onHistory,
  onAnalyze,
  onDetails,
  details,
  finalFocus,
}: DesktopStrengthCompletedProps) {
  const { trusted: accountTrusted, ownsAccount } =
    useWorkoutAccountBoundary(true)
  const [resetVersion, setResetVersion] = useState(0),
    resetGeneration = useRef(0),
    contextRevoked = useRef(false),
    activeRequest = useRef<AbortController | null>(null),
    sessionRevision = apiSessionRevision(),
    deviceScope = deviceCacheScope(),
    contextTrusted = accountTrusted && !contextRevoked.current,
    provenance = { sessionRevision, deviceScope, resetVersion },
    identity = strengthRecordedIdentity(workout),
    binding = JSON.stringify({ ...identity, ...provenance }),
    [snapshot, setSnapshot] = useState<StrengthRecordedSnapshot | null>(() => {
      const values =
        identity.activityId && contextTrusted
          ? cachedActivitySummary(
              identity.activityId,
              identity.activityRevision
            )
          : null
      return values && identity.activityId
        ? {
            ...identity,
            ...provenance,
            activityId: identity.activityId,
            values,
          }
        : null
    }),
    [request, setRequest] = useState({ binding, loading: false, error: "" }),
    [retry, setRetry] = useState(0),
    [actionError, setActionError] = useState(""),
    [filesBusy, setFilesBusy] = useState(false),
    actionBusy = useRef(false)
  const { workoutId, activityId, activityRevision } = identity
  useEffect(() => {
    const reset = (event: Event) => {
        if (
          event.type === "storage" &&
          (event as StorageEvent).key &&
          (event as StorageEvent).key !== "training-agent-startup-v2"
        )
          return
        if (!ownsAccount()) contextRevoked.current = true
        resetGeneration.current++
        activeRequest.current?.abort()
        setSnapshot(null)
        setResetVersion(resetGeneration.current)
      },
      events = [
        "training-cache-reset",
        "device-cache-cleared",
        "app-auth-required",
        "storage",
      ]
    for (const event of events) window.addEventListener(event, reset)
    return () => {
      for (const event of events) window.removeEventListener(event, reset)
    }
  }, [ownsAccount])
  useEffect(() => {
    // A different account cannot authorize lookup of IDs from the old props.
    // A fresh parent record must remount this summary after an account change.
    if (!contextTrusted) return
    if (!activityId || workout.status !== "completed") return
    if (sessionRevision === null) {
      setRequest({
        binding,
        loading: false,
        error: "Sign in to refresh completed values.",
      })
      return
    }
    const controller = new AbortController()
    activeRequest.current = controller
    const current = () =>
      !controller.signal.aborted &&
      resetGeneration.current === resetVersion &&
      apiSessionRevision() === sessionRevision &&
      deviceCacheScope() === deviceScope
    setRequest({ binding, loading: true, error: "" })
    void loadActivitySummary(activityId, activityRevision, controller.signal)
      .then((values) => {
        if (!current()) return
        setSnapshot({
          workoutId,
          activityId,
          activityRevision,
          sessionRevision,
          deviceScope,
          resetVersion,
          values,
        })
        setRequest({ binding, loading: false, error: "" })
      })
      .catch((reason) => {
        if (current())
          setRequest({
            binding,
            loading: false,
            error:
              reason instanceof Error
                ? reason.message
                : "Completed values could not be refreshed.",
          })
      })
    return () => {
      controller.abort()
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }, [
    binding,
    workoutId,
    activityId,
    activityRevision,
    workout.status,
    sessionRevision,
    deviceScope,
    resetVersion,
    retry,
    contextTrusted,
  ])
  const allowContextCompleted = resetVersion === 0 && contextTrusted
  const files = async () => {
    if (!onFiles || actionBusy.current) return
    actionBusy.current = true
    setFilesBusy(true)
    setActionError("")
    try {
      await onFiles()
    } catch (reason) {
      setActionError(
        reason instanceof Error
          ? reason.message
          : "Workout files could not open."
      )
    } finally {
      actionBusy.current = false
      setFilesBusy(false)
    }
  }
  if (!contextTrusted)
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <DialogContent
          fullscreen
          finalFocus={finalFocus}
          showCloseButton={false}
          className="dsc-dialog"
          overlayClassName="dsc-backdrop"
          onKeyDown={(event) => {
            event.stopPropagation()
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "s"
            )
              event.preventDefault()
          }}
        >
          <DialogTitle className="sr-only">
            Completed Strength Workout
          </DialogTitle>
          <DialogDescription className="sr-only">
            Reopen the workout from the current connected account.
          </DialogDescription>
          <header className="dsc-header">
            <div className="dsc-actions">
              <button
                type="button"
                className="dsc-close"
                aria-label="Close completed Strength workout"
                onClick={onClose}
              >
                <X size={24} aria-hidden="true" />
              </button>
            </div>
          </header>
          <p role="alert" className="dsc-status">
            The connected account changed. Close this summary and reopen the
            workout from your current calendar.
          </p>
        </DialogContent>
      </Dialog>
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !actionBusy.current) onClose()
      }}
    >
      <DialogContent
        fullscreen
        finalFocus={finalFocus}
        showCloseButton={false}
        className="dsc-dialog"
        overlayClassName="dsc-backdrop"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "s"
          )
            event.preventDefault()
        }}
      >
        <DialogTitle className="sr-only">
          Completed Strength Workout
        </DialogTitle>
        <DialogDescription className="sr-only">
          Read-only planned and completed session summary. Saved exercise values
          are prescriptions.
        </DialogDescription>
        <header className="dsc-header">
          <span className="dsc-sport">
            <Dumbbell size={24} aria-hidden="true" />
            {workout.editor_model?.strength?.subtype || "Strength"}
          </span>
          <time dateTime={workout.workout_date || undefined}>
            {workout.workout_date || workout.date}
          </time>
          <div className="dsc-actions">
            {onAnalyze && (
              <button type="button" onClick={onAnalyze}>
                Analyze Recording
              </button>
            )}
            {onDetails && (
              <button type="button" onClick={onDetails}>
                Notes and Details
              </button>
            )}
            {onFiles && (
              <button
                type="button"
                onClick={() => void files()}
                disabled={filesBusy}
              >
                <Paperclip size={18} aria-hidden="true" />
                Files
              </button>
            )}
            <button
              type="button"
              className="dsc-close"
              aria-label="Close completed Strength workout"
              disabled={filesBusy}
              onClick={onClose}
            >
              <X size={24} aria-hidden="true" />
            </button>
          </div>
        </header>
        {request.binding === binding && request.loading && (
          <p role="status" className="dsc-status">
            Refreshing completed values…
          </p>
        )}
        {request.binding === binding && request.error && (
          <p role="alert" className="dsc-status">
            {request.error} Existing values remain visible.{" "}
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry completed values
            </button>
          </p>
        )}
        {actionError && (
          <p role="alert" className="dsc-status">
            {actionError}
          </p>
        )}
        <div className="dsc-body">
          <nav className="dsc-nav" aria-label="Strength views">
            <span aria-current="page">Summary</span>
            {onHistory && (
              <button type="button" onClick={() => onHistory(workout)}>
                <History size={20} aria-hidden="true" />
                Exercise History
              </button>
            )}
          </nav>
          <StrengthCompletedSummaryContent
            workout={workout}
            snapshot={snapshot}
            provenance={provenance}
            allowContextCompleted={allowContextCompleted}
          />
          {details && (
            <section className="dsc-details" aria-label="Workout details">
              {details}
            </section>
          )}
        </div>
        {fileDialogs}
      </DialogContent>
    </Dialog>
  )
}
