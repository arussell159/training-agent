import { useEffect, useMemo, useRef, useState } from "react"
import { BarChart3 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
import {
  DesktopWorkoutHeader,
  type DesktopWorkoutMetadata,
} from "./desktop-workout-header"
import {
  WorkoutEditor,
  type DesktopBuilderSubmission,
} from "./workout-editor-launcher"
import {
  createPlannedWorkout,
  trainingCacheScope,
  type PlannedWorkout,
  type WorkoutSummaryValues,
} from "@/lib/training-context"
import {
  changedPlannedValues,
  formatPlannedValue,
  plannedValueDraft,
  plannedValueRows,
  updatePlannedValueDraft,
} from "@/lib/planned-workout-values"
import { randomId } from "@/lib/random-id"
import {
  readPendingWorkoutCreation,
  rememberPendingWorkoutCreation,
  clearPendingWorkoutCreation,
} from "@/lib/pending-workout-creation"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog"
import { simpleWorkoutModel } from "../../../app-backend/lib/simple-workout.mjs"
import {
  chartSegments,
  workoutTotals,
  type WorkoutModel,
} from "../../../app-backend/lib/workout-editor-model.mjs"
import "./desktop-workout-details.css"
import {
  useWorkoutPersonalFields,
  WorkoutDescriptionInput,
  WorkoutDetailNavigation,
  WorkoutEquipment,
  WorkoutPersonalNotes,
  WorkoutAttachments,
} from "./desktop-workout-personal-fields"
import { removeWorkoutLocalMetadata } from "@/lib/workout-local-metadata"
import { useToastManager } from "./ui/toast"
import { useWorkoutFiles } from "./workout-file-actions"
import { WorkoutRecurrenceControl } from "./desktop-workout-recurrence"
import { applyWorkoutRecurrence, type WorkoutRecurrenceDraft } from "@/lib/workout-recurrence"
import { clearWorkoutSaveDraft, readWorkoutSaveDraft, retainWorkoutSaveDraft } from "@/lib/workout-save-drafts"

export function DesktopWorkoutCreate({
  date,
  initialSport = "Run",
  initialName = "Run",
  onClose,
  onSaved,
}: {
  date: string
  initialSport?: string
  initialName?: string
  onClose: () => void
  onSaved: (workout: PlannedWorkout, close: boolean, notice?: string) => void
}) {
  const toast = useToastManager()
  const [scope] = useState(trainingCacheScope)
  const [recovered] = useState(() => {
    try {
      return readPendingWorkoutCreation(localStorage, scope)
    } catch {
      return null
    }
  })
  const [creationId] = useState(() => recovered?.creationId || randomId())
  const personal = useWorkoutPersonalFields(scope, `draft:${creationId}`)
  const [recurrence, setRecurrence] = useState<WorkoutRecurrenceDraft | null>(() => readWorkoutSaveDraft<WorkoutRecurrenceDraft>(scope, `draft:${creationId}`, "recurrence")?.value || null)
  const [selectedSport, setSelectedSport] = useState(recovered?.model.sport || initialSport)
  const [metadata, setMetadata] = useState<DesktopWorkoutMetadata>({
    name: recovered?.model.name || "",
    date: recovered?.model.date || date,
    time: recovered?.time || "",
  })
  const [draft, setDraft] = useState(() =>
    plannedValueDraft(recovered?.values, recovered?.model.sport || initialSport)
  )
  const [description, setDescription] = useState(recovered?.model.notes || "")
  const [comment, setComment] = useState(recovered?.comment || "")
  const [structure, setStructure] = useState<WorkoutModel | null>(
    recovered?.model || null
  )
  const sport = structure?.sport || selectedSport
  const [builder, setBuilder] = useState<WorkoutModel | null>(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const autoCalculate = personal.value.autoCalculate
  const [uncertain, setUncertain] = useState(
    Boolean(recovered) && recovered?.reconcileOnly !== false
  )
  const [error, setError] = useState(
    recovered
      ? recovered.reconcileOnly === false
        ? "The previous save was rejected. Review your retained draft and save again."
        : "A previous save needs confirmation. Recheck this draft before creating another workout."
      : ""
  )
  const [discardPending, setDiscardPending] = useState(false)
  const saving = useRef(false)
  const submitted = useRef<Parameters<typeof createPlannedWorkout>[0] | null>(
    recovered?.reconcileOnly === false ? null : recovered
  )
  const hasDraft = Boolean(
    metadata.name ||
    metadata.time ||
    description ||
    comment ||
    personal.dirty ||
    recurrence ||
    structure ||
    Object.values(draft).some((value) => value.trim())
  )
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (busy || uncertain || hasDraft) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [busy, uncertain, hasDraft])
  const blank = plannedValueDraft(null, sport)
  let values: Partial<WorkoutSummaryValues> = {}
  try {
    values = changedPlannedValues(draft, blank, sport)
  } catch {
    /* Invalid drafts remain editable. */
  }
  const preview: PlannedWorkout = {
    id: `draft:${creationId}`,
    title: metadata.name,
    sport:
      sport === "Ride"
        ? "Bike"
        : sport === "WeightTraining"
          ? "Strength"
          : sport === "Other"
            ? "Sauna"
            : sport,
    date: metadata.date,
    workout_date: metadata.date,
    day: "",
    status: "upcoming",
    duration: "",
    goal: description,
    planned_values_edited: true,
    workout_summary: { planned: values, completed: null },
  }
  const files = useWorkoutFiles({ model: structure
    ? { ...structure, name: metadata.name || initialName, date: metadata.date, notes: description }
    : { version: 1, name: metadata.name || initialName, sport, date: metadata.date, notes: description, poolLength: sport === "Swim" ? "25y" : "", steps: [] },
  })
  const startBuilder = () => {
    const base = {
      name: metadata.name.trim() || initialName,
      sport,
      date: metadata.date,
      description,
      values,
    }
    const model = structure
      ? { ...structure, name: base.name, date: base.date, notes: description }
      : ({
          version: 1,
          name: base.name,
          sport,
          date: base.date,
          notes: description,
          poolLength: sport === "Swim" ? "25y" : "",
          steps: [],
        } as WorkoutModel)
    setBuilder(model)
  }
  const applyStructure = (model: WorkoutModel) => {
    setStructure(model)
    setMetadata((current) => ({
      ...current,
      name: model.name,
      date: model.date,
    }))
    setDescription(model.notes)
    const totals = workoutTotals(model)
    setDraft((current) => ({
      ...current,
      duration_seconds:
        totals.unknownTime || totals.open
          ? ""
          : formatPlannedValue("duration_seconds", totals.seconds, model.sport),
      distance_meters:
        totals.unknownDistance || !totals.distance
          ? ""
          : formatPlannedValue(
              "distance_meters",
              /swim/i.test(model.sport)
                ? totals.distance / 0.9144
                : totals.distance,
              model.sport
            ),
      average_speed: "",
      tss: totals.load == null ? "" : String(Math.round(totals.load)),
    }))
  }
  const save = async (
    close: boolean,
    built?: DesktopBuilderSubmission & { model: WorkoutModel }
  ) => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError("")
    let providerStarted = false
    try {
      // The builder shares this draft but owns its own loaded snapshot. Pick up
      // files added there before deciding whether personal data must migrate.
      if (built) await personal.refresh()
      const planned = built?.values || changedPlannedValues(draft, blank, sport)
      const base = {
        name: built?.model.name || metadata.name.trim() || initialName,
        sport: built?.model.sport || sport,
        date: built?.model.date || metadata.date,
        description: built?.model.notes ?? description,
        values: planned,
      }
      const model =
        built?.model ||
        (structure
          ? {
              ...structure,
              name: base.name,
              date: base.date,
              notes: description,
            }
          : (simpleWorkoutModel(base) as WorkoutModel))
      const input = submitted.current || {
        model,
        descriptionMode: "manual" as const,
        description: base.description,
        values: planned,
        time: built?.time ?? metadata.time,
        comment: built?.comment ?? comment,
        creationId,
      }
      submitted.current = input
      const repeatDraft = built && "recurrence" in built ? built.recurrence : recurrence
      if (repeatDraft) retainWorkoutSaveDraft(scope, `draft:${creationId}`, "recurrence", repeatDraft)
      await personal.save(`draft:${creationId}`, built?.personal)
      try {
        rememberPendingWorkoutCreation(localStorage, scope, input)
      } catch (reason) {
        if ((reason as { code?: string }).code === "CREATION_PENDING")
          throw reason
      }
      providerStarted = true
      const pending = createPlannedWorkout({
        ...input,
        reconcileOnly: uncertain,
      })
      if (close) onClose()
      const result = await pending
      let personalWarning = ""
      try {
        await personal.save(result.workout.id, built?.personal || personal.value)
      } catch {
        personalWarning = "Workout saved. Personal fields or attachments still need to sync. Reopen creation and recheck the retained draft to finish saving them."
        toast.add({ type: "info", title: "Personal fields need recovery", description: personalWarning, timeout: 10000 })
      }
      let repeatWarning = ""
      if (repeatDraft) {
        try {
          await applyWorkoutRecurrence(result.workout.id, repeatDraft)
          clearWorkoutSaveDraft(scope, `draft:${creationId}`, "recurrence")
          setRecurrence(null)
        } catch (reason) {
          repeatWarning = `Workout saved. Its repeat schedule still needs confirmation: ${reason instanceof Error ? reason.message : "recheck the retained draft."}`
          toast.add({ type: "info", title: "Repeat schedule needs confirmation", description: repeatWarning, timeout: 10000 })
        }
      }
      try {
        if (!personalWarning && !repeatWarning) clearPendingWorkoutCreation(localStorage, scope, creationId)
      } catch {
        /* Optional storage. */
      }
      // A background response must not close or reopen a subsequently opened
      // popup. Verified cache updates and the global toast own completion.
      if (!close) onSaved(result.workout, false, [personalWarning, repeatWarning, result.refreshWarning].filter(Boolean).join(" ") || undefined)
    } catch (reason) {
      const failure = reason as Error & { status?: number; code?: string }
      if (!providerStarted && uncertain) {
        // An interrupted personal-field retry cannot resolve an earlier
        // unconfirmed provider creation. Keep its idempotent recovery request.
      } else if (
        providerStarted &&
        !(
          failure.status &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.code !== "CREATE_UNCONFIRMED"
        )
      )
        setUncertain(true)
      else {
        try {
          clearPendingWorkoutCreation(localStorage, scope, creationId)
          if (close && providerStarted && submitted.current)
            rememberPendingWorkoutCreation(localStorage, scope, {
              ...submitted.current,
              reconcileOnly: false,
            })
        } catch {
          /* Optional storage. */
        }
        submitted.current = null
        setUncertain(false)
      }
      setError(
        failure.message ||
          "The workout could not be saved. Your draft is retained."
      )
      // The builder must keep its recovery draft and display this failure,
      // instead of treating a handled creation error as a successful save.
      if (built) throw reason
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const profile = useMemo(() => {
    const segments = structure ? chartSegments(structure).segments : []
    const total = segments.reduce((sum, item) => sum + item.width, 0)
    const high = Math.max(
      1,
      ...segments.flatMap((item) => [item.start, item.end])
    )
    let left = 0
    return segments.map((item, index) => {
      const bar = {
        key: item.step.id + index,
        x: total ? (600 * left) / total : 0,
        width: total ? Math.max(0.5, (600 * item.width) / total - 1) : 0,
        height: (30 * Math.max(item.start, item.end, high * 0.2)) / high,
      }
      left += item.width
      return bar
    })
  }, [structure])
  if (builder)
    return (
      <WorkoutEditor
        date={builder.date}
        initialSport={sport}
        initialModel={builder}
        initialDesktopDraft={{ values, time: metadata.time, comment, personal: personal.value, personalId: personal.id, recurrence }}
        onApplyDraft={async (model, submission) => {
          applyStructure(model)
          if (submission) {
            setDraft(plannedValueDraft(submission.values, model.sport))
            setMetadata({
              name: model.name,
              date: model.date,
              time: submission.time,
            })
            setComment(submission.comment)
            if (submission.personal) personal.setValue(submission.personal)
            if ("recurrence" in submission) setRecurrence(submission.recurrence || null)
            await save(submission.close, { ...submission, model })
          }
        }}
        onClose={() => setBuilder(null)}
      />
    )
  const disabled = busy || uncertain || personal.busy
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose()
        }}
      >
        <DialogContent
          initialFocus={false}
          showCloseButton={false}
          className={`desktop-workout-preview desktop-workout-create ${expanded ? "desktop-workout-dialog-expanded" : ""}`}
        >
          <DialogTitle className="sr-only">
            New {preview.sport.toLowerCase()} workout
          </DialogTitle>
          <DialogDescription className="sr-only">
            Enter planned values or build structured intervals, then save the
            workout.
          </DialogDescription>
          <DesktopWorkoutHeader
            workout={preview}
            isNew
            expanded={expanded}
            onToggleExpanded={() => setExpanded((value) => !value)}
            onUpload={files.upload}
            onExport={files.exportWorkout}
            recurrence={<WorkoutRecurrenceControl date={metadata.date} disabled={disabled} draft={recurrence} onDraftChange={setRecurrence} />}
            settings={<label className="desktop-workout-auto-calculate"><input type="checkbox" checked={autoCalculate} disabled={disabled} onChange={event => personal.setValue({ ...personal.value, autoCalculate: event.target.checked })} />Automatically calculate planned values</label>}
            actions={<><button type="button" disabled={disabled} onClick={startBuilder}>Build Workout</button><button type="button" disabled={disabled} onClick={files.upload}>Upload activity</button><button type="button" disabled={disabled} onClick={files.exportWorkout}>Export workout</button></>}
            metadata={metadata}
            onMetadataChange={setMetadata}
            onSportChange={next => {
              setSelectedSport(next)
              if (structure) setStructure({ ...structure, sport: next })
              setDraft(plannedValueDraft(values, next))
            }}
            busy={disabled}
            onClose={onClose}
          />
          <section
            className="desktop-new-workout-build"
            aria-label="Workout structure"
          >
            <button type="button" disabled={disabled} onClick={startBuilder}>
              <BarChart3 size={19} />
              {structure ? "Edit Workout" : "Build Workout"}
            </button>
            {structure ? (
              <svg
                viewBox="0 0 600 36"
                preserveAspectRatio="none"
                aria-label="Planned workout profile"
              >
                {profile.map((bar) => (
                  <rect
                    key={bar.key}
                    x={bar.x}
                    y={34 - bar.height}
                    width={bar.width}
                    height={bar.height}
                  />
                ))}
              </svg>
            ) : (
              <div className="desktop-new-workout-outline" aria-hidden="true">
                <span>Warm up</span>
                <span>Main set</span>
                <span>Cool down</span>
              </div>
            )}
          </section>
          <div className="desktop-workout-dialog-body">
            <form
              id={`desktop-totals-${preview.id}`}
              onSubmit={(event) => {
                event.preventDefault()
                void save(false)
              }}
            >
              <div className="desktop-workout-details-shell">
                <WorkoutDetailNavigation />
                <div className="desktop-workout-details-grid">
                <section
                  className="desktop-workout-totals"
                  aria-label="Planned and completed values"
                >
                  <table>
                    <colgroup>
                      <col className="metric-label" />
                      <col />
                      <col />
                      <col className="metric-unit" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th />
                        <th scope="col">Planned</th>
                        <th scope="col">Completed</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {plannedValueRows(sport).map(({ key, label, unit }) => (
                        <tr key={key}>
                          <th scope="row">
                            <label
                              className="desktop-editable-metric"
                              htmlFor={`new-${key}`}
                            >
                              {label}
                            </label>
                          </th>
                          <td>
                            <input
                              id={`new-${key}`}
                              aria-label={`Planned ${label.toLowerCase()}`}
                              value={draft[key] || ""}
                              disabled={disabled || key === "normalized_power"}
                              onChange={(event) =>
                                setDraft((current) =>
                                  updatePlannedValueDraft(
                                    current,
                                    key,
                                    event.target.value,
                                    sport,
                                    autoCalculate
                                  )
                                )
                              }
                              onBlur={() => {
                                if (
                                  key === "duration_seconds" &&
                                  /^\d+:[0-5]\d$/.test(draft[key])
                                )
                                  setDraft((current) => ({
                                    ...current,
                                    [key]: `0:${current[key]}`,
                                  }))
                              }}
                            />
                          </td>
                          <td>
                            <output
                              aria-label={`Completed ${label.toLowerCase()}`}
                              className="desktop-recorded-value"
                            />
                          </td>
                          <td>{unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <table
                    className="desktop-new-recorded-values"
                    aria-label="Recorded minimum average maximum"
                  >
                    <thead>
                      <tr>
                        <th />
                        <th>Min</th>
                        <th>Avg</th>
                        <th>Max</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        [
                          /bike|ride/i.test(sport) ? "Power" : "Pace",
                          /bike|ride/i.test(sport)
                            ? "W"
                            : /swim/i.test(sport)
                              ? "min/100yd"
                              : "min/mi",
                        ],
                        ["Heart Rate", "bpm"],
                      ].map(([label, unit]) => (
                        <tr key={label}>
                          <th>{label}</th>
                          {["minimum", "average", "maximum"].map((value) => (
                            <td key={value}>
                              <output
                                aria-label={`Recorded ${value} ${label.toLowerCase()}`}
                                className="desktop-recorded-value"
                              />
                            </td>
                          ))}
                          <td>{unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <WorkoutEquipment value={personal.value} onChange={personal.setValue} scope={scope} sport={sport} disabled={disabled} options={personal.equipmentOptions} />
                </section>
                <div className="desktop-workout-detail-text">
                  <section className="desktop-workout-description">
                    <WorkoutAttachments personal={personal} />
                    <WorkoutDescriptionInput
                      aria-label="Workout description"
                      maxLength={12000}
                      disabled={disabled}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </section>
                  <section className="desktop-planned-comments">
                    <h3>Post-activity Comments</h3>
                    <textarea
                      aria-label="New planned workout comment"
                      placeholder="Enter a new comment"
                      maxLength={2000}
                      disabled={disabled}
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                    />
                  </section>
                  <WorkoutPersonalNotes value={personal.value} onChange={personal.setValue} disabled={disabled} />
                </div>
                </div>
              </div>
            </form>
          </div>
          <footer className="desktop-workout-dialog-footer">
            <label className="desktop-workout-auto-calculate">
              <input
                type="checkbox"
                checked={autoCalculate}
                disabled={disabled}
                onChange={(event) => personal.setValue({ ...personal.value, autoCalculate: event.target.checked })}
              />{" "}
              Automatically calculate planned values
            </label>
            {error && (
              <p role="alert" className="desktop-workout-save-error">
                {error}
              </p>
            )}
            <button type="button" disabled={busy} onClick={onClose}>
              {uncertain ? "Close" : "Cancel"}
            </button>
            {uncertain && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setDiscardPending(true)}
              >
                Discard draft
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(false)}
            >
              {busy ? "Saving…" : uncertain ? "Recheck save" : "Save"}
            </button>
            <button
              type="button"
              className="desktop-workout-save-close"
              disabled={busy}
              onClick={() => void save(true)}
            >
              {uncertain ? "Recheck & Close" : "Save & Close"}
            </button>
          </footer>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discardPending} onOpenChange={setDiscardPending}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this unconfirmed draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The earlier request may already have reached Intervals.icu. Check
              the calendar before creating another copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                try {
                  clearPendingWorkoutCreation(localStorage, scope, creationId)
                  removeWorkoutLocalMetadata(scope, `draft:${creationId}`)
                } catch {
                  /* Optional storage. */
                }
                onClose()
              }}
            >
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {files.dialogs}
    </>
  )
}
