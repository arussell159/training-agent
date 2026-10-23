import { useRef, useState } from "react"
import {
  Bike,
  CalendarDays,
  Dumbbell,
  Footprints,
  Waves,
  Ellipsis,
  Pencil,
  Scissors,
  Copy,
  Trash2,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MobileActionMenu } from "@/components/ui/mobile-native-controls"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { DesktopSportIcon } from "@/components/desktop-sport-icon"
import { WorkoutProfile } from "@/components/workout-profile"
import { CalendarWorkoutProfile } from "@/components/calendar-workout-profile"
import { hasWorkoutProfile } from "@/lib/workout-profile-visibility"
import {
  workoutCompletionGrade,
  type CompletionGrade,
} from "@/lib/workout-completion"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import { durationMinutes, type PlannedWorkout } from "@/lib/training-context"
import {
  formatWorkoutTss,
  workoutTime,
  workoutPlannedMinutes,
} from "@/lib/workout-metrics"
import { canEditWorkout } from "@/lib/workout-permissions"
import { workoutDetailRoute } from "@/lib/workout-preload"
import { workoutPresentationSport } from "@/lib/workout-presentation"
import { calendarSportLabel } from "@/lib/calendar-events"
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
export function SportIcon({ sport }: { sport: string }) {
  if (/^(?:Brick|Day off|Custom)$/i.test(sport))
    return <DesktopSportIcon sport={sport} />
  const value = sport.toLowerCase()
  const base = "size-5 shrink-0"
  if (value.includes("swim"))
    return <Waves className={`${base} text-cyan-600`} />
  if (
    value.includes("bike") ||
    value.includes("ride") ||
    value.includes("brick")
  )
    return <Bike className={`${base} text-violet-600`} />
  if (value.includes("run"))
    return <Footprints className={`${base} text-lime-600`} />
  if (value.includes("strength"))
    return <Dumbbell className={`${base} text-orange-600`} />
  return <CalendarDays className={`${base} text-slate-500`} />
}

const gradeStyles: Record<CompletionGrade, string> = {
  planned: "border-border bg-card text-card-foreground hover:bg-accent/50",
  unknown: "border-border bg-card text-card-foreground hover:bg-accent/50",
  good: "border-green-700/35 bg-green-50 text-green-950 hover:bg-green-100 dark:border-green-700/70 dark:bg-green-950/50 dark:text-green-100",
  medium:
    "border-amber-700/35 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:border-amber-700/70 dark:bg-amber-950/50 dark:text-amber-100",
  failed:
    "border-red-700/35 bg-red-50 text-red-950 hover:bg-red-100 dark:border-red-700/70 dark:bg-red-950/50 dark:text-red-100",
}

const gradeAccent: Partial<Record<CompletionGrade, string>> = {
  good: "bg-lime-500",
  medium: "bg-amber-400",
  failed: "bg-red-500",
}

export function completionGrade(workout: PlannedWorkout): CompletionGrade {
  return workoutCompletionGrade(workout)
}
function WorkoutPreview({
  workout,
  large = false,
  calendarPresentation = false,
  onOpen,
}: {
  workout: PlannedWorkout
  large?: boolean
  calendarPresentation?: boolean
  onOpen?: () => void
}) {
  if (!hasWorkoutProfile(workout)) return null
  return (
    <div
      onClickCapture={
        onOpen
          ? (event) => {
              event.stopPropagation()
              onOpen()
            }
          : undefined
      }
      className={`${large ? "" : "-mx-2.5 mt-auto -mb-3 pt-2"} ${calendarPresentation ? "calendar-workout-profile" : ""}`}
    >
      {calendarPresentation ? (
        <CalendarWorkoutProfile workout={workout} />
      ) : (
        <WorkoutProfile workout={workout} compact={!large} />
      )}
    </div>
  )
}

export function estimatedDistance(workout: PlannedWorkout) {
  const label = plannedDistanceLabel(workout)
  return label === "—" ? "" : label
}

