import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { apiSessionRevision } from "@/lib/api-client"
import { deviceCacheScope } from "@/lib/device-cache"
import { useWorkoutAccountBoundary } from "@/hooks/use-workout-account-boundary"
import {
  cachedWorkoutValues,
  loadWorkoutValues,
  clearWorkoutReads,
  loadWorkoutEditor,
} from "@/lib/workout-read-cache"
import { Skeleton } from "./ui/skeleton"
import {
  useWorkoutTextDraft,
  type WorkoutTextDraft,
} from "@/hooks/use-workout-text-draft"
import {
  cachedActivitySummary,
  loadActivitySummary,
} from "@/lib/activity-analysis"
import {
  savePlannedWorkoutValues,
  beginWorkoutSaveFeedback,
  writeWorkoutEditor,
  trainingCacheScope,
  type PlannedWorkout,
  type WorkoutSummaryValues,
} from "@/lib/training-context"
import {
  changedPlannedValues,
  formatPlannedValue,
  plannedValueDraft,
  plannedValueRows,
  recordedValueRows,
  plannedDraftValue,
  hasPlannedValueChanges,
  withCalculatedPlannedValues,
  mergeLoadedPlannedDraft,
  updatePlannedValueDraft,
} from "@/lib/planned-workout-values"
import "./desktop-workout-details.css"
import type { DesktopWorkoutMetadata } from "./desktop-workout-header"
import { workoutPresentationSport } from "@/lib/workout-presentation"
import { hasWorkoutProfile } from "@/lib/workout-profile-visibility"
import { localCommittedWorkout } from "@/lib/workout-commits"
import { completedValueDraft, changedCompletedValues, editableCompletedValue } from "@/lib/completed-workout-values"
import { WorkoutSyncAction } from "./workout-sync-action"
import { yieldForWorkoutFeedback } from "@/lib/workout-feedback-frame"
import { simpleWorkoutModel } from "../../../app-backend/lib/simple-workout.mjs"
import type { WorkoutModel } from "../../../app-backend/lib/workout-editor-model.mjs"
import type { SportZoneSettings } from "../../../app-backend/lib/workout-editor-zones.mjs"
import {
  readWorkoutSaveDraft,
  retainWorkoutSaveDraft,
  clearWorkoutSaveDraft,
  validPlannedSaveDraft,
  type PlannedSaveDraft,
} from "@/lib/workout-save-drafts"
import {
  useWorkoutPersonalFields,
  WorkoutDescriptionInput,
  WorkoutDetailNavigation,
  WorkoutEquipment,
  WorkoutPersonalNotes,
  WorkoutAttachments,
} from "./desktop-workout-personal-fields"
type DetailOptions = {
  metadata?: DesktopWorkoutMetadata
  onClose?: () => void
  onDelete?: () => void
  footerTarget?: HTMLElement | null
  commentsTarget?: HTMLElement | null
  onBusyChange?: (busy: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
  onDiscardReady?: (discard: (() => void) | null) => void
}

function PlannedComments({
  text,
  busy,
  showEmpty = false,
}: {
  text: WorkoutTextDraft
  busy: boolean
  showEmpty?: boolean
}) {
  return (
    <section
      className="desktop-planned-comments"
      aria-label={
        text.type === "pre"
          ? "Planned workout comments"
          : "Post-activity comments"
      }
    >
      <h3>Post-activity Comments</h3>
      {text.commentsLoading && !text.comments.length && (
        <div
          role="status"
          aria-label="Loading workout comments"
          className="space-y-2 py-2"
        >
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      )}
      {showEmpty &&
        !text.commentsLoading &&
        !text.comments.some(
          (item) => (item.type || item.comment_type) === text.type
        ) && <p className="a360-no-comments">No comments just yet</p>}
      {text.comments
        .filter((item) => (item.type || item.comment_type) === text.type)
        .map((comment) => (
          <article key={comment.id}>
            <p>{comment.body}</p>
            <time dateTime={comment.created_at}>
              {new Date(comment.created_at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          </article>
        ))}
      <textarea
        aria-label={
          text.type === "pre"
            ? "New planned workout comment"
            : "New post-activity comment"
        }
        placeholder="Enter a new comment"
        maxLength={2000}
        value={text.comment}
        disabled={busy}
        onChange={(event) => text.setComment(event.target.value)}
      />
      <div className="desktop-workout-detail-actions">
        <span>{text.comment.length} / 2000</span>
      </div>
      {text.commentsError && <p role="alert">{text.commentsError}</p>}
    </section>
  )
}

function PlannedTotals({
  workout,
  readOnly,
  metadata,
  onClose,
  onDelete,
  footerTarget,
  onBusyChange,
  onDirtyChange,
  text,
  personal,
}: {
  text: WorkoutTextDraft
  personal: ReturnType<typeof useWorkoutPersonalFields>
  workout: PlannedWorkout
  readOnly: boolean
} & DetailOptions) {
  const { ownsAccount } = useWorkoutAccountBoundary(true)
  const requireCurrentAccount = () => {
    if (!ownsAccount())
      throw Error(
        "The connected account changed. Reopen the workout before saving."
      )
  }
  const sport = workoutPresentationSport(workout)
  const editable = /^(event:[1-9]\d*|app:[a-f0-9-]+)$/.test(workout.id) && !readOnly
  const durableSave = editable && /^(Swim|Ride|Run)$/.test(workout.sport)
  const editorModel = useRef<WorkoutModel | undefined>(localCommittedWorkout(workout.id)?.input.model || workout.editor_model)
  const editorZones = useRef<SportZoneSettings[] | undefined>(localCommittedWorkout(workout.id)?.input.zoneSettings)
  const workoutRef = useRef(workout)
  workoutRef.current = workout
  const loadGeneration = useRef(0)
  const [scope] = useState(trainingCacheScope)
  const [recovered] = useState(
    () =>
      readWorkoutSaveDraft<PlannedSaveDraft>(
        scope,
        workout.id,
        "totals",
        validPlannedSaveDraft
      )?.value
  )
  const [saved, setSaved] = useState(() =>
    plannedValueDraft(
      localCommittedWorkout(workout.id)?.workout.workout_summary?.planned || cachedWorkoutValues(workout.id)?.workout.workout_summary?.planned ||
        workout.workout_summary?.planned,
      sport
    )
  )
  const [draft, setDraft] = useState(() =>
      withCalculatedPlannedValues(saved, recovered?.values || {}, sport)
    ),
    [revision, setRevision] = useState(
      () => localCommittedWorkout(workout.id)?.revision || cachedWorkoutValues(workout.id)?.revision || ""
    )
  const [localBusy, setBusy] = useState(false),
    [loading, setLoading] = useState(
      editable && !cachedWorkoutValues(workout.id) && !localCommittedWorkout(workout.id)
    ),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("")
  const [syncFailed, setSyncFailed] = useState(false)
  useEffect(() => {
    if (!durableSave) return
    const update = () => {
      if (!ownsAccount()) return
      const local = localCommittedWorkout(workout.id)
      if (!local) return
      setSyncFailed(local.state === "failed")
      setNotice(local.state === "synced" ? "Synced to Intervals.icu" : local.state === "failed" ? `Saved in the app. ${local.error || "Synchronization needs attention."}` : local.state === "local" ? "Saved on this device; sync pending." : "Saved in the app; sync pending.")
    }
    update()
    window.addEventListener("workout-commits-updated", update)
    return () => window.removeEventListener("workout-commits-updated", update)
  }, [durableSave, workout.id, ownsAccount])
  const busy =
    localBusy || personal.busy || Boolean(workout.app_pending_operation)
  const saving = useRef(false)
  const savedRef = useRef(saved)
  savedRef.current = saved
  useEffect(() => {
    onBusyChange?.(busy)
    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])
  const activityId =
    workout.activity_id ||
    (workout.id.startsWith("activity:") ? workout.id.slice(9) : null)
  const activityRevision =
    (workout as PlannedWorkout & { activity_revision?: string })
      .activity_revision || ""
  const [recordedEpoch, setRecordedEpoch] = useState(0),
    [recordedRetry, setRecordedRetry] = useState(0),
    recordedGeneration = useRef(0),
    recordedRequest = useRef<AbortController | null>(null),
    recordedSession = apiSessionRevision(),
    recordedScope = deviceCacheScope(),
    recordedTrusted = ownsAccount(),
    recordedBinding = JSON.stringify([
      workout.id,
      activityId,
      activityRevision,
      recordedSession,
      recordedScope,
      recordedEpoch,
    ]),
    [downloaded, setDownloaded] = useState<{
      binding: string
      values: WorkoutSummaryValues
    } | null>(() => {
      const values =
        activityId && recordedTrusted
          ? cachedActivitySummary(activityId, activityRevision)
          : null
      return values ? { binding: recordedBinding, values } : null
    }),
    [recordedStatus, setRecordedStatus] = useState({
      binding: recordedBinding,
      loading: false,
      error: "",
    })
  useEffect(() => {
    const reset = (event: Event) => {
        if (
          event.type === "storage" &&
          (event as StorageEvent).key &&
          (event as StorageEvent).key !== "training-agent-startup-v2"
        )
          return
        recordedGeneration.current++
        recordedRequest.current?.abort()
        setDownloaded(null)
        setRecordedEpoch(recordedGeneration.current)
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
  }, [])
  useEffect(() => {
    if (!activityId || !recordedTrusted) return
    const controller = new AbortController()
    recordedRequest.current = controller
    const current = () =>
      !controller.signal.aborted &&
      recordedGeneration.current === recordedEpoch &&
      apiSessionRevision() === recordedSession &&
      deviceCacheScope() === recordedScope
    setRecordedStatus({ binding: recordedBinding, loading: true, error: "" })
    void loadActivitySummary(activityId, activityRevision, controller.signal)
      .then((values) => {
        if (!current()) return
        setDownloaded({ binding: recordedBinding, values })
        setRecordedStatus({
          binding: recordedBinding,
          loading: false,
          error: "",
        })
      })
      .catch((reason) => {
        if (current())
          setRecordedStatus({
            binding: recordedBinding,
            loading: false,
            error:
              reason instanceof Error
                ? reason.message
                : "Completed values could not be refreshed.",
          })
      })
    return () => {
      controller.abort()
      if (recordedRequest.current === controller) recordedRequest.current = null
    }
  }, [
    activityId,
    activityRevision,
    recordedBinding,
    recordedTrusted,
    recordedSession,
    recordedScope,
    recordedEpoch,
    recordedRetry,
  ])
  // A recording snapshot is one authoritative document, not a partial patch.
  // Missing/null fields must not fall through to older context measurements.
  const completed = !recordedTrusted
    ? {}
    : downloaded?.binding === recordedBinding
      ? downloaded.values
      : workout.workout_summary?.completed || {}
  const [completedSaved, setCompletedSaved] = useState(() => completedValueDraft(completed, sport))
  const [completedDraft, setCompletedDraft] = useState(() => completedValueDraft({...completed,...recovered?.completedValues}, sport))
  const completedSavedRef = useRef(completedSaved)
  const completedSnapshot = JSON.stringify(completed)
  useEffect(() => {
    const next = completedValueDraft(JSON.parse(completedSnapshot), sport)
    // React may run the state updater after this effect has advanced the ref.
    // Compare typing against the captured old snapshot, never the new remote.
    const beforeRead = completedSavedRef.current
    setCompletedDraft(current => mergeLoadedPlannedDraft(current, beforeRead, next))
    completedSavedRef.current = next
    setCompletedSaved(next)
  }, [completedSnapshot, sport])
  const completedDirty = hasPlannedValueChanges(completedDraft, completedSaved, sport)
  const completedEditable = !readOnly && (editable || Boolean(activityId))
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!editable) return
      const generation = ++loadGeneration.current
      const localRevision = localCommittedWorkout(workout.id)?.revision
      const beforeRead = savedRef.current
      setLoading(!cachedWorkoutValues(workout.id) && !localCommittedWorkout(workout.id))
      setError("")
      setNotice("")
      try {
        const sourceWorkout = workoutRef.current
        const data = durableSave
          ? await loadWorkoutEditor(`/api/workouts/${encodeURIComponent(workout.id)}/editor`, signal).then(editor => ({revision:editor.revision, workout:{...sourceWorkout,workout_summary:{...sourceWorkout.workout_summary,planned:editor.plannedValues || sourceWorkout.workout_summary?.planned}}, model:editor.model,zoneSettings:editor.zoneSettings}))
          : await loadWorkoutValues(workout.id, signal)
        if (signal?.aborted || generation !== loadGeneration.current || localRevision !== localCommittedWorkout(workout.id)?.revision) return
        if ("model" in data) { editorModel.current = data.model as WorkoutModel; editorZones.current = data.zoneSettings }
        const next = plannedValueDraft(
          data.workout.workout_summary?.planned,
          sport
        )
        setSaved(next)
        setDraft((current) =>
          mergeLoadedPlannedDraft(current, beforeRead, next)
        )
        setRevision(data.revision)
      } catch (e) {
        if (!signal?.aborted && generation === loadGeneration.current)
          setError(
            e instanceof Error
              ? e.message
              : "Planned values could not be loaded."
          )
      } finally {
        if (!signal?.aborted && generation === loadGeneration.current) setLoading(false)
      }
    },
    [editable, workout.id, sport, durableSave]
  )
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])
  useEffect(() => {
    if (!editable) return
    let controller: AbortController | null = null
    const refreshAfterLocalEdit = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string }>).detail
      if (detail?.id !== workout.id || busy) return
      controller?.abort()
      const request = new AbortController()
      controller = request
      if (durableSave) {
        void load(request.signal)
        return
      }
      setLoading(true)
      void (async () => {
        try {
          clearWorkoutReads()
          const data = await loadWorkoutValues(workout.id, request.signal)
          if (request.signal.aborted) return
          const next = plannedValueDraft(
            data.workout.workout_summary?.planned,
            sport
          )
          const hasDraft = hasPlannedValueChanges(draft, saved, sport)
          if (hasDraft && hasPlannedValueChanges(next, saved, sport)) {
            setRevision("")
            setError(
              "The interval edit changed planned totals. Your draft is retained. Reload values to use the saved workout."
            )
          } else {
            setRevision(data.revision)
            setSaved(next)
            if (!hasDraft) setDraft(next)
          }
        } catch (reason) {
          if (!request.signal.aborted) {
            setRevision("")
            setError(
              reason instanceof Error
                ? reason.message
                : "Saved workout values could not be refreshed."
            )
          }
        } finally {
          if (!request.signal.aborted) setLoading(false)
        }
      })()
    }
    window.addEventListener("workout-editor-saved", refreshAfterLocalEdit)
    window.addEventListener(
      "workout-description-updated",
      refreshAfterLocalEdit
    )
    return () => {
      controller?.abort()
      window.removeEventListener("workout-editor-saved", refreshAfterLocalEdit)
      window.removeEventListener(
        "workout-description-updated",
        refreshAfterLocalEdit
      )
    }
  }, [editable, workout.id, sport, busy, draft, saved, durableSave, load])
  const metadataPatch = metadata
    ? Object.fromEntries(
        Object.entries(metadata).filter(
          ([key, value]) =>
            value !==
            (key === "name"
              ? workout.title
              : key === "date"
                ? workout.workout_date
                : workout.scheduled_start_at?.slice(11, 16) || "")
        )
      )
    : {}
  const valuesDirty =
    Object.keys(metadataPatch).length > 0 ||
    hasPlannedValueChanges(draft, saved, sport)
  const dirty = valuesDirty || completedDirty || text.dirty || personal.dirty
  // A second input event (Escape, Back, or close) can arrive before passive
  // effects. Publish the committed draft state before another event can exit.
  useLayoutEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  const canSave = editable || text.editable || !readOnly
  const save = async (close = false) => {
    if (
      busy ||
      saving.current ||
      (valuesDirty && editable && (loading || !revision))
    )
      return
    // Keep the form and its draft visible until every changed field is saved.
    let values: ReturnType<typeof changedPlannedValues>
    let completedValues: ReturnType<typeof changedCompletedValues> | undefined
    try {
      values =
        valuesDirty && editable ? changedPlannedValues(draft, saved, sport) : {}
      completedValues = completedDirty ? changedCompletedValues(completedDraft, completedSaved, sport) : undefined
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Check the planned values."
      )
      return
    }
    saving.current = true
    setBusy(true)
    setError("")
    setNotice("")
    const feedback = beginWorkoutSaveFeedback(true, workout.id)
    let warning: string | undefined
    try {
      await yieldForWorkoutFeedback()
      requireCurrentAccount()
      if (activityId && !readOnly) {
        const target = `activity:${activityId}`
        text.retain()
        const token = retainWorkoutSaveDraft(scope, workout.id, "totals", {values, completedValues, metadata:metadataPatch})
        const editor = await loadWorkoutEditor(`/api/workouts/${encodeURIComponent(target)}/editor`)
        requireCurrentAccount()
        // Read a current provider revision before accepting the intent. A field
        // changed since this form opened needs review, never silent overwrite.
        for (const key of Object.keys(completedValues || {}) as Array<keyof WorkoutSummaryValues>) {
          if (editor.completedValues?.[key] !== completed[key])
            throw Error("Completed values changed in Intervals.icu. Your draft is retained; reopen the workout to review them.")
        }
        const descriptionChanged = text.description !== text.savedDescription
        if(descriptionChanged && editor.originalDescription !== text.savedDescription)
          throw Error("The description changed in Intervals.icu. Your draft is retained; reopen it to review both versions.")
        const model = {...editor.model,
          ...(metadata?.name !== undefined && metadata.name !== workout.title ? {name:metadata.name} : {}),
          ...(metadata?.date !== undefined && metadata.date !== workout.workout_date ? {date:metadata.date} : {})}
        const result = await writeWorkoutEditor(target, {
          model, revision:editor.revision, completedValues,
          completedEditableFields:editor.completedEditableFields,
          ...(descriptionChanged ? {description:text.description, descriptionMode:"manual" as const} : {}),
          comment:text.comment, commentId:text.creationId,
          ...(metadata?.time !== undefined && metadata.time !== (workout.scheduled_start_at?.slice(11,16) || "") ? {time:metadata.time} : {}),
          comments:text.comments.map(item=>({id:item.id,body:item.body})),
        })
        requireCurrentAccount()
        clearWorkoutSaveDraft(scope, workout.id, "totals", token)
        setCompletedSaved(completedDraft)
        completedSavedRef.current = completedDraft
        text.acceptCommitted()
        if (personal.dirty) await personal.save()
        setNotice(result.refreshWarning || "Saved on this device; sync pending.")
        if (close) onClose?.()
        return
      }
      if (durableSave || completedValues) {
        // Save all visible fields with the complete editor prescription in the
        // same durable transaction. No separate personal/text write precedes it.
        text.retain()
        const token = retainWorkoutSaveDraft(scope, workout.id, "totals", {values, completedValues, metadata:metadataPatch})
        const local = localCommittedWorkout(workout.id)
        let model = structuredClone(local?.input.model || editorModel.current || workout.editor_model)
        let currentRevision = local?.revision || revision
        if (!model || !currentRevision) {
          const editor = await loadWorkoutEditor(`/api/workouts/${encodeURIComponent(workout.id)}/editor`)
          requireCurrentAccount()
          model = editor.model
          editorZones.current = editor.zoneSettings
          currentRevision = editor.revision
        }
        const name = metadata?.name ?? workout.title
        const date = metadata?.date ?? workout.workout_date ?? model.date
        if (model.unstructured)
          model = {...model,...simpleWorkoutModel({name,sport:model.sport,date,description:text.description,values,unstructured:true})}
        else model = {...model,name,date}
        loadGeneration.current++
        const result = await writeWorkoutEditor(workout.id, {
          model, revision:currentRevision, values, completedValues, description:text.description,
          descriptionMode:"manual", comment:text.comment, commentId:text.creationId,
          time:metadata?.time ?? workout.scheduled_start_at?.slice(11,16) ?? "",
          personal:personal.value,
          personalId:personal.id, comments:text.comments.map(item=>({id:item.id,body:item.body})),
          zoneSettings:local?.input.zoneSettings || editorZones.current,
        })
        requireCurrentAccount()
        editorModel.current = model
        const next = plannedValueDraft(result.workout.workout_summary?.planned,sport)
        setSaved(next)
        setDraft(next)
        setRevision(result.revision)
        setCompletedSaved(completedDraft)
        completedSavedRef.current = completedDraft
        setLoading(false)
        clearWorkoutSaveDraft(scope,workout.id,"totals",token)
        clearWorkoutSaveDraft(scope,workout.id,"personal")
        personal.acceptCommitted(personal.value)
        text.acceptCommitted()
        setNotice(result.refreshWarning || "Saved in the app; sync pending.")
        // The commit client owns synchronization status. A local transaction
        // must never produce the legacy 'Synced to Intervals.icu' notification.
        if (close) onClose?.()
        return
      }
      if (personal.dirty) await personal.save()
      requireCurrentAccount()
      text.retain()
      const token =
        valuesDirty && editable
          ? retainWorkoutSaveDraft(scope, workout.id, "totals", {
              values,
              metadata: metadataPatch,
            })
          : undefined
      const pending =
        valuesDirty && editable
          ? savePlannedWorkoutValues(
              workout.id,
              values,
              revision,
              metadataPatch,
              { feedback: false }
            )
          : undefined
      if (valuesDirty && editable) {
        const result = (await pending)!
        requireCurrentAccount()
        clearWorkoutSaveDraft(scope, workout.id, "totals", token)
        const next = plannedValueDraft(
          result.workout.workout_summary?.planned,
          sport
        )
        setSaved(next)
        setDraft(next)
        setRevision(result.revision)
        warning = result.refreshWarning
      }
      await text.save({ feedback: false })
      requireCurrentAccount()
      if (editable && text.dirty && !close) await load()
      requireCurrentAccount()
      setNotice(warning || "Saved")
      feedback.confirm(warning)
      if (close) onClose?.()
    } catch (e) {
      feedback.fail(e)
      setError(
        e instanceof Error ? e.message : "Planned values could not be saved."
      )
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const footer = onClose ? (
    <footer className="desktop-workout-dialog-footer" data-workout-dirty={dirty}>
      {editable && (
        <label className="desktop-workout-auto-calculate">
          <input
            type="checkbox"
            checked={personal.value.autoCalculate}
            disabled={busy}
            onChange={(event) =>
              personal.setValue({
                ...personal.value,
                autoCalculate: event.target.checked,
              })
            }
          />
          Automatically calculate planned values
        </label>
      )}
      {error && footerTarget && (
        <p role="alert" className="desktop-workout-save-error">
          {error}
        </p>
      )}
      {onDelete && (
        <button className="desktop-workout-delete-action" type="button" disabled={busy || loading} onClick={onDelete}>
          Delete
        </button>
      )}
      {canSave && (
        <button
          type="button"
          className="desktop-workout-cancel-action"
          disabled={busy}
          onClick={() => {
            clearWorkoutSaveDraft(scope, workout.id, "totals")
            text.discardDraft()
            personal.discard()
            onClose()
          }}
        >
          Cancel
        </button>
      )}
      {canSave && (
        <>
          <button
            type="submit"
            className="desktop-workout-save-action"
            form={`desktop-totals-${workout.id}`}
            disabled={
              busy ||
              !dirty ||
              (valuesDirty && editable && (loading || !revision))
            }
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="desktop-workout-save-close"
            disabled={
              busy || (valuesDirty && editable && (loading || !revision))
            }
            onClick={() => (dirty ? void save(true) : onClose())}
          >
            <span className="desktop-workout-save-close-label">Save &amp; Close</span>
            <span className="desktop-workout-clean-close-label">Close</span>
          </button>
        </>
      )}
      {!canSave && (
        <button
          type="button"
          className="desktop-workout-save-close"
          onClick={onClose}
        >
          Close
        </button>
      )}
    </footer>
  ) : null
  return (
    <section
      aria-label="Planned and completed values"
      className="desktop-workout-totals"
    >
      <form
        id={`desktop-totals-${workout.id}`}
        onSubmit={(e) => {
          e.preventDefault()
          if (
            dirty &&
            canSave &&
            !busy &&
            !(valuesDirty && (loading || !revision))
          )
            void save()
        }}
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
            {plannedValueRows(sport).map(
              ({
                key,
                rowKey = key,
                presentation,
                label,
                unit,
                planned: allowPlanned = true,
              }) => (
                <tr key={rowKey}>
                  <th scope="row">
                    <label
                      className={
                        allowPlanned && editable && key !== "normalized_power"
                          ? "desktop-editable-metric"
                          : undefined
                      }
                      htmlFor={
                        allowPlanned ? `${workout.id}-${rowKey}` : undefined
                      }
                    >
                      {label}
                    </label>
                  </th>
                  <td>
                    {!allowPlanned ? (
                      <span aria-label={`Planned ${label.toLowerCase()}`}>
                        —
                      </span>
                    ) : editable ? (
                      <input
                        id={`${workout.id}-${rowKey}`}
                        aria-label={`Planned ${label.toLowerCase()}`}
                        value={plannedDraftValue(
                          draft,
                          key,
                          sport,
                          presentation
                        )}
                        readOnly={!editable || key === "normalized_power"}
                        disabled={editable && busy}
                        inputMode={
                          key === "duration_seconds" || key === "average_speed"
                            ? "text"
                            : "decimal"
                        }
                        title={
                          key === "normalized_power"
                            ? "Calculated from planned intervals"
                            : `Edit planned ${label.toLowerCase()}`
                        }
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(e) => {
                          const value = e.target.value
                          setDraft((current) =>
                            updatePlannedValueDraft(
                              current,
                              key,
                              value,
                              sport,
                              personal.value.autoCalculate,
                              presentation
                            )
                          )
                          setNotice("")
                        }}
                      />
                    ) : (
                      <output
                        className="desktop-recorded-value"
                        aria-label={`Planned ${label.toLowerCase()}`}
                      >
                        {plannedDraftValue(draft, key, sport, presentation) ||
                          "—"}
                      </output>
                    )}
                  </td>
                  <td>
                    {completedEditable && editableCompletedValue(key) && (!activityId || text.completedEditableFields.includes(key)) ? <input
                      aria-label={`Completed ${label.toLowerCase()}`}
                      value={plannedDraftValue(completedDraft, key, sport, presentation)}
                      disabled={busy || Boolean(activityId && recordedStatus.loading)}
                      inputMode={key === "duration_seconds" ? "text" : "decimal"}
                      onFocus={event=>event.currentTarget.select()}
                      onChange={event=>{setError("");setCompletedDraft(current=>updatePlannedValueDraft(current,key,event.target.value,sport,false,presentation))}}
                    /> : <output
                      className="desktop-recorded-value"
                      aria-label={`Completed ${label.toLowerCase()}`}
                      title={activityId && key === "duration_seconds" ? "Intervals.icu does not support changing an existing activity's duration through this integration." : undefined}
                    >
                      {formatPlannedValue(
                        key,
                        completed[key],
                        sport,
                        true,
                        presentation
                      ) || "—"}
                    </output>}
                  </td>
                  <td>{unit}</td>
                </tr>
              )
            )}
          </tbody>
        </table>
        {canSave && !onClose && (
          <div className="desktop-workout-detail-actions">
            <button
              type="submit"
              disabled={
                busy ||
                !dirty ||
                (valuesDirty && editable && (loading || !revision))
              }
            >
              {busy ? "Saving…" : "Save workout"}
            </button>
            {editable && (
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => void load()}
              >
                {loading ? "Loading…" : "Reload values"}
              </button>
            )}
          </div>
        )}
        {editable && (
          <p className="desktop-workout-detail-hint">
            {workout.status === "completed"
              ? "Planned totals are separate from the recorded workout."
              : !hasWorkoutProfile(workout)
                ? "Planned totals. Build Workout to add intervals."
                : "Planned totals. Select the profile to edit intervals."}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {error && editable && (
          <button
            type="button"
            className="text-xs text-blue-600"
            onClick={() => void load()}
          >
            Reload values
          </button>
        )}
        {notice && <p role={syncFailed ? "alert" : "status"}>{notice}{syncFailed && <> <WorkoutSyncAction workoutId={workout.id} onError={setNotice}/></>}</p>}
      </form>
      <div className="desktop-workout-recorded">
        {recordedStatus.binding === recordedBinding &&
          recordedStatus.loading && (
            <p role="status">Refreshing completed values…</p>
          )}
        {recordedStatus.binding === recordedBinding && recordedStatus.error && (
          <p role="alert">
            {recordedStatus.error}{" "}
            <button
              type="button"
              onClick={() => setRecordedRetry((value) => value + 1)}
            >
              Retry completed values
            </button>
          </p>
        )}
        <table aria-label="Recorded minimum average maximum">
          <colgroup>
            <col className="metric-label" />
            <col />
            <col />
            <col />
            <col className="metric-unit" />
          </colgroup>
          <thead>
            <tr>
              <th />
              {["Min", "Avg", "Max"].map((label) => (
                <th key={label}>{label}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {recordedValueRows(sport)
              .map((row) => ({
                ...row,
                key:
                  row.kind === "pace"
                    ? ("average_speed" as const)
                    : ("average_power" as const),
                values:
                  row.kind === "power"
                    ? [
                        completed.min_power,
                        completed.average_power,
                        completed.max_power,
                      ]
                    : row.kind === "pace"
                      ? [
                          completed.max_speed,
                          completed.average_speed,
                          completed.min_speed,
                        ]
                      : [
                          completed.min_hr,
                          completed.average_hr,
                          completed.max_hr,
                        ],
              }))
              .map((row) => (
                <tr key={row.label}>
                  <th>{row.label}</th>
                  {row.values.map((value, index) => (
                    <td key={index}>
                      <output
                        className="desktop-recorded-value"
                        aria-live="off"
                        aria-label={`Recorded ${["minimum", "average", "maximum"][index]} ${row.label.toLowerCase()}`}
                      >
                        {formatPlannedValue(
                          row.key,
                          value,
                          sport,
                          true,
                          row.kind === "pace" && sport === "Brick"
                            ? "pace"
                            : undefined
                        ) || "—"}
                      </output>
                    </td>
                  ))}
                  <td>{row.unit}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <WorkoutEquipment
          value={personal.value}
          onChange={personal.setValue}
          scope={scope}
          sport={sport}
          disabled={busy}
          options={personal.equipmentOptions}
        />
      )}
      {footer && (footerTarget ? createPortal(footer, footerTarget) : footer)}
    </section>
  )
}

function DesktopWorkoutDetailsForm({
  workout,
  readOnly = false,
  metadata,
  onClose,
  onDelete,
  footerTarget,
  commentsTarget,
  onBusyChange,
  onDirtyChange,
  onDiscardReady,
}: {
  workout: PlannedWorkout
  readOnly?: boolean
} & DetailOptions) {
  const text = useWorkoutTextDraft(workout, readOnly)
  const [scope] = useState(trainingCacheScope)
  const personal = useWorkoutPersonalFields(scope, workout.id)
  const discardTextDraft = text.discardDraft,
    discardPersonalDraft = personal.discard
  useEffect(() => {
    onDiscardReady?.(() => {
      clearWorkoutSaveDraft(scope, workout.id, "totals")
      discardTextDraft()
      discardPersonalDraft()
    })
    return () => onDiscardReady?.(null)
  }, [
    scope,
    workout.id,
    discardTextDraft,
    discardPersonalDraft,
    onDiscardReady,
  ])
  const [textBusy, setTextBusy] = useState(false)
  const handleBusy = useCallback(
    (busy: boolean) => {
      setTextBusy(busy)
      onBusyChange?.(busy)
    },
    [onBusyChange]
  )
  return (
    <div className="desktop-workout-details-shell" key={workout.id}>
      <WorkoutDetailNavigation />
      <div className="desktop-workout-details-grid">
        <PlannedTotals
          workout={workout}
          readOnly={readOnly}
          metadata={metadata}
          onClose={onClose}
          onDelete={onDelete}
          footerTarget={footerTarget}
          onBusyChange={handleBusy}
          onDirtyChange={onDirtyChange}
          text={text}
          personal={personal}
        />
        <div className="desktop-workout-detail-text">
          <section
            aria-label="Workout description"
            className="desktop-workout-description"
          >
            {!readOnly ? (
              <WorkoutAttachments
                personal={personal}
                disabled={textBusy || Boolean(workout.app_pending_operation)}
              />
            ) : (
              <h3>
                <label htmlFor={workout.id + "-description"}>Description</label>
              </h3>
            )}
            <WorkoutDescriptionInput
              id={workout.id + "-description"}
              aria-label="Workout description"
              value={text.description}
              maxLength={30000}
              readOnly={!text.editable}
              disabled={textBusy}
              onChange={(event) => text.setDescription(event.target.value)}
            />
          </section>
          {text.editable &&
            (commentsTarget ? (
              createPortal(
                <PlannedComments text={text} busy={textBusy} showEmpty />,
                commentsTarget
              )
            ) : (
              <PlannedComments text={text} busy={textBusy} />
            ))}
          {!readOnly && (
            <WorkoutPersonalNotes
              value={personal.value}
              onChange={personal.setValue}
              disabled={textBusy}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function DesktopWorkoutDetails(
  props: Parameters<typeof DesktopWorkoutDetailsForm>[0]
) {
  return <DesktopWorkoutDetailsForm key={props.workout.id} {...props} />
}
