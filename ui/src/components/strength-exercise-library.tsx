import { useCallback, useEffect, useRef, useState } from "react"
import { EllipsisVertical, Plus, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
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
import {
  strengthLibraryClient,
  strengthLibraryAttempt,
  type StrengthLibraryAttempt,
  type StrengthLibraryCatalog,
  type StrengthLibraryExercise,
  type StrengthLibraryHistory,
  type StrengthLibraryResult,
  type StrengthChangedInspection,
} from "@/lib/strength-exercise-library"
import {
  newStrengthExerciseDefinition,
  strengthMuscleGroups,
  strengthExerciseVideo,
  validateStrengthExerciseDefinition,
  type StrengthExerciseDefinition,
} from "../../../app-backend/lib/strength-exercise-library-model.mjs"
import {
  strengthParameterFields,
  type StrengthExercise,
} from "../../../app-backend/lib/workout-strength-model.mjs"
import { randomId } from "@/lib/random-id"
import "./strength-exercise-library.css"
import { registerWorkoutNavigationGuard } from "@/lib/workout-navigation-guard"
import { useWorkoutAccountBoundary } from "@/hooks/use-workout-account-boundary"

export function useStrengthExerciseLibrary() {
  const [catalog, setCatalog] = useState<StrengthLibraryCatalog | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    setError("")
    void strengthLibraryClient
      .list({}, controller.signal)
      .then((row) => {
        if (!controller.signal.aborted) setCatalog(row)
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "The exercise library could not load."
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [revision])
  useEffect(() => {
    const reset = () => {
      setCatalog(null)
      setRevision((value) => value + 1)
    }
    window.addEventListener("app-auth-required", reset)
    window.addEventListener("training-cache-reset", reset)
    return () => {
      window.removeEventListener("app-auth-required", reset)
      window.removeEventListener("training-cache-reset", reset)
    }
  }, [])
  return {
    catalog,
    error,
    busy,
    reload: useCallback(() => setRevision((value) => value + 1), []),
  }
}
export function StrengthExerciseDefinitionDialog({
  catalog,
  exercise,
  initialTitle = "",
  preview = false,
  recover = false,
  deleteRequested = false,
  onClose,
  onSaved,
  onResolved,
}: {
  catalog: StrengthLibraryCatalog
  exercise?: StrengthLibraryExercise
  initialTitle?: string
  preview?: boolean
  recover?: boolean
  deleteRequested?: boolean
  onClose: () => void
  onSaved: (result: StrengthLibraryResult, created: boolean) => void
  onResolved?: () => void
}) {
  const definitionAccount = useWorkoutAccountBoundary(true)
  const navigationDiscard = useRef<((approved: boolean) => void) | null>(null)
  const definitionNavigation = useRef({
    dirty: false,
    decide: async () => false,
  })
  const [row, setRow] = useState(exercise),
    [draft, setDraft] = useState<StrengthExerciseDefinition>(() => ({
      ...newStrengthExerciseDefinition(),
      title: initialTitle,
    })),
    [view, setView] = useState(preview),
    [busy, setBusy] = useState(Boolean(exercise)),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState<StrengthLibraryAttempt | null>(null),
    [discard, setDiscard] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(deleteRequested),
    [readReady, setReadReady] = useState(!exercise)
  const [catalogRevision, setCatalogRevision] = useState(catalog)
  const [confirmed, setConfirmed] = useState<{
    result: StrengthLibraryResult
    created: boolean
  } | null>(null)
  const [changedAvailable, setChangedAvailable] = useState(false),
    [inspection, setInspection] = useState<StrengthChangedInspection | null>(
      null
    )
  const [storageBlocked, setStorageBlocked] = useState(false)
  const base = useRef(JSON.stringify(draft)),
    mounted = useRef(true),
    saving = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const applyRow = useCallback(
    (value: StrengthLibraryExercise, replace: boolean) => {
      setRow(value)
      setReadReady(true)
      if (replace) {
        const next = validateStrengthExerciseDefinition({
          title: value.title,
          muscleGroup: value.muscleGroup,
          instructions: value.instructions,
          videoUrl: value.videoUrl,
          parameters: value.parameters,
        })
        setDraft(next)
        base.current = JSON.stringify(next)
      }
    },
    []
  )
  useEffect(() => {
    const controller = new AbortController()
    try {
      const retained = strengthLibraryClient.pending(catalog.accountScope)
      if (retained) {
        setAttempt(retained)
        if (retained.body.definition) setDraft(retained.body.definition)
        setView(true)
        setBusy(false)
        setReadReady(true)
        setChangedAvailable(
          Boolean(strengthLibraryClient.changed(catalog.accountScope))
        )
        setConfirmDelete(false)
        return
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Exercise recovery could not load."
      )
      setBusy(false)
      setReadReady(false)
      setStorageBlocked(true)
      return
    }
    if (!exercise) {
      setBusy(false)
      return
    }
    void strengthLibraryClient
      .load(exercise.id, catalog.accountScope, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) applyRow(value, true)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setReadReady(false)
          setError(
            reason instanceof Error
              ? reason.message
              : "The saved exercise could not load."
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [catalog.accountScope, exercise, applyRow, recover])
  const dirty = JSON.stringify(draft) !== base.current
  const requestDefinitionNavigation = async () => {
    if (
      !definitionAccount.isCurrent() ||
      !mounted.current ||
      saving.current ||
      busy ||
      navigationDiscard.current
    )
      return false
    if (attempt) {
      setError(
        "This exercise change still needs confirmation. Recheck its retained save before closing."
      )
      return false
    }
    if (!dirty) return true
    return new Promise<boolean>((resolve) => {
      navigationDiscard.current = resolve
      setDiscard(true)
    })
  }
  const onDiscardOpenChange = (open: boolean) => {
    setDiscard(open)
    if (!open) {
      navigationDiscard.current?.(false)
      navigationDiscard.current = null
    }
  }
  const confirmDefinitionDiscard = () => {
    if (!definitionAccount.isCurrent()) {
      onDiscardOpenChange(false)
      return
    }
    const resolve = navigationDiscard.current
    navigationDiscard.current = null
    setDiscard(false)
    // Global navigation only prepares consent. Keep every input intact until
    // all parent layers approve; a later parent Cancel must lose nothing.
    if (resolve) resolve(true)
    else onClose()
  }
  definitionNavigation.current = { dirty, decide: requestDefinitionNavigation }
  useEffect(() => {
    const unregister = registerWorkoutNavigationGuard(
      () => definitionNavigation.current.decide(),
      () => definitionNavigation.current.dirty,
      20
    )
    return () => {
      unregister()
      navigationDiscard.current?.(false)
      navigationDiscard.current = null
    }
  }, [])
  const requestClose = () => {
    if (
      !definitionAccount.isCurrent() ||
      saving.current ||
      busy ||
      navigationDiscard.current
    )
      return
    if (attempt) {
      setError(
        "This exercise change still needs confirmation. Recheck its retained save before closing."
      )
      return
    }
    if (dirty) setDiscard(true)
    else onClose()
  }
  const save = async (deleting = false) => {
    if (
      !definitionAccount.isCurrent() ||
      saving.current ||
      !readReady ||
      catalog.readOnly ||
      catalogRevision.readOnly ||
      (row && !row.editable)
    )
      return
    if (confirmed) {
      try {
        onSaved(confirmed.result, confirmed.created)
        onClose()
      } catch {
        setError(
          "The exercise is saved. Retry adding it to this workout; no new library request will be sent."
        )
      }
      return
    }
    if (!attempt && !deleting && row && !dirty) return
    saving.current = true
    setBusy(true)
    setError("")
    let current = attempt
    try {
      if (!current)
        current = strengthLibraryAttempt(
          catalogRevision,
          deleting ? null : validateStrengthExerciseDefinition(draft),
          row
        )
      setAttempt(current)
      const result = await strengthLibraryClient.mutate(
        current,
        Boolean(attempt)
      )
      if (mounted.current && definitionAccount.isCurrent()) {
        setAttempt(null)
        setConfirmed({ result, created: current.method === "POST" })
        try {
          onSaved(result, current.method === "POST")
          onClose()
        } catch {
          setError(
            "The exercise is saved. Retry adding it to this workout; no new library request will be sent."
          )
        }
      }
    } catch (reason) {
      if (mounted.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : "The exercise save could not be confirmed."
        )
        try {
          setAttempt(strengthLibraryClient.pending(catalog.accountScope))
          setChangedAvailable(
            Boolean(strengthLibraryClient.changed(catalog.accountScope))
          )
        } catch {
          setReadReady(false)
          setStorageBlocked(true)
        }
      }
    } finally {
      saving.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const problem = (() => {
    try {
      validateStrengthExerciseDefinition(draft)
      return ""
    } catch (reason) {
      return reason instanceof Error ? reason.message : "Check this exercise."
    }
  })()
  const locked =
    busy ||
    Boolean(attempt) ||
    Boolean(confirmed) ||
    catalog.readOnly ||
    catalogRevision.readOnly ||
    Boolean(row && !row.editable) ||
    !readReady
  const change = (next: StrengthExerciseDefinition) => {
    if (!locked) setDraft(next)
  }
  const reload = async () => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      if (row)
        applyRow(
          await strengthLibraryClient.load(row.id, catalog.accountScope),
          false
        )
      else {
        const next = await strengthLibraryClient.list()
        if (next.accountScope !== catalog.accountScope)
          throw Error(
            "The signed-in exercise account changed. Keep this draft and reopen the correct account."
          )
        setCatalogRevision(next)
        setReadReady(true)
      }
      setError(
        "Current definition loaded. Your draft is retained; review it before saving."
      )
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The saved exercise could not load."
      )
    } finally {
      setBusy(false)
    }
  }
  const inspect = async () => {
    if (!attempt || busy) return
    setBusy(true)
    setError("")
    try {
      setInspection(await strengthLibraryClient.inspectChanged(attempt))
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The changed exercise could not load."
      )
    } finally {
      setBusy(false)
    }
  }
  const retryStorage = async () => {
    if (busy) return
    setBusy(true)
    try {
      const retained = strengthLibraryClient.pending(catalog.accountScope)
      setAttempt(retained)
      setChangedAvailable(
        Boolean(strengthLibraryClient.changed(catalog.accountScope))
      )
      if (retained) {
        if (retained.body.definition) setDraft(retained.body.definition)
        setView(true)
      } else if (row)
        applyRow(
          await strengthLibraryClient.load(row.id, catalog.accountScope),
          false
        )
      setReadReady(true)
      setStorageBlocked(false)
      setError("")
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Exercise recovery storage is unavailable."
      )
    } finally {
      setBusy(false)
    }
  }
  const acknowledge = (review: boolean) => {
    if (!inspection) return
    try {
      strengthLibraryClient.acknowledgeChanged(inspection)
      setAttempt(null)
      setChangedAvailable(false)
      setCatalogRevision(inspection.catalog)
      setReadReady(true)
      setError("")
      setInspection(null)
      onResolved?.()
      if (review) {
        setRow(inspection.exercise || undefined)
        setView(false)
        base.current = inspection.exercise
          ? JSON.stringify(
              validateStrengthExerciseDefinition({
                title: inspection.exercise.title,
                muscleGroup: inspection.exercise.muscleGroup,
                instructions: inspection.exercise.instructions,
                videoUrl: inspection.exercise.videoUrl,
                parameters: inspection.exercise.parameters,
              })
            )
          : JSON.stringify(newStrengthExerciseDefinition())
      } else onClose()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The changed outcome could not be acknowledged. Keep its recovery identity."
      )
    }
  }
  return (
    <>
      <Dialog
        open
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) requestClose()
        }}
      >
        <DialogContent
          className="sel-dialog"
          showCloseButton={false}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "s"
            ) {
              event.preventDefault()
              if (view && !discard && !confirmDelete) void save()
            }
          }}
        >
          <header>
            <DialogTitle>
              {attempt
                ? "Confirm Exercise Change"
                : view
                  ? "Exercise Preview"
                  : row
                    ? "Edit Exercise"
                    : "Create Custom Exercise"}
            </DialogTitle>
            <button
              type="button"
              aria-label="Close exercise definition"
              disabled={busy || Boolean(attempt)}
              onClick={requestClose}
            >
              <X size={20} />
            </button>
          </header>
          <DialogDescription className="sr-only">
            Create and manage your own saved exercise definition independently
            of this workout.
          </DialogDescription>
          {error && <p role="alert">{error}</p>}
          {busy && (
            <p role="status">
              {saving.current ? "Saving exercise…" : "Loading exercise…"}
            </p>
          )}
          {(catalog.readOnly || catalogRevision.readOnly) && (
            <p role="status">This exercise library is read-only.</p>
          )}
          {storageBlocked && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void retryStorage()}
            >
              Retry exercise recovery storage
            </button>
          )}
          {attempt && (
            <p role="status">
              A retained {attempt.method === "DELETE" ? "deletion" : "save"}{" "}
              needs confirmation. Its original identity and content are
              retained.
            </p>
          )}
          {attempt && changedAvailable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void inspect()}
            >
              Reload saved exercise
            </button>
          )}
          {inspection && (
            <section
              className="sel-preview"
              aria-label="Current saved exercise"
            >
              <h2>
                {inspection.exercise
                  ? "Current saved definition"
                  : "Exercise deleted from library"}
              </h2>
              {inspection.exercise && (
                <>
                  <h3>{inspection.exercise.title}</h3>
                  <p className="sel-instructions">
                    {inspection.exercise.instructions ||
                      "No exercise instructions."}
                  </p>
                </>
              )}
              <p>
                Your original draft below remains retained and has not
                overwritten this current outcome.
              </p>
              <button type="button" onClick={() => acknowledge(true)}>
                {inspection.exercise
                  ? "Review retained draft"
                  : "Create a new exercise from retained draft"}
              </button>
              <button type="button" onClick={() => acknowledge(false)}>
                {inspection.exercise
                  ? "Keep saved exercise and close"
                  : "Keep deletion and close"}
              </button>
            </section>
          )}
          {view ? (
            <section className="sel-preview">
              <h2>{draft.title || row?.title || "Exercise"}</h2>
              <p>
                {draft.muscleGroup === "None"
                  ? "No muscle group selected"
                  : draft.muscleGroup}
              </p>
              <div className="sel-preview-parameters">
                {draft.parameters.map((column, index) => (
                  <span key={column.id}>
                    {
                      strengthParameterFields.find(
                        (field) => field.kind === column.kind
                      )?.label
                    }{" "}
                    {column.unit}
                    {index < draft.parameters.length - 1 ? " · " : ""}
                  </span>
                ))}
              </div>
              {draft.videoUrl && (
                <a
                  href={strengthExerciseVideo(draft.videoUrl)?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open exercise video
                </a>
              )}
              {!draft.videoUrl && <p>No Video</p>}
              <p className="sel-instructions">
                {draft.instructions || "No exercise instructions."}
              </p>
            </section>
          ) : (
            <div className="sel-form">
              <label>
                Title
                <input
                  aria-label="Exercise title"
                  required
                  maxLength={128}
                  value={draft.title}
                  disabled={locked}
                  onChange={(event) =>
                    change({ ...draft, title: event.target.value })
                  }
                />
                <small>{draft.title.length}/128</small>
              </label>
              <label>
                Muscle Group
                <select
                  aria-label="Muscle Group"
                  value={draft.muscleGroup}
                  disabled={locked}
                  onChange={(event) =>
                    change({
                      ...draft,
                      muscleGroup: event.target
                        .value as StrengthExerciseDefinition["muscleGroup"],
                    })
                  }
                >
                  {strengthMuscleGroups.map((group) => (
                    <option key={group}>{group}</option>
                  ))}
                </select>
              </label>
              <fieldset disabled={locked}>
                <legend>Parameters</legend>
                {draft.parameters.map((column, index) => {
                  const field = strengthParameterFields.find(
                    (field) => field.kind === column.kind
                  )!
                  return (
                    <div className="sel-parameter" key={column.id}>
                      <label>
                        <span className="sr-only">Parameter {index + 1}</span>
                        <select
                          aria-label={`Parameter ${index + 1}`}
                          value={column.kind}
                          onChange={(event) => {
                            const next = strengthParameterFields.find(
                              (field) => field.kind === event.target.value
                            )!
                            change({
                              ...draft,
                              parameters: draft.parameters.map((item) =>
                                item.id === column.id
                                  ? {
                                      ...item,
                                      kind: next.kind,
                                      unit: next.units[0],
                                    }
                                  : item
                              ),
                            })
                          }}
                        >
                          {strengthParameterFields.map((field) => (
                            <option key={field.kind} value={field.kind}>
                              {field.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="sr-only">
                          Parameter {index + 1} unit
                        </span>
                        <select
                          aria-label={`Parameter ${index + 1} unit`}
                          value={column.unit}
                          onChange={(event) =>
                            change({
                              ...draft,
                              parameters: draft.parameters.map((item) =>
                                item.id === column.id
                                  ? { ...item, unit: event.target.value }
                                  : item
                              ),
                            })
                          }
                        >
                          {field.units.map((unit) => (
                            <option key={unit}>{unit}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove parameter ${index + 1}`}
                        disabled={draft.parameters.length === 1}
                        onClick={() =>
                          change({
                            ...draft,
                            parameters: draft.parameters.filter(
                              (item) => item.id !== column.id
                            ),
                          })
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )
                })}
                <button
                  type="button"
                  disabled={draft.parameters.length >= 12}
                  onClick={() =>
                    change({
                      ...draft,
                      parameters: [
                        ...draft.parameters,
                        { id: randomId(), kind: "reps", unit: "reps" },
                      ],
                    })
                  }
                >
                  <Plus size={16} />
                  Add Parameter
                </button>
              </fieldset>
              <label>
                Video URL
                <input
                  aria-label="Video URL"
                  type="url"
                  placeholder="YouTube or Vimeo URL"
                  maxLength={2048}
                  value={draft.videoUrl}
                  disabled={locked}
                  onChange={(event) =>
                    change({ ...draft, videoUrl: event.target.value })
                  }
                />
              </label>
              <label>
                Exercise Instructions
                <textarea
                  aria-label="Exercise instructions"
                  maxLength={1000}
                  value={draft.instructions}
                  disabled={locked}
                  onChange={(event) =>
                    change({ ...draft, instructions: event.target.value })
                  }
                />
                <small>{draft.instructions.length}/1000</small>
              </label>
            </div>
          )}
          <footer>
            {row && !attempt && (
              <button
                type="button"
                disabled={locked}
                onClick={() => setConfirmDelete(true)}
              >
                Delete Exercise
              </button>
            )}
            {error && !attempt && !confirmed && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void reload()}
              >
                {row ? "Reload current definition" : "Reload exercise library"}
              </button>
            )}
            <div />
            {view && !attempt && (
              <button
                type="button"
                disabled={locked}
                onClick={() => setView(false)}
              >
                Edit Exercise
              </button>
            )}
            <button
              type="button"
              disabled={busy || Boolean(attempt)}
              onClick={requestClose}
            >
              Cancel
            </button>
            {confirmed ? (
              <button
                type="button"
                className="sel-primary"
                onClick={() => void save()}
              >
                Add saved exercise to workout
              </button>
            ) : attempt ? (
              <button
                type="button"
                className="sel-primary"
                disabled={
                  busy ||
                  catalog.readOnly ||
                  catalogRevision.readOnly ||
                  !readReady
                }
                onClick={() => void save()}
              >
                Recheck exercise save
              </button>
            ) : view ? (
              <button
                type="button"
                className="sel-primary"
                disabled={locked || Boolean(problem) || Boolean(row && !dirty)}
                onClick={() => void save()}
              >
                Save
              </button>
            ) : (
              <button
                type="button"
                className="sel-primary"
                disabled={locked || Boolean(problem)}
                onClick={() => {
                  setError("")
                  setView(true)
                }}
              >
                Preview Changes
              </button>
            )}
          </footer>
          {problem && !view && <p className="sel-hint">{problem}</p>}
          <AlertDialog open={discard} onOpenChange={onDiscardOpenChange}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Discard exercise changes?</AlertDialogTitle>
                <AlertDialogDescription>
                  These definition changes have not been saved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep editing</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDefinitionDiscard}>
                  Discard changes
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete this custom exercise?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Existing workout prescriptions remain unchanged. The library
                  definition will be removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={locked}
                  onClick={() => {
                    setConfirmDelete(false)
                    void save(true)
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function StrengthLibraryHistoryView({
  id,
  scope,
  onApply,
}: {
  id: string
  scope: string
  onApply: (exercise: StrengthExercise) => void
}) {
  const [data, setData] = useState<StrengthLibraryHistory | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError("")
    void strengthLibraryClient
      .history(id, scope, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value)
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "History could not load."
          )
      })
    return () => controller.abort()
  }, [id, scope, retry])
  return (
    <section className="sel-history" aria-label="Saved exercise history">
      <p>
        Prescriptions from retained calendar history. Actual set results are
        unavailable.
      </p>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry exercise history
          </button>
        </p>
      ) : !data ? (
        <p role="status">Loading exercise history…</p>
      ) : (
        <>
          {!data.records.length && (
            <p>No prescriptions linked to this saved exercise.</p>
          )}
          {data.records.map((record) => (
            <article key={record.workoutId}>
              <h3>{record.title}</h3>
              <time>{record.date}</time>
              {record.exercises.map((exercise) => (
                <div key={exercise.id}>
                  <strong>{exercise.title}</strong>
                  <p>{exercise.sets.length} prescribed sets</p>
                  <button type="button" onClick={() => onApply(exercise)}>
                    Apply Last Prescribed
                  </button>
                </div>
              ))}
            </article>
          ))}
          {Boolean(data.legacyMatches.length) && (
            <p>
              Separate legacy name matches: {data.legacyMatches.length}. These
              are not linked to this saved exercise.
            </p>
          )}
        </>
      )}
    </section>
  )
}

export function StrengthLibraryCard({
  exercise,
  disabled,
  canInsert,
  onAdd,
  onPreview,
  onEdit,
  onHistory,
  onDelete,
}: {
  exercise: StrengthLibraryExercise
  disabled: boolean
  canInsert: boolean
  onAdd: () => void
  onPreview: () => void
  onEdit: () => void
  onHistory: () => void
  onDelete: () => void
}) {
  const [menu, setMenu] = useState(false)
  return (
    <article
      className="sel-library-card"
      aria-label={`Custom exercise: ${exercise.title}`}
    >
      <button
        type="button"
        className="sel-insert"
        aria-label={`Add exercise: ${exercise.title}`}
        disabled={disabled || !canInsert}
        onClick={onAdd}
      >
        <strong>{exercise.title}</strong>
        <Plus size={16} />
      </button>
      <p>
        {exercise.muscleGroup === "None"
          ? "Custom exercise"
          : exercise.muscleGroup}
      </p>
      <button
        type="button"
        aria-label={`Exercise options: ${exercise.title}`}
        aria-expanded={menu}
        onClick={() => setMenu((value) => !value)}
      >
        <EllipsisVertical size={16} />
      </button>
      {menu && (
        <nav aria-label={`${exercise.title} actions`}>
          <button
            type="button"
            onClick={() => {
              setMenu(false)
              onPreview()
            }}
          >
            Preview
          </button>
          <button
            type="button"
            disabled={!exercise.editable}
            onClick={() => {
              setMenu(false)
              onEdit()
            }}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(false)
              onHistory()
            }}
          >
            History
          </button>
          <button
            type="button"
            disabled={!exercise.editable}
            onClick={() => {
              setMenu(false)
              onDelete()
            }}
          >
            Delete
          </button>
        </nav>
      )}
    </article>
  )
}
