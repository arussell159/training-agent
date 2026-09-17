import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { CalendarDays, CalendarIcon, LoaderCircle, Pencil, Plus, Settings, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { apiFetch } from "@/lib/api-client"
import {
  PLAN_PHASES,
  PHASE_COLORS,
  calendarActuals,
  dateLabel,
  phaseLabel,
  recentAverages,
  type AnnualPlan,
  type AnnualPlanWeek,
  type PlanEvent,
  type PlanPhase,
  type WeekActuals,
} from "@/lib/annual-plan"
import {
  cachedTrainingContext,
  loadTrainingContext,
  rememberTrainingContext,
  type PlannedWorkout,
  type TrainingHistoryItem,
  type TrainingContext,
} from "@/lib/training-context"
import { RaceMarkerIcon } from "@/components/race-events"
import { Section11Report } from "@/components/section11-report"
import { planReportBlocks } from "../../../app-backend/lib/report-blocks.mjs"

type PlanSettings = {
  id?: string
  name: string
  startDate: string
  endDate: string
  baseline: number | null
  recoveryCycle: 3 | 4
  events: PlanEvent[]
  createdAt?: string
  revision?: number
  revisionHistory?: AnnualPlan["revisionHistory"]
  isDraft?: boolean
}

function monday(value: Date) {
  const next = new Date(value)
  next.setHours(12, 0, 0, 0)
  next.setDate(next.getDate() - ((next.getDay() + 6) % 7))
  return next
}

function shifted(value: Date, days: number) {
  return new Date(value.getTime() + days * 86_400_000)
}

function iso(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

function defaultSettings(context: TrainingContext): PlanSettings {
  const current = monday(new Date())
  const start = shifted(current, -26 * 7)
  const end = shifted(current, 26 * 7 + 6)
  return {
    name: "Training Plan",
    startDate: iso(start),
    endDate: iso(end),
    baseline: recentAverages(context).hours,
    recoveryCycle: 4,
    events: [],
  }
}

function settingsFromPlan(plan: AnnualPlan): PlanSettings {
  return {
    id: plan.id,
    name: plan.name,
    startDate: plan.startDate,
    endDate: plan.endDate,
    baseline: plan.baseline,
    recoveryCycle: plan.recoveryCycle,
    events: structuredClone(plan.events),
    createdAt: plan.createdAt,
    revision: plan.revision,
    revisionHistory: plan.revisionHistory,
    isDraft: plan.isDraft,
  }
}

function weekRangeLabel(start: string, end: string) {
  const first = new Date(`${start}T12:00:00Z`)
  const last = new Date(`${end}T12:00:00Z`)
  if (first.getUTCMonth() === last.getUTCMonth()) return `${first.getUTCDate()} - ${last.getUTCDate()}`
  return `${first.getUTCDate()} - ${dateLabel(end, { month: "short", day: "numeric" })}`
}

function clockHours(value: number | null) {
  if (value == null || !Number.isFinite(value)) return ""
  const seconds = Math.round(value * 3600)
  return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

function parseHours(value: string): number | null | undefined {
  const cleaned = value.trim().replace(/\s*h(?:ours?)?$/i, "")
  if (!cleaned) return null
  if (cleaned.includes(":")) {
    const parts = cleaned.split(":").map(Number)
    if (parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return undefined
    return (parts[0] || 0) + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600
  }
  const hours = Number(cleaned)
  return Number.isFinite(hours) && hours >= 0 ? hours : undefined
}

function PlanDialog({ open, onOpenChange, initial, busy, submitError, onSubmit }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: PlanSettings
  busy: boolean
  submitError: string | null
  onSubmit: (settings: PlanSettings) => void
}) {
  const [settings, setSettings] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setSettings(structuredClone(initial))
      setError(null)
    }
  }, [initial, open])
  const submit = () => {
    if (!settings.name.trim()) return setError("Enter a plan name.")
    if (!settings.startDate || !settings.endDate || settings.endDate < settings.startDate) return setError("Choose a valid date range.")
    setError(null)
    onSubmit({ ...settings, name: settings.name.trim() })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{settings.id ? "Plan settings" : "Create training plan"}</DialogTitle>
          <DialogDescription>Choose the dates shown in the rolling plan. Periodization is automatic and can still be adjusted week by week.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="plan-name">Plan name</Label><Input id="plan-name" value={settings.name} onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="plan-start">Start date</Label><Input id="plan-start" type="date" value={settings.startDate} onChange={(event) => setSettings((current) => ({ ...current, startDate: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="plan-end">End date</Label><Input id="plan-end" type="date" value={settings.endDate} onChange={(event) => setSettings((current) => ({ ...current, endDate: event.target.value }))} /></div>
          </div>
          {(error || submitError) && <p role="alert" className="text-sm text-destructive">{error || submitError}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}{settings.id ? "Update dates" : "Create plan"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RaceDialog({ week, event, open, busy, onOpenChange, onSubmit, onDelete }: {
  week: AnnualPlanWeek | null
  event?: PlanEvent
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (value: { name: string; date: string; priority: "A" | "B" | "C" }) => void
  onDelete: () => void
}) {
  const [name, setName] = useState("")
  const [date, setDate] = useState("")
  const [priority, setPriority] = useState<"A" | "B" | "C">("A")
  useEffect(() => {
    if (open) {
      setName(event?.name || "")
      setDate(event?.date || week?.startDate || iso(new Date()))
      setPriority(event?.priority || "A")
    }
  }, [event, open, week])
  const selectedDate = date ? new Date(`${date}T12:00:00`) : undefined
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{event ? "Edit race event" : "Add race event"}</DialogTitle><DialogDescription>{event ? "Changes are saved to Intervals.icu, the annual plan and your calendar." : "This creates a race in Intervals.icu and adds it to your app calendar."}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="race-name">Race name</Label><Input id="race-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Race name" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="race-priority">Category</Label><Select value={priority} onValueChange={(value) => setPriority(value as "A" | "B" | "C")}><SelectTrigger id="race-priority" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["A", "B", "C"].map((value) => <SelectItem key={value} value={value}>Race {value}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Date</Label><Popover><PopoverTrigger render={<Button type="button" variant="outline" className="w-full justify-start font-normal" />}><CalendarIcon />{date ? dateLabel(date, { month: "short", day: "numeric", year: "numeric" }) : "Choose date"}</PopoverTrigger><PopoverContent className="w-auto p-0" align="end"><Calendar mode="single" selected={selectedDate} defaultMonth={selectedDate} onSelect={(value) => { if (value) setDate(iso(value)) }} /></PopoverContent></Popover></div>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">{event ? <Button variant="destructive" disabled={busy} onClick={onDelete}><Trash2 />Delete race</Button> : <span />}<div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={busy || !name.trim() || !date} onClick={() => onSubmit({ name: name.trim(), date, priority })}>{busy && <LoaderCircle className="animate-spin" />}{event ? "Save changes" : "Add race"}</Button></div></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SeasonChart({ plan, actuals, selectedWeek, onSelect }: {
  plan: AnnualPlan
  actuals: Map<string, WeekActuals>
  selectedWeek: string | null
  onSelect: (id: string) => void
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const monthWidth = 96
  const monthKeys = useMemo(() => {
    const first = new Date(`${plan.startDate.slice(0, 7)}-01T12:00:00Z`)
    const last = new Date(`${plan.endDate.slice(0, 7)}-01T12:00:00Z`)
    const result: string[] = []
    for (const cursor = new Date(first); cursor <= last; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
      result.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`)
    }
    return result
  }, [plan.endDate, plan.startDate])
  const chartWidth = Math.max(960, viewportWidth, monthKeys.length * monthWidth)
  const equalMonthWidth = chartWidth / monthKeys.length
  const daysInMonth = (key: string) => {
    const [year, month] = key.split("-").map(Number)
    return new Date(Date.UTC(year, month, 0)).getUTCDate()
  }
  const nextDay = (value: string) => {
    const next = new Date(`${value}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    return next.toISOString().slice(0, 10)
  }
  const boundaryX = (value: string) => {
    const parsed = new Date(`${value}T12:00:00Z`)
    const key = value.slice(0, 7)
    const monthIndex = monthKeys.indexOf(key)
    if (monthIndex < 0) return value < plan.startDate ? 0 : chartWidth
    return (monthIndex + (parsed.getUTCDate() - 1) / daysInMonth(key)) * equalMonthWidth
  }
  const dateCenterX = (value: string) => boundaryX(value) + equalMonthWidth / daysInMonth(value.slice(0, 7)) / 2
  const values = plan.weeks.flatMap((week) => {
    const completed = actuals.get(week.id)?.completedHours
    return [week.targetHours, completed].filter((value): value is number => value != null && Number.isFinite(value))
  })
  const max = Math.max(1, ...values) * 1.1
  const today = iso(new Date())
  const currentWeek = plan.weeks.find((week) => today >= week.startDate && today <= week.endDate)
  const groups = plan.weeks.reduce<Array<{ phase: PlanPhase; startDate: string; endDate: string }>>((result, week) => {
    const previous = result.at(-1)
    if (previous?.phase === week.phase) previous.endDate = week.endDate
    else result.push({ phase: week.phase, startDate: week.startDate, endDate: week.endDate })
    return result
  }, [])

  useEffect(() => {
    const element = scrollerRef.current
    if (!element) return
    const updateWidth = () => setViewportWidth(element.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = scrollerRef.current
    if (!element || !currentWeek) return
    const currentX = dateCenterX(today)
    requestAnimationFrame(() => { element.scrollLeft = Math.max(0, currentX - element.clientWidth / 2) })
  }, [chartWidth, currentWeek, plan.id, plan.startDate, plan.endDate, today])

  return (
    <TooltipProvider>
      <div ref={scrollerRef} className="w-full overflow-x-auto overflow-y-hidden" aria-label="Planned and completed training hours">
        <div style={{ width: chartWidth }}>
          <div className="relative h-7 border-b border-r text-[10px] text-muted-foreground">
            {monthKeys.map((key, index) => <div key={key} className={`absolute inset-y-0 border-l border-border ${index % 2 ? "bg-muted/45" : "bg-background"}`} style={{ left: index * equalMonthWidth, width: equalMonthWidth }}><span className="block px-1.5 pt-1.5">{dateLabel(`${key}-01`, { month: "long" })}</span></div>)}
          </div>
          <div className="relative h-48 border-b border-r bg-background">
            {monthKeys.map((key, index) => <span key={key} aria-hidden className={`absolute inset-y-0 border-l border-border ${index % 2 ? "bg-muted/45" : "bg-background"}`} style={{ left: index * equalMonthWidth, width: equalMonthWidth }} />)}
            {plan.weeks.map((week) => {
              const completed = actuals.get(week.id)?.completedHours ?? null
              const events = plan.events.filter((event) => event.date >= week.startDate && event.date <= week.endDate)
              const weekLeft = boundaryX(week.startDate)
              const weekRight = boundaryX(nextDay(week.endDate))
              return (
                <Tooltip key={week.id}>
                  <TooltipTrigger render={<button type="button" />} onClick={() => onSelect(week.id)} style={{ left: weekLeft, width: Math.max(2, weekRight - weekLeft) }} className={`group absolute inset-y-0 z-10 outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary ${selectedWeek === week.id ? "ring-2 ring-inset ring-primary" : ""}`} aria-label={`${dateLabel(week.startDate)} planned ${clockHours(week.targetHours) || "not set"}, completed ${clockHours(completed) || "not recorded"}`}>
                    {(week.targetHours ?? 0) > 0 && <span className="absolute bottom-0 left-px bg-slate-300 transition-colors group-hover:bg-slate-400 dark:bg-slate-600" style={{ width: "calc(100% - 2px)", height: `${week.targetHours! / max * 100}%` }} />}
                    {(completed ?? 0) > 0 && <span className="absolute bottom-0 left-px z-20" style={{ width: "calc(100% - 2px)", height: `${completed! / max * 100}%`, backgroundColor:PHASE_COLORS[week.phase] }} />}
                    {events.map((event, eventIndex) => <span key={event.id} className="absolute z-30" style={{ top: 4 + eventIndex * 20, left: dateCenterX(event.date) - weekLeft - 10 }}><RaceMarkerIcon priority={event.priority} /></span>)}
                  </TooltipTrigger>
                  <TooltipContent className="space-y-1"><p className="font-semibold">{dateLabel(week.startDate)}–{dateLabel(week.endDate)}</p><p>{phaseLabel(week)}</p><p>Planned: {clockHours(week.targetHours) || "—"}</p><p>Completed: {clockHours(completed) || "—"}</p>{events.map((event) => <p key={event.id}>{event.priority} · {event.name}</p>)}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
          <div className="relative h-20 bg-background">
            {groups.map((group) => {
              const left = boundaryX(group.startDate)
              const right = boundaryX(nextDay(group.endDate))
              return <div key={`${group.phase}-${group.startDate}`} className="absolute inset-y-0" style={{ left, width: Math.max(2, right - left) }} title={group.phase}><span className="absolute inset-x-px top-0 h-1" style={{ backgroundColor: PHASE_COLORS[group.phase] }} /><span className="absolute right-1/2 top-2 flex w-16 justify-end whitespace-nowrap text-right text-[9px] leading-none text-muted-foreground" style={{ transform: "rotate(-45deg)", transformOrigin: "right top" }}>{group.phase}</span></div>
            })}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

function InlineHours({ value, inputRef, onCommit, onNext, onTab }: {
  value: number | null
  inputRef: (element: HTMLInputElement | null) => void
  onCommit: (value: number | null) => void
  onNext: () => void
  onTab: (backward: boolean) => boolean
}) {
  const [text, setText] = useState(() => clockHours(value))
  useEffect(() => setText(clockHours(value)), [value])
  const commit = () => {
    const parsed = parseHours(text)
    if (parsed === undefined) return setText(clockHours(value))
    setText(clockHours(parsed))
    if (parsed !== value) onCommit(parsed)
  }
  return <Input ref={inputRef} aria-label="Planned hours" value={text} placeholder="0:00:00" className="h-8 rounded-none border-0 bg-transparent px-2 text-sm tabular-nums shadow-none focus-visible:ring-inset" onChange={(event) => setText(event.target.value)} onFocus={(event) => event.currentTarget.select()} onBlur={commit} onKeyDown={(event) => { if(event.key==="Tab"&&onTab(event.shiftKey)){event.preventDefault();return}if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); requestAnimationFrame(onNext) } }} />
}

function InlineNotes({ value, inputRef, onCommit, onNext, onTab }: {
  value: string
  inputRef: (element: HTMLInputElement | null) => void
  onCommit: (value: string) => void
  onNext: () => void
  onTab: (backward: boolean) => boolean
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return <Input ref={inputRef} aria-label="Week notes" value={text} placeholder="Add notes" className="h-8 rounded-none border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-inset" onChange={(event) => setText(event.target.value)} onBlur={() => { if (text !== value) onCommit(text) }} onKeyDown={(event) => { if(event.key==="Tab"&&onTab(event.shiftKey)){event.preventDefault();return}if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); requestAnimationFrame(onNext) } }} />
}

export function AnnualPlanCreator() {
  const [context, setContext] = useState<TrainingContext>(() => cachedTrainingContext())
  const [plans, setPlans] = useState<AnnualPlan[]>([])
  const [plan, setPlan] = useState<AnnualPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [planDialogOpen, setPlanDialogOpen] = useState(false)
  const [planSubmitError, setPlanSubmitError] = useState<string | null>(null)
  const [planDialogInitial, setPlanDialogInitial] = useState<PlanSettings>(() => defaultSettings(context))
  const [raceEditor, setRaceEditor] = useState<{ week: AnnualPlanWeek; event?: PlanEvent } | null>(null)
  const [activeWeekId, setActiveWeekId] = useState<string | null>(null)
  const planRef = useRef<AnnualPlan | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const phaseRefs = useRef(new Map<string, HTMLButtonElement>())
  const hoursRefs = useRef(new Map<string, HTMLInputElement>())
  const notesRefs = useRef(new Map<string, HTMLInputElement>())
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const tableScrollerRef = useRef<HTMLElement | null>(null)
  const centeredWeekRef = useRef<string | null>(null)

  const setCurrentPlan = useCallback((next: AnnualPlan | null) => {
    planRef.current = next
    setPlan(next)
    if (next) setPlans((items) => [next, ...items.filter((item) => item.id !== next.id)])
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      loadTrainingContext(false, "full").catch(() => cachedTrainingContext()),
      apiFetch("/api/annual-plans").then(async (response) => {
        if (!response.ok) throw new Error("Unable to load annual plans")
        return response.json() as Promise<{ plans: AnnualPlan[]; activeId?: string | null }>
      }),
    ]).then(([nextContext, result]) => {
      if (!active) return
      setContext(nextContext)
      setPlans(result.plans)
      const first = result.plans.find((item) => item.id === result.activeId) || result.plans[0] || null
      planRef.current = first
      setPlan(first)
      if (!first) {
        setPlanDialogInitial(defaultSettings(nextContext))
        setPlanDialogOpen(true)
      }
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Unable to load the training plan")).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  const actuals = useMemo(() => calendarActuals(context, plan), [context, plan])
  const reportBlocks = useMemo(() => planReportBlocks(plan), [plan])
  const reportToday = new Intl.DateTimeFormat("en-CA", { timeZone: context.athlete.time_zone || "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const today = iso(new Date())
  const currentWeek = plan?.weeks.find(
    (week) => today >= week.startDate && today <= week.endDate
  )

  const centerTableWeek = useCallback(
    (id: string, behavior: ScrollBehavior = "auto") => {
      const scroller = tableScrollerRef.current
      const row = rowRefs.current.get(id)
      if (!scroller || !row) return
      scroller.scrollTo({
        top: Math.max(
          0,
          row.offsetTop - (scroller.clientHeight - row.offsetHeight) / 2
        ),
        behavior,
      })
    },
    []
  )

  useLayoutEffect(() => {
    if (!plan || !currentWeek) return
    const centeringKey = `${plan.id}:${currentWeek.id}`
    if (centeredWeekRef.current === centeringKey) return
    centeredWeekRef.current = centeringKey
    const frame = requestAnimationFrame(() => centerTableWeek(currentWeek.id))
    return () => cancelAnimationFrame(frame)
  }, [centerTableWeek, currentWeek, plan])

  const persistPlan = useCallback((next: AnnualPlan) => {
    planRef.current = next
    setPlan(next)
    setPlans((items) => [next, ...items.filter((item) => item.id !== next.id)])
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      const response = await apiFetch(`/api/annual-plans/${encodeURIComponent(next.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: next }) })
      const result = await response.json() as { plan?: AnnualPlan; error?: string }
      if (!response.ok || !result.plan) throw new Error(result.error || "The plan could not be saved")
      window.dispatchEvent(new Event("annual-plan-updated"))
    }).catch((error) => { toast.error(error instanceof Error ? error.message : "The plan could not be saved") })
  }, [])

  const changeWeek = useCallback((id: string, patch: Partial<AnnualPlanWeek>) => {
    const current = planRef.current
    if (!current) return
    persistPlan({ ...current, weeks: current.weeks.map((week) => week.id === id ? { ...week, ...patch } : week) })
  }, [persistPlan])

  const changePeriod = useCallback((id: string, phase: PlanPhase) => {
    const current = planRef.current
    if (!current) return
    let previous: PlanPhase | null = null
    let phaseWeek = 0
    const weeks = current.weeks.map((week) => {
      const nextPhase = week.id === id ? phase : week.phase
      if (nextPhase !== previous) { previous = nextPhase; phaseWeek = 1 } else phaseWeek += 1
      const numbered = !["Not Set", "Race"].includes(nextPhase)
      return { ...week, phase: nextPhase, phaseWeek: numbered ? phaseWeek : null, ...(week.id === id ? { manual: true } : {}) }
    })
    persistPlan({ ...current, weeks })
  }, [persistPlan])

  const selectWeek = useCallback((id: string) => {
    setActiveWeekId(id)
    requestAnimationFrame(() => centerTableWeek(id, "smooth"))
  }, [centerTableWeek])

  const focusEditableCell = useCallback((rowIndex:number,column:0|1|2) => {
    const week=planRef.current?.weeks[rowIndex]
    if(!week)return false
    const element=column===0?phaseRefs.current.get(week.id):column===1?hoursRefs.current.get(week.id):notesRefs.current.get(week.id)
    if(!element)return false
    element.focus()
    if(element instanceof HTMLInputElement)element.select()
    return true
  },[])

  const tabEditableCell = useCallback((rowIndex:number,column:0|1|2,backward:boolean) => {
    const count=planRef.current?.weeks.length || 0
    const next=rowIndex*3+column+(backward?-1:1)
    if(next<0||next>=count*3)return false
    return focusEditableCell(Math.floor(next/3),(next%3) as 0|1|2)
  },[focusEditableCell])

  const submitPlanSettings = async (settings: PlanSettings) => {
    setBusy(true)
    setPlanSubmitError(null)
    try {
      const response = await apiFetch("/api/annual-plans/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: { ...settings, mode: "automatic", methodology: "hours", background: "", currentFitness: "", availability: {} }, athlete: { fitness: context.metrics.fitness, fatigue: context.metrics.fatigue }, existing: settings.id ? planRef.current : null }) })
      const previewResult = await response.json() as { plan?: AnnualPlan; error?: string }
      if (!response.ok || !previewResult.plan) throw new Error(previewResult.error || "The plan could not be created")
      const saveResponse = await apiFetch("/api/annual-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: previewResult.plan, reason: settings.id ? "Updated plan dates" : "Created training plan" }) })
      const result = await saveResponse.json() as { plan?: AnnualPlan; error?: string }
      if (!saveResponse.ok || !result.plan) throw new Error(result.error || "The plan could not be saved")
      setCurrentPlan(result.plan)
      setPlanDialogOpen(false)
      window.dispatchEvent(new Event("annual-plan-updated"))
    } catch (error) {
      const message = error instanceof Error ? error.message : "The plan could not be saved"
      setPlanSubmitError(message)
      toast.error(message)
    } finally { setBusy(false) }
  }

  const saveRace = async (value: { name: string; date: string; priority: "A" | "B" | "C" }) => {
    const current = planRef.current
    if (!current) return
    setBusy(true)
    try {
      const editing = raceEditor?.event
      const endpoint = editing
        ? `/api/annual-plans/${encodeURIComponent(current.id)}/events/${encodeURIComponent(editing.id)}`
        : `/api/annual-plans/${encodeURIComponent(current.id)}/events`
      const response = await apiFetch(endpoint, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) })
      const result = await response.json() as { plan?: AnnualPlan; workout?: PlannedWorkout; context?: TrainingContext; error?: string }
      if (!response.ok || !result.plan) throw new Error(result.error || "The race could not be created")
      setCurrentPlan(result.plan)
      let nextContext = result.context || context
      if (!result.context && result.workout) {
        const today = iso(new Date())
        const history = context.history.filter((item) => (item as PlannedWorkout).id !== result.workout!.id)
        const planned = context.planned.filter((item) => item.id !== result.workout!.id)
        if ((result.workout.workout_date || "") < today) history.push(result.workout as PlannedWorkout & TrainingHistoryItem)
        else planned.push(result.workout)
        nextContext = { ...context, history, planned }
      }
      setContext(nextContext)
      rememberTrainingContext(nextContext, "full")
      window.dispatchEvent(new CustomEvent("training-context-updated", { detail: nextContext }))
      window.dispatchEvent(new Event("annual-plan-updated"))
      setRaceEditor(null)
      toast.success(`${value.name} ${editing ? "updated" : "added"} in Intervals.icu and the calendar`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `The race could not be ${raceEditor?.event ? "updated" : "created"}`)
    } finally { setBusy(false) }
  }

  const deleteRace = async () => {
    const current = planRef.current
    const event = raceEditor?.event
    if (!current || !event) return
    setBusy(true)
    try {
      const response = await apiFetch(`/api/annual-plans/${encodeURIComponent(current.id)}/events/${encodeURIComponent(event.id)}`, { method: "DELETE" })
      const result = await response.json() as { plan?: AnnualPlan; context?: TrainingContext; error?: string }
      if (!response.ok || !result.plan) throw new Error(result.error || "The race could not be deleted")
      setCurrentPlan(result.plan)
      const nextContext = result.context || { ...context, planned: context.planned.filter((item) => item.id !== event.id), history: context.history.filter((item) => !("id" in item) || item.id !== event.id) }
      setContext(nextContext)
      rememberTrainingContext(nextContext, "full")
      window.dispatchEvent(new CustomEvent("training-context-updated", { detail: nextContext }))
      window.dispatchEvent(new Event("annual-plan-updated"))
      setRaceEditor(null)
      toast.success(`${event.name} deleted`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The race could not be deleted")
    } finally { setBusy(false) }
  }

  if (loading) return <div className="flex h-full w-full items-center justify-center"><LoaderCircle className="size-6 animate-spin text-muted-foreground" /></div>

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        {plans.length > 0 ? <Select value={plan?.id || ""} onValueChange={(id) => { const next = plans.find((item) => item.id === id); if (next) persistPlan(next) }}><SelectTrigger className="h-9 w-auto min-w-52 border-0 bg-transparent px-1 text-base font-semibold shadow-none"><span className="max-w-72 truncate">{plan?.name || "Training plan"}</span></SelectTrigger><SelectContent>{plans.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select> : <h1 className="text-base font-semibold">Training Plan</h1>}
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Create new plan" onClick={() => { setPlanSubmitError(null); setPlanDialogInitial(defaultSettings(context)); setPlanDialogOpen(true) }}><Plus /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Plan settings" disabled={!plan} onClick={() => { if (plan) { setPlanSubmitError(null); setPlanDialogInitial(settingsFromPlan(plan)); setPlanDialogOpen(true) } }}><Settings /></Button>
        {plan && <p className="ml-auto hidden text-xs text-muted-foreground sm:block">{dateLabel(plan.startDate, { month: "short", day: "numeric", year: "numeric" })} – {dateLabel(plan.endDate, { month: "short", day: "numeric", year: "numeric" })}</p>}
      </header>

      {plan ? <>
        <section className="shrink-0 border-b">
          <div className="flex items-center justify-end gap-4 border-b px-4 py-1.5 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><span className="size-2.5 bg-slate-300 dark:bg-slate-600" /> Planned</span><span>Completed · period color</span></div>
          <SeasonChart plan={plan} actuals={actuals} selectedWeek={activeWeekId} onSelect={selectWeek} />
        </section>
        <section ref={tableScrollerRef} className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[980px] border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-slate-100 text-left text-slate-600 shadow-[0_1px_0_rgba(15,23,42,.35)] dark:bg-muted dark:text-muted-foreground"><tr><th className="w-[15%] px-2 py-1.5 font-medium">Week</th><th className="w-[22%] px-2 py-1.5 font-medium">Event</th><th className="w-[15%] px-2 py-1.5 font-medium">Period</th><th className="w-[10%] px-2 py-1.5 font-medium">Hours</th><th className="w-[10%] px-2 py-1.5 font-medium">Completed</th><th className="w-[28%] min-w-96 px-2 py-1.5 font-medium">Details</th></tr></thead>
            <tbody>
              {plan.weeks.map((week, index) => {
                const monthChanged = index === 0 || week.startDate.slice(0, 7) !== plan.weeks[index - 1].startDate.slice(0, 7)
                const events = plan.events.filter((event) => event.date >= week.startDate && event.date <= week.endDate)
                const completed = actuals.get(week.id)?.completedHours ?? null
                const reportBlock = reportBlocks.find(block => block.endDate === week.endDate && block.endDate < reportToday)
                const nextHours = () => { const next = plan.weeks[index + 1]; if (next) { const input = hoursRefs.current.get(next.id); input?.focus(); input?.select() } }
                const nextNotes = () => { const next = plan.weeks[index + 1]; if (next) notesRefs.current.get(next.id)?.focus() }
                return [
                  monthChanged ? <tr key={`${week.id}-month`} className="bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><th colSpan={6} className="px-1 py-1 text-left font-semibold">{dateLabel(week.startDate, { month: "long", year: "numeric" })}</th></tr> : null,
                  <tr key={week.id} aria-current={currentWeek?.id === week.id ? "date" : undefined} ref={(element) => { if (element) rowRefs.current.set(week.id, element); else rowRefs.current.delete(week.id) }} className={`border-b transition-colors ${currentWeek?.id === week.id ? "bg-slate-300/90 font-medium ring-1 ring-inset ring-slate-400/70 hover:bg-slate-300/90 dark:bg-slate-700/90 dark:ring-slate-500/80 dark:hover:bg-slate-700/90" : activeWeekId === week.id ? "bg-primary/5 hover:bg-primary/10" : index % 2 ? "bg-slate-50/60 hover:bg-muted/40 dark:bg-muted/15" : "hover:bg-muted/40"}`}>
                    <td className="px-2 py-1.5 tabular-nums">{weekRangeLabel(week.startDate, week.endDate)}</td>
                    <td className="px-2 py-1"><div className="flex min-w-0 items-center gap-1 overflow-hidden">{events.length ? <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">{events.map((event) => <Button key={event.id} type="button" variant="ghost" size="sm" className="h-7 min-w-0 gap-1 px-1.5" onClick={() => setRaceEditor({ week, event })}><RaceMarkerIcon priority={event.priority} /><span className="truncate">{event.name}</span><Pencil className="size-3" /></Button>)}</div> : <span className="min-w-0 flex-1" />}<Button type="button" variant="ghost" size="icon-sm" className="size-6 shrink-0" aria-label={`Add race during ${dateLabel(week.startDate)}`} onClick={() => setRaceEditor({ week })}><Plus className="size-3.5" /></Button></div></td>
                    <td className="p-0" style={{ backgroundColor: PHASE_COLORS[week.phase] }}><Select value={week.phase} onValueChange={(value)=>changePeriod(week.id,value as PlanPhase)}><SelectTrigger ref={(element)=>{if(element)phaseRefs.current.set(week.id,element);else phaseRefs.current.delete(week.id)}} aria-label={`Period for ${dateLabel(week.startDate)}`} className="h-10 w-full rounded-none border-0 bg-transparent px-2 text-xs font-semibold text-white shadow-none hover:bg-white/10 focus-visible:border-white/80 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 dark:bg-transparent dark:hover:bg-white/10 [&_svg]:text-white" onKeyDown={(event)=>{if(event.key==='Tab'&&tabEditableCell(index,0,event.shiftKey))event.preventDefault()}}><SelectValue>{phaseLabel(week)}</SelectValue></SelectTrigger><SelectContent align="start">{PLAN_PHASES.map((phase)=><SelectItem key={phase} value={phase}>{phase}</SelectItem>)}</SelectContent></Select></td>
                    <td className="p-0"><InlineHours value={week.targetHours} inputRef={(element) => { if (element) hoursRefs.current.set(week.id, element); else hoursRefs.current.delete(week.id) }} onCommit={(value) => changeWeek(week.id, { targetHours: value, manual: true })} onNext={nextHours} onTab={(backward)=>tabEditableCell(index,1,backward)} /></td>
                    <td className="p-0"><span className="flex h-8 items-center px-2 text-sm font-bold tabular-nums">{clockHours(completed) || "—"}</span></td>
                    <td className="p-0"><InlineNotes value={week.notes} inputRef={(element) => { if (element) notesRefs.current.set(week.id, element); else notesRefs.current.delete(week.id) }} onCommit={(notes) => changeWeek(week.id, { notes })} onNext={nextNotes} onTab={(backward)=>tabEditableCell(index,2,backward)} /></td>
                  </tr>,
                  reportBlock ? <tr className="hidden md:table-row" key={`${week.id}-section11-report`}><td colSpan={6} className="border-b bg-muted/20 p-3"><div className="mx-auto max-w-5xl space-y-2"><p className="text-sm font-medium">{reportBlock.phase} · {dateLabel(reportBlock.startDate)} – {dateLabel(reportBlock.endDate)} · Block complete</p><Section11Report target={{ kind: "block", planId: plan.id, startDate: reportBlock.startDate }} /></div></td></tr> : null,
                ]
              })}
            </tbody>
          </table>
        </section>
      </> : <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center"><div className="max-w-sm space-y-3"><CalendarDays className="mx-auto size-8 text-muted-foreground" /><h2 className="text-lg font-semibold">Create your rolling training plan</h2><p className="text-sm text-muted-foreground">Start with the six months around today, then edit hours, periods, races and notes directly in the weekly grid.</p><Button onClick={() => { setPlanSubmitError(null); setPlanDialogInitial(defaultSettings(context)); setPlanDialogOpen(true) }}><Plus />Create plan</Button></div></div>}

      <PlanDialog open={planDialogOpen} onOpenChange={(open) => { setPlanDialogOpen(open); if (!open) setPlanSubmitError(null) }} initial={planDialogInitial} busy={busy} submitError={planSubmitError} onSubmit={(settings) => void submitPlanSettings(settings)} />
      <RaceDialog week={raceEditor?.week || null} event={raceEditor?.event} open={Boolean(raceEditor)} busy={busy} onOpenChange={(open) => { if (!open) setRaceEditor(null) }} onSubmit={(value) => void saveRace(value)} onDelete={() => void deleteRace()} />
    </div>
  )
}
