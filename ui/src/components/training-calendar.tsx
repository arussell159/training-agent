import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  Bike,
  CalendarDays,
  CheckCircle2,
  Dumbbell,
  Footprints,
  PanelRightClose,
  PanelRightOpen,
  Waves,
} from "lucide-react"
import { Pie, PieChart } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  type PlannedWorkout,
} from "@/lib/training-context"
import { useIsMobile } from "@/hooks/use-mobile"
import { workoutProfile } from "@/components/section-cards"

function SportIcon({ sport }: { sport: string }) {
  const value = sport.toLowerCase()
  const base = "size-4 shrink-0"
  if (value.includes("swim")) return <Waves className={`${base} text-cyan-600`} />
  if (value.includes("bike")) return <Bike className={`${base} text-violet-600`} />
  if (value.includes("run")) return <Footprints className={`${base} text-lime-600`} />
  if (value.includes("strength")) return <Dumbbell className={`${base} text-orange-600`} />
  return <CalendarDays className={`${base} text-slate-500`} />
}

type CompletionGrade = "good" | "medium" | "failed" | "planned"

function completionGrade(workout: PlannedWorkout): CompletionGrade {
  if (workout.status !== "completed") return "planned"
  const plannedDuration = durationMinutes(workout)
  const actualDuration = completedMinutes(workout)
  const plannedTss = Number(workout.planned?.tss ?? workout.load ?? 0)
  const actualTss = Number(workout.completed_data?.tss ?? 0)
  const durationRatio = plannedDuration > 0 ? actualDuration / plannedDuration : 1
  const loadRatio = plannedTss > 0 && actualTss > 0 ? actualTss / plannedTss : 1

  if (actualDuration <= 0) return "failed"
  if (durationRatio >= 0.9 && durationRatio <= 1.1 && loadRatio >= 0.85 && loadRatio <= 1.15) return "good"
  if (durationRatio >= 0.75 && durationRatio <= 1.25 && loadRatio >= 0.7 && loadRatio <= 1.3) return "medium"
  return "failed"
}

const gradeStyles: Record<CompletionGrade, string> = {
  planned: "border-border bg-card text-card-foreground hover:bg-accent/50",
  good: "border-border bg-card text-card-foreground hover:bg-accent/50",
  medium: "border-border bg-card text-card-foreground hover:bg-accent/50",
  failed: "border-border bg-card text-card-foreground hover:bg-accent/50",
}

function WorkoutPreview({ workout, large = false }: { workout: PlannedWorkout; large?: boolean }) {
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
    <div className={`mt-auto flex items-end overflow-hidden opacity-70 ${large ? "h-20 gap-1 rounded-md border p-2" : "h-8 gap-0.5 pt-2"}`} aria-label="Workout profile preview">
      {profile.map((segment, index) => (
        <span
          key={index}
          className={`min-w-px bg-muted-foreground/40 ${large ? "rounded-sm" : "rounded-[1px]"}`}
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

export function WorkoutCard({ workout, onClick }: { workout: PlannedWorkout; onClick: () => void }) {
  const grade = completionGrade(workout)
  const displayedMinutes = workout.status === "completed" && completedMinutes(workout) > 0
    ? completedMinutes(workout)
    : durationMinutes(workout)
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onClick() }}
      className={`w-full cursor-pointer gap-2 rounded-md px-2.5 py-3 shadow-sm transition-colors ${gradeStyles[grade]}`}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <SportIcon sport={workout.sport} />
        <span className="line-clamp-2 text-xs font-semibold leading-4">
          {workout.title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        {displayedMinutes > 0 && <span>{formatDuration(displayedMinutes)}</span>}
        {estimatedDistance(workout) && <span>· {estimatedDistance(workout)}</span>}
      </div>
      {workout.status === "completed" && (
        <span className="flex items-center gap-1 text-[10px] font-medium">
          <CheckCircle2 className="size-3" /> {grade === "good" ? "Completed well" : grade === "medium" ? "Partially achieved" : "Missed target"}
        </span>
      )}
      <WorkoutPreview workout={workout} />
    </Card>
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
  const [context, setContext] = useState(fallbackTrainingContext)
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(null)
  const [activeWeekKey, setActiveWeekKey] = useState("")
  const [summaryOpen, setSummaryOpen] = useState(() => localStorage.getItem("training-calendar-summary-open") !== "false")
  const isMobile = useIsMobile()
  const weekRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    let active = true
    loadTrainingContext().then((next) => active && setContext(next))
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
      void loadFullTrainingContext().then((next) => active && setContext(next))
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
    if (!weeks.length) return
    const previousRestoration = history.scrollRestoration
    history.scrollRestoration = "manual"
    const todayWeek = dateKey(startOfMonday(new Date()))
    const target = weeks.some((week) => week.key === todayWeek) ? todayWeek : weeks[weeks.length - 1].key
    setActiveWeekKey(target)
    const alignToday = () => {
      const element = weekRefs.current.get(target)
      if (!element) return
      window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - 56), behavior: "instant" })
    }
    alignToday()
    const frame = requestAnimationFrame(() => requestAnimationFrame(alignToday))
    const timer = window.setTimeout(alignToday, 250)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      history.scrollRestoration = previousRestoration
    }
  }, [weeks])

  const scrollToWeek = (key: string, behavior: ScrollBehavior = "smooth") => {
    const element = weekRefs.current.get(key)
    if (!element) return
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 56, behavior })
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
    scrollToWeek(target, "instant")
    requestAnimationFrame(() => scrollToWeek(target, "instant"))
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
    <div className="flex w-full min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-50 flex h-14 w-full shrink-0 items-center border-b bg-background/95 px-4 shadow-sm backdrop-blur">
        <h1 className="min-w-0 truncate text-sm font-semibold">{activeMonth}</h1>
        <div className="ml-4 flex items-center gap-1">
          <Button size="sm" onClick={goToToday}>Today</Button>
        </div>
      </header>
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
                        <div key={dateKey(day)} className={isToday ? "min-w-0 bg-primary/5 px-1.5 py-2" : "min-w-0 px-1.5 py-2"}>
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium uppercase text-muted-foreground">{day.toLocaleDateString("en-US", { weekday: "short" })}</span>
                            <Badge variant={isToday ? "default" : "outline"}>{day.getDate()}</Badge>
                          </div>
                          <div className="space-y-2">
                            {dayWorkouts.map((workout) => <WorkoutCard key={workout.id} workout={workout} onClick={() => openWorkout(workout)} />)}
                          </div>
                        </div>
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
