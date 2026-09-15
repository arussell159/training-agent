import {WorkoutDescription} from '@/components/workout-description'
import {lazy,Suspense} from 'react'
import {formatDuration} from '@/lib/duration'
import { gradeWorkoutCompletion, type CompletionGrade } from "@/lib/workout-completion"
import { MobileHeaderMenu } from "@/components/ui/mobile-header-menu"
import { WorkoutProfile } from "@/components/workout-profile"
import { WorkoutSummary } from "@/components/workout-summary"
import { plannedDistanceLabel } from "@/lib/workout-distance"
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
  PanelRightClose,
  PanelRightOpen,
  Waves,
} from "lucide-react"
import { Pie, PieChart } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog"
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
  fallbackTrainingContext,
  moveWorkoutDate,
  changeWorkout,
  changeWorkoutDay,
  type PlannedWorkout,
  type TrainingHistoryItem,
  type TrainingContext,
} from "@/lib/training-context"
import { useIsMobile } from "@/hooks/use-mobile"
import { DailyMetricsCard, DailyMetricsDialog } from "@/components/daily-metrics"
const WorkoutAnalysis=lazy(()=>import('@/components/workout-analysis').then(m=>({default:m.WorkoutAnalysis})))
import {apiFetch} from '@/lib/api-client'

function SportIcon({ sport }: { sport: string }) {
  const value = sport.toLowerCase()
  const base = "size-5 shrink-0"
  if (value.includes("swim")) return <Waves className={`${base} text-cyan-600`} />
  if (value.includes("bike") || value.includes("brick")) return <Bike className={`${base} text-violet-600`} />
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
  return <div className={large ? '' : 'mt-auto -mx-2.5 -mb-3 pt-2'}><WorkoutProfile workout={workout} compact={!large} /></div>
}

function estimatedDistance(workout: PlannedWorkout) { const label=plannedDistanceLabel(workout);return label==='—'?'':label }

