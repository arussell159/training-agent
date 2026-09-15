import { gradeWorkoutCompletion, type CompletionGrade } from "@/lib/workout-completion"
import { MobileHeaderMenu } from "@/components/ui/mobile-header-menu"
import { hasWorkoutStructure } from "@/lib/workout-structure"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core"
import {
  Bike,
  CalendarDays,
  Dumbbell,
  Footprints,
  Ellipsis,
  Copy,
  Trash2,
  Plus,
  Crosshair,
  PanelRightClose,
  PanelRightOpen,
  Waves,
} from "lucide-react"
import { Pie, PieChart } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  durationMinutes,
  completedMinutes,
  fallbackTrainingContext,
  loadFullTrainingContext,
  loadTrainingContext,
  moveWorkoutDate,
  changeWorkout,
  changeWorkoutDay,
  type PlannedWorkout,
  type TrainingHistoryItem,
} from "@/lib/training-context"
import { useIsMobile } from "@/hooks/use-mobile"
import { workoutProfile } from "@/components/section-cards"

function SportIcon({ sport }: { sport: string }) {
  const value = sport.toLowerCase()
  const base = "size-5 shrink-0"
  if (value.includes("swim")) return <Waves className={`${base} text-cyan-600`} />
  if (value.includes("bike")) return <Bike className={`${base} text-violet-600`} />
  if (value.includes("run")) return <Footprints className={`${base} text-lime-600`} />
  if (value.includes("strength")) return <Dumbbell className={`${base} text-orange-600`} />
  return <CalendarDays className={`${base} text-slate-500`} />
}

const gradeStyles: Record<CompletionGrade, string> = {
  planned: "border-border bg-card text-card-foreground hover:bg-accent/50",
  unknown: "border-border bg-card text-card-foreground hover:bg-accent/50",
  good: "border-green-500/50 bg-green-50 text-green-950 hover:bg-green-100 dark:bg-green-950/30 dark:text-green-100",
  medium: "border-orange-500/50 bg-orange-50 text-orange-950 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-100",
  failed: "border-red-500/50 bg-red-50 text-red-950 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-100",
}
function WorkoutPreview({ workout, large = false }: { workout: PlannedWorkout; large?: boolean }) {
  if (!hasWorkoutStructure(workout.structure)) return null
  const source = workout.details ?? workout.goal ?? workout.title
  const points = workoutProfile(workout.title, workout.sport, source)
  const profile = Array.from({ length: Math.floor(points.length / 2) }, (_, index) => {
    const start = points[index * 2]
    const end = points[index * 2 + 1]
    return {
      intensity: start.intensity,
      width: Math.max(1, end.position - start.position),
    }
  })
  return (
    <div className={`mt-auto flex items-end overflow-hidden opacity-70 ${large ? "h-20 gap-1 rounded-md border p-2" : "-mx-2.5 -mb-3 h-8 gap-0 pt-2"}`} aria-label="Workout profile preview">
      {profile.map((segment, index) => (
        <span
          key={index}
          className={`min-w-px bg-muted-foreground/40 ${large ? "rounded-sm" : ""}`}
          style={{
            flexBasis: 0,
            flexGrow: segment.width,
            height: `${Math.min(segment.intensity, 96)}%`,
          }}
        />
      ))}
    </div>
  )
}

