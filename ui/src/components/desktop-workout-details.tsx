import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { apiFetch } from "@/lib/api-client"
import { randomId } from "@/lib/random-id"
import {
  cachedActivitySummary,
  loadActivitySummary,
} from "@/lib/activity-analysis"
import {
  savePlannedWorkoutValues,
  type PlannedWorkout,
  type WorkoutSummaryValues,
} from "@/lib/training-context"
import {
  changedPlannedValues,
  formatPlannedValue,
  plannedValueDraft,
  plannedValueRows,
} from "@/lib/planned-workout-values"
import { WorkoutDescription } from "@/components/workout-description"
import "./desktop-workout-details.css"
import type { DesktopWorkoutMetadata } from "./desktop-workout-header"
type DetailOptions = {
  metadata?: DesktopWorkoutMetadata
  onClose?: () => void
  onDelete?: () => void
  footerTarget?: HTMLElement | null
  onBusyChange?: (busy: boolean) => void
}

interface Comment {
  id: string
  body: string
  workout_id: string
  type?: string
  comment_type?: string
  created_at: string
}
function PlannedComments({
  workoutId,
  type = "pre",
}: {
  workoutId: string
  type?: "pre" | "post"
}) {
  const [comments, setComments] = useState<Comment[]>([]),
    [draft, setDraft] = useState("")
  const [creationId, setCreationId] = useState(randomId),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    void apiFetch(`/api/comments?${new URLSearchParams({ workoutId })}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok || !Array.isArray(data.comments))
          throw Error(data.error || "Comments could not be loaded.")
        if (!controller.signal.aborted) setComments(data.comments)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [workoutId])
  const add = async () => {
    setBusy(true)
    setError("")
    try {
      const response = await apiFetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId,
          body: draft,
          type,
          creationId,
        }),
        signal: AbortSignal.timeout(30_000),
      })
      const comment = (await response.json()) as Comment & { error?: string }
      if (
        !response.ok ||
        !comment.id ||
        comment.workout_id !== workoutId ||
        comment.body !== draft.trim()
      )
        throw Error(
          comment.error ||
            "The comment save could not be confirmed. Your draft is retained."
        )
      setComments((previous) => [
        comment,
        ...previous.filter((item) => item.id !== comment.id),
      ])
      setDraft("")
      setCreationId(randomId())
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The comment save could not be confirmed."
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="desktop-planned-comments"
      aria-label={
        type === "pre" ? "Planned workout comments" : "Post-activity comments"
      }
    >
      <h3>{type === "pre" ? "Comments" : "Post-activity Comments"}</h3>
      {comments
        .filter((item) => (item.type || item.comment_type) === type)
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
          type === "pre"
            ? "New planned workout comment"
            : "New post-activity comment"
        }
        placeholder="Enter a new comment"
        maxLength={2000}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="desktop-workout-detail-actions">
        <button
          type="button"
          disabled={busy || !draft.trim()}
          onClick={() => void add()}
        >
          {busy ? "Saving…" : "Add comment"}
        </button>
        <span>{draft.length} / 2000</span>
      </div>
      {error && <p role="alert">{error}</p>}
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
}: {
  workout: PlannedWorkout
  readOnly: boolean
} & DetailOptions) {
  const editable = /^event:[1-9]\d*$/.test(workout.id) && !readOnly
  const [saved, setSaved] = useState(() =>
    plannedValueDraft(workout.workout_summary?.planned, workout.sport)
  )
  const [draft, setDraft] = useState(saved),
    [revision, setRevision] = useState("")
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(editable),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("")
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
      setLoading(true)
      setError("")
      setNotice("")
      try {
        const response = await apiFetch(
          `/api/workouts/${encodeURIComponent(workout.id)}/planned-values`,
          { signal }
        )
        const data = await response.json()
        if (!response.ok || !data.revision || data.workout?.id !== workout.id)
          throw Error(data.error || "Planned values could not be loaded.")
        if (signal?.aborted) return
        const next = plannedValueDraft(
          data.workout.workout_summary?.planned,
          workout.sport
        )
        setSaved(next)
        setDraft(next)
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
          const response = await apiFetch(
            `/api/workouts/${encodeURIComponent(workout.id)}/planned-values`,
            { signal: request.signal }
          )
          const data = await response.json()
          if (!response.ok || !data.revision || data.workout?.id !== workout.id)
            throw Error(
              data.error || "Saved workout values could not be refreshed."
            )
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
  const dirty =
    Object.keys(metadataPatch).length > 0 ||
    plannedValueRows(workout.sport).some(({ key }) => draft[key] !== saved[key])
  const save = async (close = false) => {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const values = changedPlannedValues(draft, saved, workout.sport)
      const result = await savePlannedWorkoutValues(
        workout.id,
        values,
        revision,
        metadataPatch
      )
      const next = plannedValueDraft(
        result.workout.workout_summary?.planned,
        workout.sport
      )
      setSaved(next)
      setDraft(next)
      setRevision(result.revision)
      setNotice(result.refreshWarning || "Saved to Intervals.icu")
      if (close) onClose?.()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Planned values could not be saved."
      )
    } finally {
      setBusy(false)
    }
  }
  const footer = onClose ? (
    <footer className="desktop-workout-dialog-footer">
      {onDelete && (
        <button type="button" disabled={busy || loading} onClick={onDelete}>
          Delete
        </button>
      )}
      {editable && <button type="button" disabled={busy} onClick={onClose}>
        Cancel
      </button>}
      {editable && (
        <>
          <button
            type="submit"
            form={`desktop-totals-${workout.id}`}
            disabled={busy || loading || !revision || !dirty}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="desktop-workout-save-close"
            disabled={busy || (dirty && (loading || !revision))}
            onClick={() => (dirty ? void save(true) : onClose())}
          >
            Save &amp; Close
          </button>
        </>
      )}
      {!editable && (
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
          if (dirty && editable && revision && !busy && !loading) void save()
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
                  <label className={editable && key !== "normalized_power" ? "desktop-editable-metric" : undefined} htmlFor={`${workout.id}-${key}`}>{label}</label>
                </th>
                <td>
                  {editable ? <input
                    id={`${workout.id}-${key}`}
                    aria-label={`Planned ${label.toLowerCase()}`}
                    value={draft[key] || ""}
                    readOnly={!editable || key === "normalized_power"}
                    disabled={editable && (busy || loading || !revision)}
                    inputMode={
                      key === "duration_seconds" || key === "average_speed"
                        ? "text"
                        : "decimal"
                    }
                    title={key === "normalized_power" ? "Calculated from planned intervals" : `Edit planned ${label.toLowerCase()}`}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(e) => {
                      setDraft({ ...draft, [key]: e.target.value })
                      setNotice("")
                    }}
                  /> : <output className="desktop-recorded-value" aria-label={`Planned ${label.toLowerCase()}`}>{draft[key] || "—"}</output>}
                </td>
                <td>
                  <output className="desktop-recorded-value" aria-label={`Completed ${label.toLowerCase()}`}>
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
        {editable && !onClose && (
          <div className="desktop-workout-detail-actions">
            <button
              type="submit"
              disabled={busy || loading || !revision || !dirty}
            >
              {busy ? "Saving…" : "Save planned values"}
            </button>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              {loading ? "Loading…" : "Reload values"}
            </button>
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
                    <output className="desktop-recorded-value" aria-live="off"
                      aria-label={`Recorded ${["minimum", "average", "maximum"][index]} ${row.label.toLowerCase()}`}
                    >{formatPlannedValue(
                        row.key,
                        value,
                        workout.sport,
                        true
                      ) || "—"}</output>
                  </td>
                ))}
                <td>{row.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && (footerTarget ? createPortal(footer, footerTarget) : footer)}
    </section>
  )
}

export function DesktopWorkoutDetails({
  workout,
  readOnly = false,
  metadata,
  onClose,
  onDelete,
  footerTarget,
  onBusyChange,
}: {
  workout: PlannedWorkout
  readOnly?: boolean
} & DetailOptions) {
  const planned =
    workout.status !== "completed" &&
    /^event:[1-9]\d*$/.test(workout.id) &&
    !readOnly
  return (
    <div className="desktop-workout-details-grid" key={workout.id}>
      <PlannedTotals
        workout={workout}
        readOnly={readOnly}
        metadata={metadata}
        onClose={onClose}
        onDelete={onDelete}
        footerTarget={footerTarget}
        onBusyChange={onBusyChange}
      />
      <div className="desktop-workout-detail-text">
        {(planned ||
          (!readOnly &&
            workout.status === "completed" &&
            /^(event:\d+|activity:i?\d+)$/.test(workout.id))) && (
          <PlannedComments
            workoutId={workout.id}
            type={planned ? "pre" : "post"}
          />
        )}
        <WorkoutDescription workout={workout} title="Description" />
      </div>
    </div>
  )
}
