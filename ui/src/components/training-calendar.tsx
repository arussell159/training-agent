import {
  calendarScrollSurface,
  calendarScrollTarget,
  calendarScrollTop,
  scrollCalendarTo,
} from "@/lib/calendar-scroll-surface"
import {
  readCalendarViewPreferences,
  saveCalendarViewPreferences,
  type CalendarViewPreferences,
} from "@/lib/calendar-view-preferences"
import {
  WorkoutCard,
  SportIcon,
  completionGrade,
  estimatedDistance,
} from "@/components/calendar-workout-card"
export { WorkoutCard } from "@/components/calendar-workout-card"
import {
  workoutDetailRoute,
  workoutAnalysisRoute,
  workoutAnalysis360Route,
  prepareWorkout,
} from "@/lib/workout-preload"
import { prepareWorkoutEditor } from "@/components/workout-editor-launcher"
import { fallbackTrainingContext } from "@/lib/training-context"
import {
  readWorkoutSaveDraft,
  validPlannedSaveDraft,
  type PlannedSaveDraft,
} from "@/lib/workout-save-drafts"
import "./training-calendar.css"
import "@/lib/framework7-calendar"
import {
  adjacentCalendarWeek,
  calendarAnchorAdjustment,
  calendarRange,
  extendCalendarRange,
  indexCalendarWorkouts,
} from "@/lib/calendar-viewport"
import {
  desktopCalendarRecordedTotal,
  sameDesktopCalendarSport,
  type RecordedCalendarTotal,
} from "@/lib/desktop-calendar-summary"
import { loadTrainingHistoryRange } from "@/lib/training-history-range"
import { performanceProbe } from "@/lib/performance-probe"
import { CalendarSkeleton, ChartSkeleton } from "@/components/loading-layouts"
import {
  Analysis360Skeleton,
  WorkoutAnalysisSkeleton,
} from "@/components/workout-analysis-skeleton"
import { SavedReportButton } from "@/components/saved-report-button"
import { planReportBlocks } from "../../../app-backend/lib/report-blocks.mjs"
import { WorkoutDescription } from "@/components/workout-description"
import { lazy, Suspense } from "react"
import { formatDuration } from "@/lib/duration"
import { type CompletionGrade } from "@/lib/workout-completion"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { LiquidGlassLayer } from "@/components/ui/liquid-glass-layer"
import { WorkoutProfile } from "@/components/workout-profile"
import {
  DesktopCalendarWeekActions,
  DesktopCalendarShiftDialog,
} from "@/components/desktop-calendar-week-actions"
import { WorkoutSummary } from "@/components/workout-summary"
import { DesktopWorkoutDetails } from "@/components/desktop-workout-details"
import { WorkoutAccountBoundary } from "@/components/workout-account-boundary"
import { useWorkoutAccountBoundary } from "@/hooks/use-workout-account-boundary"
import {
  registerWorkoutNavigationGuard,
  bypassWorkoutNavigationGuard,
  runWithWorkoutNavigationGuard,
} from "@/lib/workout-navigation-guard"
import { isCompletedStrengthWorkout } from "@/lib/strength-completed-summary"
const DesktopStrengthCompleted = lazy(() =>
  import("./desktop-strength-completed").then((module) => ({
    default: module.DesktopStrengthCompleted,
  }))
)
import { DesktopWorkoutCreate } from "@/components/desktop-workout-create"
import { WorkoutGenerator } from "@/components/workout-generator"
import type { WorkoutGeneratorResult } from "@/lib/workout-generator"
import { useWorkoutFiles } from "@/components/workout-file-actions"
import { DesktopWorkoutSummarySettings } from "@/components/desktop-workout-toolbar"
import { WorkoutRecurrenceControl } from "@/components/desktop-workout-recurrence"
import { CalendarDailyMetrics } from "@/components/calendar-daily-metrics"
import {
  CalendarAnnotationCard,
  CalendarAnnotationEditor,
} from "@/components/calendar-annotation-editor"
import {
  validateAnnotation,
  type AnnotationKind,
  type AnnotationResult,
} from "@/lib/calendar-annotations"
import { mergeVerifiedWorkout } from "@/lib/workout-save-state"
import type { CalendarMetricsResult } from "@/lib/calendar-metrics"
import { canEditActivity, canEditWorkout } from "@/lib/workout-permissions"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import {
  formatWorkoutTss,
  workoutTime,
  workoutTssTotal,
  workoutPlannedMinutes,
} from "@/lib/workout-metrics"
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
  Check,
  Copy,
  ClipboardPaste,
  Scissors,
  Menu,
  X,
  RefreshCw,
  Upload,
  Search,
  Settings,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
} from "lucide-react"
import { f7ready } from "framework7-react"
import type { Calendar as Framework7Calendar } from "framework7/types"

import { Button } from "@/components/ui/button"
import { DatePickerCalendar } from "@/components/date-picker-calendar"
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
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  WorkoutEditor,
  WorkoutEditorMenu,
  useEditedWorkout,
} from "@/components/workout-editor-launcher"
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
  pairCompletedWorkout,
  changeWorkout,
  changeWorkoutDay,
  refreshRecentIntervals,
  trainingCacheScope,
  rememberWorkoutForEditing,
  rememberTrainingContext,
  type PlannedWorkout,
  type TrainingContext,
} from "@/lib/training-context"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  validatedTrainingContext,
  validatedTrainingWorkout,
} from "@/lib/training-context-validation"
const WorkoutAnalysis = workoutAnalysisRoute.Component
const WorkoutAnalysis360 = workoutAnalysis360Route.Component
const DailyMetricsDialog = lazy(() =>
  import("@/components/daily-metrics").then((module) => ({
    default: module.DailyMetricsDialog,
  }))
)
const DesktopEventDialog = lazy(() =>
  import("@/components/desktop-event-dialog").then((module) => ({
    default: module.DesktopEventDialog,
  }))
)
import type { RaceEventSaveResult } from "@/lib/race-event-details"
import { apiFetch } from "@/lib/api-client"
import {
  phaseLabel,
  type AnnualPlan,
  type AnnualPlanWeek,
} from "@/lib/annual-plan"
import { isRaceWorkout, RaceCalendarCard } from "@/components/race-events"
import { confirmWithFramework7 } from "@/lib/framework7-confirm"
import { isCalendarNote, notesFirst } from "@/lib/calendar-events"
import {
  calendarDiscipline,
  prepareCalendarPaste,
  projectCalendarMove,
  rollbackCalendarMove,
  rollbackCalendarDeletion,
  applyVerifiedCalendarPair,
  readCalendarClipboardState,
  writeCalendarClipboard,
  calendarClipboardPending,
  calendarClipboardPasteDate,
  removeVerifiedCalendarPlans,
  type CalendarClipboard,
} from "@/lib/calendar-interactions"
import {
  createCalendarEntryTransferClient,
  createCalendarEntryTransferAttempt,
  type CalendarEntryTransferError,
} from "@/lib/calendar-entry-transfer"
import type { CalendarEntryClipboard } from "@/lib/calendar-entry-clipboard"
import { randomId } from "@/lib/random-id"
import {
  DesktopWorkoutHeader,
  type DesktopWorkoutMetadata,
} from "@/components/desktop-workout-header"
import { CalendarAddDialog } from "@/components/calendar-add-dialog"
import {
  CalendarNoteCard,
  CalendarNoteEditor,
} from "@/components/calendar-note"
const calendarEntryTransferClient = createCalendarEntryTransferClient()
const calendarEntryTransferEnabled = (
  kind: CalendarEntryClipboard["entryKind"]
) => ["availability", "goals", "event"].includes(kind)

const mobileGradeStyles: Record<CompletionGrade, string> = {
  planned: "bg-background",
  unknown: "bg-background",
  good: "bg-green-200 text-green-950 active:bg-green-300 dark:bg-green-950/50 dark:text-green-100",
  medium:
    "bg-orange-200 text-orange-950 active:bg-orange-300 dark:bg-orange-950/50 dark:text-orange-100",
  failed:
    "bg-red-200 text-red-950 active:bg-red-300 dark:bg-red-950/50 dark:text-red-100",
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
  target?: {
    kind?: string
    unit?: string
    value?: number
    start?: number
    end?: number
  }
  power?: { units?: string; value?: number; start?: number; end?: number }
  pace?: { units?: string; value?: number; start?: number; end?: number }
  hr?: { units?: string; value?: number; start?: number; end?: number }
}

function profileNodes(workout: PlannedWorkout): CalendarProfileNode[] {
  if (workout.editor_model?.steps) return workout.editor_model.steps
  if (!workout.structure) return []
  try {
    const parsed = JSON.parse(workout.structure)
    const steps = Array.isArray(parsed)
      ? parsed
      : (parsed?.steps ?? parsed?.structure)
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
      else if (node.role !== "rest" && node.intensity !== "rest")
        activeSteps.push(node)
    }
  }
  collect(profileNodes(workout))
  return (
    activeSteps.length > 0 &&
    activeSteps.every((step) => {
      const target = workout.editor_model
        ? step.target
        : step.power || step.pace || step.hr
      const targetData = target as
        | { unit?: string; units?: string; value?: number; start?: number }
        | undefined
      const unit = targetData?.unit || targetData?.units
      const value = targetData?.value ?? targetData?.start
      return Boolean(unit?.includes("zone") && value === 2)
    })
  )
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
      data-workout-id={workout.id}
      onPointerEnter={() => {
        void workoutDetailRoute.preload().catch(() => {})
      }}
      onFocus={() => {
        void workoutDetailRoute.preload().catch(() => {})
      }}
      onTouchStart={() => {
        void workoutDetailRoute.preload().catch(() => {})
      }}
      className={`flex w-full items-stretch gap-3 overflow-hidden px-1 text-left transition-colors md:hidden ${compact ? "min-h-0 py-3" : "min-h-24 py-3"} ${completed ? "bg-background active:bg-accent/50" : mobileGradeStyles[grade]} ${completed ? "mb-1 rounded-md" : ""} ${showDivider && !completed ? "border-b border-border/70" : ""}`}
      aria-label={`Open ${workout.title}${completed ? ", completed" : ""}`}
      disabled={Boolean(workout.app_pending_operation)}
      aria-busy={Boolean(workout.app_pending_operation) || undefined}
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
          <span className="shrink-0 text-[15px] leading-5 font-normal whitespace-nowrap text-foreground tabular-nums">
            {time.label.replace(" time", "")}: {time.value}
          </span>
        </span>
        {(distance || tss !== "—") && (
          <span className="mt-1 block text-right text-[15px] leading-5 text-muted-foreground tabular-nums">
            {[distance, tss !== "—" ? tss : ""].filter(Boolean).join(" · ")}
          </span>
        )}
        {showProfile && (
          <span className="mt-2 block w-full overflow-hidden rounded-sm">
            <WorkoutProfile
              workout={workout}
              compact
              mobilePlanned
              mobileCalendar
            />
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
  disabled = disabled || Boolean(workout.app_pending_operation)
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: workout.id,
    data: { workout },
    disabled,
  })
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({
    id: `combine:${workout.id}`,
    data: { workout, kind: "combine" },
    disabled:
      disabled || workout.status === "completed" || !canEditWorkout(workout),
  })
  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        setDropNodeRef(node)
      }}
      {...listeners}
      className={`relative select-none md:hidden ${isDragging ? "opacity-30" : ""} ${isOver ? "z-10 rounded-md ring-2 ring-primary ring-offset-2" : ""}`}
    >
      {isOver && (
        <span className="pointer-events-none absolute -top-2 right-2 z-20 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow">
          Combine workouts
        </span>
      )}
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

function DraggableWorkout({
  workout,
  onOpen,
  onAction,
  disabled,
  cut = false,
  onEntryTransfer,
  entryTransferDisabled = false,
  onEntryEdit,
}: {
  workout: PlannedWorkout
  onOpen: () => void
  onAction: (action: "copy" | "cut" | "delete") => void | Promise<void>
  disabled: boolean
  cut?: boolean
  onEntryTransfer?: (mode: "copy" | "cut") => void
  entryTransferDisabled?: boolean
  onEntryEdit?: () => void
}) {
  disabled = disabled || Boolean(workout.app_pending_operation)
  const race = isRaceWorkout(workout)
  const nativePermissions = workout as PlannedWorkout & {
    editable?: boolean
    raw?: {
      read_only?: boolean
      readonly?: boolean
      editable?: boolean
      athlete_cannot_edit?: boolean
    }
  }
  if (race)
    disabled =
      disabled ||
      !canEditWorkout(workout) ||
      nativePermissions.editable === false ||
      Boolean(
        nativePermissions.raw?.read_only ||
        nativePermissions.raw?.readonly ||
        nativePermissions.raw?.athlete_cannot_edit
      ) ||
      nativePermissions.raw?.editable === false
  const completedActivity =
    workout.status === "completed" &&
    workout.id.startsWith("activity:") &&
    Boolean(workout.activity_id)
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: workout.id,
    data: { workout },
    disabled:
      disabled || race || (!completedActivity && !canEditWorkout(workout)),
  })
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({
    id: `combine:${workout.id}`,
    data: { workout, kind: "combine" },
    disabled:
      disabled ||
      isCalendarNote(workout) ||
      workout.status === "completed" ||
      !workout.id.startsWith("event:") ||
      !canEditWorkout(workout),
  })
  if (race)
    return (
      <div ref={setNodeRef} className="calendar-race-card">
        <RaceCalendarCard
          workout={workout}
          disabled={disabled}
          onOpen={onOpen}
          onDelete={() => onAction("delete")}
          onTransfer={onEntryTransfer}
          transferDisabled={entryTransferDisabled}
          onEdit={onEntryEdit}
        />
      </div>
    )
  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        setDropNodeRef(node)
      }}
      {...listeners}
      data-calendar-cut={cut || undefined}
      className={`relative select-none ${isDragging ? "opacity-30" : ""} ${isOver ? "z-10 rounded-md ring-2 ring-primary ring-offset-2" : ""}`}
    >
      {isOver && (
        <span className="pointer-events-none absolute -top-2 right-2 z-20 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow">
          Combine workouts
        </span>
      )}
      {isCalendarNote(workout) ? (
        <CalendarNoteCard
          workout={workout}
          onOpen={onOpen}
          onAction={onAction}
          disabled={disabled}
        />
      ) : (
        <WorkoutCard
          workout={workout}
          onClick={onOpen}
          onAction={canEditWorkout(workout) ? onAction : undefined}
          disabled={disabled}
          calendarPresentation
        />
      )}
    </div>
  )
}

