import { SavedReportButton } from "@/components/saved-report-button"
import { planReportBlocks } from "../../../app-backend/lib/report-blocks.mjs"
import { WorkoutCoachButton } from "@/components/workout-coach-button"
import { WorkoutDescription } from "@/components/workout-description"
import { lazy, Suspense } from "react"
import { formatDuration } from "@/lib/duration"
import {
  gradeWorkoutCompletion,
  type CompletionGrade,
} from "@/lib/workout-completion"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import {
  MobileActionMenu,
  MobileDatePicker,
} from "@/components/ui/mobile-native-controls"
import { WorkoutProfile } from "@/components/workout-profile"
import { WorkoutSummary } from "@/components/workout-summary"
import { WorkoutMapSplits } from "@/components/workout-map-splits"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import {
  forgetOpenWorkout,
  rememberOpenWorkout,
  restoreOpenWorkout,
} from "@/lib/workout-navigation"
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  Bike,
  CalendarDays,
  Dumbbell,
  Footprints,
  Ellipsis,
  Copy,
  Trash2,
  Plus,
  PanelRightClose,
  PanelRightOpen,
  Waves,
} from "lucide-react"
import { Pie, PieChart } from "recharts"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  WorkoutEditor,
  WorkoutEditorMenu,
  useEditedWorkout,
} from "@/components/workout-editor"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"
import { Card, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  durationMinutes,
  completedMinutes,
  cachedTrainingContext,
  hydrateDeviceHistory,
  loadTrainingContext,
  mergeCalendarContext,
  rememberTrainingContext,
  moveWorkoutDate,
  changeWorkout,
  changeWorkoutDay,
  type PlannedWorkout,
  type TrainingHistoryItem,
  type TrainingContext,
} from "@/lib/training-context"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  DailyMetricsCard,
  DailyMetricsDialog,
} from "@/components/daily-metrics"
const WorkoutAnalysis = lazy(() =>
  import("@/components/workout-analysis").then((m) => ({
    default: m.WorkoutAnalysis,
  }))
)
import { apiFetch } from "@/lib/api-client"
import {
  phaseLabel,
  type AnnualPlan,
  type AnnualPlanWeek,
} from "@/lib/annual-plan"
import { isRaceWorkout, RaceCalendarCard } from "@/components/race-events"

function SportIcon({ sport }: { sport: string }) {
  const value = sport.toLowerCase()
  const base = "size-5 shrink-0"
  if (value.includes("swim"))
    return <Waves className={`${base} text-cyan-600`} />
  if (value.includes("bike") || value.includes("brick"))
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
  good: "border-green-700/65 bg-green-200 text-green-950 hover:bg-green-300 dark:border-green-700/70 dark:bg-green-950/50 dark:text-green-100",
  medium:
    "border-orange-700/65 bg-orange-200 text-orange-950 hover:bg-orange-300 dark:border-orange-700/70 dark:bg-orange-950/50 dark:text-orange-100",
  failed:
    "border-red-700/65 bg-red-200 text-red-950 hover:bg-red-300 dark:border-red-700/70 dark:bg-red-950/50 dark:text-red-100",
}
function WorkoutPreview({
  workout,
  large = false,
}: {
  workout: PlannedWorkout
  large?: boolean
}) {
  return (
    <div className={large ? "" : "-mx-2.5 mt-auto -mb-3 pt-2"}>
      <WorkoutProfile workout={workout} compact={!large} />
    </div>
  )
}

function estimatedDistance(workout: PlannedWorkout) {
  const label = plannedDistanceLabel(workout)
  return label === "—" ? "" : label
}

function workoutDate(value?: string) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function WorkoutCard({
  workout,
  onClick,
  onAction,
  disabled = false,
}: {
  workout: PlannedWorkout
  onClick: () => void
  onAction?: (action: "copy" | "delete") => void
  disabled?: boolean
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Activity rows are historical records, not planned-event completions. Keep
  // the historical archive consistently green; only a completed planned event
  // is graded against its prescription.
  const historical = workout.id.startsWith("activity:")
  const grade =
    historical && workout.status === "completed"
      ? "good"
      : workout.status === "completed" && workout.completion_grade
        ? workout.completion_grade
        : gradeWorkoutCompletion(
            workout.status,
            {
              ...workout.planned,
              duration_minutes:
                workout.planned?.duration_minutes ??
                workout.plannedDurationMinutes,
            },
            {
              ...workout.completed_data,
              duration_minutes: completedMinutes(workout),
            }
          )
  const displayedMinutes =
    workout.status === "completed" && completedMinutes(workout) > 0
      ? completedMinutes(workout)
      : durationMinutes(workout)
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault()
          onClick()
        }
      }}
      className={`group/workout w-full cursor-pointer gap-2 rounded-xl px-2.5 py-3 transition-colors ${gradeStyles[grade]}`}
    >
      <div className="flex min-w-0 flex-col items-start gap-2">
        <div className="flex w-full items-center justify-between">
          <SportIcon sport={workout.sport} />
          <div
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <MobileActionMenu
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
                  onSelect: () => setDeleteOpen(true),
                },
              ]}
            >
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="-my-1 -mr-1 size-7 opacity-100 transition-opacity group-focus-within/workout:opacity-100 data-[popup-open]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/workout:opacity-100"
                      disabled={disabled && Boolean(onAction)}
                      aria-label={`Options for ${workout.title}`}
                    />
                  }
                >
                  <Ellipsis className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-36"
                  onClick={(event) => event.stopPropagation()}
                >
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
                  <DropdownMenuItem
                    disabled={!onAction || disabled}
                    variant="destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </MobileActionMenu>
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogContent onClick={(event) => event.stopPropagation()}>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete workout?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Delete “{workout.title}” from your Intervals.icu calendar?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => onAction?.("delete")}
                  >
                    Delete workout
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <span className="line-clamp-2 w-full text-left text-[13px] leading-tight font-semibold md:text-sm">
          {workout.title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-muted-foreground md:text-xs">
        {(displayedMinutes > 0 || workout.planned_time_label) && (
          <span>
            {(workout.status !== "completed" && workout.planned_time_label) ||
              formatDuration(displayedMinutes)}
          </span>
        )}
        {estimatedDistance(workout) && (
          <span>· {estimatedDistance(workout)}</span>
        )}
      </div>
      {(workout.details || workout.goal) && (
        <p className="line-clamp-6 text-xs leading-relaxed break-words whitespace-pre-line text-muted-foreground">
          {(workout.details || workout.goal || "").trim()}
        </p>
      )}
      {workout.status === "completed" && grade !== "unknown" && (
        <span className="flex items-center gap-1 text-[10px] font-medium">
          {grade === "good"
            ? "On target"
            : grade === "medium"
              ? "Near target"
              : "Outside target"}
        </span>
      )}
      <WorkoutPreview workout={workout} />
    </Card>
  )
}

