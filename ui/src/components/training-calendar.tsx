import { fallbackTrainingContext } from "@/lib/training-context"
import "@/lib/framework7-calendar"
import { calendarAnchorAdjustment, calendarRange, extendCalendarRange, indexCalendarWorkouts } from "@/lib/calendar-viewport"
import { loadTrainingHistoryRange } from "@/lib/training-history-range"
import { performanceProbe } from '@/lib/performance-probe'
import { CalendarSkeleton, ChartSkeleton } from "@/components/loading-layouts"
import { SavedReportButton } from "@/components/saved-report-button"
import { planReportBlocks } from "../../../app-backend/lib/report-blocks.mjs"
import { WorkoutDescription } from "@/components/workout-description"
import { lazy, Suspense } from "react"
import { formatDuration } from "@/lib/duration"
import {
  gradeWorkoutCompletion,
  type CompletionGrade,
} from "@/lib/workout-completion"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { MobileActionMenu } from "@/components/ui/mobile-native-controls"
import { LiquidGlassLayer } from "@/components/ui/liquid-glass-layer"
import { WorkoutProfile } from "@/components/workout-profile"
import { WorkoutSummary } from "@/components/workout-summary"
import { canEditWorkout } from "@/lib/workout-permissions"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import { formatWorkoutTss, workoutTime } from "@/lib/workout-metrics"
import {
  forgetOpenWorkout,
  rememberOpenWorkout,
  restoreOpenWorkout,
} from "@/lib/workout-navigation"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
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
  Check,
  Dumbbell,
  Footprints,
  Ellipsis,
  Copy,
  Trash2,
  PanelRightClose,
  PanelRightOpen,
  Waves,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react"
import { f7ready } from "framework7-react"
import type { Calendar as Framework7Calendar } from "framework7/types"

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
import { Card, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
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
  loadFullTrainingContext,
  mergeCalendarContext,
  moveWorkoutDate,
  changeWorkout,
  changeWorkoutDay,
  type PlannedWorkout,
  type TrainingHistoryItem,
  type TrainingContext,
} from "@/lib/training-context"
import { useIsMobile } from "@/hooks/use-mobile"
import { validatedTrainingContext } from "@/lib/training-context-validation"
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
import { confirmWithFramework7 } from "@/lib/framework7-confirm"

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

const mobileGradeStyles: Record<CompletionGrade, string> = {
  planned: "bg-background",
  unknown: "bg-background",
  good: "bg-green-200 text-green-950 active:bg-green-300 dark:bg-green-950/50 dark:text-green-100",
  medium:
    "bg-orange-200 text-orange-950 active:bg-orange-300 dark:bg-orange-950/50 dark:text-orange-100",
  failed:
    "bg-red-200 text-red-950 active:bg-red-300 dark:bg-red-950/50 dark:text-red-100",
}

