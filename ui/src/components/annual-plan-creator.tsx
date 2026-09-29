import { SavedReportButton } from "@/components/saved-report-button"
import { planReportBlocks } from "../../../app-backend/lib/report-blocks.mjs"
import { rollingPlanWindow } from "../../../app-backend/lib/rolling-plan-window.mjs"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { CalendarDays, CalendarIcon, ChevronDown, LoaderCircle, Pencil, Plus, Settings, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { SettingsList, SettingsListItem } from "@/components/ui/settings-list"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { MobileSelect, MobileDatePicker } from "@/components/ui/mobile-native-controls"
import { Calendar } from "@/components/ui/calendar"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { apiFetch } from "@/lib/api-client"
import { useIsMobile } from "@/hooks/use-mobile"
import { useSheetDismiss } from "@/hooks/use-sheet-dismiss"
import { Sheet } from "framework7-react"
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

function iso(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

function defaultSettings(context: TrainingContext): PlanSettings {
  const { startDate, endDate } = rollingPlanWindow(iso(new Date()))
  return {
    name: "Training Plan",
    startDate,
    endDate,
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

function hourMinuteLabel(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—"
  const minutes = Math.round(value * 60)
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
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

const mobileFieldClass = "rounded-xl border border-input bg-card px-3 py-1.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
const mobileSubmitClass = "h-11 w-full rounded-full bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 sm:w-auto"

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
    setError(null)
    onSubmit({ ...settings, ...rollingPlanWindow(iso(new Date())), name: settings.name.trim() })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{settings.id ? "Plan settings" : "Create training plan"}</DialogTitle>
          <DialogDescription>The plan shows six months before and after today. Training periods and hours can be adjusted week by week.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className={mobileFieldClass}><Label htmlFor="plan-name" className="block text-[11px] leading-4 text-muted-foreground">Plan name</Label><Input id="plan-name" value={settings.name} onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))} className="h-6 rounded-none border-0 bg-transparent px-0 py-0 text-sm focus-visible:ring-0 dark:bg-transparent" /></div>
          {(error || submitError) && <p role="alert" className="text-sm text-destructive">{error || submitError}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} className="h-11 w-full rounded-full sm:w-auto">Cancel</Button><Button onClick={submit} disabled={busy} className={mobileSubmitClass}>{busy && <LoaderCircle className="animate-spin" />}{settings.id ? "Save plan" : "Create plan"}</Button></DialogFooter>
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
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader><DialogTitle>{event ? "Edit race event" : "Add race event"}</DialogTitle><DialogDescription>{event ? "Changes are saved to Intervals.icu, the annual plan and your calendar." : "This creates a race in Intervals.icu and adds it to your app calendar."}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className={mobileFieldClass}><Label htmlFor="race-name" className="block text-[11px] leading-4 text-muted-foreground">Race name</Label><Input id="race-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Race name" className="h-7 rounded-none border-0 bg-transparent px-0 py-0 text-sm focus-visible:ring-0 dark:bg-transparent" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={mobileFieldClass}><Label htmlFor="race-priority" className="block text-[11px] leading-4 text-muted-foreground">Category</Label><MobileSelect id="race-priority" className="h-7 w-full rounded-none border-0 bg-transparent px-0 text-sm focus-visible:ring-0" value={priority} onValueChange={(value) => setPriority(value as "A" | "B" | "C")} options={["A", "B", "C"].map((value) => ({ value, label: `Race ${value}` }))}><Select value={priority} onValueChange={(value) => setPriority(value as "A" | "B" | "C")}><SelectTrigger id="race-priority" className="h-7 w-full rounded-none border-0 bg-transparent px-0 text-sm shadow-none"><SelectValue /></SelectTrigger><SelectContent>{["A", "B", "C"].map((value) => <SelectItem key={value} value={value}>Race {value}</SelectItem>)}</SelectContent></Select></MobileSelect></div>
            <div className={mobileFieldClass}><Label htmlFor="race-date" className="block text-[11px] leading-4 text-muted-foreground">Date</Label><MobileDatePicker id="race-date" aria-label="Race date" className="h-7 w-full rounded-none border-0 bg-transparent px-0 text-sm focus-visible:ring-0" value={date} onValueChange={setDate}><Popover><PopoverTrigger render={<Button id="race-date" type="button" variant="ghost" className="h-7 w-full justify-start rounded-none px-0 text-sm font-normal" />}><CalendarIcon />{date ? dateLabel(date, { month: "short", day: "numeric", year: "numeric" }) : "Choose date"}</PopoverTrigger><PopoverContent className="w-auto p-0" align="end"><Calendar mode="single" selected={selectedDate} defaultMonth={selectedDate} onSelect={(value) => { if (value) setDate(iso(value)) }} /></PopoverContent></Popover></MobileDatePicker></div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">{event ? <Button variant="destructive" disabled={busy} onClick={onDelete} className="h-11 rounded-full"><Trash2 />Delete race</Button> : <span />}<div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row"><Button variant="outline" onClick={() => onOpenChange(false)} className="h-11 w-full rounded-full sm:w-auto">Cancel</Button><Button disabled={busy || !name.trim() || !date} onClick={() => onSubmit({ name: name.trim(), date, priority })} className={mobileSubmitClass}>{busy && <LoaderCircle className="animate-spin" />}{event ? "Save changes" : "Add race"}</Button></div></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SeasonChart({ plan, actuals, selectedWeek, onSelect, glassBackground = false }: {
  plan: AnnualPlan
  actuals: Map<string, WeekActuals>
  selectedWeek: string | null
  onSelect: (id: string) => void
  glassBackground?: boolean
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [chartLoaded, setChartLoaded] = useState(false)
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
    const currentLeft = boundaryX(currentWeek.startDate)
    const currentRight = boundaryX(nextDay(currentWeek.endDate))
    const currentX = (currentLeft + currentRight) / 2
    requestAnimationFrame(() => { element.scrollLeft = Math.max(0, currentX - element.clientWidth / 2) })
  }, [chartWidth, currentWeek, plan.id, plan.startDate, plan.endDate, today])

  useEffect(() => {
    setChartLoaded(false)
    const frame = requestAnimationFrame(() => setChartLoaded(true))
    return () => cancelAnimationFrame(frame)
  }, [plan.id])

  return (
    <TooltipProvider>
      <div ref={scrollerRef} className={`w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${glassBackground ? "rounded-b-[var(--calendar-picker-radius)]" : ""}`} aria-label="Planned and completed training hours">
        <div style={{ width: chartWidth }}>
          <div className="relative h-7 border-b border-r text-[10px] text-muted-foreground">
            {monthKeys.map((key, index) => <div key={key} className={`absolute inset-y-0 border-l border-border ${glassBackground ? (index % 2 ? "bg-white/5 dark:bg-white/5" : "bg-transparent") : index % 2 ? "bg-muted/45" : "bg-background"}`} style={{ left: index * equalMonthWidth, width: equalMonthWidth }}><span className="block px-1.5 pt-1.5">{dateLabel(`${key}-01`, { month: "long" })}</span></div>)}
          </div>
          <div className={`relative h-28 border-b border-r md:h-48 ${glassBackground ? "overflow-hidden rounded-b-[var(--calendar-picker-radius)] bg-transparent" : "bg-background"}`}>
            {monthKeys.map((key, index) => <span key={key} aria-hidden className={`absolute inset-y-0 border-l border-border ${glassBackground ? (index % 2 ? "bg-white/5 dark:bg-white/5" : "bg-transparent") : index % 2 ? "bg-muted/45" : "bg-background"}`} style={{ left: index * equalMonthWidth, width: equalMonthWidth }} />)}
            {plan.weeks.map((week, index) => {
              const completed = actuals.get(week.id)?.completedHours ?? null
              const events = plan.events.filter((event) => event.date >= week.startDate && event.date <= week.endDate)
              const weekLeft = boundaryX(week.startDate)
              const weekRight = boundaryX(nextDay(week.endDate))
              return (
                <Tooltip key={week.id}>
                  <TooltipTrigger render={<button type="button" />} onClick={() => onSelect(week.id)} style={{ left: weekLeft, width: Math.max(2, weekRight - weekLeft) }} className={`group absolute inset-y-0 z-10 outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary ${currentWeek?.id === week.id ? "bg-foreground/5" : ""} ${selectedWeek === week.id && currentWeek?.id !== week.id ? "ring-2 ring-inset ring-primary" : ""}`} aria-label={`${dateLabel(week.startDate)} planned ${clockHours(week.targetHours) || "not set"}, completed ${clockHours(completed) || "not recorded"}`}>
                    {(week.targetHours ?? 0) > 0 && <span className={`absolute bottom-0 left-px transition-[height,opacity] duration-700 ease-out motion-reduce:transition-none ${currentWeek?.id === week.id ? "bg-slate-400 dark:bg-slate-500" : "bg-slate-300 group-hover:bg-slate-400 dark:bg-slate-600"}`} style={{ width: "calc(100% - 2px)", height: `${chartLoaded ? week.targetHours! / max * 100 : 0}%`, opacity: chartLoaded ? 1 : 0, transitionDelay: `${Math.min(index, 24) * 14}ms` }} />}
                    {(completed ?? 0) > 0 && <span className="absolute bottom-0 left-px z-20 transition-[height,opacity] duration-700 ease-out motion-reduce:transition-none" style={{ width: "calc(100% - 2px)", height: `${chartLoaded ? completed! / max * 100 : 0}%`, opacity: chartLoaded ? 1 : 0, backgroundColor:PHASE_COLORS[week.phase], transitionDelay: `${Math.min(index, 24) * 14 + 90}ms` }} />}
                    {events.map((event, eventIndex) => <span key={event.id} className="absolute z-30" style={{ top: 4 + eventIndex * 20, left: dateCenterX(event.date) - weekLeft - 10 }}><RaceMarkerIcon priority={event.priority} /></span>)}
                  </TooltipTrigger>
                  <TooltipContent className="hidden space-y-1 md:block"><p className="font-semibold">{dateLabel(week.startDate)}–{dateLabel(week.endDate)}</p><p>{phaseLabel(week)}</p><p>Planned: {clockHours(week.targetHours) || "—"}</p><p>Completed: {clockHours(completed) || "—"}</p>{events.map((event) => <p key={event.id}>{event.priority} · {event.name}</p>)}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
          <div className="relative hidden h-20 bg-background md:block">
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

function MobileWeekNotes({ id, value, onCommit }: { id: string; value: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return <textarea id={id} value={text} onChange={(event) => setText(event.target.value)} onBlur={() => { if (text !== value) onCommit(text) }} placeholder="Add notes for this week" rows={3} className="min-h-20 w-full resize-y bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground" />
}

function MobileWeekHours({ id, value, onCommit }: { id: string; value: number | null; onCommit: (value: number | null) => void }) {
  const [text, setText] = useState(() => clockHours(value))
  useEffect(() => setText(clockHours(value)), [value])
  const commit = () => {
    const parsed = parseHours(text)
    if (parsed === undefined) { setText(clockHours(value)); return }
    setText(clockHours(parsed))
    if (parsed !== value) onCommit(parsed)
  }
  return <Input id={id} inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }} placeholder="0:00:00" className="h-7 rounded-none border-0 bg-transparent px-0 py-0 text-sm tabular-nums focus-visible:ring-0 dark:bg-transparent" />
}

function MobileWeekCard({ week, weekNumber, current, onOpen }: {
  week: AnnualPlanWeek
  weekNumber: number
  current: boolean
  onOpen: (trigger: HTMLButtonElement) => void
}) {
  return <SettingsListItem
    icon={CalendarDays}
    label={week.phase === "Race" ? "Race week" : `Week ${week.phaseWeek ?? weekNumber}${week.recovery ? " · Recovery" : ""}`}
    description={`${dateLabel(week.startDate, { month: "short", day: "numeric" })} – ${dateLabel(week.endDate, { month: "short", day: "numeric", year: "numeric" })}`}
    value={<span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="font-medium tabular-nums text-foreground">{hourMinuteLabel(week.targetHours)}</span>{current && <span>This week</span>}</span>}
    className={current ? "bg-muted text-foreground hover:bg-muted hover:text-foreground dark:bg-muted/50 dark:hover:bg-muted/50 [&>span>span:first-child]:font-semibold" : undefined}
    onClick={(event) => onOpen(event.currentTarget)}
  />
}

function MobileWeekDetails({ week, completed, events, reportStartDate, onPhaseChange, onHoursChange, onNotesChange, onRace }: {
  week: AnnualPlanWeek
  completed: number | null
  events: PlanEvent[]
  reportStartDate: string | null
  onPhaseChange: (phase: PlanPhase) => void
  onHoursChange: (hours: number | null) => void
  onNotesChange: (notes: string) => void
  onRace: (event?: PlanEvent) => void
}) {
  return <div className="space-y-3 px-1 py-2">
      <div className="text-xs tabular-nums text-muted-foreground">Planned {clockHours(week.targetHours) || "—"} <span aria-hidden="true">·</span> Completed {clockHours(completed) || "—"}</div>
      {events.length > 0 && <p className="text-xs font-medium">{events.map(event => `${event.priority} · ${event.name}`).join(" · ")}</p>}
      <div className={mobileFieldClass}>
        <Label htmlFor={`atp-phase-${week.id}`} className="block text-[11px] leading-4 text-muted-foreground">Training period</Label>
        <div className="relative"><select id={`atp-phase-${week.id}`} value={week.phase} onChange={(event) => onPhaseChange(event.target.value as PlanPhase)} className="h-7 w-full appearance-none border-0 bg-transparent pr-6 text-sm outline-none">{PLAN_PHASES.map(phase => <option key={phase} value={phase}>{phase}</option>)}</select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-0 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className={mobileFieldClass}><Label htmlFor={`atp-hours-${week.id}`} className="block text-[11px] leading-4 text-muted-foreground">Planned hours</Label><MobileWeekHours id={`atp-hours-${week.id}`} value={week.targetHours} onCommit={onHoursChange} /></div>
        <div className={mobileFieldClass}><span className="block text-[11px] leading-4 text-muted-foreground">Completed hours</span><span className="flex h-7 items-center text-sm tabular-nums">{clockHours(completed) || "—"}</span></div>
      </div>
      <div className={mobileFieldClass}><Label htmlFor={`atp-notes-${week.id}`} className="block text-[11px] leading-4 text-muted-foreground">Week notes</Label><MobileWeekNotes id={`atp-notes-${week.id}`} value={week.notes} onCommit={onNotesChange} /></div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Race events</p>
        {events.map(event => <button key={event.id} type="button" onClick={() => onRace(event)} className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-input px-3 text-left text-sm"><RaceMarkerIcon priority={event.priority} /><span className="min-w-0 flex-1 truncate">{event.name}</span><Pencil aria-hidden="true" className="size-3.5 text-muted-foreground" /></button>)}
        <Button type="button" variant="outline" onClick={() => onRace()} className="h-10 w-full rounded-full"><Plus className="size-4" />Add race</Button>
      </div>
      {reportStartDate && <div className="flex justify-end"><SavedReportButton kind="block" startDate={reportStartDate} /></div>}
  </div>
}

function groupPlanWeeks(weeks: AnnualPlanWeek[]) {
  const blocks: { key: string; phase: PlanPhase; weeks: AnnualPlanWeek[] }[] = []
  for (const week of weeks) {
    const last = blocks.at(-1)
    if (last?.phase === week.phase) {
      last.weeks.push(week)
    } else {
      blocks.push({ key: `${week.id}:${week.phase}`, phase: week.phase, weeks: [week] })
    }
  }
  return blocks
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
  const isMobile = useIsMobile()
  const [context, setContext] = useState<TrainingContext>(() => cachedTrainingContext())
  const [plans, setPlans] = useState<AnnualPlan[]>([])
  const [plan, setPlan] = useState<AnnualPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [mobileChartOpen, setMobileChartOpen] = useState(false)
  const [planDialogOpen, setPlanDialogOpen] = useState(false)
  const [planSubmitError, setPlanSubmitError] = useState<string | null>(null)
  const [planDialogInitial, setPlanDialogInitial] = useState<PlanSettings>(() => defaultSettings(context))
  const [raceEditor, setRaceEditor] = useState<{ week: AnnualPlanWeek; event?: PlanEvent } | null>(null)
  const [activeWeekId, setActiveWeekId] = useState<string | null>(null)
  const [mobileWeekDialogId, setMobileWeekDialogId] = useState<string | null>(null)
  const [weekSheetExpanded, setWeekSheetExpanded] = useState(false)
  const weekSheetHistory = useRef(false)
  const weekSheetTrigger = useRef<HTMLElement | null>(null)
  const planRef = useRef<AnnualPlan | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const phaseRefs = useRef(new Map<string, HTMLButtonElement | HTMLSelectElement>())
  const hoursRefs = useRef(new Map<string, HTMLInputElement>())
  const notesRefs = useRef(new Map<string, HTMLInputElement>())
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const tableScrollerRef = useRef<HTMLElement | null>(null)
  const mobileWeekRefs = useRef(new Map<string, HTMLElement>())
  const mobileScrollerRef = useRef<HTMLElement | null>(null)
  const centeredWeekRef = useRef<string | null>(null)
  useEffect(() => {
    const update = () => setContext(cachedTrainingContext())
    window.addEventListener('training-context-updated', update)
    return () => window.removeEventListener('training-context-updated', update)
  }, [])

  const setCurrentPlan = useCallback((next: AnnualPlan | null) => {
    planRef.current = next
    setPlan(next)
    setActiveWeekId(null)
    setMobileWeekDialogId(null)
    centeredWeekRef.current = null
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

  const reportBlocks = useMemo(() => planReportBlocks(plan), [plan])
  const actuals = useMemo(() => calendarActuals(context, plan), [context, plan])
  const mobileBlocks = useMemo(() => groupPlanWeeks(plan?.weeks || []), [plan])
  const today = iso(new Date())
  const currentWeek = plan?.weeks.find(
    (week) => today >= week.startDate && today <= week.endDate
  )
  const mobileWeekDialog = plan?.weeks.find((week) => week.id === mobileWeekDialogId) || null
  const mobileWeekDialogBlock = mobileWeekDialog
    ? mobileBlocks.find((block) => block.weeks.some((week) => week.id === mobileWeekDialog.id))
    : null
  const mobileWeekDialogNumber = mobileWeekDialogBlock?.weeks.findIndex((week) => week.id === mobileWeekDialog?.id) ?? 0
  const mobileWeekDialogEvents = mobileWeekDialog
    ? plan?.events.filter((event) => event.date >= mobileWeekDialog.startDate && event.date <= mobileWeekDialog.endDate) || []
    : []
  const mobileWeekDialogReport = mobileWeekDialog
    ? reportBlocks.find((item) => item.endDate === mobileWeekDialog.endDate)
    : null

  const centerTableWeek = useCallback(
    (id: string, behavior: ScrollBehavior = "auto") => {
      if (window.matchMedia("(max-width: 767px)").matches) {
        const scroller = mobileScrollerRef.current
        const card = mobileWeekRefs.current.get(id)
        if (!scroller || !card) return
        const scrollerTop = scroller.getBoundingClientRect().top
        const cardTop = card.getBoundingClientRect().top
        scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + cardTop - scrollerTop - 120), behavior })
        return
      }
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

  useEffect(() => {
    const returnToCurrentWeek = () => {
      if (!currentWeek || !plan) return
      const centeringKey = `${isMobile ? "mobile" : "desktop"}:${plan.id}:${currentWeek.id}`
      centeredWeekRef.current = centeringKey
      setActiveWeekId(currentWeek.id)
      setMobileChartOpen(false)
      const scroll = () => centerTableWeek(currentWeek.id, "instant")
      scroll()
      requestAnimationFrame(() => requestAnimationFrame(scroll))
    }
    window.addEventListener("annual-plan-go-current-week", returnToCurrentWeek)
    return () => window.removeEventListener("annual-plan-go-current-week", returnToCurrentWeek)
  }, [centerTableWeek, currentWeek, isMobile, plan])

  useLayoutEffect(() => {
    if (!plan) return
    const weekId = activeWeekId || currentWeek?.id
    if (!weekId) return
    const centeringKey = `${isMobile ? "mobile" : "desktop"}:${plan.id}:${weekId}`
    if (centeredWeekRef.current === centeringKey) return
    centeredWeekRef.current = centeringKey
    const frame = requestAnimationFrame(() => centerTableWeek(weekId, activeWeekId ? "smooth" : "auto"))
    return () => cancelAnimationFrame(frame)
  }, [activeWeekId, centerTableWeek, currentWeek, isMobile, plan])

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
    centeredWeekRef.current = null
  }, [])

  const closeWeekSheet = useCallback(() => {
    setWeekSheetExpanded(false)
    if (weekSheetHistory.current) {
      weekSheetHistory.current = false
      setMobileWeekDialogId(null)
      window.history.back()
    } else setMobileWeekDialogId(null)
  }, [])
  const expandWeekSheet = useCallback(() => setWeekSheetExpanded(true), [])
  useSheetDismiss("annual-plan-week-layer", Boolean(mobileWeekDialogId), closeWeekSheet, {
    expanded: weekSheetExpanded,
    onExpand: expandWeekSheet,
  })
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      if (!weekSheetHistory.current) return
      event.stopImmediatePropagation()
      weekSheetHistory.current = false
      setWeekSheetExpanded(false)
      setMobileWeekDialogId(null)
    }
    window.addEventListener("popstate", pop, true)
    return () => window.removeEventListener("popstate", pop, true)
  }, [])

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

  const planSelector = plans.length > 0 ? <MobileSelect aria-label="Training plan" className="max-w-64 border-0 bg-transparent px-1 font-semibold" value={plan?.id || ""} onValueChange={(id) => { const next = plans.find((item) => item.id === id); if (next) persistPlan(next) }} options={plans.map((item) => ({ value: item.id, label: item.name }))}><Select value={plan?.id || ""} onValueChange={(id) => { const next = plans.find((item) => item.id === id); if (next) persistPlan(next) }}><SelectTrigger className="h-9 w-auto min-w-52 border-0 bg-transparent px-1 text-base font-semibold shadow-none"><span className="max-w-72 truncate">{plan?.name || "Training plan"}</span></SelectTrigger><SelectContent>{plans.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></MobileSelect> : "Training Plan"
  const createPlan = () => { setPlanSubmitError(null); setPlanDialogInitial(defaultSettings(context)); setPlanDialogOpen(true) }
  const editPlan = () => { if (plan) { setPlanSubmitError(null); setPlanDialogInitial(settingsFromPlan(plan)); setPlanDialogOpen(true) } }

  if (loading) return <div className="flex h-full w-full items-center justify-center"><LoaderCircle className="size-6 animate-spin text-muted-foreground" /></div>

  return (
    <div id="annual-plan-week-layer" className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <MobileSiteNavbar
        className={mobileChartOpen ? "annual-plan-navbar calendar-picker-navbar-open" : "annual-plan-navbar"}
        titleLabel="Annual Planner"
        title={<button
          type="button"
          aria-label="Toggle season chart"
          aria-expanded={mobileChartOpen}
          aria-controls="annual-plan-season-chart"
          onClick={() => setMobileChartOpen((open) => !open)}
          className="calendar-month-title-button"
        >
          <span>Annual Planner</span>
          <ChevronDown aria-hidden="true" />
        </button>}
        showMenu={!mobileChartOpen}
        actions={[
          ...(plan ? [{ value: "plan-settings", label: "Plan settings", onSelect: editPlan }] : []),
          { value: "new-plan", label: "New plan", onSelect: createPlan },
          ...plans.filter(item => item.id !== plan?.id).map(item => ({ value: `switch-${item.id}`, label: `Switch to ${item.name}`, onSelect: () => persistPlan(item) })),
        ]}
      />
      {isMobile && mobileChartOpen && plan && <div
        className="mobile-calendar-picker-layer annual-plan-chart-layer"
        onClick={(event) => { if (event.target === event.currentTarget) setMobileChartOpen(false) }}
      >
        <div
          id="annual-plan-season-chart"
          className="mobile-calendar-picker-panel"
          role="dialog"
          aria-label="Season chart"
        >
          <SeasonChart key={plan.id} plan={plan} actuals={actuals} selectedWeek={activeWeekId} onSelect={selectWeek} glassBackground />
        </div>
      </div>}
      <header className="hidden h-14 shrink-0 items-center gap-2 border-b px-4 md:flex">
        <div className="min-w-0 text-base font-semibold">{planSelector}</div>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Create new plan" onClick={createPlan}><Plus /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Plan settings" disabled={!plan} onClick={editPlan}><Settings /></Button>
        {plan && <p className="ml-auto hidden text-xs text-muted-foreground sm:block">{dateLabel(plan.startDate, { month: "short", day: "numeric", year: "numeric" })} – {dateLabel(plan.endDate, { month: "short", day: "numeric", year: "numeric" })}</p>}
      </header>

      {plan ? <>
        {!isMobile && <section className="shrink-0 border-b">
          <div className="hidden items-center justify-end gap-4 border-b px-4 py-1.5 text-[11px] text-muted-foreground md:flex"><span className="flex items-center gap-1.5"><span className="size-2.5 bg-slate-300 dark:bg-slate-600" /> Planned</span><span>Completed · period color</span></div>
          <SeasonChart key={plan.id} plan={plan} actuals={actuals} selectedWeek={activeWeekId} onSelect={selectWeek} />
        </section>
        }
        {isMobile && <section ref={mobileScrollerRef} aria-label="Training plan blocks" className="annual-plan-blocks-scroller min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
          {mobileBlocks.map(block => <section key={block.key} aria-label={block.phase}>
            <h2 className="mb-2 px-1 text-sm font-medium" style={{ color: PHASE_COLORS[block.phase] }}>{block.phase}</h2>
            <SettingsList>
              {block.weeks.map((week, index) => {
                return <div key={week.id} ref={(element) => { if (element) mobileWeekRefs.current.set(week.id, element); else mobileWeekRefs.current.delete(week.id) }}>
                  <MobileWeekCard week={week} weekNumber={index + 1} current={currentWeek?.id === week.id} onOpen={(trigger) => { weekSheetTrigger.current = trigger; setWeekSheetExpanded(false); window.history.pushState({ ...window.history.state, annualPlanWeek: week.id }, ""); weekSheetHistory.current = true; selectWeek(week.id); setMobileWeekDialogId(week.id) }} />
                </div>
              })}
            </SettingsList>
          </section>)}
        </section>}
        {!isMobile && <section ref={tableScrollerRef} className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[980px] border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-slate-100 text-left text-slate-600 shadow-[0_1px_0_rgba(15,23,42,.35)] dark:bg-muted dark:text-muted-foreground"><tr><th className="w-[15%] px-2 py-1.5 font-medium">Week</th><th className="w-[22%] px-2 py-1.5 font-medium">Event</th><th className="w-[15%] px-2 py-1.5 font-medium">Period</th><th className="w-[10%] px-2 py-1.5 font-medium">Hours</th><th className="w-[10%] px-2 py-1.5 font-medium">Completed</th><th className="w-[28%] min-w-96 px-2 py-1.5 font-medium">Details</th></tr></thead>
            <tbody>
              {plan.weeks.map((week, index) => {
                const monthChanged = index === 0 || week.startDate.slice(0, 7) !== plan.weeks[index - 1].startDate.slice(0, 7)
                const events = plan.events.filter((event) => event.date >= week.startDate && event.date <= week.endDate)
                const completed = actuals.get(week.id)?.completedHours ?? null
                const reportBlock = reportBlocks.find(block => block.endDate === week.endDate)
                const nextHours = () => { const next = plan.weeks[index + 1]; if (next) { const input = hoursRefs.current.get(next.id); input?.focus(); input?.select() } }
                const nextNotes = () => { const next = plan.weeks[index + 1]; if (next) notesRefs.current.get(next.id)?.focus() }
                return [
                  monthChanged ? <tr key={`${week.id}-month`} className="bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><th colSpan={6} className="px-1 py-1 text-left font-semibold">{dateLabel(week.startDate, { month: "long", year: "numeric" })}</th></tr> : null,
                  <tr key={week.id} aria-current={currentWeek?.id === week.id ? "date" : undefined} ref={(element) => { if (element) rowRefs.current.set(week.id, element); else rowRefs.current.delete(week.id) }} className={`border-b transition-colors ${currentWeek?.id === week.id ? "bg-slate-300/90 font-medium ring-1 ring-inset ring-slate-400/70 hover:bg-slate-300/90 dark:bg-slate-700/90 dark:ring-slate-500/80 dark:hover:bg-slate-700/90" : activeWeekId === week.id ? "bg-primary/5 hover:bg-primary/10" : index % 2 ? "bg-slate-50/60 hover:bg-muted/40 dark:bg-muted/15" : "hover:bg-muted/40"}`}>
                    <td className="px-2 py-1.5 tabular-nums">{weekRangeLabel(week.startDate, week.endDate)}</td>
                    <td className="px-2 py-1"><div className="flex min-w-0 items-center gap-1 overflow-hidden">{events.length ? <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">{events.map((event) => <Button key={event.id} type="button" variant="ghost" size="sm" className="h-7 min-w-0 gap-1 px-1.5" onClick={() => setRaceEditor({ week, event })}><RaceMarkerIcon priority={event.priority} /><span className="truncate">{event.name}</span><Pencil className="size-3" /></Button>)}</div> : <span className="min-w-0 flex-1" />}<Button type="button" variant="ghost" size="icon-sm" className="size-6 shrink-0" aria-label={`Add race during ${dateLabel(week.startDate)}`} onClick={() => setRaceEditor({ week })}><Plus className="size-3.5" /></Button></div></td>
                    <td className="p-0" style={{ backgroundColor: PHASE_COLORS[week.phase] }}><MobileSelect ref={(element)=>{if(element)phaseRefs.current.set(week.id,element);else phaseRefs.current.delete(week.id)}} aria-label={`Period for ${dateLabel(week.startDate)}`} className="h-10 w-full rounded-none border-0 bg-transparent px-2 font-semibold text-white" value={week.phase} options={PLAN_PHASES.map((phase)=>({ value: phase, label: phase === week.phase ? phaseLabel(week) : phase }))} onValueChange={(value)=>changePeriod(week.id,value as PlanPhase)} onKeyDown={(event)=>{if(event.key==='Tab'&&tabEditableCell(index,0,event.shiftKey))event.preventDefault()}}><Select value={week.phase} onValueChange={(value)=>changePeriod(week.id,value as PlanPhase)}><SelectTrigger ref={(element)=>{if(element)phaseRefs.current.set(week.id,element);else phaseRefs.current.delete(week.id)}} aria-label={`Period for ${dateLabel(week.startDate)}`} className="h-10 w-full rounded-none border-0 bg-transparent px-2 text-xs font-semibold text-white shadow-none hover:bg-white/10 focus-visible:border-white/80 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 dark:bg-transparent dark:hover:bg-white/10 [&_svg]:text-white" onKeyDown={(event)=>{if(event.key==='Tab'&&tabEditableCell(index,0,event.shiftKey))event.preventDefault()}}><SelectValue>{phaseLabel(week)}</SelectValue></SelectTrigger><SelectContent align="start">{PLAN_PHASES.map((phase)=><SelectItem key={phase} value={phase}>{phase}</SelectItem>)}</SelectContent></Select></MobileSelect></td>
                    <td className="p-0"><InlineHours value={week.targetHours} inputRef={(element) => { if (element) hoursRefs.current.set(week.id, element); else hoursRefs.current.delete(week.id) }} onCommit={(value) => changeWeek(week.id, { targetHours: value, manual: true })} onNext={nextHours} onTab={(backward)=>tabEditableCell(index,1,backward)} /></td>
                    <td className="p-0"><span className="flex h-8 items-center px-2 text-sm font-bold tabular-nums">{clockHours(completed) || "—"}</span></td>
                    <td className="p-0"><div className="flex items-center"><div className="min-w-0 flex-1"><InlineNotes value={week.notes} inputRef={(element) => { if (element) notesRefs.current.set(week.id, element); else notesRefs.current.delete(week.id) }} onCommit={(notes) => changeWeek(week.id, { notes })} onNext={nextNotes} onTab={(backward)=>tabEditableCell(index,2,backward)} /></div>{reportBlock && <SavedReportButton kind="block" startDate={reportBlock.startDate} />}</div></td>
                  </tr>,
                ]
              })}
            </tbody>
          </table>
        </section>}
      </> : <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center"><div className="max-w-sm space-y-3"><CalendarDays className="mx-auto size-8 text-muted-foreground" /><h2 className="text-lg font-semibold">Create your rolling training plan</h2><p className="text-sm text-muted-foreground">Start with the six months around today, then edit hours, periods, races and notes week by week.</p><Button onClick={createPlan} className={mobileSubmitClass}><Plus />Create plan</Button></div></div>}

      <PlanDialog open={planDialogOpen} onOpenChange={(open) => { setPlanDialogOpen(open); if (!open) setPlanSubmitError(null) }} initial={planDialogInitial} busy={busy} submitError={planSubmitError} onSubmit={(settings) => void submitPlanSettings(settings)} />
      <RaceDialog week={raceEditor?.week || null} event={raceEditor?.event} open={Boolean(raceEditor)} busy={busy} onOpenChange={(open) => { if (!open) setRaceEditor(null) }} onSubmit={(value) => void saveRace(value)} onDelete={() => void deleteRace()} />
      {isMobile && <>
        <div
          className={`terms-metric-backdrop sheet-backdrop annual-plan-week-backdrop${mobileWeekDialogId ? " backdrop-in" : ""}`}
          aria-hidden="true"
          onClick={closeWeekSheet}
        />
        <Sheet
          containerEl="#annual-plan-week-layer"
          className={`terms-metric-sheet detail-sheet-expandable ${weekSheetExpanded ? "detail-sheet-expanded" : ""}`}
          opened={Boolean(mobileWeekDialogId)}
          backdrop
          backdropEl="#annual-plan-week-layer .annual-plan-week-backdrop"
          closeByBackdropClick
          closeOnEscape
          onSheetClose={closeWeekSheet}
          onSheetClosed={() => weekSheetTrigger.current?.focus({ preventScroll: true })}
          {...{
            role: "dialog",
            "aria-modal": true,
            "aria-label": mobileWeekDialog ? `Week of ${dateLabel(mobileWeekDialog.startDate)}` : "Training week",
          }}
        >
          <div className="terms-metric-sheet-handle detail-sheet-handle" aria-hidden="true"><span /></div>
          <div className="terms-metric-sheet-heading">
            <div>
              <h2>{mobileWeekDialog ? (mobileWeekDialog.phase === "Race" ? "Race week" : `Week ${mobileWeekDialog.phaseWeek ?? mobileWeekDialogNumber + 1}${mobileWeekDialog.recovery ? " · Recovery" : ""}`) : "Training week"}</h2>
              {mobileWeekDialog && <p className="mt-1 text-sm text-muted-foreground">{dateLabel(mobileWeekDialog.startDate, { month: "long", day: "numeric" })} – {dateLabel(mobileWeekDialog.endDate, { month: "long", day: "numeric", year: "numeric" })}</p>}
            </div>
          </div>
          <div className="terms-metric-sheet-scroll" data-sheet-scroll key={mobileWeekDialogId}>
            {mobileWeekDialog && <MobileWeekDetails
              week={mobileWeekDialog}
              completed={actuals.get(mobileWeekDialog.id)?.completedHours ?? null}
              events={mobileWeekDialogEvents}
              reportStartDate={mobileWeekDialogReport?.startDate || null}
              onPhaseChange={(phase) => changePeriod(mobileWeekDialog.id, phase)}
              onHoursChange={(hours) => changeWeek(mobileWeekDialog.id, { targetHours: hours, manual: true })}
              onNotesChange={(notes) => changeWeek(mobileWeekDialog.id, { notes })}
              onRace={(event) => { setRaceEditor({ week: mobileWeekDialog, event }); closeWeekSheet() }}
            />}
          </div>
        </Sheet>
      </>}
    </div>
  )
}