function estimatedDistance(workout: PlannedWorkout) {
  const sport = workout.sport.toLowerCase()
  const source = `${workout.title} ${workout.details ?? workout.goal ?? ""}`
  const minutes = workout.status === "completed" && completedMinutes(workout) > 0
    ? completedMinutes(workout)
    : durationMinutes(workout)
  if (sport.includes("swim")) {
    const yards = [...source.matchAll(/(\d+)\s*x\s*\(([^)]+)\)/gi)].reduce((sum, set) => {
      const setDistance = [...set[2].matchAll(/(\d+)\s*(?:FS|Free|Pull|Kick|Back|Breast|Choice|Drill)/gi)]
        .reduce((distance, step) => distance + Number(step[1]), 0)
      return sum + Number(set[1]) * setDistance
    }, 0)
    const estimate = yards || Math.round((minutes * 50) / 50) * 50
    return estimate > 0 ? `~${estimate} yds` : ""
  }
  if (sport.includes("bike") || sport.includes("brick")) {
    const mph = /70\.3|race pace|threshold|over-under/i.test(source) ? 20 : /easy|recovery/i.test(source) ? 16 : 18
    return minutes > 0 ? `~${(minutes / 60 * mph).toFixed(1)} mi` : ""
  }
  if (sport.includes("run")) {
    const mph = /threshold|tempo|70\.3|race pace/i.test(source) ? 7.2 : /easy|recovery/i.test(source) ? 6 : 6.6
    return minutes > 0 ? `~${(minutes / 60 * mph).toFixed(1)} mi` : ""
  }
  return ""
}

function workoutDate(value?: string) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function WorkoutCard({ workout, onClick, onAction, disabled = false }: { workout: PlannedWorkout; onClick: () => void; onAction?: (action: "copy" | "delete") => void; disabled?: boolean }) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const grade = gradeWorkoutCompletion(workout.status, { ...workout.planned, duration_minutes: workout.planned?.duration_minutes ?? workout.plannedDurationMinutes }, { ...workout.completed_data, duration_minutes: completedMinutes(workout) })
  const displayedMinutes = workout.status === "completed" && completedMinutes(workout) > 0
    ? completedMinutes(workout)
    : durationMinutes(workout)
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick() } }}
      className={`w-full cursor-pointer gap-2 rounded-md px-2.5 py-3 shadow-sm transition-colors ${gradeStyles[grade]}`}
    >
      <div className="flex min-w-0 flex-col items-start gap-2">
        <div className="flex w-full items-center justify-between">
          <SportIcon sport={workout.sport} />
          {onAction && <div onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="-my-1 -mr-1 size-7" disabled={disabled} aria-label={`Options for ${workout.title}`} />}>
                <Ellipsis className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-36" onClick={event => event.stopPropagation()}>
                <DropdownMenuItem onClick={() => onAction("copy")}><Copy />Copy</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}><Trash2 />Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogContent onClick={event => event.stopPropagation()}>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete workout?</AlertDialogTitle>
                  <AlertDialogDescription>Delete “{workout.title}” from your Intervals.icu calendar?</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => onAction("delete")}>Delete workout</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>}
        </div>
        <span className="line-clamp-2 w-full text-left text-sm font-semibold leading-tight md:text-base">
          {workout.title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        {displayedMinutes > 0 && <span>{formatDuration(displayedMinutes)}</span>}
        {estimatedDistance(workout) && <span>· {estimatedDistance(workout)}</span>}
      </div>
      {workout.status === "completed" && grade !== "unknown" && (
        <span className="flex items-center gap-1 text-[10px] font-medium">
          {grade === "good" ? "On target" : grade === "medium" ? "Near target" : "Outside target"}
        </span>
      )}
      <WorkoutPreview workout={workout} />
    </Card>
  )
}

function DraggableWorkout({ workout, onOpen, onAction, disabled }: { workout: PlannedWorkout; onOpen: () => void; onAction: (action: "copy" | "delete") => void; disabled: boolean }) {
  const {setNodeRef, listeners, isDragging} = useDraggable({id:workout.id, data:{workout}, disabled})
  return <div ref={setNodeRef} {...listeners} className={`select-none ${isDragging ? "opacity-30" : ""}`}>
    <WorkoutCard workout={workout} onClick={onOpen} onAction={workout.id.startsWith("event:") ? onAction : undefined} disabled={disabled} />
  </div>
}

function CalendarDay({ date, className, children, disabled }: { date: string; className: string; children: ReactNode; disabled: boolean }) {
  const {setNodeRef, isOver} = useDroppable({id:date, disabled})
  return <div ref={setNodeRef} data-calendar-date={date} className={`group/day ${className} ${isOver ? "bg-primary/10 ring-2 ring-inset ring-primary" : ""}`}>{children}</div>
}

