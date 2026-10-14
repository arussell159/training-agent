import { ArrowLeft, X } from "lucide-react"
import { DesktopSportIcon } from "./desktop-sport-icon"
import { Button } from "@/components/ui/button"
import { WorkoutEditorMenu } from "@/components/workout-editor"
import {
  cachedTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"
import { plannedDistanceLabel } from "@/lib/workout-distance"
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
  onAnalyze,
  onSummary,
  onEdit,
  busy = false,
}: {
  workout: PlannedWorkout
  onClose: () => void
  back?: boolean
  library?: boolean
  metadata?: DesktopWorkoutMetadata
  onMetadataChange?: (value: DesktopWorkoutMetadata) => void
  onAnalyze?: () => void
  onSummary?: () => void
  onEdit?: () => void
  busy?: boolean
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
  const start = workout.recorded_start_local || workout.scheduled_start_at
  const time =
    start && Number.isFinite(new Date(start).getTime())
      ? new Date(start).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })
      : null
  const metrics = cachedTrainingContext().metrics
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
      : workoutTime(workout).value
  const distance = plannedDistanceLabel(workout).replace(/^[~≈]\s*/, "")
  const distanceParts = distance.match(/^(.*?)\s+(mi|yds?|km|m)$/i)
  const tss = formatWorkoutTss(workout).replace(/^~\s*/, "")
  const tssParts = tss.match(/^(.*?)\s+(TSS)$/i)
  return (
    <header className="desktop-workout-header">
      <div className="desktop-workout-heading-row">
        <div className="desktop-workout-date">
          {metadata && onMetadataChange ? (
            <label className="desktop-workout-date-edit">
              {day}
              <input
                type="date"
                disabled={busy}
                aria-label="Workout date"
                form={`desktop-totals-${workout.id}`}
                value={metadata.date}
                onChange={(event) =>
                  onMetadataChange({ ...metadata, date: event.target.value })
                }
              />
            </label>
          ) : (
            day
          )}
        </div>
        {metadata && onMetadataChange ? (
          <input
            className="desktop-workout-time"
            type="time"
            disabled={busy}
            aria-label="Workout start time"
            form={`desktop-totals-${workout.id}`}
            value={metadata.time}
            onChange={(event) =>
              onMetadataChange({ ...metadata, time: event.target.value })
            }
          />
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
                {label} {Math.round(metrics[key]!)}
              </span>
            ) : null
          )}
        </div>
        <div className="desktop-workout-actions" inert={busy || undefined}>
          {!library && <WorkoutEditorMenu workout={workout} />}
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
        Does not repeat{" "}
        <span>{workout.status === "completed" ? "Completed" : "Planned"}</span>
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
            <DesktopSportIcon sport={workout.sport} />
            <strong>{duration}</strong>
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
            <span>{workout.sport}</span>
            <span>
              {workout.status === "completed" ? "Completed" : "Planned"}
            </span>
          </div>
        </div>
        {(onAnalyze || onSummary || onEdit) && (
          <div className="desktop-workout-view-actions">
            {onEdit && (
              <button type="button" disabled={busy} onClick={onEdit}>
                Edit workout
              </button>
            )}
            {onAnalyze && (
              <button type="button" disabled={busy} onClick={onAnalyze}>
                Analyze
              </button>
            )}
            {onSummary && (
              <button type="button" disabled={busy} onClick={onSummary}>
                Summary
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