function completionGrade(workout: PlannedWorkout): CompletionGrade {
  const completedDataDuration = Number(workout.completed_data?.duration_minutes)
  const actualDuration = Number.isFinite(workout.actualDurationMinutes)
    ? Number(workout.actualDurationMinutes)
    : Number.isFinite(completedDataDuration)
      ? completedDataDuration
      : 0
  return gradeWorkoutCompletion(
    workout.status,
    {
      duration_minutes:
        workout.planned?.duration_minutes ?? workout.plannedDurationMinutes,
    },
    { duration_minutes: actualDuration }
  )
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

function sportAccent(sport: string) {
  const value = sport.toLowerCase()
  if (value.includes("swim")) return "bg-sky-600"
  if (value.includes("bike") || value.includes("brick")) return "bg-indigo-600"
  if (value.includes("run")) return "bg-emerald-600"
  if (value.includes("strength")) return "bg-amber-600"
  return "bg-slate-400"
}

type CalendarProfileNode = {
  role?: string
  intensity?: string
  steps?: CalendarProfileNode[]
  target?: { kind?: string; unit?: string; value?: number; start?: number; end?: number }
  power?: { units?: string; value?: number; start?: number; end?: number }
  pace?: { units?: string; value?: number; start?: number; end?: number }
  hr?: { units?: string; value?: number; start?: number; end?: number }
}

function profileNodes(workout: PlannedWorkout): CalendarProfileNode[] {
  if (workout.editor_model?.steps) return workout.editor_model.steps
  if (!workout.structure) return []
  try {
    const parsed = JSON.parse(workout.structure)
    const steps = Array.isArray(parsed) ? parsed : parsed?.steps ?? parsed?.structure
    return Array.isArray(steps) ? steps : []
  } catch {
    return []
  }
}

function hasWorkoutProfileTargets(workout: PlannedWorkout) {
  const hasTarget = (nodes: CalendarProfileNode[]): boolean =>
    nodes.some((node) => {
      if (node.steps?.length) return hasTarget(node.steps)
      if (node.role === "rest" || node.intensity === "rest") return false
      return workout.editor_model
        ? Boolean(node.target && node.target.kind !== "none")
        : Boolean(node.power || node.pace || node.hr)
    })
  return hasTarget(profileNodes(workout))
}

function isLongZoneTwoWorkout(workout: PlannedWorkout, minutes: number) {
  if (minutes < 60) return false
  const text = `${workout.title} ${workout.goal} ${workout.details || ""}`
  if (/\b(?:z\s?2|zone\s?2|endurance)\b/i.test(text)) return true

  const activeSteps: CalendarProfileNode[] = []
  const collect = (nodes: CalendarProfileNode[]) => {
    for (const node of nodes) {
      if (node.steps?.length) collect(node.steps)
      else if (node.role !== "rest" && node.intensity !== "rest") activeSteps.push(node)
    }
  }
  collect(profileNodes(workout))
  return activeSteps.length > 0 && activeSteps.every((step) => {
    const target = workout.editor_model ? step.target : step.power || step.pace || step.hr
    const targetData = target as
      | { unit?: string; units?: string; value?: number; start?: number }
      | undefined
    const unit = targetData?.unit || targetData?.units
    const value = targetData?.value ?? targetData?.start
    return Boolean(unit?.includes("zone") && value === 2)
  })
}

function MobileWorkoutRow({
  workout,
  onOpen,
  showDivider,
}: {
  workout: PlannedWorkout
  onOpen: () => void
  showDivider: boolean
}) {
  const grade = completionGrade(workout)
  const minutes =
    workout.status === "completed" && completedMinutes(workout) > 0
      ? completedMinutes(workout)
      : durationMinutes(workout)
  const distance = estimatedDistance(workout)
  const tss = formatWorkoutTss(workout)
  const time = workoutTime(workout)
  const showProfile = hasWorkoutProfileTargets(workout)
  const compact = !showProfile || isLongZoneTwoWorkout(workout, minutes)
  const completed = workout.status === "completed"
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-stretch gap-3 overflow-hidden px-1 text-left transition-colors md:hidden ${compact ? "min-h-0 py-3" : "min-h-24 py-3"} ${completed ? "bg-background active:bg-accent/50" : mobileGradeStyles[grade]} ${completed ? "mb-1 rounded-md" : ""} ${showDivider && !completed ? "border-b border-border/70" : ""}`}
      aria-label={`Open ${workout.title}${completed ? ", completed" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`my-0.5 w-1 rounded-full ${sportAccent(workout.sport)}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {completed && (
              <span
                aria-hidden="true"
                className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/80"
              >
                <Check className="size-2.5 stroke-[3]" />
              </span>
            )}
            <span className="block min-w-0 flex-1 truncate text-[17px] leading-5 font-semibold text-foreground">
              {workout.title}
            </span>
          </span>
          <span className="shrink-0 whitespace-nowrap text-[15px] leading-5 font-normal tabular-nums text-foreground">
            {time.label.replace(" time", "")}: {time.value}
          </span>
        </span>
        {(distance || tss !== "—") && (
          <span className="mt-1 block text-right text-[15px] leading-5 tabular-nums text-muted-foreground">
            {[distance, tss !== "—" ? tss : ""].filter(Boolean).join(" · ")}
          </span>
        )}
        {showProfile && (
          <span className="mt-2 block w-full overflow-hidden rounded-sm">
          <WorkoutProfile workout={workout} compact mobilePlanned mobileCalendar />
          </span>
        )}
      </span>
    </button>
  )
}

function DraggableMobileWorkoutRow({
  workout,
  onOpen,
  showDivider,
  disabled,
}: {
  workout: PlannedWorkout
  onOpen: () => void
  showDivider: boolean
  disabled: boolean
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: workout.id,
    data: { workout },
    disabled,
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`select-none md:hidden ${isDragging ? "opacity-30" : ""}`}
    >
      <MobileWorkoutRow
        workout={workout}
        onOpen={onOpen}
        showDivider={showDivider}
      />
    </div>
  )
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
  const grade = completionGrade(workout)
  const completed = workout.status === "completed"
  const tss = formatWorkoutTss(workout)
  const time = workoutTime(workout)
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
      className={`group/workout relative w-full cursor-pointer gap-2 rounded-lg px-2.5 ${completed ? "pt-5 pb-3" : "py-3"} shadow-[0_2px_6px_rgba(15,23,42,0.16)] transition-colors ${gradeStyles[grade]}`}
    >
      {completed && gradeAccent[grade] && (
        <span
          aria-hidden="true"
          className={`absolute inset-x-0 top-0 h-2.5 rounded-t-lg ${gradeAccent[grade]}`}
        />
      )}
      <div className="flex min-w-0 flex-col items-start gap-2">
        <div className="flex w-full items-center justify-between">
          <SportIcon sport={workout.sport} />
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
                    onSelect: () => void confirmWithFramework7("Delete workout?", `Delete “${workout.title}” from your Intervals.icu calendar?`).then((confirmed) => { if (confirmed) onAction?.("delete") }),
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
                      onClick={() => void confirmWithFramework7("Delete workout?", `Delete “${workout.title}” from your Intervals.icu calendar?`).then((confirmed) => { if (confirmed) onAction?.("delete") })}
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
        <span className="line-clamp-2 w-full text-left text-[13px] leading-tight font-semibold md:text-sm">
          {workout.title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-muted-foreground md:text-xs">
        {time.value !== "—" && (
          <span>
            {time.label.replace(" time", "")}: {time.value}
          </span>
        )}
        {estimatedDistance(workout) && (
          <span>· {estimatedDistance(workout)}</span>
        )}
        {tss !== "—" && <span>· {tss}</span>}
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
    disabled: disabled || race || !canEditWorkout(workout),
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
        onAction={canEditWorkout(workout) ? onAction : undefined}
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
      className={`group/day relative ${className} ${isOver ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""}`}
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
  onCreate,
  children,
}: {
  day: Date
  count: number
  disabled: boolean
  onAction: (action: "copy" | "delete") => void
  onCreate: () => void
  children: ReactNode
}) {
  const label = day.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const chooseAction = (event: ChangeEvent<HTMLSelectElement>) => {
    const action = event.currentTarget.value
    if (action === "create") onCreate()
    if (action === "copy") void onAction("copy")
    if (action === "delete") {
      void confirmWithFramework7("Delete this day’s workouts?", `Delete all ${count} workouts on ${label} from your Intervals.icu calendar?`).then((confirmed) => {
        if (confirmed) onAction("delete")
      })
    }
    // Keep the date as the selected label so the native picker can be opened
    // again after an action is chosen.
    event.currentTarget.value = ""
  }
  return (
    <div className="mobile-calendar-day-heading relative -mx-4 px-4 py-0.5 md:mx-0 md:mb-3 md:px-0 md:py-0 md:pb-0">
      {children}
      <select
        aria-label={`Workout actions for ${label}`}
        disabled={disabled}
        value=""
        onChange={chooseAction}
        className="absolute inset-0 z-[1] h-full w-full cursor-pointer appearance-none opacity-0"
      >
        <option value="" disabled>{label}</option>
        <option value="create">Add workout</option>
        <option value="copy" disabled={count === 0}>Copy</option>
        <option value="delete" disabled={count === 0}>Delete</option>
      </select>
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

// Keep the last calendar visit in memory for a workout-detail round trip.
// Offscreen weeks occupy their measured height without mounting cards, charts,
// menus, drag sensors or mobile headings. Session resets discard the visit.
const calendarWeekHeights = new Map<string, number>()
let previousCalendarRange: ReturnType<typeof calendarRange> | null = null
let previousCalendarContext: TrainingContext | null = null
let previousCalendarPosition: { date: string; top: number } | null = null
function rememberCalendarVisit(context: TrainingContext, range: ReturnType<typeof calendarRange>, position: typeof previousCalendarPosition) {
  previousCalendarContext = context
  previousCalendarRange = range
  previousCalendarPosition = position
}
if (typeof window !== 'undefined') {
  const resetCalendar = () => {
    calendarWeekHeights.clear()
    previousCalendarRange = null
    previousCalendarContext = null
    previousCalendarPosition = null
  }
  window.addEventListener('training-cache-reset', resetCalendar)
  window.addEventListener('app-auth-required', resetCalendar)
  window.addEventListener('device-cache-cleared', resetCalendar)
}

function CalendarWeekViewport({ weekKey, mobile, summaryOpen, forceMounted, register, captureAnchor, restoreAnchor, children }: {
  weekKey: string
  mobile: boolean
  summaryOpen: boolean
  forceMounted: boolean
  register: (key: string, element: HTMLElement | null) => void
  captureAnchor: () => void
  restoreAnchor: () => void
  children: () => ReactNode
}) {
  const elementRef = useRef<HTMLElement>(null)
  const [nearViewport, setNearViewport] = useState(forceMounted)
  const nearViewportRef = useRef(forceMounted)
  const mounted = forceMounted || nearViewport
  const heightKey = `${mobile ? 'mobile' : summaryOpen ? 'wide' : 'compact'}:${weekKey}`
  const measuredHeight = useRef(calendarWeekHeights.get(heightKey) ?? (mobile ? 840 : 300))

  useLayoutEffect(() => {
    if (forceMounted) { nearViewportRef.current = true; setNearViewport(true) }
  }, [forceMounted])
  useLayoutEffect(() => {
    const element = elementRef.current
    if (mounted && element) {
      measuredHeight.current = element.getBoundingClientRect().height
      calendarWeekHeights.set(heightKey, measuredHeight.current)
    }
    restoreAnchor()
  })
  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => {
      const next = entry.isIntersecting
      if (nearViewportRef.current === next) return
      captureAnchor()
      if (!next) {
        measuredHeight.current = element.getBoundingClientRect().height
        calendarWeekHeights.set(heightKey, measuredHeight.current)
      }
      nearViewportRef.current = next
      setNearViewport(next)
    }, { rootMargin: '900px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [captureAnchor, heightKey])

  return (
    <section
      ref={(element) => { elementRef.current = element; register(weekKey, element) }}
      data-calendar-week={weekKey}
      data-calendar-mounted={mounted ? 'true' : 'false'}
      className="h-auto min-h-0 scroll-mt-14 bg-background"
      style={mounted ? undefined : { height: calendarWeekHeights.get(heightKey) ?? measuredHeight.current }}
    >
      {mounted ? children() : null}
    </section>
  )
}

export function TrainingCalendar({
  onWorkoutOpen,
  restoreScrollTop = null,
  onScrollRestored,
}: {
  onWorkoutOpen?: (workout: PlannedWorkout) => void
  restoreScrollTop?: number | null
  onScrollRestored?: () => void
}) {
  const [context, updateContext] = useState(() => {
    const current = cachedTrainingContext()
    return restoreScrollTop !== null && previousCalendarContext
      ? mergeCalendarContext(previousCalendarContext, current)
      : current
  })
  useEffect(() => { previousCalendarContext = context }, [context])
  const anchorOperations = useRef({ capture: () => {}, restore: () => {} })
  const setContext = useCallback<Dispatch<SetStateAction<TrainingContext>>>((update) => {
    anchorOperations.current.capture()
    updateContext(update)
  }, [])
  const [dateRange, setDateRange] = useState(() => restoreScrollTop !== null && previousCalendarRange ? previousCalendarRange : calendarRange(new Date()))
  const [pendingDateJump, setPendingDateJump] = useState<Date | null>(null)
  const restoredPosition = useRef(restoreScrollTop !== null ? previousCalendarPosition : null)
  useEffect(() => { previousCalendarRange = dateRange }, [dateRange])
  useEffect(() => {
    if (context !== fallbackTrainingContext) performanceProbe('calendar-visible')
  }, [context])
  const [calendarReady, setCalendarReady] = useState(() => context !== fallbackTrainingContext)
  const [annualPlan, setAnnualPlan] = useState<AnnualPlan | null>(null)
  const [historyReady, setHistoryReady] = useState(false)
  const loadedWeeks = useRef(new Set<string>())
  const [selectedWorkout, setSelectedWorkout] =
    useState<PlannedWorkout | null>(null)
  const [newWorkoutDate, setNewWorkoutDate] = useState<string | null>(null)
  const [activeWeekKey, setActiveWeekKey] = useState(""),
    [datePickerOpen, setDatePickerOpen] = useState(false),
    [visibleMonth, setVisibleMonth] = useState(""),
    [pickerMonthLabel, setPickerMonthLabel] = useState("")
  const [pickerMonth, setPickerMonth] = useState(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() }))
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
    const markCoveredWeeks = (cached: TrainingContext & { cached_ranges?: Array<{ start: string; end: string }> }) => {
      if (!cached.cached_ranges?.length) return
      const now = new Date()
      const cursor = startOfMonday(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90))
      const last = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
      while (cursor <= last) {
        const start = dateKey(cursor)
        const end = dateKey(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 6))
        if (cached.cached_ranges.some((covered) => covered.start <= start && covered.end >= end))
          loadedWeeks.current.add(start)
        cursor.setDate(cursor.getDate() + 7)
      }
    }
    const cached = cachedTrainingContext() as TrainingContext & {
      display_range?: { start: string; end: string }
      cached_ranges?: Array<{ start: string; end: string }>
    }
    const range = cached.display_range
    if (range && range.start > "0000-01-01") {
      const start = new Date(`${range.start}T12:00:00`),
        end = new Date(`${range.end}T12:00:00`)
      while (start <= end) {
        loadedWeeks.current.add(dateKey(start))
        start.setDate(start.getDate() + 7)
      }
    }
    markCoveredWeeks(cached)
    void hydrateDeviceHistory().then((device) => {
      if (!active || !device) return
      markCoveredWeeks(device)
      setContext((current) => mergeCalendarContext(device, current))
      setCalendarReady(true)
    }).catch(() => {})
    void loadFullTrainingContext().then((full) => {
      if (!active) return
      markCoveredWeeks(full)
      setContext((current) => current === full ? current : mergeCalendarContext(current, full))
      setCalendarReady(true)
    }).catch(() => { if (active) setCalendarReady(true) })
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
  }, [setContext])
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
          if (active) {
            anchorOperations.current.capture()
            setAnnualPlan(
              result.plans.find((item) => item.id === result.activeId) ||
                result.plans[0] ||
                null
            )
          }
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
        if(result.context)result.context=validatedTrainingContext(result.context)
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
      !canEditWorkout(workout) ||
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
  }, [setContext])
  useEffect(() => {
    let active = true
    void apiFetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        if (active) { anchorOperations.current.capture(); setSummaryOpen(c.calendarSummaryOpen !== false) }
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
      anchorOperations.current.capture()
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
  const mobilePickerContainerRef = useRef<HTMLDivElement>(null)
  const mobilePickerPanelRef = useRef<HTMLDivElement>(null)
  const mobilePickerTriggerRef = useRef<HTMLButtonElement>(null)
  const pickerSwipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const mobilePickerRef = useRef<Framework7Calendar.Calendar | null>(null)
  const desktopPickerTriggerRef = useRef<HTMLButtonElement>(null)
  const desktopPickerContentRef = useRef<HTMLDivElement>(null)
  const queuedDateJump = useRef<Date | null>(null)
  const calendarUserScrolled = useRef(false)
  const initialAlignmentDone = useRef(false)
  useEffect(() => {
    const calendar = calendarRef.current
    if (!calendar || !window.matchMedia("(max-width: 767px)").matches) return

    let frame = 0
    const updateActiveHeading = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const headings = Array.from(
          calendar.querySelectorAll<HTMLElement>(".mobile-calendar-day-heading")
        )
        const navbar = document.querySelector<HTMLElement>(
          ".calendar-sticky-day-navbar"
        )
        const stickyTop = headings[0]
          ? Number.parseFloat(getComputedStyle(headings[0]).top)
          : Number.NaN
        const stickyBoundary = Number.isFinite(stickyTop)
          ? stickyTop
          : (navbar?.getBoundingClientRect().bottom ?? 56)
        const headingsAboveBlur = new Set<HTMLElement>()

        for (const heading of headings) {
          const bounds = heading.getBoundingClientRect()
          const exitProgress = Math.max(
            0,
            Math.min(1, (stickyBoundary - bounds.top) / 48)
          )
          const isExiting =
            bounds.top < stickyBoundary - 1 && exitProgress < 1
          heading.classList.toggle(
            "mobile-calendar-day-heading-exiting",
            isExiting
          )
          if (isExiting) {
            heading.style.setProperty(
              "--calendar-day-exit-progress",
              exitProgress.toFixed(3)
            )
          } else {
            heading.style.removeProperty("--calendar-day-exit-progress")
          }
          if (
            bounds.top >= stickyBoundary - 1 &&
            bounds.top <= stickyBoundary + 48 &&
            bounds.bottom > stickyBoundary
          ) {
            headingsAboveBlur.add(heading)
          }
        }

        for (const heading of headings) {
          heading.classList.toggle(
            "mobile-calendar-day-heading-active",
            headingsAboveBlur.has(heading)
          )
        }
      })
    }

    const observer = new MutationObserver(updateActiveHeading)
    observer.observe(calendar, { childList: true, subtree: true })
    window.addEventListener("scroll", updateActiveHeading, { passive: true })
    window.addEventListener("resize", updateActiveHeading)
    updateActiveHeading()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("scroll", updateActiveHeading)
      window.removeEventListener("resize", updateActiveHeading)
      calendar
        .querySelectorAll(
          ".mobile-calendar-day-heading-active, .mobile-calendar-day-heading-exiting"
        )
        .forEach((heading) => {
          const headingElement = heading as HTMLElement
          heading.classList.remove(
            "mobile-calendar-day-heading-active",
            "mobile-calendar-day-heading-exiting"
          )
          headingElement.style.removeProperty("--calendar-day-exit-progress")
        })
    }
  }, [calendarReady])
  const viewportAnchor = useRef<{
    element: Element
    top: number
    scrollY: number
  } | null>(null)
  const captureViewportAnchor = useCallback(() => {
    // Refresh the capture even when a previous no-op state update did not commit.
    if (!initialAlignmentDone.current) return
    const header = window.matchMedia("(max-width: 767px)").matches ? 56 : 84
    const visible = (selector: string) => Array.from(calendarRef.current?.querySelectorAll(selector) ?? [])
      .map((element) => ({ element, bounds: element.getBoundingClientRect() }))
      .filter(({ bounds }) => bounds.bottom > header && bounds.top < window.innerHeight)
      .sort((a, b) => Math.abs(a.bounds.top - header) - Math.abs(b.bounds.top - header))
    // A large scrollbar/date jump can land in an unmounted placeholder.
    const anchor = visible('[data-calendar-date]')[0] ?? visible('[data-calendar-week]')[0]
    if (anchor) viewportAnchor.current = { element: anchor.element, top: anchor.bounds.top, scrollY: window.scrollY }
  }, [])
  const restoreViewportAnchor = useCallback(() => {
    const anchor = viewportAnchor.current
    viewportAnchor.current = null
    if (!anchor || !anchor.element.isConnected) return
    const adjustment = calendarAnchorAdjustment(anchor, anchor.element.getBoundingClientRect().top, window.scrollY)
    if (Math.abs(adjustment) > 0.5) {
      performanceProbe('calendar-anchor-adjust', { before: anchor.element.getBoundingClientRect().top, expected: anchor.top, adjustment, scrollY: window.scrollY })
      window.scrollTo({ top: window.scrollY + adjustment, behavior: 'instant' })
    }
  }, [])
  useLayoutEffect(() => {
    anchorOperations.current = { capture: captureViewportAnchor, restore: restoreViewportAnchor }
  }, [captureViewportAnchor, restoreViewportAnchor])

  useEffect(() => {
    const mark = () => {
      calendarUserScrolled.current = true
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
    if (restoreScrollTop !== null) {
      if (!calendarReady) return
      const position = restoredPosition.current
      const element = position ? calendarRef.current?.querySelector(`[data-calendar-date="${position.date}"]`) : null
      const top = position && element
        ? window.scrollY + element.getBoundingClientRect().top - position.top
        : restoreScrollTop
      viewportAnchor.current = null
      performanceProbe('calendar-position-restore', { found: !!element, savedTop: position?.top ?? -1, topBefore: element?.getBoundingClientRect().top ?? -1, scrollY: window.scrollY, target: top, fallback: restoreScrollTop })
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" })
      initialAlignmentDone.current = true
      calendarUserScrolled.current = true
      if (position) setActiveWeekKey(dateKey(startOfMonday(new Date(`${position.date}T12:00:00`))))
      const frame = requestAnimationFrame(() => {
        performanceProbe('calendar-position-settled', { top: element?.getBoundingClientRect().top ?? -1, scrollY: window.scrollY })
        onScrollRestored?.()
      })
      return () => cancelAnimationFrame(frame)
    }
    if (initialAlignmentDone.current || calendarUserScrolled.current || calendarWasDragged.current) return
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
          (mobileViewport ? 56 : 84)
      ),
      behavior: "instant",
    })
    setActiveWeekKey(dateKey(startOfMonday(today)))
    initialAlignmentDone.current = true
  }, [context, summaryOpen, isMobile, calendarReady, restoreScrollTop, onScrollRestored])

  // Correct layout growth before paint, rather than letting newly loaded rows
  // move the day the user was reading. Retain any intervening user scrolling.
  useLayoutEffect(restoreViewportAnchor, [context, dateRange, restoreViewportAnchor])

  useEffect(() => {
    // Wait until initial date alignment finishes before observing the actual viewport.
    if (!calendarReady) return
    const timer = window.setTimeout(() => setHistoryReady(true), 300)
    return () => window.clearTimeout(timer)
  }, [calendarReady])

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
    // Date bounds belong to navigation, not the volume of saved history.
    const first = new Date(`${dateRange.start}T12:00:00`)
    const last = new Date(`${dateRange.end}T12:00:00`)
    const workoutsByWeek = indexCalendarWorkouts(workouts)
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
      result.push({
        key: dateKey(start),
        start,
        days,
        workouts: workoutsByWeek.get(dateKey(start)) ?? [],
      })
    }
    return result
  }, [workouts, dateRange])

  const weekKeys = weeks.map((week) => week.key).join("|")
  const contextVersion = String((context as TrainingContext & { version?: string }).version || '')
  const historyVersion = useRef(contextVersion)
  useEffect(() => {
    if (historyVersion.current === contextVersion) return
    historyVersion.current = contextVersion
    loadedWeeks.current.clear()
    const ranges = (context as TrainingContext & { cached_ranges?: Array<{ start: string; end: string }> }).cached_ranges ?? []
    for (const week of weeks) {
      if (ranges.some((range) => range.start <= week.key && range.end >= dateKey(week.days[6]))) loadedWeeks.current.add(week.key)
    }
  }, [contextVersion, context, weeks])
  useEffect(() => {
    if (!historyReady) return
    let active = true
    const controller = new AbortController()
    let busy = false
    let scrolled = calendarUserScrolled.current
    const queue = new Set<string>()
    const pendingWeeks = new Set<string>()
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
      pendingWeeks.add(start)
      const revision = calendarRevision.current
      await loadTrainingHistoryRange(start, end, { signal: controller.signal })
        .then((next) => {
          if (!active || revision !== calendarRevision.current) return
          loadedWeeks.current.add(start)
          setContext((previous) => mergeCalendarContext(previous, next))
        })
        .catch((error) => {
          if (active && error.name !== "AbortError")
            setMoveNotice(
              `Workouts for ${start} could not load. Scroll back to retry.`
            )
        })
        .finally(() => {
          pendingWeeks.delete(start)
          busy = false
        })
      if (active) void pump()
    }
    const loadVisible = () => {
      if (!scrolled) return
      const first = weekRefs.current.get(dateRange.start)?.getBoundingClientRect()
      const last = weekRefs.current.get(dateRange.end)?.getBoundingClientRect()
      if (first && first.top > -900 && first.top < window.innerHeight + 900) {
        const earlier = new Date(`${dateRange.start}T12:00:00`)
        earlier.setDate(earlier.getDate() - 84)
        captureViewportAnchor()
        setDateRange((current) => extendCalendarRange(current, earlier))
      } else if (last && last.bottom < window.innerHeight + 900 && last.bottom > -900) {
        const later = new Date(`${dateRange.end}T12:00:00`)
        later.setDate(later.getDate() + 84)
        captureViewportAnchor()
        setDateRange((current) => extendCalendarRange(current, later))
      }
      queue.clear()
      for (const [key, element] of weekRefs.current) {
        const bounds = element.getBoundingClientRect()
        if (
          bounds.bottom > 56 &&
          bounds.top < window.innerHeight &&
          !loadedWeeks.current.has(key) &&
          !pendingWeeks.has(key)
        )
          queue.add(key)
      }
      void pump()
    }
    let scrollFrame = 0
    const onScroll = () => {
      scrolled = calendarUserScrolled.current
      if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0
        if (active) loadVisible()
      })
    }
    const observer = new IntersectionObserver(loadVisible, {
      rootMargin: "0px",
      threshold: 0,
    })
    for (const element of weekRefs.current.values()) observer.observe(element)
    const todayKey = dateKey(startOfMonday(new Date()))
    if (weekRefs.current.has(todayKey)) queue.add(todayKey)
    void pump()
    loadVisible()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      active = false
      cancelAnimationFrame(scrollFrame)
      controller.abort()
      observer.disconnect()
      window.removeEventListener("scroll", onScroll)
      pendingWeeks.clear()
    }
  }, [weekKeys, historyReady, dateRange, contextVersion, captureViewportAnchor, setContext])

  useEffect(() => {
    let frame = 0
    const trackVisibleWeek = () => {
      const header = isMobile ? 56 : 84
      let visibleKey = activeWeekKey
      for (const week of weeks) {
        const bounds = weekRefs.current.get(week.key)?.getBoundingClientRect()
        if (bounds && bounds.bottom > header + 1) {
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
              Math.max(bounds.top, header)
          ) / 7
        if (!weight) continue
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
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0
        trackVisibleWeek()
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("scroll", onScroll)
    }
  }, [activeWeekKey, weeks, isMobile])

  const goToToday = useCallback(() => {
    calendarWasDragged.current = true
    calendarUserScrolled.current = true
    setDatePickerOpen(false)
    if (!isMobile && datePickerOpen) {
      queuedDateJump.current = new Date()
      return
    }
    setDateRange(calendarRange(new Date()))
    setPendingDateJump(new Date())
  }, [datePickerOpen, isMobile])

  useEffect(() => {
    window.addEventListener("calendar-go-today", goToToday)
    return () => window.removeEventListener("calendar-go-today", goToToday)
  }, [goToToday])

  const activeWeek =
    weeks.find((week) => week.key === activeWeekKey) ?? weeks[0]
  const activeMonth =
    visibleMonth ||
    activeWeek?.start.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }) ||
    "Calendar"
  const jumpToDate = useCallback((date?: Date) => {
    if (!date) return
    calendarWasDragged.current = true
    calendarUserScrolled.current = true
    setDatePickerOpen(false)
    if (!isMobile && datePickerOpen) {
      queuedDateJump.current = date
      return
    }
    setDateRange(calendarRange(date))
    setPendingDateJump(date)
  }, [datePickerOpen, isMobile])

  useLayoutEffect(() => {
    if (!pendingDateJump || !calendarReady) return
    const key = dateKey(startOfMonday(pendingDateJump))
    const element = isMobile
      ? calendarRef.current?.querySelector(`[data-calendar-date="${dateKey(pendingDateJump)}"]`)
      : weekRefs.current.get(key)
    if (!element) return
    viewportAnchor.current = null
    performanceProbe('calendar-date-jump', { before: element.getBoundingClientRect().top, scrollY: window.scrollY, expected: isMobile ? 56 : 84 })
    window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - (isMobile ? 56 : 84)), behavior: 'instant' })
    performanceProbe('calendar-date-aligned', { top: element.getBoundingClientRect().top, scrollY: window.scrollY })
    initialAlignmentDone.current = true
    setActiveWeekKey(key)
    setVisibleMonth(pendingDateJump.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))
    setPendingDateJump(null)
  }, [pendingDateJump, calendarReady, isMobile, weekKeys])

  useEffect(() => {
    if (!isMobile || !datePickerOpen || !mobilePickerContainerRef.current)
      return
    let destroyed = false
    let picker: Framework7Calendar.Calendar | null = null
    const container=mobilePickerContainerRef.current
    const selected = activeWeek?.start ?? new Date()
    f7ready((app) => {
      if (destroyed || !container.isConnected) return
      container.replaceChildren()
      const updatePickerMonth = (calendar: {
        currentMonth: number
        currentYear: number
      }) => {
        setPickerMonth({ year: calendar.currentYear, month: calendar.currentMonth })
        setPickerMonthLabel(
          new Date(
            calendar.currentYear,
            calendar.currentMonth,
            1
          ).toLocaleDateString("en-US", { month: "long", year: "numeric" })
        )
      }
      picker = app.calendar.create({
        containerEl: container,
        value: [selected],
        minDate: new Date(1900, 0, 1),
        firstDay: 1,
        locale: "en-US",
        toolbar: false,
        monthSelector: false,
        yearSelector: false,
        touchMove: true,
        animate: true,
        cssClass: "calendar-jump-inline",
        on: {
          init: updatePickerMonth,
          monthYearChangeStart: updatePickerMonth,
          dayClick: (_calendar, _dayEl, year, month, day) =>
            jumpToDate(new Date(year, month, day)),
        },
      })
      mobilePickerRef.current = picker
    })
    return () => {
      destroyed = true
      mobilePickerRef.current = null
      picker?.destroy()
      container.replaceChildren()
    }
  }, [activeWeek?.start, datePickerOpen, isMobile, jumpToDate, weeks])

  useEffect(() => {
    if (!isMobile || !datePickerOpen) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        mobilePickerPanelRef.current?.contains(target) ||
        mobilePickerTriggerRef.current?.contains(target) ||
        (target instanceof Element && target.closest(".mobile-site-navbar"))
      )
        return
      setDatePickerOpen(false)
    }
    document.addEventListener("pointerdown", dismiss)
    return () => document.removeEventListener("pointerdown", dismiss)
  }, [datePickerOpen, isMobile])

  const displayedMonth =
    datePickerOpen && pickerMonthLabel ? pickerMonthLabel : activeMonth
  const registerWeek = useCallback((key: string, element: HTMLElement | null) => {
    if (element) weekRefs.current.set(key, element)
    else weekRefs.current.delete(key)
  }, [])
  const reportBlocks = useMemo(() => planReportBlocks(annualPlan), [annualPlan])
  const todayWeekKey = dateKey(startOfMonday(new Date()))
  const jumpWeekKey = pendingDateJump ? dateKey(startOfMonday(pendingDateJump)) : null
  const restoredWeekKey = restoredPosition.current ? dateKey(startOfMonday(new Date(`${restoredPosition.current.date}T12:00:00`))) : null

  const openWorkout = (workout: PlannedWorkout) => {
    if (onWorkoutOpen) {
      captureViewportAnchor()
      const anchor = viewportAnchor.current
      const date = anchor?.element.getAttribute('data-calendar-date') || anchor?.element.getAttribute('data-calendar-week')
      rememberCalendarVisit(context, dateRange, date && anchor ? { date, top: anchor.top } : null)
      performanceProbe('calendar-position-save', { found: !!date, top: anchor?.top ?? -1, scrollY: window.scrollY })
      viewportAnchor.current = null
      onWorkoutOpen(workout)
      return
    }
    rememberOpenWorkout(workout)
    setSelectedWorkout(workout)
  }

  if (!calendarReady) return <CalendarSkeleton />

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
        className="flex w-full min-w-0 flex-1 flex-col max-md:max-w-full max-md:overflow-x-clip"
      >
        <MobileSiteNavbar
          fixed
          className={
            datePickerOpen
              ? "calendar-sticky-day-navbar calendar-picker-navbar-open"
              : "calendar-sticky-day-navbar"
          }
          title=""
          left={
            <button
              ref={mobilePickerTriggerRef}
              type="button"
              aria-label="Jump to calendar date"
              aria-expanded={datePickerOpen}
              aria-controls="mobile-calendar-date-picker"
              onClick={() => setDatePickerOpen((open) => !open)}
              className="mobile-navbar-action mobile-navbar-action-with-text liquid-glass-button calendar-month-picker-button"
            >
              <LiquidGlassLayer />
              <ChevronLeft aria-hidden="true" />
              <span>{displayedMonth}</span>
            </button>
          }
          right={
            datePickerOpen ? (
              <div className="calendar-picker-month-controls">
                <button
                  type="button"
                  className="mobile-navbar-action liquid-glass-button"
                  aria-label="Previous month"
                  onClick={() => mobilePickerRef.current?.prevMonth(250)}
                >
                  <LiquidGlassLayer />
                  <ChevronLeft aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="mobile-navbar-action liquid-glass-button"
                  aria-label="Next month"
                  onClick={() => mobilePickerRef.current?.nextMonth(250)}
                >
                  <LiquidGlassLayer />
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            ) : undefined
          }
          showMenu={!datePickerOpen}
        />
        {isMobile && datePickerOpen && (
          <div className="mobile-calendar-picker-layer">
            <div
              ref={mobilePickerPanelRef}
              id="mobile-calendar-date-picker"
              className="mobile-calendar-picker-panel"
              role="dialog"
              aria-label="Choose calendar date"
              onPointerDown={(event) => {
                pickerSwipeStartRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                }
              }}
              onPointerUp={(event) => {
                const start = pickerSwipeStartRef.current
                pickerSwipeStartRef.current = null
                if (!start) return
                const deltaX = event.clientX - start.x
                const deltaY = event.clientY - start.y
                if (
                  deltaY < -64 &&
                  Math.abs(deltaY) > Math.abs(deltaX) * 1.25
                )
                  setDatePickerOpen(false)
              }}
              onPointerCancel={() => {
                pickerSwipeStartRef.current = null
              }}
            >
              <div className="flex justify-center gap-3 px-4 pt-3">
                <select aria-label="Calendar month" className="min-h-10 rounded-md bg-background px-3 text-sm" value={pickerMonth.month} onChange={(event) => mobilePickerRef.current?.setYearMonth(pickerMonth.year, Number(event.target.value), 0)}>
                  {Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{new Date(2026, month, 1).toLocaleDateString('en-US', { month: 'long' })}</option>)}
                </select>
                <select aria-label="Calendar year" className="min-h-10 rounded-md bg-background px-3 text-sm" value={pickerMonth.year} onChange={(event) => mobilePickerRef.current?.setYearMonth(Number(event.target.value), pickerMonth.month, 0)}>
                  {Array.from({ length: new Date().getFullYear() + 11 - 1900 }, (_, index) => 1900 + index).map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </div>
              <div ref={mobilePickerContainerRef} />
            </div>
          </div>
        )}
        {!isMobile && (
          <header className="sticky top-0 z-50 hidden h-14 w-full shrink-0 items-center px-4 md:flex md:bg-background md:shadow-none">
            <Popover open={datePickerOpen} onOpenChange={(open) => {
              if (open) queuedDateJump.current = null
              setDatePickerOpen(open)
            }} onOpenChangeComplete={(open) => {
              if (open || !queuedDateJump.current) return
              // Closing popovers restore focus asynchronously. Move the calendar
              // after that lifecycle instead of letting it undo the date jump.
              const date = queuedDateJump.current
              queuedDateJump.current = null
              setDateRange(calendarRange(date))
              setPendingDateJump(date)
            }}>
              <PopoverTrigger ref={desktopPickerTriggerRef} className="mx-auto h-9 min-w-0 truncate rounded-md px-2 text-left text-sm font-semibold hover:bg-muted md:mx-0 md:text-base">
                {activeMonth}
              </PopoverTrigger>
              <PopoverContent ref={desktopPickerContentRef} align="start" className="w-auto p-0" initialFocus={() => {
                const target = desktopPickerContentRef.current?.querySelector<HTMLElement>('button, select') ?? desktopPickerContentRef.current
                target?.focus({ preventScroll: true })
                return false
              }} finalFocus={() => {
                desktopPickerTriggerRef.current?.focus({ preventScroll: true })
                return false
              }}>
                <Calendar
                  mode="single"
                  captionLayout="dropdown"
                  startMonth={new Date(1900, 0)}
                  endMonth={new Date(new Date().getFullYear() + 10, 11)}
                  defaultMonth={activeWeek?.start}
                  selected={activeWeek?.start}
                  onSelect={jumpToDate}
                />
              </PopoverContent>
            </Popover>
            <div className="flex items-center gap-1 md:ml-4">
              <Button size="sm" onClick={goToToday}>
                Today
              </Button>
            </div>
          </header>
        )}
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
            <div className="md:divide-y">
              {weeks.map((week) => {
                const end = week.days[6]
                const title = `${week.start.toLocaleDateString("en-US", { month: "short", day: "2-digit" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "2-digit" })}`
                const planWeek =
                  annualPlan?.weeks.find(
                    (item) => item.startDate === week.key
                  ) || null
                return (
                  <CalendarWeekViewport
                    key={week.key}
                    weekKey={week.key}
                    mobile={isMobile}
                    summaryOpen={summaryOpen}
                    forceMounted={week.key === todayWeekKey || week.key === jumpWeekKey || week.key === restoredWeekKey}
                    register={registerWeek}
                    captureAnchor={captureViewportAnchor}
                    restoreAnchor={restoreViewportAnchor}
                  >
                    {() => (
                    <div className="flex h-auto min-h-0 w-full flex-col items-stretch xl:flex-row">
                      <div className="grid h-auto min-h-0 w-full min-w-0 flex-1 grid-cols-1 items-stretch md:min-h-60 md:grid-cols-7 md:divide-x md:divide-y-0">
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
                          const todayKey = dateKey(new Date())
                          const dayKey = dateKey(day)
                          const isToday = dayKey === todayKey
                          const isPast = dayKey < todayKey
                          return (
                            <CalendarDay
                              key={dateKey(day)}
                              date={dateKey(day)}
                              disabled={moving}
                              className={
                                isToday
                                  ? "min-w-0 px-4 pt-0 pb-8 md:bg-primary/5 md:px-1.5 md:py-2"
                                  : "min-w-0 px-4 pt-0 pb-8 md:px-1.5 md:py-2"
                              }
                            >
                              <DayMenu
                                day={day}
                                count={dayWorkouts.length}
                                disabled={moving}
                                onAction={(action) => void runDayAction(day, action)}
                                onCreate={() => setNewWorkoutDate(dateKey(day))}
                              >
                                <span className={`text-[17px] leading-[20.4px] font-semibold md:px-0.5 md:text-sm md:leading-normal md:font-bold ${isPast ? "text-muted-foreground" : isToday ? "text-red-600 dark:text-red-400 md:text-primary" : "text-foreground"}`}>
                                  <span className="md:hidden">
                                    {day.toLocaleDateString("en-US", {
                                      weekday: "long",
                                    })}
                                    {" – "}
                                    {day.toLocaleDateString("en-US", {
                                      month: "short",
                                    })}{" "}
                                  </span>
                                  {day.getDate()}
                                </span>
                              </DayMenu>
                              <div className="mobile-calendar-day-divider w-full border-b border-border/70 md:hidden" aria-hidden="true" />
                              <div className="space-y-0 md:space-y-2">
                                {dayWorkouts.map((workout, workoutIndex) =>
                                  isMobile ? (
                                    <DraggableMobileWorkoutRow
                                      key={workout.id}
                                      workout={workout}
                                      onOpen={() => openWorkout(workout)}
                                      showDivider={
                                        dayWorkouts.length > 1 &&
                                        workoutIndex < dayWorkouts.length - 1
                                      }
                                      disabled={
                                        moving ||
                                        isRaceWorkout(workout) ||
                                        !canEditWorkout(workout)
                                      }
                                    />
                                  ) : (
                                    <DraggableWorkout
                                      key={workout.id}
                                      workout={workout}
                                      disabled={
                                        moving ||
                                        !workout.id.startsWith("event:")
                                      }
                                      onOpen={() => openWorkout(workout)}
                                      onAction={(action) =>
                                        void runWorkoutAction(workout, action)
                                      }
                                    />
                                  )
                                )}
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
                              blockStart={
                                reportBlocks.find(
                                  (block) => block.endDate === dateKey(end)
                                )?.startDate
                              }
                            />
                          </CollapsibleContent>
                        </Collapsible>
                      </aside>
                    </div>
                    )}
                  </CalendarWeekViewport>
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
      </div>
      <DragOverlay>
        {dragging ? (
          <div className="pointer-events-none max-w-sm cursor-grabbing shadow-xl">
            {isMobile ? (
              <MobileWorkoutRow
                workout={dragging}
                onOpen={() => {}}
                showDivider={false}
              />
            ) : (
              <WorkoutCard workout={dragging} onClick={() => {}} />
            )}
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
}

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
        <svg viewBox="0 0 160 160" className="mx-auto size-40" role="img" aria-label="Completed duration by sport">
          {chartData.map((item, index) => {
            const percent = completedTotalMinutes > 0 ? item.minutes / completedTotalMinutes * 100 : 0
            const before = chartData.slice(0, index).reduce((sum, part) => sum + part.minutes, 0)
            return <circle key={item.discipline} cx="80" cy="80" r="51" fill="none" stroke={item.fill} strokeWidth="26" pathLength="100" strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-before / completedTotalMinutes * 100} transform="rotate(-90 80 80)"><title>{item.label}: {formatDuration(item.minutes)}</title></circle>
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <strong className="text-base tabular-nums">
            {formatDuration(completedTotalMinutes)}
          </strong>
          <span className="text-[10px] text-muted-foreground">Total time</span>
        </div>
      </div>
      <div
        className="grid grid-cols-2 divide-x border-t pt-3 text-sm"
        aria-label="Completed versus planned duration"
      >
        <div className="pr-4">
          <p className="mb-1 text-xs text-muted-foreground">Planned</p>
          <p className="font-semibold tabular-nums">
            {formatDuration(plannedTotalMinutes)}
          </p>
        </div>
        <div className="pl-4">
          <p className="mb-1 text-xs text-muted-foreground">Completed</p>
          <p className="font-semibold tabular-nums">
            {formatDuration(completedTotalMinutes)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <SavedReportButton kind="weekly" startDate={startDate} />
        {blockStart && (
          <SavedReportButton kind="block" startDate={blockStart} />
        )}
      </div>
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
  showWorkoutProfile = true,
}: {
  workout: PlannedWorkout | null
  onOpenChange: (open: boolean) => void
  showWorkoutProfile?: boolean
}) {
  const isMobile = useIsMobile()
  const workout = useEditedWorkout(initialWorkout)
  if (!workout) return null
  const desktopCompleted = workout.status === "completed" && !isMobile
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

  if (desktopCompleted) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent
          fullscreen
          showCloseButton={false}
          className="flex h-dvh min-h-0 flex-col gap-0 overflow-hidden bg-background p-0 ring-0"
        >
          <header className="relative z-20 flex h-16 shrink-0 items-center gap-3 border-b bg-background px-5 pr-24 shadow-sm">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
              <SportIcon sport={workout.sport} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-semibold">
                {workout.title}
              </DialogTitle>
              <DialogDescription className="mt-1 truncate text-xs">
                {date}
                {time && <span className="ml-2 tabular-nums">{time}</span>}
              </DialogDescription>
            </div>
            <div className="absolute top-3 right-3 flex items-center gap-1">
              <WorkoutEditorMenu workout={workout} />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close workout details"
                onClick={() => onOpenChange(false)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20">
            <div className="mx-auto grid w-full max-w-[1800px] gap-4 p-4 md:grid-cols-[300px_minmax(0,1fr)] xl:p-5">
              <aside className="min-w-0 space-y-4 md:sticky md:top-4 md:self-start">
                <section
                  className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                  aria-label="Workout overview"
                >
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <p className="text-[10px] font-medium tracking-wide uppercase opacity-70">
                        Duration
                      </p>
                      <p className="mt-1 text-xl font-bold tabular-nums">
                        {duration}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium tracking-wide uppercase opacity-70">
                        Distance
                      </p>
                      <p className="mt-1 text-xl font-bold tabular-nums">
                        {plannedDistanceLabel(workout)}
                      </p>
                    </div>
                    {load != null && (
                      <div>
                        <p className="text-[10px] font-medium tracking-wide uppercase opacity-70">
                          Training load
                        </p>
                        <p className="mt-1 text-lg font-semibold tabular-nums">
                          {Math.round(load).toLocaleString()} TSS
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-medium tracking-wide uppercase opacity-70">
                        Status
                      </p>
                      <p className="mt-1 text-lg font-semibold">Completed</p>
                    </div>
                  </div>
                </section>

                <WorkoutSummary
                  workout={workout}
                  showElapsed={false}
                  embedded
                />

                <section className="rounded-xl border bg-card p-4 shadow-sm">
                  <WorkoutDescription workout={workout} title="Description" />
                </section>
              </aside>

              <main className="min-w-0 space-y-4" aria-label="Workout analysis workspace">
                <Suspense
                  fallback={
                    <ChartSkeleton className="rounded-xl border" />
                  }
                >
                  <WorkoutAnalysis workout={workout} />
                </Suspense>
              </main>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

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
            {showWorkoutProfile &&
              workout.status !== "completed" &&
              (workout.structure || workout.editor_model) && (
                <div className="mt-3 overflow-hidden">
                  <WorkoutProfile
                    workout={workout}
                    compact
                    desktopDetail
                    enableEditOnClick
                  />
                </div>
              )}
          </section>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(340px,0.9fr)_minmax(0,1.1fr)]">
            <WorkoutSummary workout={workout} showElapsed={false} embedded />
            <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
              <WorkoutDescription workout={workout} title="Description" />
            </div>
          </div>
          <Suspense
            fallback={
              <ChartSkeleton className="rounded-xl" />
            }
          >
            <WorkoutAnalysis workout={workout} />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  )
}