function DayMenu({day, count, disabled, onAction}: {day: Date; count:number; disabled:boolean; onAction:(action:"copy"|"delete") => void}) {
  const [open,setOpen] = useState(false)
  const [deleteOpen,setDeleteOpen] = useState(false)
  const label = day.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
  return <div className={`transition-opacity group-hover/day:opacity-100 focus-within:opacity-100 ${open || deleteOpen ? "opacity-100" : "opacity-0"}`}>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" disabled={disabled || count === 0} aria-label={`Workout actions for ${label}`} />}><Ellipsis className="size-4" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuItem onClick={() => onAction("copy")}><Copy />Copy</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}><Trash2 />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this day’s workouts?</AlertDialogTitle>
          <AlertDialogDescription>Delete all {count} workouts on {label} from your Intervals.icu calendar?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => onAction("delete")}>Delete workouts</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
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
  const [context, setContext] = useState(fallbackTrainingContext)
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(null)
  const [activeWeekKey, setActiveWeekKey] = useState("")
  const [dragging, setDragging] = useState<PlannedWorkout | null>(null)
  const [moving, setMoving] = useState(false)
  const [moveNotice, setMoveNotice] = useState("")
  const calendarWasDragged = useRef(false)
  const calendarRevision = useRef(0)
  const sensors = useSensors(useSensor(MouseSensor, {activationConstraint:{distance:6}}), useSensor(TouchSensor, {activationConstraint:{delay:250,tolerance:6}}))

  const runWorkoutAction = async (workout: PlannedWorkout, action: "copy" | "delete") => {
    if (moving) return
    calendarWasDragged.current = true
    setMoving(true)
    setMoveNotice(action === "copy" ? "Copying workout…" : "Deleting workout…")
    try {
      const result = await changeWorkout(workout.id, action)
      if (result.context) setContext(current => ({...current, ...result.context}))
      else if (action === "delete") setContext(current => ({...current, planned:current.planned.filter(item => item.id !== workout.id), history:current.history.filter(item => !("id" in item) || item.id !== workout.id)}))
      setMoveNotice(`${workout.title} ${action === "copy" ? "copied to the same day" : "deleted"}.${!result.context ? " Refresh Intervals.icu to reload the calendar." : ""}`)
    } catch (error) {setMoveNotice(error instanceof Error ? error.message : `Unable to ${action} workout.`)}
    finally {setMoving(false)}
  }

  const runDayAction = async (day: Date, action: "copy"|"delete") => {
    if (moving) return
    calendarWasDragged.current = true
    setMoving(true)
    setMoveNotice(action === "copy" ? "Copying this day’s workouts…" : "Deleting this day’s workouts…")
    try {
      const result = await changeWorkoutDay(dateKey(day),action)
      if (result.context) setContext(current => ({...current,...result.context}))
      else if (action === "delete") {
        const ids = new Set(result.results.map(item => item.workoutId))
        setContext(current => ({...current, planned:current.planned.filter(item => !ids.has(item.id)),history:current.history.filter(item => !("id" in item) || !ids.has(String(item.id)))}))
      }
      setMoveNotice(`${result.results.length} of ${result.total} workouts ${action === "copy" ? "copied to the same day" : "deleted"}.${result.failures.length ? ` ${result.failures[0].error} Refresh before retrying.` : !result.context ? " Refresh Intervals.icu to reload the calendar." : ""}`)
    } catch(error) {setMoveNotice(error instanceof Error ? error.message : "Unable to update this day’s workouts.")}
    finally {setMoving(false)}
  }

  const finishDrag = async ({active, over}: DragEndEvent) => {
    setDragging(null)
    const workout = active.data.current?.workout as PlannedWorkout | undefined
    if (!workout || !workout.id.startsWith("event:") || !over || String(over.id) === workout.workout_date || moving) return
    const date = String(over.id)
    calendarWasDragged.current = true
    const snapshot = context
    calendarRevision.current += 1
    const update = (item: PlannedWorkout) => item.id === workout.id ? {...item, workout_date:date,
      day:new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{weekday:'short'}).toUpperCase(),
      date:new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'}),
      status:item.status === 'completed' ? 'completed' as const : date === dateKey(new Date()) ? 'today' as const : 'upcoming' as const,
    } : item
    setMoving(true)
    setMoveNotice("Saving workout date…")
    setContext(current => ({...current, planned:current.planned.map(update), history:(current.history as PlannedWorkout[]).map(update) as TrainingHistoryItem[]}))
    try {
      const result = await moveWorkoutDate(workout.id, date)
      if (result.context) setContext(current => ({...current, ...result.context}))
      setMoveNotice(`${workout.title} saved and moved to ${new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'})}.`)
    } catch (error) {
      setContext(snapshot)
      setMoveNotice(error instanceof Error ? error.message : "Unable to move workout.")
    } finally {setMoving(false)}
  }
  const [summaryOpen, setSummaryOpen] = useState(() => localStorage.getItem("training-calendar-summary-open") !== "false")
  const isMobile = useIsMobile()
  const weekRefs = useRef(new Map<string, HTMLElement>())
  const calendarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    const revision = calendarRevision.current
    loadTrainingContext().then((next) => active && revision === calendarRevision.current && setContext(next))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    let started = false
    const hydrateHistory = () => {
      if (started) return
      started = true
      const revision = calendarRevision.current
      void loadFullTrainingContext().then((next) => active && revision === calendarRevision.current && setContext(next))
    }
    window.addEventListener("scroll", hydrateHistory, { passive: true, once: true })
    const timer = window.setTimeout(hydrateHistory, 1200)
    return () => {
      active = false
      window.clearTimeout(timer)
      window.removeEventListener("scroll", hydrateHistory)
    }
  }, [])

  const workouts = useMemo(() => {
      const workouts = new Map<string, PlannedWorkout>()
      for (const workout of context.history as PlannedWorkout[]) {
        if (workout.id && workout.workout_date) workouts.set(workout.id, workout)
      }
      for (const workout of context.planned) workouts.set(workout.id, workout)

      return [...workouts.values()].filter((workout) => workoutDate(workout.workout_date)).sort((a, b) => String(a.workout_date).localeCompare(String(b.workout_date)))
    },
    [context.history, context.planned]
  )

  const weeks = useMemo(() => {
    if (!workouts.length) return []
    const first = startOfMonday(workoutDate(workouts[0].workout_date)!)
    const last = startOfMonday(workoutDate(workouts[workouts.length - 1].workout_date)!)
    const result: Array<{ key: string; start: Date; days: Date[]; workouts: PlannedWorkout[] }> = []
    for (let cursor = first; cursor <= last; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7)) {
      const start = new Date(cursor)
      const days = Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
      const keys = new Set(days.map(dateKey))
      result.push({ key: dateKey(start), start, days, workouts: workouts.filter((workout) => keys.has(workout.workout_date ?? "")) })
    }
    return result
  }, [workouts])

  useLayoutEffect(() => {
    if (!weeks.length || calendarWasDragged.current) return
    const previousRestoration = history.scrollRestoration
    history.scrollRestoration = "manual"
    const todayWeek = dateKey(startOfMonday(new Date()))
    const target = weeks.some((week) => week.key === todayWeek) ? todayWeek : weeks[weeks.length - 1].key
    const alignToday = () => {
      if (calendarWasDragged.current) return
      setActiveWeekKey(target)
      const element = isMobile
        ? calendarRef.current?.querySelector(`[data-calendar-date="${dateKey(new Date())}"]`) || weekRefs.current.get(target)
        : weekRefs.current.get(target)
      if (!element) return
      window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - (isMobile ? 56 : 84)), behavior: "instant" })
    }
    const frame = requestAnimationFrame(() => requestAnimationFrame(alignToday))
    const timer = window.setTimeout(alignToday, 250)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      history.scrollRestoration = previousRestoration
    }
  }, [weeks, isMobile])

  const scrollToWeek = (key: string, behavior: ScrollBehavior = "smooth") => {
    const element = weekRefs.current.get(key)
    if (!element) return
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - (isMobile ? 56 : 84), behavior })
    setActiveWeekKey(key)
  }

  useEffect(() => {
    const trackVisibleWeek = () => {
      let visibleKey = activeWeekKey
      for (const week of weeks) {
        const bounds = weekRefs.current.get(week.key)?.getBoundingClientRect()
        if (bounds && bounds.bottom > 57) { visibleKey = week.key; break }
      }
      if (visibleKey && visibleKey !== activeWeekKey) setActiveWeekKey(visibleKey)
    }
    window.addEventListener("scroll", trackVisibleWeek, { passive: true })
    return () => window.removeEventListener("scroll", trackVisibleWeek)
  }, [activeWeekKey, weeks])

  const goToToday = () => {
    const target = dateKey(startOfMonday(new Date()))
    calendarWasDragged.current = true
    const scrollToToday = () => {
      if (!isMobile) { scrollToWeek(target, "instant"); return }
      const element = calendarRef.current?.querySelector(`[data-calendar-date="${dateKey(new Date())}"]`)
      if (!element) return
      window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - 56), behavior: "instant" })
      setActiveWeekKey(target)
    }
    scrollToToday()
    requestAnimationFrame(scrollToToday)
  }

  const activeWeek = weeks.find((week) => week.key === activeWeekKey) ?? weeks[0]
  const activeMonth = activeWeek?.start.toLocaleDateString("en-US", { month: "long", year: "numeric" }) ?? "Calendar"

  const openWorkout = (workout: PlannedWorkout) => {
    if (isMobile && onWorkoutOpen) {
      onWorkoutOpen(workout)
      return
    }
    setSelectedWorkout(workout)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={({active}) => setDragging(active.data.current?.workout || null)} onDragCancel={() => setDragging(null)} onDragEnd={event => void finishDrag(event)}>
    <div ref={calendarRef} className="flex w-full min-w-0 flex-1 flex-col">
      <header className="mobile-site-header sticky top-0 z-50 flex h-14 w-full shrink-0 items-center border-b bg-background/95 px-4 shadow-sm backdrop-blur md:shadow-none">
        <h1 className="mobile-header-title min-w-0 truncate text-sm font-semibold">{activeMonth}</h1>
        <div className="flex items-center gap-1 md:ml-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={goToToday} aria-label="Go to today" title="Go to today"><Crosshair className="size-5" /></Button>
          <Button size="sm" className="hidden md:inline-flex" onClick={goToToday}>Today</Button>
        </div>
      <MobileHeaderMenu /></header>
      <div className="sticky top-14 z-40 hidden h-7 shrink-0 border-b bg-background shadow-sm md:flex">
        <div className="grid min-w-0 flex-1 grid-cols-7 divide-x">
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day => <div key={day} className="flex items-center px-2 text-[11px] font-medium uppercase text-muted-foreground">{day}</div>)}
        </div>
        <div className={`hidden shrink-0 border-l xl:block ${summaryOpen ? "w-72" : "w-10"}`} />
      </div>
      {moveNotice && <p role="status" className="border-b bg-background px-4 py-2 text-xs text-muted-foreground">{moveNotice}</p>}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-w-0 flex-1 bg-muted/20">
          <div className="divide-y">
          {weeks.map((week) => {
            const end = week.days[6]
            const title = `${week.start.toLocaleDateString("en-US", { month: "short", day: "2-digit" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "2-digit" })}`
            return (
              <section
                key={week.key}
                ref={(element) => { if (element) weekRefs.current.set(week.key, element); else weekRefs.current.delete(week.key) }}
                className="h-auto min-h-0 scroll-mt-14 bg-background"
              >
                <div className="flex h-auto min-h-0 w-full flex-col items-start xl:flex-row">
                <div className="grid h-auto min-h-0 w-full min-w-0 flex-1 grid-cols-1 items-stretch divide-y md:grid-cols-7 md:divide-x md:divide-y-0">
                    {week.days.map((day) => {
                      const dayWorkouts = week.workouts.filter((workout) => workout.workout_date === dateKey(day))
                      const isToday = dateKey(day) === dateKey(new Date())
                      return (
                        <CalendarDay key={dateKey(day)} date={dateKey(day)} disabled={moving} className={isToday ? "min-w-0 bg-primary/5 px-1.5 py-2" : "min-w-0 px-1.5 py-2"}>
                          {isToday && <section aria-label="Performance Insights" className="mb-4 pt-2 md:hidden">
                            <div className="mb-1 flex items-center justify-between">
                              <p className="text-sm font-semibold text-primary">{day.toLocaleDateString("en-US", {weekday:"short"})} - {day.getDate()}</p>
                              <DayMenu day={day} count={dayWorkouts.filter(w => w.id.startsWith("event:")).length} disabled={moving} onAction={action => void runDayAction(day,action)} />
                            </div>
                            <h2 className="mb-3 text-base font-semibold">Performance Insights</h2>
                            <div className="grid grid-cols-3 gap-1.5">
                              {[
                                {label:"Fitness", value:context.metrics.fitness, color:"text-blue-600 dark:text-blue-400"},
                                {label:"Form", value:context.metrics.form, color:"text-emerald-600 dark:text-emerald-400"},
                                {label:"Fatigue", value:context.metrics.fatigue, color:"text-orange-600 dark:text-orange-400"},
                              ].map(metric => <Card key={metric.label} className={`min-w-0 gap-1 rounded-md px-2.5 py-3 text-left shadow-none ${metric.color}`}>
                                <p className="text-base font-semibold tabular-nums">{Number.isFinite(metric.value) ? Math.round(metric.value!) : "—"}</p>
                                <div className="border-t border-current" />
                                <p className="text-[11px]">{metric.label}</p>
                              </Card>)}
                            </div>
                          </section>}
                          <div className={`mb-3 items-center justify-between gap-2 ${isToday ? "hidden md:flex" : "flex"}`}>
                            <span className={`px-0.5 text-sm ${isToday ? "hidden font-semibold text-primary md:inline" : "text-foreground"}`}>
                              <span className="md:hidden">{day.toLocaleDateString("en-US", {weekday:"short"})} - </span>{day.getDate()}
                            </span>
                            <DayMenu day={day} count={dayWorkouts.length} disabled={moving} onAction={action => void runDayAction(day,action)} />
                          </div>
                          <div className="space-y-2">
                            {dayWorkouts.map((workout) => <DraggableWorkout key={workout.id} workout={workout} disabled={moving || !workout.id.startsWith("event:")} onOpen={() => openWorkout(workout)} onAction={action => void runWorkoutAction(workout, action)} />)}
                            <div aria-hidden="true" className="flex h-12 w-full items-center justify-center rounded-sm border border-muted-foreground/40 text-muted-foreground opacity-0 transition-opacity group-hover/day:opacity-100">
                              <Plus className="size-4" />
                            </div>
                          </div>
                        </CalendarDay>
                      )
                    })}
                </div>
                <aside className={`hidden shrink-0 self-stretch border-l bg-muted/20 transition-[width] xl:block ${summaryOpen ? "w-72" : "w-10"}`}>
                  <Collapsible open={summaryOpen} onOpenChange={(open) => { setSummaryOpen(open); localStorage.setItem("training-calendar-summary-open", String(open)) }}>
                    <div className="flex justify-end p-1">
                      <CollapsibleTrigger render={<Button variant="ghost" size="icon-sm" aria-label={summaryOpen ? "Collapse weekly summary" : "Expand weekly summary"} />}>
                        {summaryOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent className="px-3 pb-3">
                      <WeekSummary title={title} workouts={week.workouts} />
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
      <WorkoutDialog workout={selectedWorkout} onOpenChange={(open) => !open && setSelectedWorkout(null)} />
    </div>
    <DragOverlay>{dragging ? <div className="max-w-sm cursor-grabbing shadow-xl"><WorkoutCard workout={dragging} onClick={() => {}} /></div> : null}</DragOverlay>
    </DndContext>
  )
}

const disciplineChartConfig = {
  swim: { label: "Swim", color: "var(--chart-1)" },
  bike: { label: "Bike", color: "var(--chart-2)" },
  run: { label: "Run", color: "var(--chart-3)" },
  strength: { label: "Strength", color: "var(--chart-4)" },
  other: { label: "Other", color: "var(--chart-5)" },
} satisfies ChartConfig

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (!hours) return `${remainder}m`
  if (!remainder) return `${hours}h`
  return `${hours}h ${remainder}m`
}

function WeekSummary({ title, workouts }: { title: string; workouts: PlannedWorkout[] }) {
  const totalMinutes = workouts.reduce((sum, item) => sum + completedMinutes(item), 0)
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
      fill: `var(--color-${discipline})`,
    }))
    .filter((item) => item.minutes > 0)

  return (
    <Card className="gap-3 rounded-md p-3">
      <CardTitle className="text-center text-sm">{title}</CardTitle>
      <div className="relative">
        <ChartContainer config={disciplineChartConfig} className="mx-auto aspect-square max-h-40 w-full">
          <PieChart accessibilityLayer>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel formatter={(value) => formatDuration(Number(value))} />}
            />
            <Pie data={chartData} dataKey="minutes" nameKey="discipline" innerRadius={38} outerRadius={64} strokeWidth={2} />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <strong className="text-lg tabular-nums">{formatDuration(totalMinutes)}</strong>
          <span className="text-[10px] text-muted-foreground">Total time</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {chartData.map((item) => (
          <div key={item.discipline} className="flex items-center gap-2 text-xs">
            <span className="size-2 rounded-full" style={{ backgroundColor: item.fill }} />
            <span className="flex-1 text-muted-foreground">{item.label}</span>
            <span className="font-medium tabular-nums">{formatDuration(item.minutes)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function WorkoutDialog({ workout, onOpenChange }: { workout: PlannedWorkout | null; onOpenChange: (open: boolean) => void }) {
  if (!workout) return null
  const planned = durationMinutes(workout)
  const completed = completedMinutes(workout)
  const date = workout.workout_date
    ? new Date(`${workout.workout_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : workout.date

  return (
    <Dialog open={Boolean(workout)} onOpenChange={onOpenChange}>
      <DialogContent className="no-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={workout.status === "completed" ? "default" : "secondary"}>
              {workout.status === "completed" ? "Completed" : workout.status === "today" ? "Today" : "Planned"}
            </Badge>
            <DialogDescription>{date}</DialogDescription>
          </div>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <span className="text-muted-foreground"><SportIcon sport={workout.sport} /></span>
            {workout.title}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Duration" value={workout.status === "completed" && completed ? `${completed} min` : workout.duration} />
          <StatCard label="Training load" value={`${Math.round(workout.load ?? 0)} TSS`} />
          <StatCard label="Discipline" value={workout.sport} />
        </div>

        <WorkoutPreview workout={workout} large />

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Planned and completed</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Metric</TableHead><TableHead>Planned</TableHead><TableHead>Completed</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell>Duration</TableCell><TableCell>{planned ? `${planned} min` : "—"}</TableCell><TableCell>{completed ? `${completed} min` : "—"}</TableCell></TableRow>
                <TableRow><TableCell>TSS</TableCell><TableCell>{Math.round(workout.load ?? 0)}</TableCell><TableCell>{workout.status === "completed" ? Math.round(workout.completed_data?.tss ?? workout.load ?? 0) : "—"}</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Workout description</CardTitle></CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{workout.details ?? workout.goal}</p>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return <Card className="gap-1 p-3"><span className="text-xs text-muted-foreground">{label}</span><strong className="text-sm">{value}</strong></Card>
}