function workoutDate(value?: string) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function WorkoutCard({ workout, onClick, onAction, disabled = false }: { workout: PlannedWorkout; onClick: () => void; onAction?: (action: "copy" | "delete") => void; disabled?: boolean }) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const grade = workout.status==='completed' && workout.completion_grade ? workout.completion_grade : gradeWorkoutCompletion(workout.status, { ...workout.planned, duration_minutes: workout.planned?.duration_minutes ?? workout.plannedDurationMinutes }, { ...workout.completed_data, duration_minutes: completedMinutes(workout) })
  const displayedMinutes = workout.status === "completed" && completedMinutes(workout) > 0
    ? completedMinutes(workout)
    : durationMinutes(workout)
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick() } }}
      className={`group/workout w-full cursor-pointer gap-2 rounded-md px-2.5 py-3 shadow-sm transition-colors ${gradeStyles[grade]}`}
    >
      <div className="flex min-w-0 flex-col items-start gap-2">
        <div className="flex w-full items-center justify-between">
          <SportIcon sport={workout.sport} />
          <div onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="-my-1 -mr-1 size-7 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/workout:opacity-100 group-focus-within/workout:opacity-100 data-[popup-open]:opacity-100" disabled={disabled && Boolean(onAction)} aria-label={`Options for ${workout.title}`} />}>
                <Ellipsis className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-36" onClick={event => event.stopPropagation()}>
                {!onAction && <p className="max-w-48 px-2 py-1.5 text-xs text-muted-foreground">Recorded history is read-only.</p>}
                <DropdownMenuItem disabled={!onAction || disabled} onClick={() => onAction?.("copy")}><Copy />Copy</DropdownMenuItem>
                <DropdownMenuItem disabled={!onAction || disabled} variant="destructive" onClick={() => setDeleteOpen(true)}><Trash2 />Delete</DropdownMenuItem>
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
                  <AlertDialogAction variant="destructive" onClick={() => onAction?.("delete")}>Delete workout</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <span className="line-clamp-2 w-full text-left text-[13px] font-semibold leading-tight md:text-sm">
          {workout.title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-muted-foreground md:text-xs">
        {displayedMinutes > 0 && <span>{formatDuration(displayedMinutes)}</span>}
        {estimatedDistance(workout) && <span>· {estimatedDistance(workout)}</span>}
      </div>
      {(workout.details || workout.goal) && (
        <p className="line-clamp-6 whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">
          {(workout.details || workout.goal || "").trim()}
        </p>
      )}
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
  const {setNodeRef, listeners, isDragging} = useDraggable({id:workout.id, data:{workout}, disabled:disabled || !workout.id.startsWith("event:")})
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
  const [context, setContext] = useState({...fallbackTrainingContext, history: [], planned: [], wellness_history: []} as TrainingContext)
  const [historyReady,setHistoryReady] = useState(false)
  const loadedWeeks = useRef(new Set<string>())
  const pendingWeeks = useRef(new Set<string>())
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(null)
  const [metricsDate, setMetricsDate] = useState<string | null>(null)
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
  const [summaryOpen, setSummaryOpen] = useState(true)
  useEffect(()=>{const update=(event:Event)=>{const {id,description}=(event as CustomEvent<{id:string;description:string}>).detail;const map=(w:PlannedWorkout)=>w.id===id?{...w,details:description,goal:description}:w;setContext(c=>({...c,planned:c.planned.map(map),history:c.history.map(w=>(w as unknown as {id:string}).id===id?{...w,details:description,goal:description}:w)}))};window.addEventListener('workout-description-updated',update);return()=>window.removeEventListener('workout-description-updated',update)},[])
  useEffect(()=>{let active=true;void apiFetch('/api/config').then(r=>r.json()).then(c=>{if(active)setSummaryOpen(c.calendarSummaryOpen !== false)}).catch(()=>{});return()=>{active=false}},[])
  async function saveSummary(open:boolean) {
    try {const r=await apiFetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({CALENDAR_SUMMARY_OPEN:String(open)})});const c=await r.json();if(!r.ok)throw new Error(c.error||'Could not save preference');setSummaryOpen(open)}catch(e){setMoveNotice(e instanceof Error?e.message:'Could not save preference')}
  }
  const isMobile = useIsMobile()
  const weekRefs = useRef(new Map<string, HTMLElement>())
  const calendarRef = useRef<HTMLDivElement>(null)
  const calendarUserScrolled = useRef(false)
  const viewportAnchor = useRef<{element:Element;top:number;scrollY:number} | null>(null)

  useEffect(() => {
    const mark = () => { calendarUserScrolled.current = true }
    const key = (event: KeyboardEvent) => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) mark() }
    window.addEventListener('wheel', mark, {passive:true})
    window.addEventListener('touchmove', mark, {passive:true})
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('wheel', mark); window.removeEventListener('touchmove', mark); window.removeEventListener('keydown', key) }
  }, [])

  // Programmatic initial scrolling is not user scrolling. Re-align after rows
  // and preferences hydrate, until the user actually moves away from today.
  useLayoutEffect(() => {
    if (calendarUserScrolled.current || calendarWasDragged.current || !window.matchMedia('(max-width: 767px)').matches) return
    const day = calendarRef.current?.querySelector(`[data-calendar-date="${dateKey(new Date())}"]`)
    if (day) window.scrollTo({top:Math.max(0, window.scrollY + day.getBoundingClientRect().top - 56), behavior:'instant'})
  }, [context, summaryOpen, isMobile])

  // Correct layout growth before paint, rather than letting newly loaded rows
  // move the day the user was reading. Retain any intervening user scrolling.
  useLayoutEffect(()=>{
    const anchor=viewportAnchor.current
    viewportAnchor.current=null
    if(!anchor || !anchor.element.isConnected)return
    const shift=anchor.element.getBoundingClientRect().top-anchor.top+(window.scrollY-anchor.scrollY)
    if(Math.abs(shift)>0.5)window.scrollTo({top:window.scrollY+shift,behavior:'instant'})
  },[context])

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

      return [...workouts.values()].filter((workout) => workoutDate(workout.workout_date)).sort((a, b) => String(a.workout_date).localeCompare(String(b.workout_date)))
    },
    [context.history, context.planned]
  )

  const weeks = useMemo(() => {
    // Dates exist independently of sessions: an empty account still has a calendar.
    const today = new Date()
    const earliest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 90)
    const latest = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
    const firstWorkout = workoutDate(workouts[0]?.workout_date)
    const lastWorkout = workoutDate(workouts[workouts.length - 1]?.workout_date)
    const first = startOfMonday(firstWorkout && firstWorkout < earliest ? firstWorkout : earliest)
    const last = startOfMonday(lastWorkout && lastWorkout > latest ? lastWorkout : latest)
    const result: Array<{ key: string; start: Date; days: Date[]; workouts: PlannedWorkout[] }> = []
    for (let cursor = first; cursor <= last; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7)) {
      const start = new Date(cursor)
      const days = Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
      const keys = new Set(days.map(dateKey))
      result.push({ key: dateKey(start), start, days, workouts: workouts.filter((workout) => keys.has(workout.workout_date ?? "")) })
    }
    return result
  }, [workouts])

  const weekKeys = weeks.map(week=>week.key).join('|')
  useEffect(()=>{
    if(!historyReady)return
    let active=true
    const controller=new AbortController()
    let busy=false
    let scrolled=false
    const queue=new Set<string>()
    const pump=async()=>{
      if(busy || !active)return
      const start=queue.values().next().value as string | undefined
      if(!start)return
      queue.delete(start)
      if(loadedWeeks.current.has(start)){void pump();return}
      busy=true
      const date=workoutDate(start)!
      const end=dateKey(new Date(date.getFullYear(),date.getMonth(),date.getDate()+6))
        pendingWeeks.current.add(start)
        const revision=calendarRevision.current
        const query=new URLSearchParams({scope:'range',start,end})
        await apiFetch(`/api/training-context?${query}`,{signal:controller.signal}).then(async response=>{
          if(!response.ok)throw new Error('Could not load calendar week')
          return await response.json() as TrainingContext
        }).then(next=>{
          if(!active || revision!==calendarRevision.current)return
          if(scrolled){
            const header=isMobile?56:84
            const visible=Array.from(calendarRef.current?.querySelectorAll('[data-calendar-date]') || [])
              .map(element=>({element,bounds:element.getBoundingClientRect()}))
              .filter(({bounds})=>bounds.bottom>header && bounds.top<window.innerHeight)
              .sort((a,b)=>Math.abs(a.bounds.top-header)-Math.abs(b.bounds.top-header))
            const anchor=visible[0]
            if(anchor)viewportAnchor.current={element:anchor.element,top:anchor.bounds.top,scrollY:window.scrollY}
          }
          loadedWeeks.current.add(start)
          setContext(previous=>{
            const history=new Map([...previous.history,...next.history].map(w=>[(w as PlannedWorkout).id,w]))
            const planned=new Map([...previous.planned,...next.planned].map(w=>[w.id,w]))
            const wellness=new Map([...(previous.wellness_history || []),...(next.wellness_history || [])].map(w=>[w.date,w]))
            return {...next,history:[...history.values()],planned:[...planned.values()],wellness_history:[...wellness.values()]}
          })
          if(!scrolled)requestAnimationFrame(()=>{
            const element=isMobile ? calendarRef.current?.querySelector(`[data-calendar-date="${dateKey(new Date())}"]`) : weekRefs.current.get(start)
            if(element && !scrolled)window.scrollTo({top:Math.max(0,window.scrollY+element.getBoundingClientRect().top-(isMobile?56:84)),behavior:'instant'})
          })
        }).catch(error=>{if(active && error.name!=='AbortError')setMoveNotice(`Workouts for ${start} could not load. Scroll back to retry.`)})
          .finally(()=>{pendingWeeks.current.delete(start);busy=false})
      if(active)void pump()
    }
    const loadVisible=()=>{
      if(!scrolled)return
      queue.clear()
      for(const [key,element] of weekRefs.current){
        const bounds=element.getBoundingClientRect()
        if(bounds.bottom>56 && bounds.top<window.innerHeight && !loadedWeeks.current.has(key) && !pendingWeeks.current.has(key))queue.add(key)
      }
      void pump()
    }
    const onScroll=()=>{scrolled=calendarUserScrolled.current;loadVisible()}
    const observer=new IntersectionObserver(loadVisible,{rootMargin:'0px',threshold:0})
    for(const element of weekRefs.current.values())observer.observe(element)
    queue.add(dateKey(startOfMonday(new Date())))
    void pump()
    window.addEventListener('scroll',onScroll,{passive:true})
    return()=>{active=false;controller.abort();observer.disconnect();window.removeEventListener('scroll',onScroll);pendingWeeks.current.clear()}
  },[weekKeys,historyReady])

  useLayoutEffect(() => {
    if (!weeks.length || calendarWasDragged.current || calendarUserScrolled.current) return
    const previousRestoration = history.scrollRestoration
    history.scrollRestoration = "manual"
    const todayWeek = dateKey(startOfMonday(new Date()))
    const target = weeks.some((week) => week.key === todayWeek) ? todayWeek : weeks[weeks.length - 1].key
    const alignToday = () => {
      if (calendarWasDragged.current || calendarUserScrolled.current) return
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
  }, [weekKeys, isMobile])

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
    <div ref={calendarRef} style={{overflowAnchor:'none'}} className="flex w-full min-w-0 flex-1 flex-col">
      <header className="mobile-site-header sticky top-0 z-50 flex h-14 w-full shrink-0 items-center border-b bg-background/95 px-4 shadow-sm backdrop-blur md:shadow-none">
        <h1 className="mobile-header-title min-w-0 truncate text-sm font-semibold">{activeMonth}</h1>
        <div className="flex items-center gap-1 md:ml-4">
          <Button size="sm" className="hidden md:inline-flex" onClick={goToToday}>Today</Button>
        </div>
      <MobileHeaderMenu /></header>
      <div className="sticky top-14 z-40 hidden h-7 shrink-0 border-b bg-background shadow-sm md:flex">
        <div className="grid min-w-0 flex-1 grid-cols-7 divide-x">
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day => <div key={day} className="flex items-center px-2 text-[11px] font-medium uppercase text-muted-foreground">{day}</div>)}
        </div>
        <div className={`hidden shrink-0 items-center justify-end border-l px-1 xl:flex ${summaryOpen ? "w-72" : "w-10"}`}>
          <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => void saveSummary(!summaryOpen)} aria-label={summaryOpen ? "Collapse weekly summary" : "Expand weekly summary"} aria-expanded={summaryOpen}>
            {summaryOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </Button>
        </div>
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
                data-calendar-week={week.key}
                ref={(element) => { if (element) weekRefs.current.set(week.key, element); else weekRefs.current.delete(week.key) }}
                className="h-auto min-h-0 scroll-mt-14 bg-background"
              >
                <div className="flex h-auto min-h-0 w-full flex-col items-stretch xl:flex-row">
                <div className="grid h-auto min-h-48 w-full min-w-0 flex-1 grid-cols-1 items-stretch divide-y md:min-h-60 md:grid-cols-7 md:divide-x md:divide-y-0">
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
                            {loadedWeeks.current.has(week.key) && <DailyMetricsCard date={dateKey(day)} rows={context.wellness_history || []} onOpen={() => setMetricsDate(dateKey(day))} />}
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
                  <Collapsible open={summaryOpen} onOpenChange={(open) => { void saveSummary(open) }}>
                    <CollapsibleContent className="p-3">
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
      <DailyMetricsDialog date={metricsDate} rows={context.wellness_history || []} onClose={() => setMetricsDate(null)} />
    </div>
    <DragOverlay>{dragging ? <div className="max-w-sm cursor-grabbing shadow-xl"><WorkoutCard workout={dragging} onClick={() => {}} /></div> : null}</DragOverlay>
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
      fill: config.color,
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
              wrapperStyle={{ zIndex: 999 }}
              content={<ChartTooltipContent hideLabel formatter={(value, name) => <div className="flex items-center gap-2"><span className="size-2 rounded-full" style={{backgroundColor: disciplineChartConfig[name as keyof typeof disciplineChartConfig]?.color}} /><span>{disciplineChartConfig[name as keyof typeof disciplineChartConfig]?.label || name}</span><span className="ml-2 font-medium tabular-nums">{formatDuration(Number(value))}</span></div>} />}
            />
            <Pie data={chartData} dataKey="minutes" nameKey="discipline" innerRadius={38} outerRadius={64} strokeWidth={2} />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <strong className="text-base tabular-nums">{formatDuration(totalMinutes)}</strong>
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
  const completed = completedMinutes(workout)
  const date = workout.workout_date
    ? new Date(`${workout.workout_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : workout.date

  return (
    <Dialog open={Boolean(workout)} onOpenChange={onOpenChange}>
      <DialogContent className="no-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-5xl">
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

        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Duration" value={workout.status === "completed" && completed ? formatDuration(completed) : formatDuration(durationMinutes(workout))} />
          <StatCard label={workout.status === "completed" ? "Distance" : "Estimated distance"} value={plannedDistanceLabel(workout)} />
        </div>

        <WorkoutPreview workout={workout} large />
        <WorkoutSummary workout={workout} />
        <Suspense fallback={<div className="h-44 animate-pulse rounded-xl bg-muted/30"/>}><WorkoutAnalysis workout={workout}/></Suspense>

        <WorkoutDescription workout={workout}/>
      </DialogContent>
    </Dialog>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return <Card className="gap-1 p-3"><span className="text-xs text-muted-foreground">{label}</span><strong className="text-sm">{value}</strong></Card>
}