function CalendarDay({
  date,
  className,
  children,
  disabled,
  today,
  currentWeek,
}: {
  date: string
  className: string
  children: ReactNode
  disabled: boolean
  today: boolean
  currentWeek: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled })
  return (
    <div
      ref={setNodeRef}
      data-calendar-date={date}
      data-calendar-today={today ? "true" : undefined}
      data-calendar-current-week={currentWeek ? "true" : undefined}
      data-calendar-drop-active={isOver ? "true" : undefined}
      className={`group/day calendar-day-cell relative ${className} ${isOver ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""}`}
    >
      {children}
    </div>
  )
}

function DayMenu({
  day,
  count,
  copyCount,
  disabled,
  onAdd,
  onAction,
  onCopy,
  onCut,
  onPaste,
  pasteLabel,
  mobile,
  children,
}: {
  day: Date
  count: number
  copyCount: number
  disabled: boolean
  onAdd: () => void
  onAction: (action: "copy" | "delete") => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  pasteLabel: string | null
  mobile: boolean
  children: ReactNode
}) {
  const label = day.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const chooseAction = (event: ChangeEvent<HTMLSelectElement>) => {
    const action = event.currentTarget.value
    if (action === "add") onAdd()
    if (action === "copy") void onAction("copy")
    if (action === "delete") onAction("delete")
    // Keep the date as the selected label so the native picker can be opened
    // again after an action is chosen.
    event.currentTarget.value = ""
  }
  return (
    <div className="mobile-calendar-day-heading relative -mx-4 flex min-h-11 items-center px-4 py-0.5 md:mx-0 md:mb-3 md:block md:min-h-0 md:px-0 md:py-0 md:pb-0">
      {mobile ? (
        <>
          {children}
          <ChevronDown className="ml-1 inline size-3.5" aria-hidden="true" />
          <select
            aria-label={`Workout actions for ${label}`}
            disabled={disabled}
            value=""
            onChange={chooseAction}
            className="absolute inset-0 z-[1] h-full w-full cursor-pointer appearance-none opacity-0"
          >
            <option value="" disabled>
              {label}
            </option>
            <option value="add">Add workout</option>
            <option value="copy" disabled={copyCount === 0}>
              Copy
            </option>
            <option value="delete" disabled={count === 0}>
              Delete
            </option>
          </select>
        </>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            render={
              <button
                type="button"
                aria-label={`Actions for ${label}`}
                className="calendar-day-menu-trigger"
                onKeyDown={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key.toLowerCase() === "v" &&
                    pasteLabel
                  ) {
                    event.preventDefault()
                    onPaste()
                  }
                }}
              />
            }
          >
            {children}
            <Menu className="calendar-day-menu-icon" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="calendar-context-menu">
            <DropdownMenuItem disabled={disabled} onClick={onAdd}>
              <Plus />
              Add workout
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={copyCount === 0 || disabled}
              onClick={onCut}
            >
              <Scissors />
              Cut day
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={copyCount === 0 || disabled}
              onClick={onCopy}
            >
              <Copy />
              Copy day
            </DropdownMenuItem>
            {pasteLabel && (
              <DropdownMenuItem disabled={disabled} onClick={onPaste}>
                <ClipboardPaste />
                Paste {pasteLabel}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={count === 0 || disabled}
              variant="destructive"
              onClick={() => onAction("delete")}
            >
              <Trash2 />
              Delete day
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
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

function calendarStickyBoundary(root: HTMLElement | null) {
  const mobile = window.matchMedia("(max-width: 767px)").matches
  const header = root?.querySelector<HTMLElement>(
    mobile ? ".calendar-sticky-day-navbar" : ".calendar-weekday-header"
  )
  if (!header) return mobile ? 56 : 83
  const top = Number.parseFloat(getComputedStyle(header).top) || 0
  return (
    (calendarScrollSurface(root)?.getBoundingClientRect().top ?? 0) +
    top +
    header.getBoundingClientRect().height
  )
}

// Keep the last calendar visit in memory for a workout-detail round trip.
// Offscreen weeks occupy their measured height without mounting cards, charts,
// menus, drag sensors or mobile headings. Session resets discard the visit.
const calendarWeekHeights = new Map<string, number>()
let previousCalendarRange: ReturnType<typeof calendarRange> | null = null
let previousCalendarContext: TrainingContext | null = null
let previousCalendarPosition: { date: string; top: number } | null = null
function rememberCalendarVisit(
  context: TrainingContext,
  range: ReturnType<typeof calendarRange>,
  position: typeof previousCalendarPosition
) {
  previousCalendarContext = context
  previousCalendarRange = range
  previousCalendarPosition = position
}
if (typeof window !== "undefined") {
  const resetCalendar = () => {
    calendarWeekHeights.clear()
    previousCalendarRange = null
    previousCalendarContext = null
    previousCalendarPosition = null
  }
  window.addEventListener("training-cache-reset", resetCalendar)
  window.addEventListener("app-auth-required", resetCalendar)
  window.addEventListener("device-cache-cleared", resetCalendar)
}

function CalendarWeekViewport({
  weekKey,
  mobile,
  summaryOpen,
  forceMounted,
  register,
  captureAnchor,
  restoreAnchor,
  children,
}: {
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
  const heightKey = `${mobile ? "mobile" : summaryOpen ? "wide" : "compact"}:${weekKey}`
  const measuredHeight = useRef(
    calendarWeekHeights.get(heightKey) ?? (mobile ? 840 : 300)
  )

  useLayoutEffect(() => {
    if (forceMounted) {
      nearViewportRef.current = true
      setNearViewport(true)
    }
  }, [forceMounted])
  useLayoutEffect(() => {
    // Opening an editor also renders its parent calendar. Measuring every week
    // here forced the new dialog's layout before it could paint. Only actual
    // viewport/mount changes need synchronous anchor restoration.
    restoreAnchor()
  }, [mounted, heightKey, restoreAnchor])
  useEffect(() => {
    const element = elementRef.current
    if (!mounted || !element) return
    const observer = new ResizeObserver(([entry]) => {
      // ResizeObserver delivers completed layout measurements. Updating the
      // virtualization cache does not need another synchronous geometry read.
      const height =
        entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height
      if (!height || height === measuredHeight.current) return
      measuredHeight.current = height
      calendarWeekHeights.set(heightKey, height)
      restoreAnchor()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [mounted, heightKey, restoreAnchor])
  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        const next = entry.isIntersecting
        if (nearViewportRef.current === next) return
        captureAnchor()
        if (!next) {
          measuredHeight.current = element.getBoundingClientRect().height
          calendarWeekHeights.set(heightKey, measuredHeight.current)
        }
        nearViewportRef.current = next
        setNearViewport(next)
      },
      {
        root: mobile
          ? null
          : element.closest<HTMLElement>(".training-calendar"),
        rootMargin: "900px 0px",
      }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [captureAnchor, heightKey, mobile])

  return (
    <section
      ref={(element) => {
        elementRef.current = element
        register(weekKey, element)
      }}
      data-calendar-week={weekKey}
      data-calendar-mounted={mounted ? "true" : "false"}
      className="calendar-week h-auto min-h-0 scroll-mt-14 bg-background"
      style={
        mounted
          ? undefined
          : {
              height:
                calendarWeekHeights.get(heightKey) ?? measuredHeight.current,
            }
      }
    >
      {mounted ? children() : null}
    </section>
  )
}

type TrainingCalendarProps = {
  onWorkoutOpen?: (workout: PlannedWorkout) => void
  restoreScrollTop?: number | null
  onScrollRestored?: () => void
}

export function TrainingCalendar(props: TrainingCalendarProps) {
  const account = useWorkoutAccountBoundary(true)
  if (!account.trusted)
    return (
      <section className="p-6" aria-label="Reopen calendar">
        <h2>Reopen calendar</h2>
        <p role="alert">
          The connected account changed. Reload the calendar to view the current
          account.
        </p>
        <Button onClick={() => window.location.reload()}>
          Reload calendar
        </Button>
      </section>
    )
  return <TrustedTrainingCalendar {...props} />
}

function TrustedTrainingCalendar({
  onWorkoutOpen,
  restoreScrollTop = null,
  onScrollRestored,
}: TrainingCalendarProps) {
  const isMobile = useIsMobile()
  const [context, updateContext] = useState(() => {
    const current = cachedTrainingContext()
    return restoreScrollTop !== null && previousCalendarContext
      ? mergeCalendarContext(previousCalendarContext, current)
      : current
  })
  useEffect(() => {
    previousCalendarContext = context
  }, [context])
  const anchorOperations = useRef({ capture: () => {}, restore: () => {} })
  const setContext = useCallback<Dispatch<SetStateAction<TrainingContext>>>(
    (update) => {
      anchorOperations.current.capture()
      updateContext(update)
    },
    []
  )
  const [dateRange, setDateRange] = useState(() =>
    restoreScrollTop !== null && previousCalendarRange
      ? previousCalendarRange
      : calendarRange(new Date())
  )
  const [pendingDateJump, setPendingDateJump] = useState<Date | null>(null)
  const restoredPosition = useRef(
    restoreScrollTop !== null ? previousCalendarPosition : null
  )
  useEffect(() => {
    previousCalendarRange = dateRange
  }, [dateRange])
  useEffect(() => {
    if (context !== fallbackTrainingContext)
      performanceProbe("calendar-visible")
  }, [context])
  const [calendarReady, setCalendarReady] = useState(
    () => context !== fallbackTrainingContext
  )
  const [annualPlan, setAnnualPlan] = useState<AnnualPlan | null>(null)
  const [historyReady, setHistoryReady] = useState(false)
  const loadedWeeks = useRef(new Set<string>())
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(
    null
  )
  const [newWorkoutDate, setNewWorkoutDate] = useState<string | null>(null)
  const [generatorDate, setGeneratorDate] = useState<string | null>(null)
  const [generatedWorkout, setGeneratedWorkout] =
    useState<WorkoutGeneratorResult | null>(null)
  const [addDialogDate, setAddDialogDate] = useState<string | null>(null)
  const [newWorkoutType, setNewWorkoutType] = useState<{
    sport: string
    name: string
    variant?: "brick" | "day-off" | "custom"
  } | null>(null)
  const [noteEditor, setNoteEditor] = useState<{
    date: string
    workout?: PlannedWorkout
  } | null>(null)
  const [eventDate, setEventDate] = useState<string | null>(null)
  const [eventId, setEventId] = useState<string | undefined>(undefined)
  const [eventEditing, setEventEditing] = useState(false)
  const [annotationEditor, setAnnotationEditor] = useState<{
    kind: AnnotationKind
    date: string
    id?: string
  } | null>(null)
  const [activeWeekKey, setActiveWeekKey] = useState(""),
    [datePickerOpen, setDatePickerOpen] = useState(false),
    [visibleMonth, setVisibleMonth] = useState(""),
    [pickerMonthLabel, setPickerMonthLabel] = useState("")
  const [pickerMonth, setPickerMonth] = useState(() => ({
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
  }))
  const [dragging, setDragging] = useState<PlannedWorkout | null>(null)
  const [moving, setMoving] = useState(false)
  const [moveNotice, setMoveNotice] = useState("")
  const clipboardScope = trainingCacheScope()
  const [clipboardState, setClipboardState] = useState(() =>
    isMobile
      ? { status: "empty" as const }
      : readCalendarClipboardState(clipboardScope)
  )
  const [clipboardAccount, setClipboardAccount] = useState(clipboardScope)
  const calendarClipboard =
    clipboardAccount === clipboardScope && clipboardState.status === "ready"
      ? clipboardState.clipboard
      : null
  const clipboardPending = calendarClipboardPending(calendarClipboard)
  const pendingPasteDate = calendarClipboardPasteDate(calendarClipboard)
  useEffect(() => {
    const refresh = () => {
      setClipboardAccount(clipboardScope)
      setClipboardState(
        isMobile
          ? { status: "empty" }
          : readCalendarClipboardState(clipboardScope)
      )
    }
    refresh()
    setWeekShift(null)
    const changed = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === `calendar-clipboard:v1:${clipboardScope}`
      )
        refresh()
    }
    window.addEventListener("storage", changed)
    return () => window.removeEventListener("storage", changed)
  }, [clipboardScope, isMobile])
  const [weekShift, setWeekShift] = useState<CalendarClipboard | null>(null)
  useEffect(() => {
    if (!moveNotice || moving || calendarClipboard) return
    const timer = window.setTimeout(() => setMoveNotice(""), 3500)
    return () => window.clearTimeout(timer)
  }, [moveNotice, moving, calendarClipboard])
  const mutationLock = useRef(false)
  const acquireCalendarMutation = () => {
    if (mutationLock.current) return false
    mutationLock.current = true
    calendarRevision.current += 1
    setMoving(true)
    return true
  }
  const releaseCalendarMutation = () => {
    calendarRevision.current += 1
    mutationLock.current = false
    setMoving(false)
  }
  const rememberClipboard = (
    value: CalendarClipboard | null,
    expected?: CalendarClipboard | null,
    resolved = false
  ) => {
    if (trainingCacheScope() !== clipboardScope)
      throw Error(
        "Your account changed. Reload the current account before continuing its calendar paste."
      )
    writeCalendarClipboard(clipboardScope, value, undefined, expected, {
      resolved,
    })
    setClipboardState(
      value ? { status: "ready", clipboard: value } : { status: "empty" }
    )
  }
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
    const markCoveredWeeks = (
      cached: TrainingContext & {
        cached_ranges?: Array<{ start: string; end: string }>
      }
    ) => {
      if (!cached.cached_ranges?.length) return
      const now = new Date()
      const cursor = startOfMonday(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90)
      )
      const last = new Date(
        now.getFullYear() + 1,
        now.getMonth(),
        now.getDate()
      )
      while (cursor <= last) {
        const start = dateKey(cursor)
        const end = dateKey(
          new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate() + 6
          )
        )
        if (
          cached.cached_ranges.some(
            (covered) => covered.start <= start && covered.end >= end
          )
        )
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
    void hydrateDeviceHistory()
      .then((device) => {
        if (!active || !device) return
        markCoveredWeeks(device)
        setContext((current) => mergeCalendarContext(device, current))
        setCalendarReady(true)
      })
      .catch(() => {})
    void loadFullTrainingContext()
      .then((full) => {
        if (!active) return
        markCoveredWeeks(full)
        setContext((current) =>
          current === full ? current : mergeCalendarContext(current, full)
        )
        setCalendarReady(true)
      })
      .catch(() => {
        if (active) setCalendarReady(true)
      })
    const update = (event: Event) => {
      if (active) {
        setContext((current) =>
          mergeCalendarContext(
            current,
            (event as CustomEvent<TrainingContext>).detail
          )
        )
      }
    }
    window.addEventListener("training-context-updated", update)
    const invalidateReads = () => {
      calendarRevision.current += 1
    }
    window.addEventListener("training-mutation-started", invalidateReads)
    return () => {
      active = false
      window.removeEventListener("training-context-updated", update)
      window.removeEventListener("training-mutation-started", invalidateReads)
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
    action: "copy" | "cut" | "delete",
    propagate = false
  ) => {
    if (mutationLock.current) {
      if (propagate)
        throw Error(
          "Another calendar change is still being saved. Try again when it finishes."
        )
      return
    }
    if ((action === "copy" || action === "cut") && !isMobile) {
      if (clipboardPending) {
        setMoveNotice(
          "Finish or clear the pending paste before selecting another workout."
        )
        return
      }
      try {
        rememberClipboard({
          kind: "workout",
          mode: action,
          workoutIds: [workout.id],
          label: workout.title,
        })
        setMoveNotice(
          `${action === "cut" ? "Cut" : "Copied"} ${workout.title}. Choose a day and select Paste workout.`
        )
      } catch (error) {
        setMoveNotice(
          error instanceof Error
            ? error.message
            : "The calendar clipboard could not be saved."
        )
      }
      return
    }
    if (action === "cut") return
    if (!acquireCalendarMutation()) {
      if (propagate)
        throw Error(
          "Another calendar change is still being saved. Try again when it finishes."
        )
      return
    }
    calendarWasDragged.current = true
    const before = context
    let provisionalDelete = false
    try {
      if (
        action === "delete" &&
        !isRaceWorkout(workout) &&
        !(await confirmWithFramework7(
          isCalendarNote(workout) ? "Delete note?" : "Delete workout?",
          `Delete “${workout.title}” from your Intervals.icu calendar?`
        ))
      )
        return
      setMoveNotice("")
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
        if (result.context)
          result.context = validatedTrainingContext(result.context)
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
      if (action === "delete" && !isRaceWorkout(workout)) {
        provisionalDelete = true
        setContext((current) =>
          removeVerifiedCalendarPlans(current, [workout.id])
        )
      }
      const result = await changeWorkout(
        workout.id,
        action,
        undefined,
        undefined,
        { feedback: false, optimistic: !isRaceWorkout(workout) }
      )
      if (result.context)
        setContext((current) =>
          action === "delete"
            ? removeVerifiedCalendarPlans(
                mergeCalendarContext(current, result.context!),
                [workout.id]
              )
            : mergeCalendarContext(current, result.context!)
        )
      else if (action === "delete")
        setContext((current) =>
          removeVerifiedCalendarPlans(current, [workout.id])
        )
      setMoveNotice(
        `${workout.title} ${action === "copy" ? "copied to the same day" : "deleted"}.${!result.context ? " Refresh Intervals.icu to reload the calendar." : ""}`
      )
    } catch (error) {
      if (provisionalDelete)
        setContext((current) =>
          rollbackCalendarDeletion(current, before, [workout.id])
        )
      setMoveNotice(
        error instanceof Error ? error.message : `Unable to ${action} workout.`
      )
      if (propagate) throw error
    } finally {
      releaseCalendarMutation()
    }
  }

  const runDayAction = async (
    day: Date,
    action: "copy" | "delete",
    count: number
  ) => {
    if (!acquireCalendarMutation()) return
    calendarWasDragged.current = true
    const before = context
    let provisionalIds: string[] = []
    try {
      if (
        action === "delete" &&
        !(await confirmWithFramework7(
          "Delete this day’s planned workouts?",
          `Delete ${count} planned workout${count === 1 ? "" : "s"} and notes on ${day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} from Intervals.icu? Completed recordings and races stay in place.`
        ))
      )
        return
      setMoveNotice("")
      if (action === "delete") {
        provisionalIds = [
          ...new Map(
            [...context.history, ...context.planned].map((row) => [
              (row as PlannedWorkout).id,
              row as PlannedWorkout,
            ])
          ).values(),
        ]
          .filter(
            (row) =>
              row.workout_date === dateKey(day) &&
              canEditWorkout(row) &&
              !isRaceWorkout(row) &&
              !row.calendar_annotation &&
              !row.calendar_annotation_key
          )
          .map((row) => row.id)
        setContext((current) =>
          removeVerifiedCalendarPlans(current, provisionalIds)
        )
      }
      const result = await changeWorkoutDay(dateKey(day), action)
      const confirmed = new Set(result.results.map((item) => item.workoutId))
      const unconfirmed = provisionalIds.filter((id) => !confirmed.has(id))
      if (result.context)
        setContext((current) =>
          rollbackCalendarDeletion(
            mergeCalendarContext(current, result.context!),
            before,
            unconfirmed
          )
        )
      else if (action === "delete") {
        const ids = result.results.map((item) => item.workoutId)
        setContext((current) => removeVerifiedCalendarPlans(current, ids))
        if (unconfirmed.length)
          setContext((current) =>
            rollbackCalendarDeletion(current, before, unconfirmed)
          )
      }
      setMoveNotice(
        `${result.results.length} of ${result.total} workouts ${action === "copy" ? "copied to the same day" : "deleted"}.${result.failures.length ? ` ${result.failures[0].error} Refresh before retrying.` : !result.context ? " Refresh Intervals.icu to reload the calendar." : ""}`
      )
    } catch (error) {
      if (provisionalIds.length)
        setContext((current) =>
          rollbackCalendarDeletion(current, before, provisionalIds)
        )
      setMoveNotice(
        error instanceof Error
          ? error.message
          : "Unable to update this day’s workouts."
      )
    } finally {
      releaseCalendarMutation()
    }
  }

  const selectCalendarEntry = async (
    kind: CalendarEntryClipboard["entryKind"],
    id: string,
    mode: "copy" | "cut"
  ) => {
    if (isMobile || !acquireCalendarMutation()) return
    try {
      const current = readCalendarClipboardState(clipboardScope)
      if (current.status === "blocked") throw Error(current.error)
      const previous = current.status === "ready" ? current.clipboard : null
      if (calendarClipboardPending(previous))
        throw Error(
          "Finish or clear the pending paste before selecting another calendar entry."
        )
      const row = await calendarEntryTransferClient.read(kind, id)
      if (!row.editable || !row.metadataCurrent)
        throw Error(
          "Reload the authoritative calendar entry before copying or moving it."
        )
      const label =
        kind === "event"
          ? (row as import("@/lib/race-event-details").RaceEventRead).name
          : kind === "goals"
            ? (row as import("@/lib/calendar-annotations").CalendarAnnotation)
                .title
            : "Availability"
      rememberClipboard(
        { kind: "entry", mode, entryKind: kind, workoutIds: [id], label, row },
        previous
      )
      setMoveNotice(
        `${mode === "cut" ? "Cut" : "Copied"} ${label}. Choose a day and select Paste entry.`
      )
    } catch (error) {
      setMoveNotice(
        error instanceof Error
          ? error.message
          : "The calendar entry could not be copied."
      )
    } finally {
      releaseCalendarMutation()
    }
  }

  const copyCalendarDay = (
    day: Date,
    workouts: PlannedWorkout[],
    mode: "copy" | "cut" = "copy"
  ) => {
    if (mutationLock.current) return
    if (clipboardPending) {
      setMoveNotice(
        "Finish or clear the pending paste before selecting another day."
      )
      return
    }
    const workoutIds = workouts
      .filter(
        (workout) =>
          canEditWorkout(workout) &&
          !isRaceWorkout(workout) &&
          !workout.calendar_annotation &&
          !workout.calendar_annotation_key
      )
      .map((workout) => workout.id)
    if (!workoutIds.length) {
      setMoveNotice("There are no planned workouts to copy from this day.")
      return
    }
    if (workoutIds.length > 100) {
      setMoveNotice("Copy up to 100 planned workouts and notes at a time.")
      return
    }
    const label = day.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    try {
      rememberClipboard({ kind: "day", mode, workoutIds, label })
      setMoveNotice(
        `${mode === "cut" ? "Cut" : "Copied"} ${workoutIds.length} planned workout${workoutIds.length === 1 ? "" : "s"} from ${label}. Choose a day and select Paste day.`
      )
    } catch (error) {
      setMoveNotice(
        error instanceof Error
          ? error.message
          : "The calendar clipboard could not be saved."
      )
    }
  }

  const pasteCalendarClipboard = async (
    day: Date,
    source = calendarClipboard
  ) => {
    if (clipboardAccount !== clipboardScope) {
      setMoveNotice(
        "Your account changed. Reload its clipboard before pasting."
      )
      return
    }
    if (!source || !acquireCalendarMutation()) return
    let clipboard = structuredClone(source)
    const date = calendarClipboardPasteDate(clipboard) || dateKey(day)
    const existingEntryAttempt = clipboard.entryAttempt
    calendarWasDragged.current = true
    setMoveNotice("")
    let pendingMove: { id: string; date: string } | undefined
    try {
      if (clipboard.kind === "entry") {
        const previous = structuredClone(clipboard)
        const attempt =
          clipboard.entryAttempt ||
          createCalendarEntryTransferAttempt(
            clipboard.entryKind,
            clipboard.row,
            clipboard.mode === "cut" ? "move" : "copy",
            date
          )
        clipboard = { ...clipboard, entryAttempt: attempt }
        rememberClipboard(clipboard, previous)
        const result = await calendarEntryTransferClient.write(attempt, {
          reconcileOnly: Boolean(existingEntryAttempt),
        })
        if (trainingCacheScope() !== clipboardScope)
          throw Error(
            "Your account changed. Reopen the original account to confirm its paste."
          )
        if (result.context)
          setContext((current) =>
            mergeCalendarContext(current, result.context!)
          )
        else
          setContext(
            (current) => mergeVerifiedWorkout(current, result.workout).context
          )
        if (result.plan) setAnnualPlan(result.plan)
        rememberClipboard(null, clipboard, true)
        setMoveNotice(
          `${clipboard.label} ${clipboard.mode === "cut" ? "moved" : "pasted"} to ${date}.${result.planWarning ? ` ${result.planWarning}` : ""}${result.refreshWarning ? ` ${result.refreshWarning}` : ""}`
        )
        return
      }
      const attempt =
        clipboard.attempt || prepareCalendarPaste(clipboard, date, randomId)
      const previousClipboard =
        source === weekShift ? readCalendarClipboardState(clipboardScope) : null
      if (previousClipboard?.status === "blocked")
        throw Error(previousClipboard.error)
      clipboard = { ...clipboard, attempt }
      rememberClipboard(
        clipboard,
        previousClipboard
          ? previousClipboard.status === "ready"
            ? previousClipboard.clipboard
            : null
          : source
      )
      let needsRefresh = false
      for (
        let index = attempt.completed;
        index < attempt.items.length;
        index++
      ) {
        const item = attempt.items[index]
        const target = item.date || date
        if (clipboard.mode === "cut") {
          pendingMove = { id: item.id, date: target }
          setContext((current) =>
            projectCalendarMove(current, item.id, target, dateKey(new Date()))
          )
        }
        const result =
          clipboard.mode === "cut"
            ? await moveWorkoutDate(item.id, target, true, { feedback: false })
            : await changeWorkout(item.id, "copy", target, item.creationId, {
                feedback: false,
              })
        if (result.context)
          setContext((current) =>
            mergeCalendarContext(current, result.context!)
          )
        else if (clipboard.mode === "copy") needsRefresh = true
        pendingMove = undefined
        const previous = clipboard
        clipboard = {
          ...clipboard,
          attempt: { ...attempt, completed: index + 1 },
        }
        rememberClipboard(clipboard, previous)
      }
      if (needsRefresh) {
        const refreshed = await loadFullTrainingContext(true)
        if (refreshed) setContext(refreshed)
      }
      rememberClipboard(null, clipboard)
      setMoveNotice(
        `${attempt.items.length} planned workout${attempt.items.length === 1 ? "" : "s"} ${clipboard.mode === "cut" ? "moved" : "pasted"} to ${date}.`
      )
    } catch (error) {
      if (
        clipboard.kind === "entry" &&
        !existingEntryAttempt &&
        (error as CalendarEntryTransferError).uncertain === false
      ) {
        try {
          const idle = { ...clipboard }
          delete idle.entryAttempt
          rememberClipboard(idle, clipboard, true)
        } catch {
          /* Preserve the original attempt when recovery cleanup cannot be confirmed. */
        }
      }
      if (pendingMove) {
        const { id, date: attemptedDate } = pendingMove
        setContext((current) =>
          rollbackCalendarMove(current, context, id, attemptedDate)
        )
      }
      setMoveNotice(
        `${clipboard.attempt?.completed ? `${clipboard.attempt.completed} confirmed. ` : ""}${error instanceof Error ? error.message : "Unable to confirm this paste."}`
      )
    } finally {
      releaseCalendarMutation()
    }
  }

  const runWeekAction = async (
    start: string,
    workouts: PlannedWorkout[],
    action: "cut" | "copy" | "paste" | "shift" | "delete"
  ) => {
    if (mutationLock.current) return
    if (action === "paste") {
      await pasteCalendarClipboard(new Date(`${start}T12:00:00`))
      return
    }
    if (clipboardPending) {
      setMoveNotice(
        "Finish or clear the pending paste before selecting another week."
      )
      return
    }
    const eligible = workouts.filter(
      (workout) =>
        canEditWorkout(workout) &&
        !isRaceWorkout(workout) &&
        !workout.calendar_annotation &&
        !workout.calendar_annotation_key
    )
    if (!eligible.length) return
    if (eligible.length > 100) {
      setMoveNotice(
        "Choose a day instead; a calendar operation supports up to 100 planned workouts and notes."
      )
      return
    }
    if (action === "delete") {
      if (!acquireCalendarMutation()) return
      let removed = 0
      const before = context
      let provisional = false
      try {
        if (
          !(await confirmWithFramework7(
            "Delete this week’s planned workouts?",
            `Delete ${eligible.length} planned workouts and notes for the week of ${start} from Intervals.icu? Completed recordings and races stay in place.`
          ))
        )
          return
        setMoveNotice("")
        provisional = true
        setContext((current) =>
          removeVerifiedCalendarPlans(
            current,
            eligible.map((workout) => workout.id)
          )
        )
        for (const workout of eligible) {
          const result = await changeWorkout(
            workout.id,
            "delete",
            undefined,
            undefined,
            { feedback: false }
          )
          const pendingIds = eligible.slice(removed).map((item) => item.id)
          if (result.context)
            setContext((current) =>
              removeVerifiedCalendarPlans(
                mergeCalendarContext(current, result.context!),
                pendingIds
              )
            )
          else
            setContext((current) =>
              removeVerifiedCalendarPlans(current, [workout.id])
            )
          removed++
        }
        setMoveNotice(`${removed} planned workouts and notes deleted.`)
      } catch (error) {
        if (provisional)
          setContext((current) =>
            rollbackCalendarDeletion(
              current,
              before,
              eligible.slice(removed).map((workout) => workout.id)
            )
          )
        setMoveNotice(
          `${removed} confirmed deleted. ${error instanceof Error ? error.message : "The remaining deletions could not be confirmed."}`
        )
      } finally {
        releaseCalendarMutation()
      }
      return
    }
    const clipboard: CalendarClipboard = {
      kind: "week",
      mode: action === "copy" ? "copy" : "cut",
      sourceStart: start,
      workoutDates: eligible.map((workout) => workout.workout_date!),
      workoutIds: eligible.map((workout) => workout.id),
      label: `Week of ${start}`,
    }
    if (action === "shift") {
      setWeekShift(clipboard)
      return
    }
    try {
      rememberClipboard(clipboard)
      setMoveNotice(
        `${action === "cut" ? "Cut" : "Copied"} ${eligible.length} planned workouts and notes. Choose a week and select Paste.`
      )
    } catch (error) {
      setMoveNotice(
        error instanceof Error
          ? error.message
          : "The calendar clipboard could not be saved."
      )
    }
  }

  const clearCalendarClipboard = async () => {
    if (mutationLock.current) return
    try {
      const current = readCalendarClipboardState(clipboardScope)
      if (current.status === "blocked") throw Error(current.error)
      const value = current.status === "ready" ? current.clipboard : null
      if (JSON.stringify(value) !== JSON.stringify(calendarClipboard)) {
        setClipboardState(current)
        setMoveNotice(
          "The calendar clipboard changed in another view. Review it before clearing."
        )
        return
      }
      if (value?.entryAttempt)
        throw Error(
          "This entry paste still needs confirmation. Resume its original operation before clearing the clipboard."
        )
      if (
        calendarClipboardPending(value) &&
        !(await confirmWithFramework7(
          "Clear pending paste?",
          "A pending copy may already exist in Intervals.icu. Clearing removes its local recovery identity; review the destination day before copying it again."
        ))
      )
        return
      rememberClipboard(null, value)
      setMoveNotice("")
    } catch (error) {
      setMoveNotice(
        error instanceof Error
          ? error.message
          : "The clipboard could not be cleared."
      )
    }
  }

  const finishDrag = async ({ active, over }: DragEndEvent) => {
    setDragging(null)
    const workout = active.data.current?.workout as PlannedWorkout | undefined
    const combineTarget =
      over?.data.current?.kind === "combine"
        ? (over.data.current.workout as PlannedWorkout | undefined)
        : undefined
    if (workout && combineTarget) {
      const validPair =
        workout.status === "completed" &&
        workout.id.startsWith("activity:") &&
        Boolean(workout.activity_id) &&
        combineTarget.status !== "completed" &&
        combineTarget.id.startsWith("event:") &&
        canEditWorkout(combineTarget) &&
        (isMobile
          ? workout.sport.toLowerCase() === combineTarget.sport.toLowerCase()
          : sameDesktopCalendarSport(workout.sport, combineTarget.sport))
      if (!validPair || !acquireCalendarMutation()) return
      setMoveNotice("")
      try {
        const result = await pairCompletedWorkout(combineTarget.id, workout.id)
        if (result.workout) {
          setContext((current) =>
            applyVerifiedCalendarPair(
              current,
              combineTarget.id,
              workout.id,
              result.workout!,
              dateKey(new Date())
            )
          )
        } else if (result.context) {
          setContext((current) => ({ ...current, ...result.context }))
        } else {
          const refreshed = await loadFullTrainingContext(true)
          if (refreshed) setContext(refreshed)
        }
        setMoveNotice(`${workout.title} combined with ${combineTarget.title}.`)
      } catch (error) {
        setMoveNotice(
          error instanceof Error
            ? error.message
            : "Unable to combine these workouts."
        )
      } finally {
        releaseCalendarMutation()
      }
      return
    }
    if (
      !workout ||
      !canEditWorkout(workout) ||
      !over ||
      String(over.id) === workout.workout_date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(over.id)) ||
      mutationLock.current
    )
      return
    const date = String(over.id)
    if (!acquireCalendarMutation()) return
    calendarWasDragged.current = true
    const snapshot = context
    setMoveNotice("")
    setContext((current) =>
      projectCalendarMove(current, workout.id, date, dateKey(new Date()))
    )
    try {
      const result = await moveWorkoutDate(workout.id, date, true, {
        feedback: false,
      })
      if (result.context)
        setContext((current) => mergeCalendarContext(current, result.context!))
      setMoveNotice(
        `${workout.title} saved in Intervals.icu for ${new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
      )
    } catch (error) {
      setContext((current) =>
        rollbackCalendarMove(current, snapshot, workout.id, date)
      )
      setMoveNotice(
        error instanceof Error ? error.message : "Unable to move workout."
      )
    } finally {
      releaseCalendarMutation()
    }
  }
  const [viewPreferences, setViewPreferences] = useState(() =>
    readCalendarViewPreferences(clipboardScope)
  )
  const summaryOpen = viewPreferences.summaryOpen
  const summarySaving = false
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const calendarFiles = useWorkoutFiles({})
  useEffect(() => {
    setViewPreferences(readCalendarViewPreferences(clipboardScope))
  }, [clipboardScope])
  const changeViewPreference = (
    name: keyof CalendarViewPreferences,
    value: boolean
  ) => {
    anchorOperations.current.capture()
    setViewPreferences((current) => {
      const next = { ...current, [name]: value }
      saveCalendarViewPreferences(clipboardScope, next)
      return next
    })
  }
  const [metricsDate, setMetricsDate] = useState<string | null>(null)
  const metricsSaved = async (result: CalendarMetricsResult) => {
    try {
      const next = validatedTrainingContext(
        result.context || (await refreshRecentIntervals()).context
      )
      rememberTrainingContext(next, "full")
      setContext((current) => mergeCalendarContext(current, next))
      setMoveNotice("Metrics saved.")
    } catch {
      setMoveNotice(
        "Metrics saved. Refresh the calendar to reload its latest values."
      )
    }
  }
  const annotationSaved = async (result: AnnotationResult) => {
    const incoming = result.context
      ? validatedTrainingContext(result.context)
      : !result.workout && !result.deleted
        ? validatedTrainingContext((await refreshRecentIntervals()).context)
        : null
    const workout = result.workout
      ? validatedTrainingWorkout(result.workout)
      : null
    const apply = (current: TrainingContext) => {
      let next = incoming ? mergeCalendarContext(current, incoming) : current
      if (result.deleted)
        next = {
          ...next,
          history: next.history.filter(
            (row) => (row as PlannedWorkout).id !== result.workoutId
          ),
          planned: next.planned.filter((row) => row.id !== result.workoutId),
        }
      else if (workout) next = mergeVerifiedWorkout(next, workout).context
      return next
    }
    rememberTrainingContext(apply(cachedTrainingContext()), "full")
    setContext(apply)
    setMoveNotice(
      result.deleted ? "Calendar entry deleted." : "Calendar entry saved."
    )
  }
  const calendarEventSaved = async (result: RaceEventSaveResult) => {
    const savedContext = validatedTrainingContext(
      result.context || (await refreshRecentIntervals()).context
    )
    rememberTrainingContext(savedContext, "full")
    setContext((current) => mergeCalendarContext(current, savedContext))
    if (result.plan) setAnnualPlan(result.plan)
    window.dispatchEvent(new Event("annual-plan-updated"))
    setMoveNotice(`${result.event.name} saved to your calendar.`)
  }
  const metricsRows = useMemo(
    () =>
      (context.wellness_history || [])
        .map((row) => ({
          ...row,
          date: String(row.date || row.id || row.timeStamp || "").slice(0, 10),
        }))
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date)),
    [context.wellness_history]
  )
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
  function saveSummary(open: boolean) {
    changeViewPreference("summaryOpen", open)
  }
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
          const isExiting = bounds.top < stickyBoundary - 1 && exitProgress < 1
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
  const navigationTarget = useRef<string | null>(null)
  const alignNavigationTarget = useCallback(() => {
    if (!navigationTarget.current) return
    const root = calendarRef.current
    const mobile = window.matchMedia("(max-width: 767px)").matches
    const element = root?.querySelector<HTMLElement>(
      mobile
        ? `[data-calendar-date="${navigationTarget.current}"]`
        : `[data-calendar-week="${dateKey(startOfMonday(new Date(`${navigationTarget.current}T12:00:00`)))}"]`
    )
    if (!element) return
    const heading = mobile
      ? element
      : element.querySelector<HTMLElement>(".mobile-calendar-day-heading")
    const adjustment =
      (heading || element).getBoundingClientRect().top -
      calendarStickyBoundary(root)
    if (Math.abs(adjustment) > 0.5)
      scrollCalendarTo(calendarRef.current, {
        top: Math.max(0, calendarScrollTop(calendarRef.current) + adjustment),
        behavior: "instant",
      })
  }, [])
  const previousMobileLayout = useRef(isMobile)
  useLayoutEffect(() => {
    if (previousMobileLayout.current === isMobile) return
    previousMobileLayout.current = isMobile
    if (!calendarReady) return
    if (!isMobile) window.scrollTo({ top: 0, left: 0, behavior: "instant" })
    const today = dateKey(new Date())
    navigationTarget.current =
      activeWeekKey === dateKey(startOfMonday(new Date()))
        ? today
        : activeWeekKey || today
    alignNavigationTarget()
  }, [isMobile, calendarReady, activeWeekKey, alignNavigationTarget])
  const captureViewportAnchor = useCallback(() => {
    // Refresh the capture even when a previous no-op state update did not commit.
    if (!initialAlignmentDone.current) return
    const header = calendarStickyBoundary(calendarRef.current)
    const visible = (selector: string) =>
      Array.from(calendarRef.current?.querySelectorAll(selector) ?? [])
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
            Math.abs(a.bounds.top - header) - Math.abs(b.bounds.top - header)
        )
    // A large scrollbar/date jump can land in an unmounted placeholder.
    const anchor =
      visible("[data-calendar-date]")[0] ?? visible("[data-calendar-week]")[0]
    if (anchor)
      viewportAnchor.current = {
        element: anchor.element,
        top: anchor.bounds.top,
        scrollY: calendarScrollTop(calendarRef.current),
      }
  }, [])
  const restoreViewportAnchor = useCallback(() => {
    const anchor = viewportAnchor.current
    viewportAnchor.current = null
    if (navigationTarget.current) {
      alignNavigationTarget()
      return
    }
    if (!anchor || !anchor.element.isConnected) return
    const adjustment = calendarAnchorAdjustment(
      anchor,
      anchor.element.getBoundingClientRect().top,
      calendarScrollTop(calendarRef.current)
    )
    if (Math.abs(adjustment) > 0.5) {
      performanceProbe("calendar-anchor-adjust", {
        before: anchor.element.getBoundingClientRect().top,
        expected: anchor.top,
        adjustment,
        scrollY: calendarScrollTop(calendarRef.current),
      })
      scrollCalendarTo(calendarRef.current, {
        top: calendarScrollTop(calendarRef.current) + adjustment,
        behavior: "instant",
      })
    }
  }, [alignNavigationTarget])
  useLayoutEffect(() => {
    anchorOperations.current = {
      capture: captureViewportAnchor,
      restore: restoreViewportAnchor,
    }
  }, [captureViewportAnchor, restoreViewportAnchor])

  useEffect(() => {
    const mark = () => {
      calendarUserScrolled.current = true
      navigationTarget.current = null
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
    const pointer = (event: PointerEvent) => {
      if (event.clientX >= document.documentElement.clientWidth) mark()
    }
    window.addEventListener("wheel", mark, { passive: true })
    window.addEventListener("touchmove", mark, { passive: true })
    window.addEventListener("keydown", key)
    window.addEventListener("pointerdown", pointer)
    return () => {
      window.removeEventListener("wheel", mark)
      window.removeEventListener("touchmove", mark)
      window.removeEventListener("keydown", key)
      window.removeEventListener("pointerdown", pointer)
    }
  }, [])

  useEffect(() => {
    if (!calendarReady || !calendarRef.current) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(alignNavigationTarget)
    })
    const list = calendarRef.current.querySelector(".calendar-week-list")
    const header = calendarRef.current.querySelector(".calendar-weekday-header")
    if (list) observer.observe(list)
    if (header) observer.observe(header)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [calendarReady, alignNavigationTarget])

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
      const element = position
        ? calendarRef.current?.querySelector(
            `[data-calendar-date="${position.date}"]`
          )
        : null
      const top =
        position && element
          ? calendarScrollTop(calendarRef.current) +
            element.getBoundingClientRect().top -
            position.top
          : restoreScrollTop
      viewportAnchor.current = null
      performanceProbe("calendar-position-restore", {
        found: !!element,
        savedTop: position?.top ?? -1,
        topBefore: element?.getBoundingClientRect().top ?? -1,
        scrollY: calendarScrollTop(calendarRef.current),
        target: top,
        fallback: restoreScrollTop,
      })
      scrollCalendarTo(calendarRef.current, {
        top: Math.max(0, top),
        behavior: "instant",
      })
      initialAlignmentDone.current = true
      calendarUserScrolled.current = true
      if (position)
        setActiveWeekKey(
          dateKey(startOfMonday(new Date(`${position.date}T12:00:00`)))
        )
      const frame = requestAnimationFrame(() => {
        performanceProbe("calendar-position-settled", {
          top: element?.getBoundingClientRect().top ?? -1,
          scrollY: calendarScrollTop(calendarRef.current),
        })
        onScrollRestored?.()
      })
      return () => cancelAnimationFrame(frame)
    }
    if (
      !calendarReady ||
      initialAlignmentDone.current ||
      calendarUserScrolled.current ||
      calendarWasDragged.current
    )
      return
    const mobileViewport = window.matchMedia("(max-width: 767px)").matches
    const today = new Date()
    const element = mobileViewport
      ? calendarRef.current?.querySelector(
          `[data-calendar-date="${dateKey(today)}"]`
        )
      : weekRefs.current.get(dateKey(startOfMonday(today)))
    if (!element) return
    navigationTarget.current = dateKey(today)
    alignNavigationTarget()
    setActiveWeekKey(dateKey(startOfMonday(today)))
    initialAlignmentDone.current = true
    const frame = requestAnimationFrame(alignNavigationTarget)
    return () => cancelAnimationFrame(frame)
  }, [
    context,
    summaryOpen,
    isMobile,
    calendarReady,
    restoreScrollTop,
    onScrollRestored,
    alignNavigationTarget,
  ])

  // Correct layout growth before paint, rather than letting newly loaded rows
  // move the day the user was reading. Retain any intervening user scrolling.
  useLayoutEffect(restoreViewportAnchor, [
    context,
    dateRange,
    viewPreferences,
    restoreViewportAnchor,
  ])

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
    const workoutsByWeek = indexCalendarWorkouts(
      workouts.filter(
        (workout) =>
          !workout.calendar_annotation && !workout.calendar_annotation_key
      )
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
  const contextVersion = String(
    (context as TrainingContext & { version?: string }).version || ""
  )
  const historyVersion = useRef(contextVersion)
  useEffect(() => {
    if (historyVersion.current === contextVersion) return
    historyVersion.current = contextVersion
    loadedWeeks.current.clear()
    const ranges =
      (
        context as TrainingContext & {
          cached_ranges?: Array<{ start: string; end: string }>
        }
      ).cached_ranges ?? []
    for (const week of weeks) {
      if (
        ranges.some(
          (range) =>
            range.start <= week.key && range.end >= dateKey(week.days[6])
        )
      )
        loadedWeeks.current.add(week.key)
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
      const viewportTop = calendarStickyBoundary(calendarRef.current)
      const first = weekRefs.current
        .get(dateRange.start)
        ?.getBoundingClientRect()
      const last = weekRefs.current.get(dateRange.end)?.getBoundingClientRect()
      if (first && first.top > -900 && first.top < window.innerHeight + 900) {
        const earlier = new Date(`${dateRange.start}T12:00:00`)
        earlier.setDate(earlier.getDate() - 84)
        captureViewportAnchor()
        setDateRange((current) => extendCalendarRange(current, earlier))
      } else if (
        last &&
        last.bottom < window.innerHeight + 900 &&
        last.bottom > -900
      ) {
        const later = new Date(`${dateRange.end}T12:00:00`)
        later.setDate(later.getDate() + 84)
        captureViewportAnchor()
        setDateRange((current) => extendCalendarRange(current, later))
      }
      queue.clear()
      for (const [key, element] of weekRefs.current) {
        const bounds = element.getBoundingClientRect()
        if (
          bounds.bottom > viewportTop &&
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
      if (!scrollFrame)
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = 0
          if (active) loadVisible()
        })
    }
    const observer = new IntersectionObserver(loadVisible, {
      root: calendarScrollSurface(calendarRef.current),
      rootMargin: "0px",
      threshold: 0,
    })
    for (const element of weekRefs.current.values()) observer.observe(element)
    const todayKey = dateKey(startOfMonday(new Date()))
    if (weekRefs.current.has(todayKey)) queue.add(todayKey)
    void pump()
    loadVisible()
    const scrollTarget = calendarScrollTarget(calendarRef.current)
    scrollTarget.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      active = false
      cancelAnimationFrame(scrollFrame)
      controller.abort()
      observer.disconnect()
      scrollTarget.removeEventListener("scroll", onScroll)
      pendingWeeks.clear()
    }
  }, [
    weekKeys,
    historyReady,
    isMobile,
    dateRange,
    contextVersion,
    captureViewportAnchor,
    setContext,
  ])

  useEffect(() => {
    let frame = 0
    const trackVisibleWeek = () => {
      const header = calendarStickyBoundary(calendarRef.current)
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
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          trackVisibleWeek()
        })
    }
    const scrollTarget = calendarScrollTarget(calendarRef.current)
    scrollTarget.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      scrollTarget.removeEventListener("scroll", onScroll)
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
  const jumpToDate = useCallback(
    (date?: Date) => {
      if (!date) return
      calendarWasDragged.current = true
      calendarUserScrolled.current = true
      setDatePickerOpen(false)
      if (!isMobile && datePickerOpen) {
        queuedDateJump.current = date
        return
      }
      const week = dateKey(startOfMonday(date))
      setDateRange((current) =>
        week < current.start || week > current.end
          ? calendarRange(date)
          : current
      )
      setPendingDateJump(date)
    },
    [datePickerOpen, isMobile]
  )

  const stepWeek = useCallback(
    (direction: -1 | 1) => {
      const positions = [...weekRefs.current].map(([key, element]) => ({
        key,
        top: (
          element.querySelector<HTMLElement>(".mobile-calendar-day-heading") ||
          element
        ).getBoundingClientRect().top,
      }))
      const nearest = adjacentCalendarWeek(
        positions,
        calendarStickyBoundary(calendarRef.current),
        direction
      )
      const target = new Date(
        `${nearest || activeWeekKey || dateKey(startOfMonday(new Date()))}T12:00:00`
      )
      if (!nearest) target.setDate(target.getDate() + direction * 7)
      jumpToDate(target)
    },
    [activeWeekKey, jumpToDate]
  )

  useLayoutEffect(() => {
    if (!pendingDateJump || !calendarReady) return
    const key = dateKey(startOfMonday(pendingDateJump))
    const element = isMobile
      ? calendarRef.current?.querySelector(
          `[data-calendar-date="${dateKey(pendingDateJump)}"]`
        )
      : weekRefs.current.get(key)
    if (!element) return
    viewportAnchor.current = null
    navigationTarget.current = dateKey(pendingDateJump)
    performanceProbe("calendar-date-jump", {
      before: element.getBoundingClientRect().top,
      scrollY: calendarScrollTop(calendarRef.current),
      expected: calendarStickyBoundary(calendarRef.current),
    })
    alignNavigationTarget()
    performanceProbe("calendar-date-aligned", {
      top: element.getBoundingClientRect().top,
      scrollY: calendarScrollTop(calendarRef.current),
    })
    initialAlignmentDone.current = true
    setActiveWeekKey(key)
    setVisibleMonth(
      pendingDateJump.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    )
    setPendingDateJump(null)
    const frame = requestAnimationFrame(alignNavigationTarget)
    return () => cancelAnimationFrame(frame)
  }, [
    pendingDateJump,
    calendarReady,
    isMobile,
    weekKeys,
    alignNavigationTarget,
  ])

  useEffect(() => {
    if (!isMobile || !datePickerOpen || !mobilePickerContainerRef.current)
      return
    let destroyed = false
    let picker: Framework7Calendar.Calendar | null = null
    const container = mobilePickerContainerRef.current
    const selected = activeWeek?.start ?? new Date()
    f7ready((app) => {
      if (destroyed || !container.isConnected) return
      container.replaceChildren()
      const updatePickerMonth = (calendar: {
        currentMonth: number
        currentYear: number
      }) => {
        setPickerMonth({
          year: calendar.currentYear,
          month: calendar.currentMonth,
        })
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
  const registerWeek = useCallback(
    (key: string, element: HTMLElement | null) => {
      if (element) weekRefs.current.set(key, element)
      else weekRefs.current.delete(key)
    },
    []
  )
  const reportBlocks = useMemo(() => planReportBlocks(annualPlan), [annualPlan])
  const todayWeekKey = dateKey(startOfMonday(new Date()))
  const jumpWeekKey = pendingDateJump
    ? dateKey(startOfMonday(pendingDateJump))
    : null
  const restoredWeekKey = restoredPosition.current
    ? dateKey(
        startOfMonday(new Date(`${restoredPosition.current.date}T12:00:00`))
      )
    : null

  const openWorkout = (workout: PlannedWorkout, editEvent = false) =>
    runWithWorkoutNavigationGuard(() => {
      if (!isMobile && workout.calendar_annotation_kind) {
        setAnnotationEditor({
          kind: workout.calendar_annotation_kind,
          date: workout.workout_date!,
          id: workout.id,
        })
        return
      }
      if (!isMobile && workout.calendar_annotation_key) {
        setMoveNotice(
          "This entry type could not be verified. Refresh the calendar to load its current saved details."
        )
        return
      }
      if (
        !isMobile &&
        isRaceWorkout(workout) &&
        workout.id.startsWith("event:")
      ) {
        setEventId(workout.id)
        setEventEditing(editEvent)
        setEventDate(workout.workout_date!)
        return
      }
      rememberWorkoutForEditing(workout)
      prepareWorkout(workout, true)
      if (!isMobile) prepareWorkoutEditor(workout)
      if (!isMobile && isCalendarNote(workout)) {
        setNoteEditor({ date: workout.workout_date!, workout })
        return
      }
      if (!isMobile) {
        setSelectedWorkout(workout)
        return
      }
      if (onWorkoutOpen) {
        captureViewportAnchor()
        const anchor = viewportAnchor.current
        const date =
          anchor?.element.getAttribute("data-calendar-date") ||
          anchor?.element.getAttribute("data-calendar-week")
        rememberCalendarVisit(
          context,
          dateRange,
          date && anchor ? { date, top: anchor.top } : null
        )
        performanceProbe("calendar-position-save", {
          found: !!date,
          top: anchor?.top ?? -1,
          scrollY: calendarScrollTop(calendarRef.current),
        })
        viewportAnchor.current = null
        onWorkoutOpen(workout)
        return
      }
      rememberOpenWorkout(workout)
      setSelectedWorkout(workout)
    })

  if (!calendarReady) return <CalendarSkeleton />

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const collisions = pointerWithin(args)
        if (args.active.data.current?.workout?.status === "completed") {
          const combineTargets = collisions.filter((collision) =>
            String(collision.id).startsWith("combine:")
          )
          if (combineTargets.length) return combineTargets
        }
        return collisions.filter(
          (collision) => !String(collision.id).startsWith("combine:")
        )
      }}
      onDragStart={({ active }) =>
        setDragging(active.data.current?.workout || null)
      }
      onDragCancel={() => setDragging(null)}
      onDragEnd={(event) => void finishDrag(event)}
    >
      <div
        ref={calendarRef}
        style={{ overflowAnchor: "none" }}
        data-calendar-profiles={
          viewPreferences.showProfiles ? "visible" : "hidden"
        }
        data-calendar-metrics={
          viewPreferences.showMetrics ? "visible" : "hidden"
        }
        className="training-calendar flex w-full min-w-0 flex-1 flex-col max-md:max-w-full max-md:overflow-x-clip"
      >
        <MobileSiteNavbar
          fixed
          className={
            datePickerOpen
              ? "calendar-sticky-day-navbar calendar-picker-navbar-open"
              : "calendar-sticky-day-navbar"
          }
          title=""
          actions={[
            {
              value: "add-workout",
              label: "Add workout today",
              disabled: moving,
              onSelect: () => {
                setNewWorkoutType(null)
                setNewWorkoutDate(dateKey(new Date()))
              },
            },
          ]}
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
                if (deltaY < -64 && Math.abs(deltaY) > Math.abs(deltaX) * 1.25)
                  setDatePickerOpen(false)
              }}
              onPointerCancel={() => {
                pickerSwipeStartRef.current = null
              }}
            >
              <div className="flex justify-center gap-3 px-4 pt-3">
                <select
                  aria-label="Calendar month"
                  className="min-h-10 rounded-md bg-background px-3 text-sm"
                  value={pickerMonth.month}
                  onChange={(event) =>
                    mobilePickerRef.current?.setYearMonth(
                      pickerMonth.year,
                      Number(event.target.value),
                      0
                    )
                  }
                >
                  {Array.from({ length: 12 }, (_, month) => (
                    <option key={month} value={month}>
                      {new Date(2026, month, 1).toLocaleDateString("en-US", {
                        month: "long",
                      })}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Calendar year"
                  className="min-h-10 rounded-md bg-background px-3 text-sm"
                  value={pickerMonth.year}
                  onChange={(event) =>
                    mobilePickerRef.current?.setYearMonth(
                      Number(event.target.value),
                      pickerMonth.month,
                      0
                    )
                  }
                >
                  {Array.from(
                    { length: new Date().getFullYear() + 11 - 1900 },
                    (_, index) => 1900 + index
                  ).map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
              <div ref={mobilePickerContainerRef} />
            </div>
          </div>
        )}
        {!isMobile && (
          <header className="calendar-desktop-toolbar sticky top-0 z-50 hidden h-14 w-full shrink-0 items-center px-4 md:flex md:bg-background md:shadow-none">
            <Popover
              open={datePickerOpen}
              onOpenChange={(open) => {
                if (open) queuedDateJump.current = null
                setDatePickerOpen(open)
              }}
              onOpenChangeComplete={(open) => {
                if (open || !queuedDateJump.current) return
                // Closing popovers restore focus asynchronously. Move the calendar
                // after that lifecycle instead of letting it undo the date jump.
                const date = queuedDateJump.current
                queuedDateJump.current = null
                setDateRange(calendarRange(date))
                setPendingDateJump(date)
              }}
            >
              <PopoverTrigger
                ref={desktopPickerTriggerRef}
                className="calendar-desktop-month-trigger mx-auto h-9 min-w-0 truncate rounded-md px-2 text-left text-sm font-semibold hover:bg-muted md:mx-0 md:text-base"
              >
                <span className="min-w-0 truncate">{activeMonth}</span>
                <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
              </PopoverTrigger>
              <PopoverContent
                ref={desktopPickerContentRef}
                align="start"
                className="w-auto p-0"
                initialFocus={() => {
                  const target =
                    desktopPickerContentRef.current?.querySelector<HTMLElement>(
                      "button, select"
                    ) ?? desktopPickerContentRef.current
                  target?.focus({ preventScroll: true })
                  return false
                }}
                finalFocus={() => {
                  desktopPickerTriggerRef.current?.focus({
                    preventScroll: true,
                  })
                  return false
                }}
              >
                <DatePickerCalendar
                  key={`${datePickerOpen}-${activeMonth}`}
                  defaultMonth={
                    Number.isFinite(Date.parse(`1 ${activeMonth}`))
                      ? new Date(`1 ${activeMonth}`)
                      : (activeWeek?.start ?? new Date())
                  }
                  selected={activeWeek?.start}
                  onSelect={jumpToDate}
                />
              </PopoverContent>
            </Popover>
            <div className="calendar-desktop-navigation flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={goToToday}>
                Today
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Previous calendar week"
                onClick={() => stepWeek(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Next calendar week"
                onClick={() => stepWeek(1)}
              >
                <ChevronRight />
              </Button>
            </div>
            <div className="calendar-desktop-tools ml-auto">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Upload activity"
                title="Upload activity"
                onClick={calendarFiles.upload}
              >
                <Upload />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh Intervals.icu"
                title="Refresh Intervals.icu"
                disabled={moving}
                onClick={async () => {
                  if (!acquireCalendarMutation()) return
                  try {
                    const result = await refreshRecentIntervals((progress) =>
                      setMoveNotice(progress.label)
                    )
                    setContext(result.context)
                    setMoveNotice(
                      result.queue.failed || result.queue.unknown
                        ? "Calendar refreshed. Some earlier edits still need confirmation in Settings."
                        : "Calendar refreshed from Intervals.icu."
                    )
                  } catch (error) {
                    setMoveNotice(
                      error instanceof Error
                        ? error.message
                        : "Calendar refresh could not be confirmed."
                    )
                  } finally {
                    releaseCalendarMutation()
                  }
                }}
              >
                <RefreshCw className={moving ? "animate-spin" : ""} />
              </Button>
              <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Search workouts"
                      title="Search workouts"
                    />
                  }
                >
                  <Search />
                </PopoverTrigger>
                <PopoverContent align="end" className="calendar-workout-search">
                  <label htmlFor="calendar-workout-search">
                    Search loaded workouts
                  </label>
                  <input
                    id="calendar-workout-search"
                    type="search"
                    placeholder="Workout title, sport or description"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    autoFocus
                  />
                  <div className="calendar-search-results">
                    {workouts
                      .filter((workout) => {
                        const query = searchQuery.trim().toLocaleLowerCase()
                        return (
                          query &&
                          `${workout.title} ${workout.sport} ${workout.details || workout.goal || ""}`
                            .toLocaleLowerCase()
                            .includes(query)
                        )
                      })
                      .slice(0, 50)
                      .map((workout) => (
                        <button
                          key={workout.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false)
                            openWorkout(workout)
                          }}
                        >
                          <span>{workout.title}</span>
                          <small>
                            {workout.workout_date} · {workout.sport}
                          </small>
                        </button>
                      ))}
                    {searchQuery.trim() &&
                      !workouts.some((workout) =>
                        `${workout.title} ${workout.sport} ${workout.details || workout.goal || ""}`
                          .toLocaleLowerCase()
                          .includes(searchQuery.trim().toLocaleLowerCase())
                      ) && <p>No matching loaded workouts.</p>}
                    {!searchQuery.trim() && (
                      <p>Search the workouts already loaded on this device.</p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Calendar settings"
                      title="Calendar settings"
                    />
                  }
                >
                  <Settings />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="calendar-context-menu"
                >
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Calendar display</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                      checked={summaryOpen}
                      onCheckedChange={(value) => saveSummary(value)}
                    >
                      Weekly summary
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={viewPreferences.showProfiles}
                      onCheckedChange={(value) =>
                        changeViewPreference("showProfiles", value)
                      }
                    >
                      Workout profiles
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={viewPreferences.showMetrics}
                      onCheckedChange={(value) =>
                        changeViewPreference("showMetrics", value)
                      }
                    >
                      Daily metrics
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setGeneratedWorkout(null)
                      setNewWorkoutType({ sport: "Other", name: "Sauna" })
                      setNewWorkoutDate(dateKey(new Date()))
                    }}
                  >
                    Add Sauna (Other)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
        )}
        <div className="calendar-weekday-header sticky top-14 z-40 hidden h-7 shrink-0 border-b bg-background shadow-sm md:flex">
          <div className="calendar-weekday-grid grid min-w-0 flex-1 grid-cols-7 divide-x">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div
                key={day}
                className="calendar-weekday-label flex items-center px-2 text-[11px] font-medium text-muted-foreground uppercase"
              >
                {day}
              </div>
            ))}
          </div>
          <div
            data-summary-open={summaryOpen}
            className={`calendar-summary-header hidden shrink-0 items-center border-l xl:flex ${summaryOpen ? "w-72" : "w-10"}`}
          >
            {summaryOpen && (
              <span className="calendar-summary-header-title">SUMMARY</span>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="calendar-summary-toggle size-6"
              onClick={() => void saveSummary(!summaryOpen)}
              disabled={summarySaving}
              aria-busy={summarySaving}
              aria-label={
                summaryOpen
                  ? "Collapse weekly summary"
                  : "Expand weekly summary"
              }
              aria-expanded={summaryOpen}
            >
              {summaryOpen ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </Button>
          </div>
        </div>
        {isMobile && !moving && moveNotice && (
          <p
            role="status"
            className="border-b bg-background px-4 py-2 text-xs text-muted-foreground"
          >
            {moveNotice}
          </p>
        )}
        {!isMobile &&
          (moveNotice ||
            calendarClipboard ||
            clipboardState.status === "blocked") && (
            <div className="calendar-operation-notice" role="status">
              <p>
                {clipboardState.status === "blocked"
                  ? clipboardState.error
                  : moveNotice ||
                    (clipboardPending
                      ? `A paste to ${pendingPasteDate} needs confirmation. Resume the same paste to check its result.`
                      : `${calendarClipboard?.mode === "cut" ? "Cut" : "Copied"}: ${calendarClipboard?.label}. Choose a ${calendarClipboard?.kind === "week" ? "week" : "day"} and select Paste.`)}
              </p>
              <div>
                {clipboardPending && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={moving}
                    onClick={() =>
                      void pasteCalendarClipboard(
                        new Date(`${pendingPasteDate}T12:00:00`)
                      )
                    }
                  >
                    Resume paste
                  </Button>
                )}
                {clipboardState.status === "blocked" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={moving}
                    onClick={() =>
                      setClipboardState(
                        readCalendarClipboardState(clipboardScope)
                      )
                    }
                  >
                    Reload clipboard
                  </Button>
                )}
                {calendarClipboard && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={moving || Boolean(calendarClipboard.entryAttempt)}
                    onClick={() => void clearCalendarClipboard()}
                  >
                    Clear clipboard
                  </Button>
                )}
                {!calendarClipboard &&
                  !moving &&
                  clipboardState.status !== "blocked" && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Dismiss calendar status"
                      onClick={() => setMoveNotice("")}
                    >
                      <X />
                    </Button>
                  )}
              </div>
            </div>
          )}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="calendar-week-list min-w-0 flex-1 bg-muted/20">
            <div className="md:divide-y">
              {weeks.map((week) => {
                const end = week.days[6]
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
                    forceMounted={
                      week.key === todayWeekKey ||
                      week.key === jumpWeekKey ||
                      week.key === restoredWeekKey
                    }
                    register={registerWeek}
                    captureAnchor={captureViewportAnchor}
                    restoreAnchor={restoreViewportAnchor}
                  >
                    {() => (
                      <div className="flex h-auto min-h-0 w-full flex-col items-stretch md:flex-row">
                        <div className="calendar-week-grid grid h-auto min-h-0 w-full min-w-0 flex-1 grid-cols-1 items-stretch md:min-h-60 md:grid-cols-7 md:divide-x md:divide-y-0">
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
                                today={isToday}
                                currentWeek={week.key === todayWeekKey}
                                className={
                                  isToday
                                    ? "min-w-0 px-4 pt-0 pb-8 md:bg-primary/5 md:px-1.5 md:py-2"
                                    : "min-w-0 px-4 pt-0 pb-8 md:px-1.5 md:py-2"
                                }
                              >
                                <DayMenu
                                  day={day}
                                  count={
                                    isMobile
                                      ? dayWorkouts.length
                                      : dayCandidates.filter(
                                          (workout) =>
                                            canEditWorkout(workout) &&
                                            !isRaceWorkout(workout)
                                        ).length
                                  }
                                  copyCount={
                                    dayCandidates.filter(
                                      (workout) =>
                                        canEditWorkout(workout) &&
                                        !isRaceWorkout(workout)
                                    ).length
                                  }
                                  disabled={moving}
                                  mobile={isMobile}
                                  onAdd={() => {
                                    if (isMobile) {
                                      setNewWorkoutType(null)
                                      setNewWorkoutDate(dayKey)
                                    } else setAddDialogDate(dayKey)
                                  }}
                                  onAction={(action) =>
                                    void runDayAction(
                                      day,
                                      action,
                                      dayCandidates.filter(
                                        (workout) =>
                                          canEditWorkout(workout) &&
                                          !isRaceWorkout(workout)
                                      ).length
                                    )
                                  }
                                  onCopy={() =>
                                    copyCalendarDay(day, dayCandidates)
                                  }
                                  onCut={() =>
                                    copyCalendarDay(day, dayCandidates, "cut")
                                  }
                                  onPaste={() =>
                                    void pasteCalendarClipboard(day)
                                  }
                                  pasteLabel={
                                    clipboardPending ||
                                    calendarClipboard?.kind === "week"
                                      ? null
                                      : calendarClipboard?.kind || null
                                  }
                                >
                                  <span
                                    className={`calendar-date-number text-[17px] leading-[20.4px] font-semibold md:px-0.5 md:text-sm md:leading-normal md:font-bold ${isPast ? "text-muted-foreground" : isToday ? "text-red-600 md:text-primary dark:text-red-400" : "text-foreground"}`}
                                  >
                                    <span className="md:hidden">
                                      {day.toLocaleDateString("en-US", {
                                        weekday: "long",
                                      })}
                                      {" – "}
                                      {day.toLocaleDateString("en-US", {
                                        month: "short",
                                      })}{" "}
                                    </span>
                                    {isToday && (
                                      <span className="hidden md:mr-1 md:inline">
                                        Today
                                      </span>
                                    )}
                                    {day.getDate() === 1 && !isToday && (
                                      <span className="hidden md:inline">
                                        {day.toLocaleDateString("en-US", {
                                          month: "short",
                                        })}{" "}
                                      </span>
                                    )}
                                    {day.getDate()}
                                  </span>
                                </DayMenu>
                                <div
                                  className="mobile-calendar-day-divider w-full border-b border-border/70 md:hidden"
                                  aria-hidden="true"
                                />
                                <div className="calendar-day-workouts space-y-0 md:space-y-2">
                                  {!isMobile &&
                                    workouts
                                      .filter(
                                        (workout) =>
                                          (workout.calendar_annotation ||
                                            workout.calendar_annotation_key) &&
                                          (workout.calendar_annotation?.date ||
                                            workout.workout_date ||
                                            "") <= dayKey &&
                                          (workout.calendar_annotation
                                            ?.endDate ||
                                            workout.workout_end_date ||
                                            workout.workout_date ||
                                            "") >= dayKey
                                      )
                                      .map((workout) =>
                                        workout.calendar_annotation ? (
                                          <CalendarAnnotationCard
                                            key={workout.id}
                                            entry={validateAnnotation(
                                              workout.calendar_annotation
                                            )}
                                            disabled={
                                              moving ||
                                              clipboardPending ||
                                              clipboardState.status ===
                                                "blocked"
                                            }
                                            onTransfer={
                                              calendarEntryTransferEnabled(
                                                workout.calendar_annotation.kind
                                              )
                                                ? (mode) =>
                                                    void selectCalendarEntry(
                                                      workout
                                                        .calendar_annotation!
                                                        .kind,
                                                      workout.id,
                                                      mode
                                                    )
                                                : undefined
                                            }
                                            onSaved={annotationSaved}
                                            onOpen={() =>
                                              setAnnotationEditor({
                                                kind: workout
                                                  .calendar_annotation!.kind,
                                                date: workout
                                                  .calendar_annotation!.date,
                                                id: workout.id,
                                              })
                                            }
                                          />
                                        ) : (
                                          <button
                                            key={workout.id}
                                            type="button"
                                            className="calendar-annotation-card"
                                            onClick={() => openWorkout(workout)}
                                          >
                                            {workout.title}
                                            <small>
                                              {workout.calendar_annotation_error ||
                                                "Reload the current saved entry."}
                                            </small>
                                          </button>
                                        )
                                      )}
                                  {!isMobile &&
                                    notesFirst(dayWorkouts)
                                      .filter(isCalendarNote)
                                      .map((note) => (
                                        <DraggableWorkout
                                          key={note.id}
                                          workout={note}
                                          onOpen={() => openWorkout(note)}
                                          onAction={(action) =>
                                            void runWorkoutAction(note, action)
                                          }
                                          disabled={moving}
                                          cut={
                                            calendarClipboard?.mode === "cut" &&
                                            calendarClipboard.workoutIds.includes(
                                              note.id
                                            )
                                          }
                                        />
                                      ))}
                                  {!isMobile && (
                                    <CalendarDailyMetrics
                                      row={metricsRows.find(
                                        (row) => row.date === dayKey
                                      )}
                                      onOpen={() => setMetricsDate(dayKey)}
                                    />
                                  )}
                                  {(isMobile
                                    ? dayWorkouts
                                    : notesFirst(dayWorkouts).filter(
                                        (workout) => !isCalendarNote(workout)
                                      )
                                  ).map((workout, workoutIndex) =>
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
                                          (!canEditWorkout(workout) &&
                                            !(
                                              workout.status === "completed" &&
                                              workout.id.startsWith(
                                                "activity:"
                                              ) &&
                                              Boolean(workout.activity_id)
                                            ))
                                        }
                                      />
                                    ) : (
                                      <DraggableWorkout
                                        key={workout.id}
                                        workout={workout}
                                        onEntryTransfer={
                                          isRaceWorkout(workout) &&
                                          calendarEntryTransferEnabled("event")
                                            ? (mode) =>
                                                void selectCalendarEntry(
                                                  "event",
                                                  workout.id,
                                                  mode
                                                )
                                            : undefined
                                        }
                                        entryTransferDisabled={
                                          clipboardPending ||
                                          clipboardState.status === "blocked"
                                        }
                                        onEntryEdit={
                                          isRaceWorkout(workout)
                                            ? () => openWorkout(workout, true)
                                            : undefined
                                        }
                                        cut={
                                          calendarClipboard?.mode === "cut" &&
                                          calendarClipboard.workoutIds.includes(
                                            workout.id
                                          )
                                        }
                                        disabled={
                                          moving ||
                                          (!workout.id.startsWith("event:") &&
                                            !workout.id.startsWith("app:") &&
                                            !(
                                              workout.status === "completed" &&
                                              workout.id.startsWith(
                                                "activity:"
                                              ) &&
                                              Boolean(workout.activity_id)
                                            ))
                                        }
                                        onOpen={() => openWorkout(workout)}
                                        onAction={(action) =>
                                          runWorkoutAction(
                                            workout,
                                            action,
                                            isRaceWorkout(workout)
                                          )
                                        }
                                      />
                                    )
                                  )}
                                  {!isMobile && (
                                    <button
                                      type="button"
                                      className="calendar-day-add-workout"
                                      aria-label={`Add workout for ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
                                      aria-haspopup="dialog"
                                      disabled={moving}
                                      onClick={() => setAddDialogDate(dayKey)}
                                    >
                                      <Plus
                                        size={16}
                                        strokeWidth={1.5}
                                        aria-hidden="true"
                                      />
                                    </button>
                                  )}
                                </div>
                              </CalendarDay>
                            )
                          })}
                        </div>
                        <aside
                          data-summary-open={summaryOpen}
                          className={`calendar-week-sidebar hidden shrink-0 self-stretch border-l bg-muted/20 transition-[width] xl:block ${summaryOpen ? "w-72" : "w-10"}`}
                        >
                          <DesktopCalendarWeekActions
                            start={week.key}
                            disabled={moving}
                            count={
                              week.workouts.filter(
                                (workout) =>
                                  canEditWorkout(workout) &&
                                  !isRaceWorkout(workout)
                              ).length
                            }
                            canPaste={
                              calendarClipboard?.kind === "week" &&
                              !calendarClipboard.attempt
                            }
                            onAction={(action) =>
                              void runWeekAction(
                                week.key,
                                week.workouts,
                                action
                              )
                            }
                          />
                          <Collapsible
                            open={summaryOpen}
                            onOpenChange={(open) => {
                              void saveSummary(open)
                            }}
                          >
                            <CollapsibleContent className="calendar-summary-content p-3">
                              <WeekSummary
                                workouts={week.workouts.filter(
                                  (workout) => !isCalendarNote(workout)
                                )}
                                planWeek={planWeek}
                                startDate={week.key}
                                context={context}
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
        {newWorkoutDate &&
          (isMobile ? (
            <WorkoutEditor
              date={newWorkoutDate}
              initialSport={newWorkoutType?.sport}
              initialName={newWorkoutType?.name}
              initialVariant={newWorkoutType?.variant}
              initialModel={generatedWorkout?.model}
              initialWarnings={generatedWorkout?.warnings}
              onClose={() => {
                setNewWorkoutDate(null)
                setGeneratedWorkout(null)
              }}
            />
          ) : (
            <DesktopWorkoutCreate
              date={newWorkoutDate}
              initialSport={newWorkoutType?.sport}
              initialName={newWorkoutType?.name}
              initialVariant={newWorkoutType?.variant}
              initialModel={generatedWorkout?.model}
              initialWarnings={generatedWorkout?.warnings}
              onClose={() => {
                setNewWorkoutDate(null)
                setGeneratedWorkout(null)
              }}
              onSaved={(workout, close) => {
                setNewWorkoutDate(null)
                setGeneratedWorkout(null)
                if (!close) setSelectedWorkout(workout)
              }}
            />
          ))}
        {addDialogDate && !isMobile && (
          <CalendarAddDialog
            date={addDialogDate}
            onClose={() => setAddDialogDate(null)}
            onUpload={() => {
              setAddDialogDate(null)
              calendarFiles.upload()
            }}
            onGenerator={() => {
              setGeneratorDate(addDialogDate)
              setAddDialogDate(null)
            }}
            onGoals={() => {
              setAnnotationEditor({ kind: "goals", date: addDialogDate })
              setAddDialogDate(null)
            }}
            onAvailability={() => {
              setAnnotationEditor({ kind: "availability", date: addDialogDate })
              setAddDialogDate(null)
            }}
            onMetrics={() => {
              setMetricsDate(addDialogDate)
              setAddDialogDate(null)
            }}
            onEvent={() => {
              setEventId(undefined)
              setEventDate(addDialogDate)
              setAddDialogDate(null)
            }}
            onSelect={(type) => {
              if (type.sport === "Note") setNoteEditor({ date: addDialogDate })
              else {
                setGeneratedWorkout(null)
                setNewWorkoutType({
                  sport: type.sport,
                  name: type.label,
                  variant: "variant" in type ? type.variant : undefined,
                })
                setNewWorkoutDate(addDialogDate)
              }
              setAddDialogDate(null)
            }}
          />
        )}
        {generatorDate && !isMobile && (
          <WorkoutGenerator
            key={generatorDate}
            date={generatorDate}
            onClose={() => setGeneratorDate(null)}
            onGenerated={(result) => {
              setGeneratedWorkout(result)
              setNewWorkoutType({
                sport: result.model.sport,
                name: result.model.name,
                variant: result.model.variant,
              })
              setNewWorkoutDate(result.model.date)
              setGeneratorDate(null)
            }}
          />
        )}
        {noteEditor && !isMobile && (
          <CalendarNoteEditor
            key={noteEditor.workout?.id || noteEditor.date}
            {...noteEditor}
            onClose={() => setNoteEditor(null)}
          />
        )}
        {annotationEditor && !isMobile && (
          <CalendarAnnotationEditor
            key={`${annotationEditor.kind}:${annotationEditor.id || annotationEditor.date}`}
            {...annotationEditor}
            onClose={() => setAnnotationEditor(null)}
            onSaved={annotationSaved}
          />
        )}
        {eventDate && !isMobile && (
          <Suspense
            fallback={
              <p role="status" className="text-xs text-muted-foreground">
                Loading event editor…
              </p>
            }
          >
            <DesktopEventDialog
              key={eventId || eventDate}
              initialDate={eventDate}
              eventId={eventId}
              initialEdit={eventEditing}
              open
              onOpenChange={(open) => {
                if (!open) setEventDate(null)
              }}
              onSaved={calendarEventSaved}
            />
          </Suspense>
        )}
        {weekShift && !isMobile && (
          <DesktopCalendarShiftDialog
            start={weekShift.sourceStart!}
            count={weekShift.workoutIds.length}
            onClose={() => setWeekShift(null)}
            onShift={(date) => {
              setWeekShift(null)
              void pasteCalendarClipboard(
                new Date(`${date}T12:00:00`),
                weekShift
              )
            }}
          />
        )}
        {!isMobile && metricsDate && (
          <Suspense
            fallback={
              <p role="status" className="text-xs text-muted-foreground">
                Loading daily metrics…
              </p>
            }
          >
            <DailyMetricsDialog
              date={metricsDate}
              rows={metricsRows}
              onClose={() => setMetricsDate(null)}
              onSaved={metricsSaved}
            />
          </Suspense>
        )}
        {calendarFiles.dialogs}
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
              <WorkoutCard
                workout={dragging}
                onClick={() => {}}
                calendarPresentation
              />
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

const disciplineSummaryConfig = {
  swim: { label: "Swim", color: "var(--color-cyan-600)" },
  bike: { label: "Bike", color: "var(--color-violet-600)" },
  run: { label: "Run", color: "#4faa0f" },
  strength: { label: "Strength", color: "#3c0d50" },
  other: { label: "Other", color: "#9d34cc" },
}

function WeekSummary({
  workouts,
  planWeek,
  startDate,
  blockStart,
  context,
}: {
  workouts: PlannedWorkout[]
  planWeek: AnnualPlanWeek | null
  startDate: string
  blockStart?: string
  context: TrainingContext
}) {
  const completedDuration = desktopCalendarRecordedTotal(
    workouts,
    "duration_seconds"
  )
  const completedDistance = desktopCalendarRecordedTotal(
    workouts,
    "distance_meters"
  )
  const totals = workouts.reduce<
    Record<string, { planned: number; completed: number }>
  >((result, workout) => {
    const discipline = calendarDiscipline(workout.sport)
    const current = result[discipline] ?? { planned: 0, completed: 0 }
    result[discipline] = {
      planned: current.planned + workoutPlannedMinutes(workout),
      completed:
        current.completed +
        (desktopCalendarRecordedTotal([workout], "duration_seconds").value ??
          0) /
          60,
    }
    return result
  }, {})
  const sportData = Object.entries(disciplineSummaryConfig)
    .map(([discipline, config]) => ({
      discipline,
      label: config.label,
      planned: totals[discipline]?.planned ?? 0,
      completed: totals[discipline]?.completed ?? 0,
      fill: config.color,
    }))
    .filter((item) => item.planned > 0 || item.completed > 0)
  const completedTss = workoutTssTotal(workouts, "completed")
  const endDay = new Date(Date.parse(`${startDate}T12:00:00Z`) + 6 * 86400000)
    .toISOString()
    .slice(0, 10)
  const today = dateKey(new Date())
  const metrics =
    startDate <= today && today <= endDay
      ? context.metrics
      : planWeek &&
          [
            planWeek.projectedCtl,
            planWeek.projectedAtl,
            planWeek.projectedTsb,
          ].some((value) => value != null)
        ? {
            fitness: planWeek.projectedCtl ?? undefined,
            fatigue: planWeek.projectedAtl ?? undefined,
            form: planWeek.projectedTsb ?? undefined,
          }
        : null
  const summaryClock = (minutes: number) => {
    const roundedMinutes = Math.round(minutes)
    if (!roundedMinutes) return "00:00"
    return `${Math.floor(roundedMinutes / 60)}:${String(roundedMinutes % 60).padStart(2, "0")}`
  }
  const totalsDistance = sportData
    .map((item) => ({
      label: item.label,
      swim: item.discipline === "swim",
      total: desktopCalendarRecordedTotal(
        workouts.filter(
          (workout) => calendarDiscipline(workout.sport) === item.discipline
        ),
        "distance_meters"
      ),
    }))
    .filter((item) => item.total.value != null && item.total.value > 0)
  const elevation = desktopCalendarRecordedTotal(workouts, "elevation_gain")
  const work = desktopCalendarRecordedTotal(workouts, "work_kj")
  const actualTitle = (label: string, total: RecordedCalendarTotal) =>
    `${label}: ${!total.expected ? "no completed workouts" : total.value == null ? "recorded measurement unavailable" : `recorded values from ${total.known} of ${total.expected} completed workouts`}`
  const summaryBar = (planned: number, completed: number, color: string) =>
    ({
      "--calendar-summary-color": color,
      "--calendar-completed-share": `${planned > 0 ? Math.min(100, (completed / planned) * 100) : completed > 0 ? 100 : 0}%`,
    }) as React.CSSProperties

  return (
    <div className="calendar-week-summary space-y-3">
      {metrics && (
        <div className="calendar-summary-fitness">
          {(
            [
              ["fitness", "Fitness", "CTL"],
              ["fatigue", "Fatigue", "ATL"],
              ["form", "Form", "TSB"],
            ] as const
          ).map(([key, label, unit]) => (
            <div key={key} data-metric={key}>
              <span>{label}</span>
              <div>
                <strong>
                  {metrics[key] == null ? "—" : Math.round(metrics[key]!)}
                </strong>{" "}
                {unit}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        <SavedReportButton kind="weekly" startDate={startDate} />
        {blockStart && (
          <SavedReportButton kind="block" startDate={blockStart} />
        )}
      </div>
      {sportData.length > 0 && (
        <table
          className="calendar-summary-sports"
          aria-label="Weekly duration by sport"
        >
          <colgroup>
            <col style={{ width: "44%" }} />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Sport</th>
              <th scope="col">Planned</th>
              <th scope="col">Completed</th>
            </tr>
          </thead>
          <tbody>
            {sportData.map((item) => (
              <tr
                key={item.discipline}
                style={summaryBar(item.planned, item.completed, item.fill)}
              >
                <th scope="row">
                  <span
                    className="calendar-sport-key"
                    style={{ backgroundColor: item.fill }}
                    aria-hidden="true"
                  />
                  {item.label} Duration
                </th>
                <td>{summaryClock(item.planned)}</td>
                <td>{summaryClock(item.completed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <dl className="calendar-summary-distances">
        <div title={actualTitle("Duration", completedDuration)}>
          <dt>Duration</dt>
          <dd>
            <strong>
              {completedDuration.value == null
                ? "—"
                : summaryClock(completedDuration.value / 60)}
            </strong>{" "}
            hms
          </dd>
        </div>
        <div title={actualTitle("Distance", completedDistance)}>
          <dt>Distance</dt>
          <dd>
            <strong>
              {completedDistance.value == null
                ? "—"
                : (completedDistance.value / 1609.344).toFixed(2)}
            </strong>{" "}
            mi
          </dd>
        </div>
        <div
          title={`${completedTss.estimated ? "Estimated " : "Recorded "}TSS available for ${completedTss.available} of ${completedTss.expected} completed workouts`}
        >
          <dt>TSS</dt>
          <dd>
            <strong>{!completedTss.expected ? "0" : completedTss.label}</strong>{" "}
            TSS
          </dd>
        </div>
        {totalsDistance.map((item) => (
          <div
            key={item.label}
            title={actualTitle(`${item.label} distance`, item.total)}
          >
            <dt>{item.label}</dt>
            <dd>
              <strong>
                {item.swim
                  ? Math.round(item.total.value! / 0.9144).toLocaleString()
                  : (item.total.value! / 1609.344).toFixed(2)}
              </strong>{" "}
              {item.swim ? "yds" : "mi"}
            </dd>
          </div>
        ))}
        {elevation.value != null && elevation.value > 0 && (
          <div title={actualTitle("Elevation gain", elevation)}>
            <dt>El. Gain</dt>
            <dd>
              <strong>
                {Math.round(elevation.value / 0.3048).toLocaleString()}
              </strong>{" "}
              ft
            </dd>
          </div>
        )}
        {work.value != null && work.value > 0 && (
          <div title={actualTitle("Work", work)}>
            <dt>Work</dt>
            <dd>
              <strong>{Math.round(work.value).toLocaleString()}</strong> kJ
            </dd>
          </div>
        )}
      </dl>
      {planWeek && (
        <div className="calendar-summary-atp space-y-1.5 pt-3">
          {planWeek.targetHours != null && (
            <p>
              ATP {summaryClock(planWeek.targetHours * 60)}:00{" "}
              <small>h:m:s</small>
            </p>
          )}
          <p className="text-base leading-snug font-bold">
            ATP Period {phaseLabel(planWeek)}
          </p>
          {planWeek.notes && (
            <p className="calendar-summary-plan-notes text-sm leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
              {planWeek.notes}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function WorkoutDialog({
  workout,
  onOpenChange,
  showWorkoutProfile = true,
}: {
  workout: PlannedWorkout | null
  onOpenChange: (open: boolean) => void
  showWorkoutProfile?: boolean
}) {
  if (!workout) return null
  return (
    <WorkoutAccountBoundary
      key={workout.id}
      onClose={() => onOpenChange(false)}
    >
      {(isAccountCurrent) => (
        <TrustedWorkoutDialog
          workout={workout}
          onOpenChange={onOpenChange}
          showWorkoutProfile={showWorkoutProfile}
          isAccountCurrent={isAccountCurrent}
        />
      )}
    </WorkoutAccountBoundary>
  )
}

function TrustedWorkoutDialog({
  workout: initialWorkout,
  onOpenChange,
  showWorkoutProfile = true,
  isAccountCurrent,
}: {
  workout: PlannedWorkout
  onOpenChange: (open: boolean) => void
  showWorkoutProfile?: boolean
  isAccountCurrent: () => boolean
}) {
  const isMobile = useIsMobile()
  const workout = useEditedWorkout(initialWorkout)
  const workoutFiles = useWorkoutFiles({ workout: workout || undefined })
  const desktopDialog = useRef<HTMLDivElement>(null)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [analysis360Open, setAnalysis360Open] = useState(false)
  const [strengthDetailsOpen, setStrengthDetailsOpen] = useState(false)
  const [detailsDirty, setDetailsDirty] = useState(false)
  const [detailsExitError, setDetailsExitError] = useState("")
  const discardDetails = useRef<(() => void) | null>(null)
  const exitInFlight = useRef(false)
  const [commentsTarget, setCommentsTarget] = useState<HTMLDivElement | null>(
    null
  )
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null)
  const [intervalEditorOpen, setIntervalEditorOpen] = useState(false)
  const [previewSaving, setPreviewSaving] = useState(false)
  const [previewDeleting, setPreviewDeleting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [metadata, setMetadata] = useState<DesktopWorkoutMetadata>({
    name: "",
    date: "",
    time: "",
  })
  const [deleteError, setDeleteError] = useState("")
  useEffect(() => {
    if (!workout) return
    prepareWorkout(workout, true)
    if (workout.status === "completed")
      void workoutAnalysis360Route.preload().catch(() => {})
    else prepareWorkoutEditor(workout)
  }, [workout])
  useEffect(() => {
    setAnalysisOpen(false)
    setAnalysis360Open(false)
    setStrengthDetailsOpen(false)
    setDetailsDirty(false)
    setDetailsExitError("")
    setIntervalEditorOpen(false)
  }, [workout?.id])
  const metadataId = workout?.id,
    metadataTitle = workout?.title,
    metadataDate = workout?.workout_date,
    metadataStart = workout?.scheduled_start_at
  useEffect(
    () =>
      setMetadata({
        name: metadataTitle || "",
        date: metadataDate || "",
        time: metadataStart?.slice(11, 16) || "",
        ...(metadataId
          ? readWorkoutSaveDraft<PlannedSaveDraft>(
              trainingCacheScope(),
              metadataId,
              "totals",
              validPlannedSaveDraft
            )?.value.metadata
          : {}),
      }),
    [metadataId, metadataTitle, metadataDate, metadataStart]
  )
  const desktopCompleted = workout.status === "completed" && !isMobile
  const completedStrength =
    desktopCompleted && isCompletedStrengthWorkout(workout)
  const confirmDetailsExit = useCallback(async () => {
    if (
      !isAccountCurrent() ||
      previewSaving ||
      previewDeleting ||
      exitInFlight.current
    )
      return false
    exitInFlight.current = true
    setDetailsExitError("")
    try {
      if (detailsDirty) {
        if (
          !(await confirmWithFramework7(
            "Discard unsaved changes?",
            "Your unsaved workout details will be discarded."
          ))
        )
          return false
        if (!isAccountCurrent()) return false
        if (!discardDetails.current)
          throw Error(
            "The open workout details are not ready to discard. Keep this view open and retry."
          )
      }
      return isAccountCurrent()
    } catch (reason) {
      setDetailsExitError(
        reason instanceof Error
          ? reason.message
          : "The workout could not close. Your details remain open."
      )
      return false
    } finally {
      exitInFlight.current = false
    }
  }, [detailsDirty, isAccountCurrent, previewSaving, previewDeleting])
  const discardDetailsChanges = useCallback(() => {
    if (!detailsDirty) return
    try {
      if (!isAccountCurrent() || !discardDetails.current)
        throw Error(
          "The open workout details are not ready to discard. Keep this view open and retry."
        )
      discardDetails.current()
      setDetailsDirty(false)
    } catch (reason) {
      setDetailsExitError(
        reason instanceof Error
          ? reason.message
          : "The workout details could not be discarded."
      )
      throw reason
    }
  }, [detailsDirty, isAccountCurrent])
  useEffect(
    () =>
      registerWorkoutNavigationGuard(
        confirmDetailsExit,
        () => detailsDirty,
        0,
        discardDetailsChanges
      ),
    [confirmDetailsExit, detailsDirty, discardDetailsChanges]
  )
  const requestStrengthExit = async (destination: "close" | "summary") => {
    if (!(await confirmDetailsExit())) return
    try {
      discardDetailsChanges()
    } catch {
      return
    }
    if (destination === "close")
      bypassWorkoutNavigationGuard(() => onOpenChange(false))
    else {
      setAnalysisOpen(false)
      setAnalysis360Open(false)
      setStrengthDetailsOpen(false)
      setDetailsDirty(false)
    }
  }
  const deleteSelected = async (propagate = false, confirmed = false) => {
    if (!isAccountCurrent() || previewDeleting || !canEditWorkout(workout))
      return
    setPreviewDeleting(true)
    setDeleteError("")
    try {
      if (
        !confirmed &&
        !(await confirmWithFramework7(
          "Delete workout",
          `Delete ${workout.title}?`
        ))
      )
        return
      if (!isAccountCurrent()) return
      await changeWorkout(workout.id, "delete")
      if (isAccountCurrent())
        bypassWorkoutNavigationGuard(() => onOpenChange(false))
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : "The delete could not be confirmed."
      )
      if (propagate) throw e
    } finally {
      setPreviewDeleting(false)
    }
  }
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

  if (!isMobile && workout.editor_model?.strength && canEditWorkout(workout))
    return (
      <WorkoutEditor
        workout={workout}
        onClose={() => {
          if (isAccountCurrent())
            bypassWorkoutNavigationGuard(() => onOpenChange(false))
        }}
        onSaved={(_saved, close) => {
          if (close && isAccountCurrent())
            bypassWorkoutNavigationGuard(() => onOpenChange(false))
        }}
        onDelete={() => deleteSelected(true, true)}
      />
    )
  if (
    completedStrength &&
    !analysisOpen &&
    !analysis360Open &&
    !strengthDetailsOpen
  )
    return (
      <Suspense fallback={<WorkoutAnalysisSkeleton />}>
        <DesktopStrengthCompleted
          key={workout.id}
          workout={workout}
          onClose={() => onOpenChange(false)}
          onAnalyze={() => setAnalysisOpen(true)}
          onDetails={() => setStrengthDetailsOpen(true)}
        />
      </Suspense>
    )
  return (
    <Dialog
      open={Boolean(workout)}
      onOpenChange={(open) => {
        if (open) onOpenChange(true)
        else void requestStrengthExit("close")
      }}
    >
      <DialogContent
        ref={desktopDialog}
        initialFocus={isMobile ? undefined : false}
        showCloseButton={isMobile}
        className={`no-scrollbar max-h-[94vh] gap-3 overflow-y-auto p-0 sm:max-w-5xl ${expanded && !isMobile ? "desktop-workout-dialog-expanded" : ""} ${isMobile ? "" : desktopCompleted && analysis360Open ? "desktop-workout-360-dialog" : desktopCompleted && analysisOpen ? "desktop-workout-completed desktop-workout-analysis-dialog" : "desktop-workout-preview rounded-md"}`}
      >
        {isMobile && (
          <div className="absolute top-2 right-11">
            <WorkoutEditorMenu workout={workout} />
          </div>
        )}
        {!isMobile && (
          <>
            <DialogTitle className="sr-only">{workout.title}</DialogTitle>
            <DialogDescription className="sr-only">{date}</DialogDescription>
            {!analysis360Open && (
              <DesktopWorkoutHeader
                workout={workout}
                expanded={expanded}
                onToggleExpanded={() => setExpanded((value) => !value)}
                busy={previewSaving || previewDeleting}
                onClose={() => void requestStrengthExit("close")}
                metadata={
                  canEditWorkout(workout) || canEditActivity(workout)
                    ? metadata
                    : undefined
                }
                onMetadataChange={setMetadata}
                onAnalyze={
                  desktopCompleted && !analysisOpen
                    ? () => setAnalysisOpen(true)
                    : undefined
                }
                onAnalyze360={
                  desktopCompleted ? () => setAnalysis360Open(true) : undefined
                }
                onSummary={
                  analysisOpen || strengthDetailsOpen
                    ? () => void requestStrengthExit("summary")
                    : undefined
                }
                onEdit={
                  !desktopCompleted && canEditWorkout(workout)
                    ? () => setIntervalEditorOpen(true)
                    : undefined
                }
                onUpload={!desktopCompleted ? workoutFiles.upload : undefined}
                onExport={
                  /^event:\d+$/.test(workout.id) || workout.editor_model
                    ? workoutFiles.exportWorkout
                    : undefined
                }
                settings={
                  canEditWorkout(workout) ? (
                    <DesktopWorkoutSummarySettings
                      getRoot={() => desktopDialog.current}
                    />
                  ) : undefined
                }
                actions={
                  canEditWorkout(workout) ? (
                    <>
                      <button
                        type="button"
                        disabled={previewSaving || previewDeleting}
                        onClick={() => setIntervalEditorOpen(true)}
                      >
                        {workout.unstructured ||
                        workout.editor_model?.unstructured
                          ? "Build Workout"
                          : "Edit Workout"}
                      </button>
                      <button
                        type="button"
                        disabled={previewSaving || previewDeleting}
                        onClick={workoutFiles.exportWorkout}
                      >
                        Export Workout
                      </button>
                      <button
                        type="button"
                        disabled={previewSaving || previewDeleting}
                        onClick={() => void deleteSelected()}
                      >
                        Delete Workout
                      </button>
                    </>
                  ) : undefined
                }
                recurrence={
                  !desktopCompleted && /^event:\d+$/.test(workout.id) ? (
                    <WorkoutRecurrenceControl
                      workoutId={workout.id}
                      date={
                        metadata.date || workout.workout_date || workout.date
                      }
                      disabled={previewSaving || previewDeleting}
                    />
                  ) : undefined
                }
              />
            )}
          </>
        )}
        {isMobile && (
          <DialogHeader className="border-b px-5 pt-5 pr-12 pb-4">
            <DialogDescription className="text-sm font-semibold text-blue-600 dark:text-blue-400">
              {date}
              {time && <span className="ml-2 tabular-nums">{time}</span>}
            </DialogDescription>
          </DialogHeader>
        )}

        {detailsExitError && (
          <p role="alert" className="text-xs text-destructive">
            {detailsExitError}
          </p>
        )}
        {desktopCompleted && analysis360Open && (
          <Suspense fallback={<Analysis360Skeleton />}>
            <WorkoutAnalysis360
              key={workout.id}
              workout={workout}
              busy={previewSaving}
              onSummary={() => {
                void requestStrengthExit("summary")
              }}
              onClassicAnalyze={() => {
                setAnalysis360Open(false)
                setAnalysisOpen(true)
              }}
              onClose={() => void requestStrengthExit("close")}
              onCommentsTarget={setCommentsTarget}
            />
          </Suspense>
        )}
        {desktopCompleted && analysisOpen && !analysis360Open && (
          <div className="desktop-workout-dialog-body">
            <main
              className="desktop-workout-analysis-main"
              aria-label="Workout analysis workspace"
            >
              <Suspense fallback={<WorkoutAnalysisSkeleton />}>
                <WorkoutAnalysis workout={workout} />
              </Suspense>
            </main>
          </div>
        )}
        <div
          hidden={desktopCompleted && (analysisOpen || analysis360Open)}
          className={
            isMobile ? "space-y-4 px-5 pb-6" : "desktop-workout-dialog-body"
          }
        >
          <section
            className={
              isMobile
                ? `rounded-xl border px-4 py-3 shadow-sm ${workout.status === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"}`
                : "desktop-workout-planned-profile"
            }
            aria-label="Workout overview"
          >
            {isMobile && (
              <>
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
              </>
            )}
            {showWorkoutProfile &&
              workout.status !== "completed" &&
              (workout.structure || workout.editor_model) && (
                <div className="mt-3 overflow-hidden">
                  <WorkoutProfile
                    workout={workout}
                    compact
                    desktopDetail
                    disableDesktopTimeline={!isMobile}
                    enableEditOnClick
                  />
                </div>
              )}
          </section>

          {!isMobile ? (
            <DesktopWorkoutDetails
              workout={workout}
              metadata={
                canEditWorkout(workout) || canEditActivity(workout)
                  ? metadata
                  : undefined
              }
              onClose={() => {
                if (isAccountCurrent())
                  bypassWorkoutNavigationGuard(() => onOpenChange(false))
              }}
              onDelete={
                canEditWorkout(workout)
                  ? () => void deleteSelected()
                  : undefined
              }
              footerTarget={footerTarget}
              commentsTarget={analysis360Open ? commentsTarget : null}
              onBusyChange={setPreviewSaving}
              onDirtyChange={setDetailsDirty}
              onDiscardReady={(discard) => {
                discardDetails.current = discard
              }}
            />
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(340px,0.9fr)_minmax(0,1.1fr)]">
              <WorkoutSummary workout={workout} showElapsed={false} embedded />
              <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
                <WorkoutDescription workout={workout} title="Description" />
              </div>
            </div>
          )}
          {deleteError && (
            <p role="alert" className="text-xs text-destructive">
              {deleteError}
            </p>
          )}
          {isMobile && (
            <Suspense fallback={<ChartSkeleton className="rounded-xl" />}>
              <WorkoutAnalysis workout={workout} />
            </Suspense>
          )}
        </div>
        {!isMobile && (
          <div className="desktop-workout-footer-slot" ref={setFooterTarget} />
        )}
        {intervalEditorOpen && (
          <WorkoutEditor
            workout={workout}
            onClose={() => setIntervalEditorOpen(false)}
            onSaveClose={() => {
              if (isAccountCurrent())
                bypassWorkoutNavigationGuard(() => onOpenChange(false))
            }}
            onDelete={() => deleteSelected(true)}
          />
        )}
        {workoutFiles.dialogs}
      </DialogContent>
    </Dialog>
  )
}