function DraggableWorkout({
  workout,
  onOpen,
  onAction,
  disabled,
}: {
  workout: PlannedWorkout
  onOpen: () => void
  onAction: (action: "copy" | "delete") => void
  disabled: boolean
}) {
  const race = isRaceWorkout(workout)
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: workout.id,
    data: { workout },
    disabled: disabled || race || !workout.id.startsWith("event:"),
  })
  if (race)
    return (
      <div ref={setNodeRef}>
        <RaceCalendarCard
          workout={workout}
          disabled={disabled}
          onOpen={onOpen}
          onDelete={() => onAction("delete")}
        />
      </div>
    )
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className={`select-none ${isDragging ? "opacity-30" : ""}`}
    >
      <WorkoutCard
        workout={workout}
        onClick={onOpen}
        onAction={workout.id.startsWith("event:") ? onAction : undefined}
        disabled={disabled}
      />
    </div>
  )
}

function CalendarDay({
  date,
  className,
  children,
  disabled,
}: {
  date: string
  className: string
  children: ReactNode
  disabled: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled })
  return (
    <div
      ref={setNodeRef}
      data-calendar-date={date}
      className={`group/day ${className} ${isOver ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""}`}
    >
      {children}
    </div>
  )
}

function DayMenu({
  day,
  count,
  disabled,
  onAction,
}: {
  day: Date
  count: number
  disabled: boolean
  onAction: (action: "copy" | "delete") => void
}) {
  const [open, setOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const label = day.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return (
    <div
      className={`transition-opacity group-hover/day:opacity-100 focus-within:opacity-100 ${open || deleteOpen ? "opacity-100" : "md:opacity-0"}`}
    >
      <MobileActionMenu
        label={`Workout actions for ${label}`}
        disabled={disabled || count === 0}
        actions={[
          { value: "copy", label: "Copy", onSelect: () => onAction("copy") },
          {
            value: "delete",
            label: "Delete",
            onSelect: () => setDeleteOpen(true),
          },
        ]}
      >
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={disabled || count === 0}
                aria-label={`Workout actions for ${label}`}
              />
            }
          >
            <Ellipsis className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            <DropdownMenuItem onClick={() => onAction("copy")}>
              <Copy />
              Copy
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </MobileActionMenu>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this day’s workouts?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete all {count} workouts on {label} from your Intervals.icu
              calendar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => onAction("delete")}
            >
              Delete workouts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function startOfMonday(date: Date) {
  const result = new Date(date)
  const day = result.getDay()
  result.setDate(result.getDate() - ((day + 6) % 7))
  result.setHours(0, 0, 0, 0)
  return result
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function TrainingCalendar({
  onWorkoutOpen,
}: {
  onWorkoutOpen?: (workout: PlannedWorkout) => void
}) {
  const [context, setContext] = useState(cachedTrainingContext)
  const [annualPlan, setAnnualPlan] = useState<AnnualPlan | null>(null)
  const [historyReady, setHistoryReady] = useState(false)
  const loadedWeeks = useRef(new Set<string>())
  const pendingWeeks = useRef(new Set<string>())
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(
    () =>
      restoreOpenWorkout([
        ...cachedTrainingContext().planned,
        ...cachedTrainingContext().history,
      ])
  )
  const [newWorkoutDate, setNewWorkoutDate] = useState<string | null>(null)
  const [metricsDate, setMetricsDate] = useState<string | null>(null)
  const [activeWeekKey, setActiveWeekKey] = useState(""),
    [datePickerOpen, setDatePickerOpen] = useState(false),
    [visibleMonth, setVisibleMonth] = useState("")
  const [dragging, setDragging] = useState<PlannedWorkout | null>(null)
  const [moving, setMoving] = useState(false)
  const [moveNotice, setMoveNotice] = useState("")
  const calendarWasDragged = useRef(false)
  const calendarRevision = useRef(0)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 6 },
    })
  )
  useEffect(() => {
    let active = true
    const range = (
      cachedTrainingContext() as TrainingContext & {
        display_range?: { start: string; end: string }
      }
    ).display_range
    if (range && range.start > "0000-01-01") {
      const start = new Date(`${range.start}T12:00:00`),
        end = new Date(`${range.end}T12:00:00`)
      while (start <= end) {
        loadedWeeks.current.add(dateKey(start))
        start.setDate(start.getDate() + 7)
      }
    }
    void hydrateDeviceHistory().then((saved) => {
      if (active && saved)
        setContext((current) => mergeCalendarContext(saved, current))
    })
    void loadTrainingContext().then((saved) => {
      if (active) setContext((current) => mergeCalendarContext(current, saved))
    })
    const update = (event: Event) => {
      if (active)
        setContext((current) =>
          mergeCalendarContext(
            current,
            (event as CustomEvent<TrainingContext>).detail
          )
        )
    }
    window.addEventListener("training-context-updated", update)
    return () => {
      active = false
      window.removeEventListener("training-context-updated", update)
    }
  }, [])
  useEffect(() => {
    let active = true
    const load = () =>
      void apiFetch("/api/annual-plans")
        .then(async (response) => {
          if (!response.ok) throw new Error("Annual plan unavailable")
          return response.json() as Promise<{
            plans: AnnualPlan[]
            activeId?: string | null
          }>
        })
        .then((result) => {
          if (active)
            setAnnualPlan(
              result.plans.find((item) => item.id === result.activeId) ||
                result.plans[0] ||
                null
            )
        })
        .catch(() => {})
    load()
    window.addEventListener("annual-plan-updated", load)
    return () => {
      active = false
      window.removeEventListener("annual-plan-updated", load)
    }
  }, [])
  useEffect(() => {
    const restore = () =>
      setSelectedWorkout(
        restoreOpenWorkout([...context.planned, ...context.history])
      )
    window.addEventListener("popstate", restore)
    return () => window.removeEventListener("popstate", restore)
  }, [context])

  const runWorkoutAction = async (
    workout: PlannedWorkout,
    action: "copy" | "delete"
  ) => {
    if (moving) return
    calendarWasDragged.current = true
    setMoving(true)
    setMoveNotice(action === "copy" ? "Copying workout…" : "Deleting workout…")
    try {
      if (
        action === "delete" &&
        isRaceWorkout(workout) &&
        annualPlan?.events.some((event) => event.id === workout.id)
      ) {
        const response = await apiFetch(
          `/api/annual-plans/${encodeURIComponent(annualPlan.id)}/events/${encodeURIComponent(workout.id)}`,
          { method: "DELETE" }
        )
        const result = (await response.json()) as {
          plan?: AnnualPlan
          context?: TrainingContext
          error?: string
        }
        if (!response.ok || !result.plan)
          throw new Error(result.error || "The race could not be deleted")
        setAnnualPlan(result.plan)
        if (result.context)
          setContext((current) => ({ ...current, ...result.context }))
        else
          setContext((current) => ({
            ...current,
            planned: current.planned.filter((item) => item.id !== workout.id),
            history: current.history.filter(
              (item) => !("id" in item) || item.id !== workout.id
            ),
          }))
        window.dispatchEvent(new Event("annual-plan-updated"))
        setMoveNotice(`${workout.title} deleted.`)
        return
      }
      const result = await changeWorkout(workout.id, action)
      if (result.context)
        setContext((current) => ({ ...current, ...result.context }))
      else if (action === "delete")
        setContext((current) => ({
          ...current,
          planned: current.planned.filter((item) => item.id !== workout.id),
          history: current.history.filter(
            (item) => !("id" in item) || item.id !== workout.id
          ),
        }))
      setMoveNotice(
        `${workout.title} ${action === "copy" ? "copied to the same day" : "deleted"}.${!result.context ? " Refresh Intervals.icu to reload the calendar." : ""}`
      )
    } catch (error) {
      setMoveNotice(
        error instanceof Error ? error.message : `Unable to ${action} workout.`
      )
    } finally {
      setMoving(false)
    }
  }

  const runDayAction = async (day: Date, action: "copy" | "delete") => {
    if (moving) return
    calendarWasDragged.current = true
    setMoving(true)
    setMoveNotice(
      action === "copy"
        ? "Copying this day’s workouts…"
        : "Deleting this day’s workouts…"
    )
    try {
      const result = await changeWorkoutDay(dateKey(day), action)
      if (result.context)
        setContext((current) => ({ ...current, ...result.context }))
      else if (action === "delete") {
        const ids = new Set(result.results.map((item) => item.workoutId))
        setContext((current) => ({
          ...current,
          planned: current.planned.filter((item) => !ids.has(item.id)),
          history: current.history.filter(
            (item) => !("id" in item) || !ids.has(String(item.id))
          ),
        }))
      }
      setMoveNotice(
        `${result.results.length} of ${result.total} workouts ${action === "copy" ? "copied to the same day" : "deleted"}.${result.failures.length ? ` ${result.failures[0].error} Refresh before retrying.` : !result.context ? " Refresh Intervals.icu to reload the calendar." : ""}`
      )
    } catch (error) {
      setMoveNotice(
        error instanceof Error
          ? error.message
          : "Unable to update this day’s workouts."
      )
    } finally {
      setMoving(false)
    }
  }

  const finishDrag = async ({ active, over }: DragEndEvent) => {
    setDragging(null)
    const workout = active.data.current?.workout as PlannedWorkout | undefined
    if (
      !workout ||
      !workout.id.startsWith("event:") ||
      !over ||
      String(over.id) === workout.workout_date ||
      moving
    )
      return
    const date = String(over.id)
    calendarWasDragged.current = true
    const snapshot = context
    calendarRevision.current += 1
    const update = (item: PlannedWorkout) =>
      item.id === workout.id
        ? {
            ...item,
            workout_date: date,
            day: new Date(`${date}T12:00:00`)
              .toLocaleDateString("en-US", { weekday: "short" })
              .toUpperCase(),
            date: new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            }),
            status:
              item.status === "completed"
                ? ("completed" as const)
                : date === dateKey(new Date())
                  ? ("today" as const)
                  : ("upcoming" as const),
          }
        : item
    setMoving(true)
    setMoveNotice("Saving workout date…")
    setContext((current) => ({
      ...current,
      planned: current.planned.map(update),
      history: (current.history as PlannedWorkout[]).map(
        update
      ) as TrainingHistoryItem[],
    }))
    try {
      const result = await moveWorkoutDate(workout.id, date)
      if (result.context)
        setContext((current) => ({ ...current, ...result.context }))
      setMoveNotice(
        `${workout.title} saved in Supabase for ${new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.${result.queued ? " Syncing to Intervals.icu…" : ""}`
      )
    } catch (error) {
      setContext(snapshot)
      setMoveNotice(
        error instanceof Error ? error.message : "Unable to move workout."
      )
    } finally {
      setMoving(false)
    }
  }
  const [summaryOpen, setSummaryOpen] = useState(true)
  useEffect(() => {
    const update = (event: Event) => {
      const { id, description } = (
        event as CustomEvent<{ id: string; description: string }>
      ).detail
      const map = (w: PlannedWorkout) =>
        w.id === id ? { ...w, details: description, goal: description } : w
      setContext((c) => ({
        ...c,
        planned: c.planned.map(map),
        history: c.history.map((w) =>
          (w as unknown as { id: string }).id === id
            ? { ...w, details: description, goal: description }
            : w
        ),
      }))
    }
    window.addEventListener("workout-description-updated", update)
    return () =>
      window.removeEventListener("workout-description-updated", update)
  }, [])
  useEffect(() => {
    let active = true
    void apiFetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        if (active) setSummaryOpen(c.calendarSummaryOpen !== false)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  async function saveSummary(open: boolean) {
    try {
      const r = await apiFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CALENDAR_SUMMARY_OPEN: String(open) }),
      })
      const c = await r.json()
      if (!r.ok) throw new Error(c.error || "Could not save preference")
      setSummaryOpen(open)
    } catch (e) {
      setMoveNotice(
        e instanceof Error ? e.message : "Could not save preference"
      )
    }
  }
  const isMobile = useIsMobile()
  const weekRefs = useRef(new Map<string, HTMLElement>())
  const calendarRef = useRef<HTMLDivElement>(null)
  const calendarUserScrolled = useRef(false)
  const initialAlignmentDone = useRef(false)
  const viewportAnchor = useRef<{
    element: Element
    top: number
    scrollY: number
  } | null>(null)

  useEffect(() => {
    const mark = () => {
      if (initialAlignmentDone.current) calendarUserScrolled.current = true
    }
    const key = (event: KeyboardEvent) => {
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "PageDown",
          "PageUp",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        mark()
    }
    window.addEventListener("wheel", mark, { passive: true })
    window.addEventListener("touchmove", mark, { passive: true })
    window.addEventListener("keydown", key)
    return () => {
      window.removeEventListener("wheel", mark)
      window.removeEventListener("touchmove", mark)
      window.removeEventListener("keydown", key)
    }
  }, [])

  // The calendar always starts at today, so do not let the browser restore a
  // stale document offset after the async rows have rendered.
  useLayoutEffect(() => {
    const previousRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = "manual"
    return () => {
      window.history.scrollRestoration = previousRestoration
    }
  }, [])

  // IndexedDB hydration can add taller historical weeks above today without
  // changing the set of week keys. Keep today anchored during that startup
  // work on desktop as well as mobile, until the user actually moves away.
  useLayoutEffect(() => {
    if (calendarUserScrolled.current || calendarWasDragged.current) return
    const mobileViewport = window.matchMedia("(max-width: 767px)").matches
    const today = new Date()
    const element = mobileViewport
      ? calendarRef.current?.querySelector(
          `[data-calendar-date="${dateKey(today)}"]`
        )
      : weekRefs.current.get(dateKey(startOfMonday(today)))
    if (!element) return
    window.scrollTo({
      top: Math.max(
        0,
        window.scrollY +
          element.getBoundingClientRect().top -
          (mobileViewport ? 0 : 84)
      ),
      behavior: "instant",
    })
    initialAlignmentDone.current = true
  }, [context, summaryOpen, isMobile])

  // Correct layout growth before paint, rather than letting newly loaded rows
  // move the day the user was reading. Retain any intervening user scrolling.
  useLayoutEffect(() => {
    const anchor = viewportAnchor.current
    viewportAnchor.current = null
    if (!anchor || !anchor.element.isConnected) return
    const shift =
      anchor.element.getBoundingClientRect().top -
      anchor.top +
      (window.scrollY - anchor.scrollY)
    if (Math.abs(shift) > 0.5)
      window.scrollTo({ top: window.scrollY + shift, behavior: "instant" })
  }, [context])

  useEffect(() => {
    // Wait until initial date alignment finishes before observing the actual viewport.
    const timer = window.setTimeout(() => setHistoryReady(true), 300)
    return () => window.clearTimeout(timer)
  }, [])

  const workouts = useMemo(() => {
    const workouts = new Map<string, PlannedWorkout>()
    for (const workout of context.history as PlannedWorkout[]) {
      if (workout.id && workout.workout_date) workouts.set(workout.id, workout)
    }
    for (const workout of context.planned) workouts.set(workout.id, workout)

    return [...workouts.values()]
      .filter((workout) => workoutDate(workout.workout_date))
      .sort((a, b) =>
        String(a.workout_date).localeCompare(String(b.workout_date))
      )
  }, [context.history, context.planned])

  const weeks = useMemo(() => {
    // Dates exist independently of sessions: an empty account still has a calendar.
    const today = new Date()
    const earliest = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - 90
    )
    const latest = new Date(
      today.getFullYear() + 1,
      today.getMonth(),
      today.getDate()
    )
    const firstWorkout = workoutDate(workouts[0]?.workout_date)
    const lastWorkout = workoutDate(workouts[workouts.length - 1]?.workout_date)
    const first = startOfMonday(
      firstWorkout && firstWorkout < earliest ? firstWorkout : earliest
    )
    const last = startOfMonday(
      lastWorkout && lastWorkout > latest ? lastWorkout : latest
    )
    const result: Array<{
      key: string
      start: Date
      days: Date[]
      workouts: PlannedWorkout[]
    }> = []
    for (
      let cursor = first;
      cursor <= last;
      cursor = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() + 7
      )
    ) {
      const start = new Date(cursor)
      const days = Array.from(
        { length: 7 },
        (_, index) =>
          new Date(
            start.getFullYear(),
            start.getMonth(),
            start.getDate() + index
          )
      )
      const keys = new Set(days.map(dateKey))
      result.push({
        key: dateKey(start),
        start,
        days,
        workouts: workouts.filter((workout) =>
          keys.has(workout.workout_date ?? "")
        ),
      })
    }
    return result
  }, [workouts])

  const weekKeys = weeks.map((week) => week.key).join("|")
  useEffect(() => {
    if (!historyReady) return
    let active = true
    const controller = new AbortController()
    let busy = false
    let scrolled = false
    const queue = new Set<string>()
    const pump = async () => {
      if (busy || !active) return
      const start = queue.values().next().value as string | undefined
      if (!start) return
      queue.delete(start)
      if (loadedWeeks.current.has(start)) {
        void pump()
        return
      }
      busy = true
      const date = workoutDate(start)!
      const end = dateKey(
        new Date(date.getFullYear(), date.getMonth(), date.getDate() + 6)
      )
      pendingWeeks.current.add(start)
      const revision = calendarRevision.current
      const query = new URLSearchParams({ scope: "range", start, end })
      await apiFetch(`/api/training-context?${query}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Could not load calendar week")
          return (await response.json()) as TrainingContext
        })
        .then((next) => {
          if (!active || revision !== calendarRevision.current) return
          if (scrolled) {
            const header = isMobile ? 56 : 84
            const visible = Array.from(
              calendarRef.current?.querySelectorAll("[data-calendar-date]") ||
                []
            )
              .map((element) => ({
                element,
                bounds: element.getBoundingClientRect(),
              }))
              .filter(
                ({ bounds }) =>
                  bounds.bottom > header && bounds.top < window.innerHeight
              )
              .sort(
                (a, b) =>
                  Math.abs(a.bounds.top - header) -
                  Math.abs(b.bounds.top - header)
              )
            const anchor = visible[0]
            if (anchor)
              viewportAnchor.current = {
                element: anchor.element,
                top: anchor.bounds.top,
                scrollY: window.scrollY,
              }
          }
          loadedWeeks.current.add(start)
          void hydrateDeviceHistory().then((cachedFull) => {
            if (active)
              rememberTrainingContext(
                {
                  ...mergeCalendarContext(cachedFull || context, next),
                  display_range: { start: "0000-01-01", end: "9999-12-31" },
                },
                "full"
              )
          })
          setContext((previous) => {
            const history = new Map(
              [...previous.history, ...next.history].map((w) => [
                (w as PlannedWorkout).id,
                w,
              ])
            )
            const planned = new Map(
              [...previous.planned, ...next.planned].map((w) => [w.id, w])
            )
            const wellness = new Map(
              [
                ...(previous.wellness_history || []),
                ...(next.wellness_history || []),
              ].map((w) => [w.date, w])
            )
            return {
              ...next,
              history: [...history.values()],
              planned: [...planned.values()],
              wellness_history: [...wellness.values()],
            }
          })
          if (!scrolled)
            requestAnimationFrame(() => {
              const element = isMobile
                ? calendarRef.current?.querySelector(
                    `[data-calendar-date="${dateKey(new Date())}"]`
                  )
                : weekRefs.current.get(start)
              if (element && !scrolled)
                window.scrollTo({
                  top: Math.max(
                    0,
                    window.scrollY +
                      element.getBoundingClientRect().top -
                      (isMobile ? 56 : 84)
                  ),
                  behavior: "instant",
                })
            })
        })
        .catch((error) => {
          if (active && error.name !== "AbortError")
            setMoveNotice(
              `Workouts for ${start} could not load. Scroll back to retry.`
            )
        })
        .finally(() => {
          pendingWeeks.current.delete(start)
          busy = false
        })
      if (active) void pump()
    }
    const loadVisible = () => {
      if (!scrolled) return
      queue.clear()
      for (const [key, element] of weekRefs.current) {
        const bounds = element.getBoundingClientRect()
        if (
          bounds.bottom > 56 &&
          bounds.top < window.innerHeight &&
          !loadedWeeks.current.has(key) &&
          !pendingWeeks.current.has(key)
        )
          queue.add(key)
      }
      void pump()
    }
    const onScroll = () => {
      scrolled = calendarUserScrolled.current
      loadVisible()
    }
    const observer = new IntersectionObserver(loadVisible, {
      rootMargin: "0px",
      threshold: 0,
    })
    for (const element of weekRefs.current.values()) observer.observe(element)
    queue.add(dateKey(startOfMonday(new Date())))
    void pump()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      active = false
      controller.abort()
      observer.disconnect()
      window.removeEventListener("scroll", onScroll)
      pendingWeeks.current.clear()
    }
  }, [weekKeys, historyReady])

  useLayoutEffect(() => {
    if (
      !weeks.length ||
      calendarWasDragged.current ||
      calendarUserScrolled.current
    )
      return
    const todayWeek = dateKey(startOfMonday(new Date()))
    const target = weeks.some((week) => week.key === todayWeek)
      ? todayWeek
      : weeks[weeks.length - 1].key
    const alignToday = () => {
      if (calendarWasDragged.current || calendarUserScrolled.current) return
      const mobileViewport = window.matchMedia("(max-width: 767px)").matches
      setActiveWeekKey(target)
      const element = mobileViewport
        ? calendarRef.current?.querySelector(
            `[data-calendar-date="${dateKey(new Date())}"]`
          ) || weekRefs.current.get(target)
        : weekRefs.current.get(target)
      if (!element) return
      window.scrollTo({
        top: Math.max(
          0,
          window.scrollY +
            element.getBoundingClientRect().top -
            (mobileViewport ? 0 : 84)
        ),
        behavior: "instant",
      })
      initialAlignmentDone.current = true
    }
    alignToday()
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      alignToday()
      secondFrame = requestAnimationFrame(alignToday)
    })
    const timer = window.setTimeout(alignToday, 250)
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      window.clearTimeout(timer)
    }
  }, [weekKeys, isMobile])

  const scrollToWeek = (key: string, behavior: ScrollBehavior = "smooth") => {
    const element = weekRefs.current.get(key)
    if (!element) return
    window.scrollTo({
      top:
        window.scrollY +
        element.getBoundingClientRect().top -
        (isMobile ? 56 : 84),
      behavior,
    })
    setActiveWeekKey(key)
  }

  useEffect(() => {
    const trackVisibleWeek = () => {
      let visibleKey = activeWeekKey
      for (const week of weeks) {
        const bounds = weekRefs.current.get(week.key)?.getBoundingClientRect()
        if (bounds && bounds.bottom > 57) {
          visibleKey = week.key
          break
        }
      }
      const monthWeights = new Map<string, number>()
      for (const week of weeks) {
        const bounds = weekRefs.current.get(week.key)?.getBoundingClientRect()
        if (!bounds) continue
        const weight =
          Math.max(
            0,
            Math.min(bounds.bottom, window.innerHeight) -
              Math.max(bounds.top, 57)
          ) / 7
        week.days.forEach((day) => {
          const month = day.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })
          monthWeights.set(month, (monthWeights.get(month) || 0) + weight)
        })
      }
      const dominantMonth = [...monthWeights.entries()].sort(
        (a, b) => b[1] - a[1]
      )[0]?.[0]
      if (dominantMonth) setVisibleMonth(dominantMonth)
      if (visibleKey && visibleKey !== activeWeekKey)
        setActiveWeekKey(visibleKey)
    }
    window.addEventListener("scroll", trackVisibleWeek, { passive: true })
    return () => window.removeEventListener("scroll", trackVisibleWeek)
  }, [activeWeekKey, weeks])

  const goToToday = () => {
    const target = dateKey(startOfMonday(new Date()))
    calendarWasDragged.current = true
    const scrollToToday = () => {
      if (!isMobile) {
        scrollToWeek(target, "instant")
        return
      }
      const element = calendarRef.current?.querySelector(
        `[data-calendar-date="${dateKey(new Date())}"]`
      )
      if (!element) return
      window.scrollTo({
        top: Math.max(0, window.scrollY + element.getBoundingClientRect().top),
        behavior: "instant",
      })
      setActiveWeekKey(target)
    }
    scrollToToday()
    requestAnimationFrame(scrollToToday)
  }

  const activeWeek =
    weeks.find((week) => week.key === activeWeekKey) ?? weeks[0]
  const activeMonth =
    visibleMonth ||
    activeWeek?.start.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }) ||
    "Calendar"
  const jumpToDate = (date?: Date) => {
    if (!date) return
    const key = dateKey(startOfMonday(date))
    calendarWasDragged.current = true
    setDatePickerOpen(false)
    setActiveWeekKey(key)
    requestAnimationFrame(() => scrollToWeek(key, "smooth"))
  }

  const openWorkout = (workout: PlannedWorkout) => {
    if (isMobile && onWorkoutOpen) {
      onWorkoutOpen(workout)
      return
    }
    rememberOpenWorkout(workout)
    setSelectedWorkout(workout)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={({ active }) =>
        setDragging(active.data.current?.workout || null)
      }
      onDragCancel={() => setDragging(null)}
      onDragEnd={(event) => void finishDrag(event)}
    >
      <div
        ref={calendarRef}
        style={{ overflowAnchor: "none" }}
        className="flex w-full min-w-0 flex-1 flex-col"
      >
        <MobileSiteNavbar
          fixed
          titleLabel={activeMonth}
          title={
            <MobileDatePicker
              aria-label="Jump to calendar date"
              value={activeWeek ? dateKey(activeWeek.start) : ""}
              onValueChange={(value) =>
                jumpToDate(new Date(`${value}T12:00:00`))
              }
              displayValue={activeMonth}
              className="h-11 min-w-0 justify-center truncate rounded-md px-2 font-semibold"
            >
              {null}
            </MobileDatePicker>
          }
        />
        <header className="sticky top-0 z-50 hidden h-14 w-full shrink-0 items-center px-4 md:flex md:bg-background md:shadow-none">
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger className="mx-auto h-9 min-w-0 truncate rounded-md px-2 text-left text-sm font-semibold hover:bg-muted md:mx-0 md:text-base">
              {activeMonth}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={activeWeek?.start}
                onSelect={jumpToDate}
              />
            </PopoverContent>
          </Popover>
          <div className="flex items-center gap-1 md:ml-4">
            <Button
              size="sm"
              className="hidden md:inline-flex"
              onClick={goToToday}
            >
              Today
            </Button>
          </div>
        </header>
        <div className="sticky top-14 z-40 hidden h-7 shrink-0 border-b bg-background shadow-sm md:flex">
          <div className="grid min-w-0 flex-1 grid-cols-7 divide-x">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div
                key={day}
                className="flex items-center px-2 text-[11px] font-medium text-muted-foreground uppercase"
              >
                {day}
              </div>
            ))}
          </div>
          <div
            className={`hidden shrink-0 items-center justify-end border-l px-1 xl:flex ${summaryOpen ? "w-72" : "w-10"}`}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6"
              onClick={() => void saveSummary(!summaryOpen)}
              aria-label={
                summaryOpen
                  ? "Collapse weekly summary"
                  : "Expand weekly summary"
              }
              aria-expanded={summaryOpen}
            >
              {summaryOpen ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
            </Button>
          </div>
        </div>
        {moveNotice && (
          <p
            role="status"
            className="border-b bg-background px-4 py-2 text-xs text-muted-foreground"
          >
            {moveNotice}
          </p>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-w-0 flex-1 bg-muted/20">
            <div className="divide-y">
              {weeks.map((week) => {
                const end = week.days[6]
                const title = `${week.start.toLocaleDateString("en-US", { month: "short", day: "2-digit" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "2-digit" })}`
                const planWeek =
                  annualPlan?.weeks.find(
                    (item) => item.startDate === week.key
                  ) || null
                return (
                  <section
                    key={week.key}
                    data-calendar-week={week.key}
                    ref={(element) => {
                      if (element) weekRefs.current.set(week.key, element)
                      else weekRefs.current.delete(week.key)
                    }}
                    className="h-auto min-h-0 scroll-mt-14 bg-background"
                  >
                    <div className="flex h-auto min-h-0 w-full flex-col items-stretch xl:flex-row">
                      <div className="grid h-auto min-h-48 w-full min-w-0 flex-1 grid-cols-1 items-stretch divide-y md:min-h-60 md:grid-cols-7 md:divide-x md:divide-y-0">
                        {week.days.map((day) => {
                          const dayCandidates = week.workouts.filter(
                            (workout) => workout.workout_date === dateKey(day)
                          )
                          const races = dayCandidates.filter(isRaceWorkout)
                          const plannedRaceId = annualPlan?.events.find(
                            (event) => event.date === dateKey(day)
                          )?.id
                          const displayedRace =
                            races.find(
                              (workout) => workout.id === plannedRaceId
                            ) || races[0]
                          const dayWorkouts =
                            races.length > 1
                              ? dayCandidates.filter(
                                  (workout) =>
                                    !isRaceWorkout(workout) ||
                                    workout.id === displayedRace?.id
                                )
                              : dayCandidates
                          const isToday = dateKey(day) === dateKey(new Date())
                          return (
                            <CalendarDay
                              key={dateKey(day)}
                              date={dateKey(day)}
                              disabled={moving}
                              className={
                                isToday
                                  ? "min-w-0 bg-primary/5 px-4 pt-16 pb-2 md:px-1.5 md:py-2"
                                  : "min-w-0 px-4 py-2 md:px-1.5"
                              }
                            >
                              {isToday && (
                                <section
                                  aria-label="Performance Insights"
                                  className="mb-4 pt-2 md:hidden"
                                >
                                  <div className="mb-1 flex items-center justify-between">
                                    <p className="text-sm font-semibold text-primary">
                                      {day.toLocaleDateString("en-US", {
                                        weekday: "short",
                                      })}{" "}
                                      - {day.getDate()}
                                    </p>
                                  </div>
                                  <h2 className="mb-3 text-base font-semibold">
                                    Performance Insights
                                  </h2>
                                  <div className="grid grid-cols-3 gap-1.5">
                                    {[
                                      {
                                        label: "Fitness",
                                        value: context.metrics.fitness,
                                        color:
                                          "text-blue-600 dark:text-blue-400",
                                      },
                                      {
                                        label: "Form",
                                        value: context.metrics.form,
                                        color:
                                          "text-emerald-600 dark:text-emerald-400",
                                      },
                                      {
                                        label: "Fatigue",
                                        value: context.metrics.fatigue,
                                        color:
                                          "text-orange-600 dark:text-orange-400",
                                      },
                                    ].map((metric) => (
                                      <Card
                                        key={metric.label}
                                        className={`min-w-0 gap-1 rounded-md px-2.5 py-3 text-left shadow-none ${metric.color}`}
                                      >
                                        <p className="text-base font-semibold tabular-nums">
                                          {Number.isFinite(metric.value)
                                            ? Math.round(metric.value!)
                                            : "—"}
                                        </p>
                                        <div className="border-t border-current" />
                                        <p className="text-[11px]">
                                          {metric.label}
                                        </p>
                                      </Card>
                                    ))}
                                  </div>
                                </section>
                              )}
                              <div
                                className={`mb-3 items-center justify-between gap-2 ${isToday ? "hidden md:flex" : "flex"}`}
                              >
                                <span
                                  className={`px-0.5 text-sm ${isToday ? "hidden font-semibold text-primary md:inline" : "text-foreground"}`}
                                >
                                  <span className="md:hidden">
                                    {day.toLocaleDateString("en-US", {
                                      weekday: "short",
                                    })}{" "}
                                    -{" "}
                                  </span>
                                  {day.getDate()}
                                </span>
                                {(!isToday || !isMobile) && (
                                  <DayMenu
                                    day={day}
                                    count={dayWorkouts.length}
                                    disabled={moving}
                                    onAction={(action) =>
                                      void runDayAction(day, action)
                                    }
                                  />
                                )}
                              </div>
                              <div className="space-y-2">
                                <DailyMetricsCard
                                  date={dateKey(day)}
                                  rows={context.wellness_history || []}
                                  onOpen={() => setMetricsDate(dateKey(day))}
                                />
                                {dayWorkouts.map((workout) => (
                                  <DraggableWorkout
                                    key={workout.id}
                                    workout={workout}
                                    disabled={
                                      moving || !workout.id.startsWith("event:")
                                    }
                                    onOpen={() => openWorkout(workout)}
                                    onAction={(action) =>
                                      void runWorkoutAction(workout, action)
                                    }
                                  />
                                ))}
                                <button
                                  type="button"
                                  aria-label={
                                    "Create workout on " + dateKey(day)
                                  }
                                  disabled={moving}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setNewWorkoutDate(dateKey(day))
                                  }}
                                  className="flex h-12 w-full items-center justify-center rounded-sm border border-muted-foreground/40 text-muted-foreground opacity-100 transition-opacity hover:bg-accent focus-visible:opacity-100 md:opacity-0 md:group-hover/day:opacity-100"
                                >
                                  <Plus className="size-4" />
                                </button>
                              </div>
                            </CalendarDay>
                          )
                        })}
                      </div>
                      <aside
                        className={`hidden shrink-0 self-stretch border-l bg-muted/20 transition-[width] xl:block ${summaryOpen ? "w-72" : "w-10"}`}
                      >
                        <Collapsible
                          open={summaryOpen}
                          onOpenChange={(open) => {
                            void saveSummary(open)
                          }}
                        >
                          <CollapsibleContent className="p-3">
                            <WeekSummary
                              title={title}
                              workouts={week.workouts}
                              planWeek={planWeek}
                              startDate={week.key}
                              blockStart={planReportBlocks(annualPlan).find(block => block.endDate === dateKey(end))?.startDate}
                            />
                          </CollapsibleContent>
                        </Collapsible>
                      </aside>
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        </div>
        {newWorkoutDate && (
          <WorkoutEditor
            date={newWorkoutDate}
            onClose={() => setNewWorkoutDate(null)}
          />
        )}
        <WorkoutDialog
          workout={selectedWorkout}
          onOpenChange={(open) => {
            if (!open) {
              forgetOpenWorkout()
              setSelectedWorkout(null)
            }
          }}
        />
        <DailyMetricsDialog
          date={metricsDate}
          rows={context.wellness_history || []}
          onClose={() => setMetricsDate(null)}
        />
      </div>
      <DragOverlay>
        {dragging ? (
          <div className="max-w-sm cursor-grabbing shadow-xl">
            <WorkoutCard workout={dragging} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

const disciplineChartConfig = {
  swim: { label: "Swim", color: "var(--color-cyan-600)" },
  bike: { label: "Bike", color: "var(--color-violet-600)" },
  run: { label: "Run", color: "var(--color-lime-600)" },
  strength: { label: "Strength", color: "var(--color-orange-600)" },
  other: { label: "Other", color: "var(--color-slate-500)" },
} satisfies ChartConfig

function WeekSummary({
  title,
  workouts,
  planWeek,
  startDate,
  blockStart,
}: {
  title: string
  workouts: PlannedWorkout[]
  planWeek: AnnualPlanWeek | null
  startDate: string
  blockStart?: string
}) {
  const completedTotalMinutes = workouts.reduce(
    (sum, item) => sum + completedMinutes(item),
    0
  )
  const plannedTotalMinutes = workouts.reduce(
    (sum, item) => sum + durationMinutes(item),
    0
  )
  const totals = workouts.reduce<Record<string, number>>((result, workout) => {
    const sport = workout.sport.toLowerCase()
    const discipline = sport.includes("swim")
      ? "swim"
      : sport.includes("bike") || sport.includes("brick")
        ? "bike"
        : sport.includes("run")
          ? "run"
          : sport.includes("strength")
            ? "strength"
            : "other"
    result[discipline] = (result[discipline] ?? 0) + completedMinutes(workout)
    return result
  }, {})
  const chartData = Object.entries(disciplineChartConfig)
    .map(([discipline, config]) => ({
      discipline,
      label: config.label,
      minutes: totals[discipline] ?? 0,
      fill: config.color,
    }))
    .filter((item) => item.minutes > 0)

  return (
    <div className="space-y-3">
      <CardTitle className="text-center text-sm">{title}</CardTitle>
      <div className="relative">
        <ChartContainer
          config={disciplineChartConfig}
          className="mx-auto aspect-square max-h-40 w-full"
        >
          <PieChart accessibilityLayer>
            <ChartTooltip
              cursor={false}
              wrapperStyle={{ zIndex: 999 }}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(value, name) => (
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{
                          backgroundColor:
                            disciplineChartConfig[
                              name as keyof typeof disciplineChartConfig
                            ]?.color,
                        }}
                      />
                      <span>
                        {disciplineChartConfig[
                          name as keyof typeof disciplineChartConfig
                        ]?.label || name}
                      </span>
                      <span className="ml-2 font-medium tabular-nums">
                        {formatDuration(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Pie
              data={chartData}
              dataKey="minutes"
              nameKey="discipline"
              innerRadius={38}
              outerRadius={64}
              strokeWidth={2}
            />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <strong className="text-base tabular-nums">
            {formatDuration(completedTotalMinutes)}
          </strong>
          <span className="text-[10px] text-muted-foreground">Total time</span>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x border-t pt-3 text-sm" aria-label="Completed versus planned duration">
        <div className="pr-4"><p className="mb-1 text-xs text-muted-foreground">Planned</p><p className="font-semibold tabular-nums">{formatDuration(plannedTotalMinutes)}</p></div>
        <div className="pl-4"><p className="mb-1 text-xs text-muted-foreground">Completed</p><p className="font-semibold tabular-nums">{formatDuration(completedTotalMinutes)}</p></div>
      </div>
      <div className="flex flex-wrap gap-1"><SavedReportButton kind="weekly" startDate={startDate} />{blockStart && <SavedReportButton kind="block" startDate={blockStart} />}</div>
      <div className="space-y-1.5">
        {chartData.map((item) => (
          <div
            key={item.discipline}
            className="flex items-center gap-2 text-xs"
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: item.fill }}
            />
            <span className="flex-1 text-muted-foreground">{item.label}</span>
            <span className="font-medium tabular-nums">
              {formatDuration(item.minutes)}
            </span>
          </div>
        ))}
      </div>
      {planWeek && (
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-base leading-snug font-bold">
            {phaseLabel(planWeek)}
          </p>
          {planWeek.notes && (
            <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
              {planWeek.notes}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function WorkoutDialog({
  workout: initialWorkout,
  onOpenChange,
}: {
  workout: PlannedWorkout | null
  onOpenChange: (open: boolean) => void
}) {
  const workout = useEditedWorkout(initialWorkout)
  if (!workout) return null
  const completed = completedMinutes(workout)
  const completedValues = workout.workout_summary?.completed
  const plannedValues = workout.workout_summary?.planned
  const values =
    workout.status === "completed" ? completedValues : plannedValues
  const durationSeconds = values?.duration_seconds
  const duration =
    (workout.status !== "completed" && workout.planned_time_label) ||
    (durationSeconds != null
      ? formatDuration(durationSeconds / 60)
      : workout.status === "completed" && completed
        ? formatDuration(completed)
        : formatDuration(durationMinutes(workout)))
  const load = values?.tss ?? workout.load
  const startValue = workout.recorded_start_local || workout.scheduled_start_at
  const start = startValue ? new Date(startValue) : null
  const time =
    start && !Number.isNaN(start.getTime())
      ? start.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })
      : null
  const date = workout.workout_date
    ? new Date(`${workout.workout_date}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : workout.date

  return (
    <Dialog open={Boolean(workout)} onOpenChange={onOpenChange}>
      <DialogContent className="no-scrollbar max-h-[94vh] gap-4 overflow-y-auto p-0 sm:max-w-5xl">
        <div className="absolute top-2 right-11">
          <WorkoutEditorMenu workout={workout} />
        </div>
        <DialogHeader className="border-b px-5 pt-5 pr-12 pb-4">
          <DialogDescription className="text-sm font-semibold text-blue-600 dark:text-blue-400">
            {date}
            {time && <span className="ml-2 tabular-nums">{time}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 pb-6">
          <section
            className={`rounded-xl border px-4 py-3 shadow-sm ${workout.status === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"}`}
            aria-label="Workout overview"
          >
            <DialogTitle className="min-w-0 truncate text-base font-bold">
              {workout.title}
            </DialogTitle>
            <div className="mt-3 flex flex-wrap items-center gap-x-7 gap-y-2">
              <SportIcon sport={workout.sport} />
              <span className="text-[1.65rem] leading-none font-bold tabular-nums">
                {duration}
              </span>
              <span className="text-[1.4rem] leading-none font-semibold tabular-nums">
                {plannedDistanceLabel(workout)}
              </span>
              {load != null && (
                <span className="text-[1.4rem] leading-none font-semibold tabular-nums">
                  {Math.round(load).toLocaleString()}{" "}
                  <span className="text-xs">TSS</span>
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-4 text-xs font-medium opacity-80">
              <span>{workout.sport}</span>
              <span>
                {workout.status === "completed"
                  ? "Completed"
                  : workout.status === "today"
                    ? "Today"
                    : "Planned"}
              </span>
            </div>
          </section>

          {workout.structure && (
            <div className="overflow-hidden rounded-lg border bg-muted/20 px-2 pt-2">
              <WorkoutProfile
                workout={workout}
                compact
                desktopDetail
                enableEditOnClick
              />
            </div>
          )}
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(340px,0.9fr)_minmax(0,1.1fr)]">
            <WorkoutSummary workout={workout} showElapsed={false} embedded />
            <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
              <WorkoutDescription workout={workout} title="Description" />
            </div>
          </div>
          {workout.status === "completed" && (
            <WorkoutMapSplits workout={workout} />
          )}
          <Suspense
            fallback={
              <div className="h-44 animate-pulse rounded-xl bg-muted/30" />
            }
          >
            <WorkoutAnalysis workout={workout} />
          </Suspense>
          <WorkoutCoachButton workout={workout} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
