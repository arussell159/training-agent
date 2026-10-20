import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cachedWorkoutValues, loadWorkoutValues, clearWorkoutReads } from "@/lib/workout-read-cache"
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
  trainingCacheScope,
  type PlannedWorkout,
  type WorkoutSummaryValues,
} from "@/lib/training-context"
import {
  changedPlannedValues,
  formatPlannedValue,
  plannedValueDraft,
  plannedValueRows,
  mergeLoadedPlannedDraft,
  updatePlannedValueDraft,
} from "@/lib/planned-workout-values"
import "./desktop-workout-details.css"
import type { DesktopWorkoutMetadata } from "./desktop-workout-header"
import { readWorkoutSaveDraft, retainWorkoutSaveDraft, clearWorkoutSaveDraft, validPlannedSaveDraft, type PlannedSaveDraft } from "@/lib/workout-save-drafts"
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
  text,
  personal,
}: {
  text: WorkoutTextDraft
  personal: ReturnType<typeof useWorkoutPersonalFields>
  workout: PlannedWorkout
  readOnly: boolean
} & DetailOptions) {
  const editable = /^event:[1-9]\d*$/.test(workout.id) && !readOnly
  const [scope] = useState(trainingCacheScope)
  const [recovered] = useState(() => readWorkoutSaveDraft<PlannedSaveDraft>(scope, workout.id, "totals",validPlannedSaveDraft)?.value)
  const [saved, setSaved] = useState(() =>
    plannedValueDraft(cachedWorkoutValues(workout.id)?.workout.workout_summary?.planned || workout.workout_summary?.planned, workout.sport)
  )
  const [draft, setDraft] = useState(() => ({...saved, ...Object.fromEntries(Object.entries(recovered?.values || {}).map(([key,value]) => [key,formatPlannedValue(key as Parameters<typeof formatPlannedValue>[0],value,workout.sport)]))})),
    [revision, setRevision] = useState(() => cachedWorkoutValues(workout.id)?.revision || "")
  const [localBusy, setBusy] = useState(false),
    [loading, setLoading] = useState(editable && !cachedWorkoutValues(workout.id)),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("")
  const busy = localBusy || personal.busy || Boolean(workout.app_pending_operation)
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
  const [downloaded, setDownloaded] = useState<WorkoutSummaryValues | null>(
    () =>
      activityId
        ? cachedActivitySummary(activityId, activityRevision) || null
        : null
  )
  useEffect(() => {
    if (!activityId) return
    const controller = new AbortController()
    void loadActivitySummary(activityId, activityRevision, controller.signal)
      .then((values) => {
        if (!controller.signal.aborted) setDownloaded(values)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [activityId, activityRevision])
  const completed = { ...workout.workout_summary?.completed, ...downloaded }
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!editable) return
      const beforeRead = savedRef.current
      setLoading(!cachedWorkoutValues(workout.id))
      setError("")
      setNotice("")
      try {
        const data = await loadWorkoutValues(workout.id, signal)
        if (signal?.aborted) return
        const next = plannedValueDraft(
          data.workout.workout_summary?.planned,
          workout.sport
        )
        setSaved(next)
        setDraft(current => mergeLoadedPlannedDraft(current, beforeRead, next))
        setRevision(data.revision)
      } catch (e) {
        if (!signal?.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Planned values could not be loaded."
          )
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [editable, workout.id, workout.sport]
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
      setLoading(true)
      void (async () => {
        try {
          clearWorkoutReads()
          const data = await loadWorkoutValues(workout.id, request.signal)
          if (request.signal.aborted) return
          const next = plannedValueDraft(
            data.workout.workout_summary?.planned,
            workout.sport
          )
          const rows = plannedValueRows(workout.sport)
          const hasDraft = rows.some(({ key }) => draft[key] !== saved[key])
          if (hasDraft && rows.some(({ key }) => next[key] !== saved[key])) {
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
  }, [editable, workout.id, workout.sport, busy, draft, saved])
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
    plannedValueRows(workout.sport).some(({ key }) => draft[key] !== saved[key])
  const dirty = valuesDirty || text.dirty || personal.dirty
  const canSave = editable || text.editable || !readOnly
  const save = async (close = false) => {
    if (saving.current || (valuesDirty && editable && (loading || !revision))) return
    // Validate before dismissing. The async request and global feedback survive
    // unmounting this form; a failed attempt is restored when it is reopened.
    let values: ReturnType<typeof changedPlannedValues>
    try { values = valuesDirty && editable ? changedPlannedValues(draft, saved, workout.sport) : {} }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Check the planned values."); return }
    saving.current = true
    setBusy(true)
    setError("")
    setNotice("")
    const feedback=beginWorkoutSaveFeedback(true,workout.id)
    let warning: string | undefined
    try {
      if (personal.dirty) await personal.save()
      text.retain()
      const token = valuesDirty && editable ? retainWorkoutSaveDraft(scope,workout.id,"totals",{values,metadata:metadataPatch}) : undefined
      const pending = valuesDirty && editable ? savePlannedWorkoutValues(workout.id,values,revision,metadataPatch,{feedback:false}) : undefined
      if (close) onClose?.()
      if (valuesDirty && editable) {
        const result = (await pending)!
        clearWorkoutSaveDraft(scope,workout.id,"totals",token)
        const next = plannedValueDraft(
          result.workout.workout_summary?.planned,
          workout.sport
        )
        setSaved(next)
        setDraft(next)
        setRevision(result.revision)
        warning=result.refreshWarning
      }
      await text.save({feedback:false})
      if (editable && text.dirty && !close) await load()
      setNotice(warning || "Saved")
      feedback.confirm(warning)
    } catch (e) {
      feedback.fail(close ? new Error(`${e instanceof Error ? e.message : "The save could not be confirmed."} Reopen the workout to review your retained draft.`) : e)
      setError(
        e instanceof Error ? e.message : "Planned values could not be saved."
      )
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const footer = onClose ? (
    <footer className="desktop-workout-dialog-footer">
      {editable && <label className="desktop-workout-auto-calculate">
        <input type="checkbox" checked={personal.value.autoCalculate} disabled={busy} onChange={event => personal.setValue({ ...personal.value, autoCalculate: event.target.checked })} />
        Automatically calculate planned values
      </label>}
      {error && footerTarget && (
        <p role="alert" className="desktop-workout-save-error">
          {error}
        </p>
      )}
      {onDelete && (
        <button type="button" disabled={busy || loading} onClick={onDelete}>
          Delete
        </button>
      )}
      {canSave && (
        <button type="button" disabled={busy} onClick={() => {clearWorkoutSaveDraft(scope,workout.id,"totals");text.discardDraft();personal.discard();onClose()}}>
          Cancel
        </button>
      )}
      {canSave && (
        <>
          <button
            type="submit"
            form={`desktop-totals-${workout.id}`}
            disabled={busy || !dirty || (valuesDirty && editable && (loading || !revision))}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="desktop-workout-save-close"
            disabled={busy || (valuesDirty && editable && (loading || !revision))}
            onClick={() => (dirty ? void save(true) : onClose())}
          >
            Save &amp; Close
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
            {plannedValueRows(workout.sport).map(({ key, label, unit }) => (
              <tr key={key}>
                <th scope="row">
                  <label
                    className={
                      editable && key !== "normalized_power"
                        ? "desktop-editable-metric"
                        : undefined
                    }
                    htmlFor={`${workout.id}-${key}`}
                  >
                    {label}
                  </label>
                </th>
                <td>
                  {editable ? (
                    <input
                      id={`${workout.id}-${key}`}
                      aria-label={`Planned ${label.toLowerCase()}`}
                      value={draft[key] || ""}
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
                        setDraft(current => updatePlannedValueDraft(current,key,value,workout.sport,personal.value.autoCalculate))
                        setNotice("")
                      }}
                    />
                  ) : (
                    <output
                      className="desktop-recorded-value"
                      aria-label={`Planned ${label.toLowerCase()}`}
                    >
                      {draft[key] || "—"}
                    </output>
                  )}
                </td>
                <td>
                  <output
                    className="desktop-recorded-value"
                    aria-label={`Completed ${label.toLowerCase()}`}
                  >
                    {formatPlannedValue(
                      key,
                      completed[key],
                      workout.sport,
                      true
                    ) || "—"}
                  </output>
                </td>
                <td>{unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canSave && !onClose && (
          <div className="desktop-workout-detail-actions">
            <button
              type="submit"
              disabled={busy || !dirty || (valuesDirty && editable && (loading || !revision))}
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
        {notice && <p role="status">{notice}</p>}
      </form>
      <div className="desktop-workout-recorded">
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
            {[
              /bike|ride/i.test(workout.sport)
                ? {
                    label: "Power",
                    unit: "W",
                    key: "average_power" as const,
                    values: [
                      completed.min_power,
                      completed.average_power,
                      completed.max_power,
                    ],
                  }
                : {
                    label: "Pace",
                    unit: /swim/i.test(workout.sport) ? "min/100yd" : "min/mi",
                    key: "average_speed" as const,
                    values: [
                      completed.max_speed,
                      completed.average_speed,
                      completed.min_speed,
                    ],
                  },
              {
                label: "Heart Rate",
                unit: "bpm",
                key: "average_power" as const,
                values: [
                  completed.min_hr,
                  completed.average_hr,
                  completed.max_hr,
                ],
              },
            ].map((row) => (
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
                        workout.sport,
                        true
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
      {!readOnly && <WorkoutEquipment value={personal.value} onChange={personal.setValue} scope={scope} sport={workout.sport} disabled={busy} options={personal.equipmentOptions} />}
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
}: {
  workout: PlannedWorkout
  readOnly?: boolean
} & DetailOptions) {
  const text = useWorkoutTextDraft(workout, readOnly)
  const [scope] = useState(trainingCacheScope)
  const personal = useWorkoutPersonalFields(scope, workout.id)
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
        text={text}
        personal={personal}
      />
      <div className="desktop-workout-detail-text">
        <section
          aria-label="Workout description"
          className="desktop-workout-description"
        >
          {!readOnly ? <WorkoutAttachments personal={personal} /> : <h3>
            <label htmlFor={workout.id + "-description"}>Description</label>
          </h3>}
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
        {!readOnly && <WorkoutPersonalNotes value={personal.value} onChange={personal.setValue} disabled={textBusy} />}
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