function calendarWorkoutDuration(workout: PlannedWorkout) {
  const completed = workout.status === "completed"
  const plannedClock = !completed
    ? workout.planned_time_label?.match(/\b\d{2,}:\d{2}:\d{2}\b/)?.[0]
    : undefined
  if (plannedClock) return plannedClock

  const summarySeconds = completed
    ? workout.workout_summary?.completed?.duration_seconds
    : workout.workout_summary?.planned?.duration_seconds
  const minutes = completed
    ? (workout.actualDurationMinutes ??
      workout.completed_data?.duration_minutes)
    : (workout.planned?.duration_minutes ??
      workout.plannedDurationMinutes ??
      durationMinutes(workout))
  const seconds = summarySeconds ?? (minutes != null ? minutes * 60 : 0)
  if (!Number.isFinite(seconds) || seconds <= 0) return "—"
  const wholeSeconds = Math.round(seconds)
  const hours = Math.floor(wholeSeconds / 3600)
  const remainingMinutes = Math.floor((wholeSeconds % 3600) / 60)
  const remainingSeconds = wholeSeconds % 60
  return `${hours}:${String(remainingMinutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
}

function calendarWorkoutDistance(workout: PlannedWorkout) {
  const label = plannedDistanceLabel(workout)
  const value = Number.parseFloat(label.replace(/[^\d.]/g, ""))
  if (!Number.isFinite(value)) return { value: "—", unit: "" }
  if (/yds$/i.test(label))
    return { value: Math.round(value).toLocaleString("en-US"), unit: "yds" }
  if (/mi$/i.test(label)) return { value: value.toFixed(2), unit: "mi" }
  return { value: "—", unit: "" }
}

export function WorkoutCard({
  workout,
  onClick,
  onAction,
  disabled = false,
  calendarPresentation = false,
}: {
  workout: PlannedWorkout
  onClick: () => void
  onAction?: (action: "copy" | "cut" | "delete") => void
  disabled?: boolean
  calendarPresentation?: boolean
}) {
  disabled = disabled || Boolean(workout.app_pending_operation)
  const grade = completionGrade(workout)
  const presentationSport =
    workout.display_variant || workout.editor_model?.variant
      ? calendarSportLabel(workoutPresentationSport(workout))
      : workout.sport
  const openAfterMenu = useRef(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const completed = workout.status === "completed"
  const tss = formatWorkoutTss(workout)
  const time = workoutTime(workout)
  const distance = estimatedDistance(workout)
  const calendarDistance = calendarWorkoutDistance(workout)
  const calendarTssValue = tss.replace(/ TSS$/, "").replace(/^~\s*/, "")
  const strength = workout.editor_model?.strength
  const strengthExercises =
    strength?.blocks.reduce((sum, block) => sum + block.exercises.length, 0) ||
    0
  const strengthSets =
    strength?.blocks.reduce(
      (sum, block) =>
        sum +
        block.exercises.reduce(
          (count, exercise) => count + exercise.sets.length,
          0
        ),
      0
    ) || 0
  const emptyStrength = strength?.blocks.length === 0
  const calendarDuration = calendarWorkoutDuration(workout)
  const description = strength
    ? workout.editor_model?.notes || ""
    : workout.details || workout.goal || ""
  const skipped =
    calendarPresentation &&
    !completed &&
    Boolean(
      workout.workout_date && workout.workout_date < dateKey(new Date())
    ) &&
    workoutPlannedMinutes(workout) > 0
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!disabled) onClick()
      }}
      onContextMenu={
        calendarPresentation && canEditWorkout(workout) && onAction
          ? (event) => {
              event.preventDefault()
              if (!disabled) setOptionsOpen(true)
            }
          : undefined
      }
      onKeyDown={(event) => {
        if (
          calendarPresentation &&
          onAction &&
          !disabled &&
          event.target === event.currentTarget &&
          (event.ctrlKey || event.metaKey) &&
          ["c", "x"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault()
          onAction?.(event.key.toLowerCase() === "x" ? "cut" : "copy")
          return
        }
        if (
          !disabled &&
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault()
          onClick()
        }
      }}
      aria-disabled={disabled || undefined}
      aria-busy={Boolean(workout.app_pending_operation) || undefined}
      data-completion-grade={calendarPresentation ? grade : undefined}
      data-workout-id={workout.id}
      onPointerEnter={() => { void workoutDetailRoute.preload().catch(() => {}) }}
      onFocus={() => { void workoutDetailRoute.preload().catch(() => {}) }}
      onTouchStart={() => {
        void workoutDetailRoute.preload().catch(() => {})
      }}
      data-calendar-completed={
        calendarPresentation && completed ? "true" : undefined
      }
      data-calendar-skipped={skipped ? "true" : undefined}
      className={`group/workout relative w-full cursor-pointer gap-2 rounded-lg px-2.5 ${completed ? "pt-5 pb-3" : "py-3"} shadow-[0_2px_6px_rgba(15,23,42,0.16)] transition-colors ${gradeStyles[grade]} ${calendarPresentation ? "calendar-workout-card" : ""}`}
    >
      {completed && gradeAccent[grade] && !calendarPresentation && (
        <span
          aria-hidden="true"
          className={`absolute inset-x-0 top-0 h-2.5 rounded-t-lg ${gradeAccent[grade]}`}
        />
      )}
      <div
        className={`flex min-w-0 flex-col items-start gap-2 ${calendarPresentation ? "calendar-workout-heading" : ""}`}
      >
        <div
          className={`flex w-full items-center justify-between ${calendarPresentation ? "calendar-workout-sport-row" : ""}`}
        >
          {calendarPresentation ? (
            <DesktopSportIcon sport={presentationSport} />
          ) : (
            <SportIcon sport={presentationSport} />
          )}
          {calendarPresentation && (
            <span className="calendar-workout-sport">{presentationSport}</span>
          )}
          {workout.app_pending_operation && (
            <span role="status" className="text-[10px] text-muted-foreground">
              Syncing…
            </span>
          )}
          {canEditWorkout(workout) && (
            <div
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <MobileActionMenu
                plain
                label={`Options for ${workout.title}`}
                disabled={disabled && Boolean(onAction)}
                actions={[
                  {
                    value: "copy",
                    label: onAction ? "Copy" : "Recorded history is read-only",
                    disabled: !onAction || disabled,
                    onSelect: () => onAction?.("copy"),
                  },
                  {
                    value: "delete",
                    label: "Delete",
                    disabled: !onAction || disabled,
                    onSelect: () => onAction?.("delete"),
                  },
                ]}
              >
                <DropdownMenu
                  open={optionsOpen}
                  onOpenChange={setOptionsOpen}
                  onOpenChangeComplete={(open) => {
                    if (!open && openAfterMenu.current) {
                      openAfterMenu.current = false
                      onClick()
                    }
                  }}
                >
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className={`-my-1 -mr-1 size-7 opacity-100 transition-opacity group-focus-within/workout:opacity-100 data-[popup-open]:opacity-100 ${calendarPresentation ? "calendar-workout-options" : "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/workout:opacity-100"}`}
                        disabled={disabled && Boolean(onAction)}
                        aria-label={`Options for ${workout.title}`}
                      />
                    }
                  >
                    <Ellipsis className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className={
                      calendarPresentation
                        ? "calendar-context-menu"
                        : "min-w-36"
                    }
                    onClick={(event) => event.stopPropagation()}
                  >
                    {calendarPresentation && (
                      <>
                        <DropdownMenuItem
                          disabled={disabled}
                          onClick={() => {
                            openAfterMenu.current = true
                          }}
                        >
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!onAction || disabled}
                          onClick={() => onAction?.("cut")}
                        >
                          <Scissors />
                          Cut
                        </DropdownMenuItem>
                      </>
                    )}
                    {!onAction && (
                      <p className="max-w-48 px-2 py-1.5 text-xs text-muted-foreground">
                        Recorded history is read-only.
                      </p>
                    )}
                    <DropdownMenuItem
                      disabled={!onAction || disabled}
                      onClick={() => onAction?.("copy")}
                    >
                      <Copy />
                      Copy
                    </DropdownMenuItem>
                    {calendarPresentation && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      disabled={!onAction || disabled}
                      variant="destructive"
                      onClick={() => onAction?.("delete")}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </MobileActionMenu>
            </div>
          )}
        </div>
        <span
          title={workout.title}
          className={`line-clamp-2 w-full text-left text-[13px] leading-tight font-semibold md:text-sm ${calendarPresentation ? "calendar-workout-title" : ""}`}
        >
          {workout.title}
        </span>
      </div>
      {calendarPresentation ? (
        <>
          <dl
            className="calendar-workout-metrics"
            data-strength-prescription={strength ? "true" : undefined}
          >
            {(!strength || calendarDuration !== "—") && (
              <div className="calendar-workout-metric calendar-workout-duration">
                <dt className="sr-only">Duration</dt>
                <dd
                  data-workout-metric="duration"
                  aria-label={`Duration ${calendarDuration}`}
                >
                  {calendarDuration}
                </dd>
              </div>
            )}
            {!strength && (
              <div className="calendar-workout-metric">
                <dt className="sr-only">Distance</dt>
                <dd
                  data-workout-metric="distance"
                  aria-label={`Distance ${calendarDistance.value}${calendarDistance.unit ? ` ${calendarDistance.unit}` : ""}`}
                >
                  <span className="calendar-workout-metric-value">
                    {calendarDistance.value}
                  </span>
                  {calendarDistance.unit && (
                    <span className="calendar-workout-metric-unit">
                      {" "}
                      {calendarDistance.unit}
                    </span>
                  )}
                </dd>
              </div>
            )}
            {(!strength || calendarTssValue !== "—") && (
              <div className="calendar-workout-metric">
                <dt className="sr-only">TSS</dt>
                <dd data-workout-metric="tss" aria-label={`TSS ${tss}`}>
                  <span className="calendar-workout-metric-value">
                    {calendarTssValue}
                  </span>
                  {calendarTssValue !== "—" && (
                    <span className="calendar-workout-metric-unit"> TSS</span>
                  )}
                </dd>
              </div>
            )}
            {strength && (
              <>
                <div className="calendar-workout-metric">
                  <dt className="sr-only">Prescribed sets</dt>
                  <dd data-workout-metric="sets">
                    {emptyStrength ? "--" : strengthSets}
                    <span className="calendar-workout-metric-unit">
                      {" "}
                      {strengthSets === 1 ? "Set" : "Sets"}
                    </span>
                  </dd>
                </div>
                <div className="calendar-workout-metric">
                  <dt className="sr-only">Prescribed exercises</dt>
                  <dd data-workout-metric="exercises">
                    {emptyStrength ? "--" : strengthExercises}
                    <span className="calendar-workout-metric-unit">
                      {" "}
                      {strengthExercises === 1 ? "Exercise" : "Exercises"}
                    </span>
                  </dd>
                </div>
              </>
            )}
          </dl>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-muted-foreground md:text-xs">
          {time.value !== "—" && (
            <span>
              {time.label.replace(" time", "")}: {time.value}
            </span>
          )}
          {distance && <span>· {distance}</span>}
          {tss !== "—" && <span>· {tss}</span>}
        </div>
      )}
      {description && (
        <p
          className={`line-clamp-6 text-xs leading-relaxed break-words whitespace-pre-line text-muted-foreground ${calendarPresentation ? "calendar-workout-description" : ""}`}
        >
          {description.trim()}
        </p>
      )}
      {workout.status === "completed" &&
        grade !== "unknown" &&
        !calendarPresentation && (
          <span className="flex items-center gap-1 text-[10px] font-medium">
            {grade === "good"
              ? "On target"
              : grade === "medium"
                ? "Near target"
                : "Outside target"}
          </span>
        )}
      {!strength && (
        <WorkoutPreview
          workout={workout}
          calendarPresentation={calendarPresentation}
          onOpen={calendarPresentation && !disabled ? onClick : undefined}
        />
      )}
    </Card>
  )
}
