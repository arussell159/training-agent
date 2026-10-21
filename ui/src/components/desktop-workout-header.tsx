import type { ReactNode } from "react"
import { ArrowLeft, X, Maximize2, Minimize2, ChevronDown, Upload, Download } from "lucide-react"
import { DesktopSportIcon } from "./desktop-sport-icon"
import { DesktopWorkoutToolbar } from "./desktop-workout-toolbar"
import { Button } from "@/components/ui/button"
import { WorkoutEditorMenu } from "@/components/workout-editor-launcher"
import {
  cachedTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import { calendarAddTypes, calendarSportType, calendarSportLabel } from "@/lib/calendar-events"
import { workoutPresentationSport, workoutSelectionKey } from "@/lib/workout-presentation"
import { formatWorkoutTss, workoutTime } from "@/lib/workout-metrics"
import "./workout-analysis.css"
import "./desktop-workout-details.css"
export type DesktopWorkoutMetadata = {
  name: string
  date: string
  time: string
}

export function DesktopWorkoutHeader({
  workout,
  onClose,
  back = false,
  library = false,
  metadata,
  onMetadataChange,
  onSportChange,
  onAnalyze,
  onAnalyze360,
  onSummary,
  onEdit,
  busy = false,
  isNew = false,
  expanded = false,
  onToggleExpanded,
  settings,
  actions,
  recurrence,
  onUpload,
  onExport,
}: {
  workout: PlannedWorkout
  onClose: () => void
  back?: boolean
  library?: boolean
  metadata?: DesktopWorkoutMetadata
  onMetadataChange?: (value: DesktopWorkoutMetadata) => void
  onSportChange?: (sport: string) => void
  onAnalyze?: () => void
  onAnalyze360?: () => void
  onSummary?: () => void
  onEdit?: () => void
  busy?: boolean
  isNew?: boolean
  expanded?: boolean
  onToggleExpanded?: () => void
  settings?: ReactNode
  actions?: ReactNode
  recurrence?: ReactNode
  onUpload?: () => void
  onExport?: () => void
}) {
  const displayedDate = metadata?.date || workout.workout_date
  const day = displayedDate
    ? new Date(`${displayedDate}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : workout.date
  const dayComma = day.indexOf(",")
  const dateLabel =
    dayComma < 0 ? (
      day
    ) : (
      <>
        <span className="desktop-workout-weekday">
          {day.slice(0, dayComma)}
        </span>
        {day.slice(dayComma + 1)}
      </>
    )
  const start = workout.recorded_start_local || workout.scheduled_start_at
  const time =
    start && Number.isFinite(new Date(start).getTime())
      ? new Date(start).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })
      : null
  const metrics = cachedTrainingContext().metrics
  const canonicalSport = workout.editor_model?.sport ||
    (workout.sport !== "Sauna" && calendarAddTypes.some(type => type.sport === workout.provider_type)
      ? workout.provider_type
      : undefined) || workout.sport
  const selectionKey = workoutSelectionKey(workout)
  const displayedSport = selectionKey.startsWith("variant:") ? workoutPresentationSport(workout) : calendarSportLabel(canonicalSport)
  const seconds = (
    workout.status === "completed"
      ? workout.workout_summary?.completed
      : workout.workout_summary?.planned
  )?.duration_seconds
  const whole =
    seconds != null && Number.isFinite(seconds)
      ? Math.max(0, Math.round(seconds))
      : null
  const duration =
    whole != null
      ? `${Math.floor(whole / 3600)}:${String(Math.floor((whole % 3600) / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`
      : isNew
        ? "--:--:--"
        : workoutTime(workout).value
  const distance = plannedDistanceLabel(workout).replace(/^[~≈]\s*/, "")
  const distanceParts =
    distance.match(/^(.*?)\s+(mi|yds?|km|m)$/i) ||
    (isNew ? ["", "--", /swim/i.test(workout.sport) ? "yds" : /row/i.test(workout.sport) ? "m" : "mi"] : null)
  const tss = formatWorkoutTss(workout).replace(/^~\s*/, "")
  const tssParts =
    tss.match(/^(.*?)\s+(TSS)$/i) || (isNew ? ["", "--", "TSS"] : null)
  return (
    <header className="desktop-workout-header">
      <div className="desktop-workout-heading-row">
        <div className="desktop-workout-date">
          {metadata && onMetadataChange ? (
            <label className="desktop-workout-date-edit">
              {dateLabel}
              <input
                type="date"
                disabled={busy}
                aria-label="Workout date"
                form={`desktop-totals-${workout.id}`}
                value={metadata.date}
                onInput={(event) =>
                  onMetadataChange({
                    ...metadata,
                    date: event.currentTarget.value,
                  })
                }
                onChange={(event) =>
                  onMetadataChange({ ...metadata, date: event.target.value })
                }
              />
            </label>
          ) : (
            dateLabel
          )}
        </div>
        {metadata && onMetadataChange ? (
          <label
            className={`desktop-workout-time-edit ${!metadata.time ? "is-empty" : ""}`}
          >
            <input
              className="desktop-workout-time"
              type="time"
              disabled={busy}
              aria-label="Workout start time"
              form={`desktop-totals-${workout.id}`}
              value={metadata.time}
              onInput={(event) =>
                onMetadataChange({
                  ...metadata,
                  time: event.currentTarget.value,
                })
              }
              onChange={(event) =>
                onMetadataChange({ ...metadata, time: event.target.value })
              }
            />
            {!metadata.time && <span aria-hidden="true">Enter Time ▾</span>}
          </label>
        ) : (
          <span className="desktop-workout-time">{time || "Enter Time"}</span>
        )}
        <div
          className="desktop-workout-fitness"
          aria-label="Latest training metrics"
        >
          {(
            [
              ["fitness", "Fitness"],
              ["fatigue", "Fatigue"],
              ["form", "Form"],
            ] as const
          ).map(([key, label]) =>
            metrics[key] != null && Number.isFinite(metrics[key]) ? (
              <span key={key} data-training-metric={key}>
                <span>{label}</span>
                <strong>{Math.round(metrics[key]!)}</strong>
              </span>
            ) : null
          )}
        </div>
        <div className="desktop-workout-actions" inert={busy || undefined}>
          <DesktopWorkoutToolbar settings={settings} actions={actions} disabled={busy} />
          {onToggleExpanded && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={expanded ? "Restore workout size" : "Expand workout"}
              disabled={busy || isNew}
              onClick={onToggleExpanded}
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </Button>
          )}
          {!actions && !library && !isNew && <WorkoutEditorMenu workout={workout} />}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={back ? "Back to workouts" : "Close workout details"}
            onClick={onClose}
          >
            {back ? <ArrowLeft /> : <X />}
          </Button>
        </div>
      </div>
      <div className="desktop-workout-repeat">
        {recurrence || "Does not repeat"}{" "}
        {!isNew && <span>
          {workout.status === "completed"
              ? "Completed"
              : "Planned"}
        </span>}
      </div>
      <div className="desktop-workout-header-main">
        <div
          className="desktop-workout-overview"
          aria-label="Workout overview"
          data-workout-completed={workout.status === "completed"}
        >
          {metadata && onMetadataChange ? (
            <input
              className="desktop-workout-title-input"
              disabled={busy}
              aria-label="Workout title"
              placeholder={isNew ? "Untitled Workout" : undefined}
              autoFocus={isNew}
              form={`desktop-totals-${workout.id}`}
              value={metadata.name}
              onChange={(event) =>
                onMetadataChange({ ...metadata, name: event.target.value })
              }
            />
          ) : (
            <h2 title={workout.title}>{workout.title}</h2>
          )}
          <div className="desktop-workout-key-values">
            {onSportChange ? <label className="desktop-workout-sport-picker">
              <DesktopSportIcon sport={displayedSport} />
              <ChevronDown size={12} aria-hidden="true" />
              <select aria-label="Workout sport" disabled={busy} value={selectionKey.startsWith("variant:") ? selectionKey : calendarSportType(displayedSport)} onChange={event => onSportChange(event.target.value)}>
                {calendarAddTypes.filter(type => type.sport !== "Note" && type.label !== "Sauna").map(type => <option key={workoutSelectionKey(type)} value={workoutSelectionKey(type)}>{type.label}</option>)}
              </select>
            </label> : <DesktopSportIcon sport={displayedSport} />}
            <strong className={isNew && whole == null ? "desktop-workout-empty-duration" : undefined}>{duration}</strong>
            <strong title={plannedDistanceLabel(workout)}>
              {distanceParts ? (
                <>
                  {distanceParts[1]}
                  <span className="desktop-workout-value-unit">
                    {" "}
                    {distanceParts[2]}
                  </span>
                </>
              ) : (
                distance
              )}
            </strong>
            <strong title={formatWorkoutTss(workout)}>
              {tssParts ? (
                <>
                  {tssParts[1]}
                  <span className="desktop-workout-value-unit">
                    {" "}
                    {tssParts[2]}
                  </span>
                </>
              ) : (
                tss
              )}
            </strong>
          </div>
          <div className="desktop-workout-context">
            <span>{displayedSport}</span>
            <span>
              {workout.status === "completed" ? "Completed" : "Planned"}
            </span>
          </div>
          {onExport && !isNew && (
            <button className="desktop-workout-export" type="button" aria-label="Export workout" title="Export workout" disabled={busy} onClick={onExport}>
              <Download size={17} aria-hidden="true" />
            </button>
          )}
        </div>
        {(isNew || onUpload || onAnalyze || onAnalyze360 || onSummary || onEdit) && (
          <div className="desktop-workout-view-actions">
            {(isNew || onUpload) && (
              <>
                <button
                  type="button"
                  disabled={busy || isNew || !onUpload}
                  onClick={onUpload}
                  title={!isNew && onUpload ? "Upload a workout recording" : "Save the workout before uploading a recording"}
                >
                  <Upload size={14} aria-hidden="true" />
                  Upload
                </button>
                {!onAnalyze && <button
                  type="button"
                  disabled
                  title="Analysis requires a completed recording"
                >
                  Analyze
                </button>}
                {!onAnalyze360 && <button
                  type="button"
                  disabled
                  title="Analysis requires a completed recording"
                >
                  Analyze 360
                </button>}
              </>
            )}
            {onEdit && (!onUpload || workout.unstructured || workout.editor_model?.unstructured) && !isNew && (
              <button type="button" disabled={busy} onClick={onEdit}>
                {workout.unstructured || workout.editor_model?.unstructured ? "Build Workout" : "Edit workout"}
              </button>
            )}
            {onAnalyze && (
              <button
                type="button"
                data-workout-view="analysis"
                disabled={busy}
                onClick={onAnalyze}
              >
                Analyze
              </button>
            )}
            {onSummary && (
              <button
                type="button"
                data-workout-view="summary"
                disabled={busy}
                onClick={onSummary}
              >
                Summary
              </button>
            )}
            {onAnalyze360 && (
              <button
                type="button"
                data-workout-view="360"
                disabled={busy}
                onClick={onAnalyze360}
              >
                Analyze 360
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
