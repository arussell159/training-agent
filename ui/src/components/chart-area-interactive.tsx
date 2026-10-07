import { useEffect, useMemo, useState, type ComponentType } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { Activity, Bike, Footprints, Waves } from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Button as F7Button } from "framework7-react"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { apiFetch } from "@/lib/api-client"
// @ts-expect-error Shared browser/server helper is plain JavaScript by design.
import { completedActivityKey, completedActivityValues } from "../../../app-backend/lib/completed-activity.mjs"

import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { MobileFilterTabs } from "@/components/ui/mobile-filter-tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TrainingContext } from "@/lib/training-context"
import { dashboardToday } from "@/lib/dashboard-metrics"
import { validHistoryDay, validatedHistoryWeeks, type HistorySport, type HistoryWeek } from "@/lib/training-history-view"

const METERS_PER_MILE = 1609.344
const METERS_PER_YARD = 0.9144
const METERS_PER_FOOT = 0.3048

type SportFilter = HistorySport
type HistoryMetric = "time" | "distance"
type HistoryRecord = Record<string, unknown>
type SportOption = {
  value: SportFilter
  label: string
  icon: ComponentType<{ className?: string }>
}

const sportOptions: SportOption[] = [
  { value: "all", label: "All Sports", icon: Activity },
  { value: "run", label: "Run", icon: Footprints },
  { value: "bike", label: "Bike", icon: Bike },
  { value: "swim", label: "Swim", icon: Waves },
]

const historyChartConfig = {
  value: { label: "Completed", color: "var(--chart-2)" },
} satisfies ChartConfig

function sportFor(
  item: TrainingContext["history"][number]
): Exclude<SportFilter, "all"> | "other" {
  const raw = item as unknown as HistoryRecord
  const sport = String(
    raw.sport ?? raw.type ?? raw.activity_type ?? ""
  ).toLowerCase()
  if (sport.includes("run")) return "run"
  if (
    sport.includes("ride") ||
    sport.includes("bike") ||
    sport.includes("cycl")
  )
    return "bike"
  if (sport.includes("swim")) return "swim"
  return "other"
}

function weekStart(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

function completedHistory(context: TrainingContext, filter: SportFilter) {
  const records = new Map<string, TrainingContext["history"][number]>()
  for (const item of context.history) {
    if (!validHistoryDay(item.workout_date)) continue
    if (filter !== "all" && sportFor(item) !== filter) continue
    const key = String(
      completedActivityKey(item)
    )
    const previous = records.get(key)
    records.set(
      key,
      previous ? ({ ...previous, ...item } as typeof item) : item
    )
  }
  return [...records.values()].filter((item) => completedActivityValues(item).hours > 0)
}

function twelveWeekHistory(
  records: TrainingContext["history"],
  today: string
) {
  const currentWeek = weekStart(today)
  const currentDate = new Date(`${currentWeek}T12:00:00Z`)
  const rows = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(currentDate)
    date.setUTCDate(currentDate.getUTCDate() - (11 - index) * 7)
    return {
      week: date.toISOString().slice(0, 10),
      hours: 0,
      distanceMeters: 0,
      elevationMeters: 0,
    }
  })
  const byWeek = new Map(rows.map((row) => [row.week, row]))
  for (const item of records) {
    const row = byWeek.get(weekStart(item.workout_date))
    if (row) {
      const values = completedActivityValues(item)
      row.hours += values.hours
      row.distanceMeters += values.distanceMeters
      row.elevationMeters += values.elevationMeters
    }
  }
  return rows
}

function monthTick(
  value: string,
  index: number,
  rows: Array<{ week: string }>
) {
  const month = value.slice(0, 7)
  const previous = rows[index - 1]?.week.slice(0, 7)
  if (index === 0) return ""
  if (index !== 0 && month === previous) return ""
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  })
}

function formatHours(hours: number) {
  const minutes = Math.max(0, Math.round(hours * 60))
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

function formatDistance(meters: number, filter: SportFilter) {
  if (filter === "swim")
    return `${Math.round(meters / METERS_PER_YARD).toLocaleString("en-US")} yd`
  return `${(meters / METERS_PER_MILE).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} mi`
}

function chartDistance(meters: number, filter: SportFilter) {
  return meters / (filter === "swim" ? METERS_PER_YARD : METERS_PER_MILE)
}

function formatChartDistance(value: number, filter: SportFilter) {
  if (filter === "swim")
    return `${Math.round(value).toLocaleString("en-US")} yd`
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} mi`
}

const activitySports = ["run", "bike", "swim", "other"] as const
type ActivitySport = (typeof activitySports)[number]
type StatsActivityRecord = {
  date: string
  sport: string
  name: string
  subtype?: string
  distance_meters: number
  duration_seconds: number
  elevation_meters: number
  achievements?: Array<Record<string, unknown>>
}
const activitySportPresentation: Record<ActivitySport, {
  label: string
  color: string
  Icon: SportOption["icon"]
}> = {
  run: { label: "Run", color: "#cfe2ce", Icon: Footprints },
  bike: { label: "Bike", color: "#e8e2ef", Icon: Bike },
  swim: { label: "Swim", color: "#c5dfe9", Icon: Waves },
  other: { label: "Other", color: "#e5e5e5", Icon: Activity },
}

function activityWeeks(context: TrainingContext) {
  const today = dashboardToday(context)
  const currentWeek = weekStart(today)
  const currentWeekDate = new Date(`${currentWeek}T12:00:00Z`)
  const weeks = Array.from({ length: 4 }, (_, index) => {
    const date = new Date(currentWeekDate)
    date.setUTCDate(currentWeekDate.getUTCDate() - (3 - index) * 7)
    return {
      start: date.toISOString().slice(0, 10),
      totals: { run: 0, bike: 0, swim: 0, other: 0 } satisfies Record<ActivitySport, number>,
      total: 0,
    }
  })
  const records = completedHistory(context, "all").filter(
    (record) => record.workout_date >= weeks[0].start && record.workout_date <= today
  )
  const countsByDay = new Map<string, number>()
  for (const record of records) {
    const weekIndex = weeks.findIndex((week, index) => {
      const next = weeks[index + 1]?.start ?? "9999-12-31"
      return record.workout_date >= week.start && record.workout_date < next
    })
    if (weekIndex < 0) continue
    countsByDay.set(record.workout_date, (countsByDay.get(record.workout_date) ?? 0) + 1)
    const category = sportFor(record)
    const values = completedActivityValues(record)
    weeks[weekIndex].totals[category] += values.hours
    weeks[weekIndex].total += values.hours
  }
  const weekDays = weeks.map((week) =>
    Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(`${week.start}T12:00:00Z`)
      date.setUTCDate(date.getUTCDate() + dayIndex)
      const key = date.toISOString().slice(0, 10)
      return {
        key,
        date,
        count: countsByDay.get(key) ?? 0,
      }
    })
  )
  return { records, weeks, weekDays, today }
}

function ActivityWeekBars({ context }: { context: TrainingContext }) {
  const { weeks } = useMemo(() => activityWeeks(context), [context])
  const maxHours = Math.max(0.01, ...weeks.map((week) => week.total))
  return (
    <div className="min-w-0 pt-2">
      <div className="mb-3 flex items-center justify-start gap-3" aria-label="Activity time by sport">
        {activitySports.map((sport) => {
          const { label, color, Icon } = activitySportPresentation[sport]
          return (
            <span key={sport} className="flex items-center gap-1" aria-label={label}>
              <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: color }} />
            <Icon aria-hidden="true" className="size-5 text-foreground" />
            </span>
          )
        })}
      </div>
      <TooltipProvider delay={150}>
        <div className="space-y-3">
        {weeks.map((week) => (
          <div key={week.start} className="flex min-w-0 items-center gap-2" aria-label={`${week.start} week: ${formatHours(week.total)}`}>
            <div className="flex h-5 min-w-0 flex-1 overflow-hidden border border-border/50 bg-muted/25">
              {activitySports.map((sport) => {
                const hours = week.totals[sport]
                if (!hours) return null
                return (
                  <Tooltip key={sport}>
                    <TooltipTrigger render={<button type="button" className="h-full min-w-px border-r border-white/70 last:border-r-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" aria-label={`${activitySportPresentation[sport].label}: ${formatHours(hours)} during week of ${week.start}`} />} style={{ width: `${(hours / maxHours) * 100}%`, backgroundColor: activitySportPresentation[sport].color }} />
                    <TooltipContent arrowClassName="hidden" className="border border-border bg-popover text-popover-foreground">
                      <p>{formatHours(hours)}</p>
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
            <Tooltip>
            <TooltipTrigger render={<button type="button" className="w-[4.5rem] shrink-0 text-left text-sm font-medium tabular-nums text-foreground outline-none focus-visible:underline" aria-label={`${formatHours(week.total)} total during week of ${week.start}`} />}>
              {formatHours(week.total)}
            </TooltipTrigger>
            <TooltipContent arrowClassName="hidden" className="border border-border bg-popover text-popover-foreground">
              <p>{formatHours(week.total)}</p>
            </TooltipContent>
            </Tooltip>
          </div>
        ))}
        </div>
      </TooltipProvider>
    </div>
  )
}

export function RecentActivitySummary({ context }: { context: TrainingContext }) {
  const { records, weekDays, today } = useMemo(() => activityWeeks(context), [context])
  const count = records.length
  const weekdayLabels = ["M", "T", "W", "T", "F", "S", "S"]
  const [hoveredDay, setHoveredDay] = useState<string | null>(null)
  const [showStats, setShowStats] = useState(false)
  const [statsSport, setStatsSport] = useState<ActivitySport | "all">("run")
  const allActivities = useMemo(() => completedHistory(context, "all"), [context])
  const [statsData, setStatsData] = useState<{ records: StatsActivityRecord[] } | null>(null)
  const [statsRequestStarted, setStatsRequestStarted] = useState(false)
  useEffect(() => {
    setStatsData(null)
    setStatsRequestStarted(false)
  }, [context.synced_at])
  useEffect(() => {
    if (!showStats || statsRequestStarted) return
    let active = true
    setStatsRequestStarted(true)
    void apiFetch("/api/training-stats", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Training stats ${response.status}`)
        return response.json() as Promise<{ records?: StatsActivityRecord[] }>
      })
      .then((result) => {
        if (active && Array.isArray(result.records)) setStatsData({ records: result.records })
      })
      .catch(() => {
        // Keep the locally synced summaries available if the detailed stats read fails.
      })
    return () => { active = false }
  }, [showStats, statsRequestStarted])
  const statsRecords = useMemo<StatsActivityRecord[]>(() => statsData?.records ?? allActivities.map((activity) => {
    const values = completedActivityValues(activity)
    const raw = activity as unknown as HistoryRecord
    return {
      date: activity.workout_date,
      sport: String(raw.sport ?? "Other"),
      name: String(raw.title ?? ""),
      subtype: String(raw.sub_type ?? ""),
      distance_meters: values.distanceMeters,
      duration_seconds: values.hours * 3600,
      elevation_meters: values.elevationMeters,
      achievements: [],
    }
  }), [statsData, allActivities])
  const statsActivities = useMemo(
    () => statsSport === "all" ? statsRecords : statsRecords.filter((activity) => {
      const type = activity.sport.toLowerCase()
      return statsSport === "run" ? type.includes("run") : statsSport === "bike" ? /ride|bike|cycl/.test(type) : statsSport === "swim" ? type.includes("swim") : !/run|ride|bike|cycl|swim/.test(type)
    }),
    [statsRecords, statsSport]
  )
  const summarize = (items: StatsActivityRecord[]) => items.reduce(
    (total, item) => {
      return {
        activities: total.activities + 1,
        distanceMeters: total.distanceMeters + (item.distance_meters || 0),
        hours: total.hours + (item.duration_seconds || 0) / 3600,
        elevationMeters: total.elevationMeters + (item.elevation_meters || 0),
      }
    },
    { activities: 0, distanceMeters: 0, hours: 0, elevationMeters: 0 }
  )
  const recentStart = new Date(`${today}T12:00:00Z`)
  recentStart.setUTCDate(recentStart.getUTCDate() - 27)
  const recentTotals = summarize(statsActivities.filter((activity) =>
    activity.date >= recentStart.toISOString().slice(0, 10) && activity.date <= today
  ))
  const recentStatsActivities = statsActivities.filter((activity) =>
    activity.date >= recentStart.toISOString().slice(0, 10) && activity.date <= today
  )
  const formatRecordedTime = (seconds: number) => {
    const whole = Math.max(0, Math.round(seconds))
    const hours = Math.floor(whole / 3600)
    const minutes = Math.floor((whole % 3600) / 60)
    const remainder = whole % 60
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`
  }
  const effortSport = statsSport === "swim" ? "swim" : statsSport === "run" || statsSport === "all" ? "run" : null
  const effortActivityRecords = effortSport
    ? recentStatsActivities.filter((activity) => activity.sport.toLowerCase().includes(effortSport))
    : []
  const effortDistances = effortSport === "swim"
    ? [
        { meters: 45.72, label: "50 yd" }, { meters: 91.44, label: "100 yd" },
        { meters: 100, label: "100 m" }, { meters: 200, label: "200 m" },
        { meters: 400, label: "400 m" }, { meters: 800, label: "800 m" },
        { meters: 1500, label: "1,500 m" }, { meters: 3800, label: "3,800 m" },
      ]
    : effortSport === "run" ? [
        { meters: 400, label: "400 m" }, { meters: 800, label: "800 m" },
        { meters: 1500, label: "1,500 m" }, { meters: 1609.34, label: "1 mile" },
        { meters: 3000, label: "3,000 m" }, { meters: 5000, label: "5K" },
        { meters: 10000, label: "10K" }, { meters: 21097.5, label: "Half Marathon" },
        { meters: 42195, label: "Marathon" },
      ]
    : []
  const effortByDistance = new Map<number, { seconds: number; date: string }>()
  for (const activity of effortActivityRecords) {
    for (const achievement of activity.achievements || []) {
      if (String(achievement.type || "").toUpperCase() !== "BEST_PACE") continue
      const distance = Number(achievement.distance)
      const seconds = Number(achievement.secs)
      if (!(distance > 0 && seconds > 0)) continue
      const match = effortDistances.find(({ meters }) => Math.abs(meters - distance) <= Math.max(1, meters * 0.005))
      if (!match) continue
      const current = effortByDistance.get(match.meters)
      if (!current || seconds < current.seconds) effortByDistance.set(match.meters, { seconds, date: activity.date })
    }
  }
  const distanceValue = (meters: number) => statsSport === "swim"
    ? `${Math.round(meters / METERS_PER_YARD).toLocaleString("en-US")} yd`
    : `${(meters / METERS_PER_MILE).toLocaleString("en-US", { maximumFractionDigits: 1 })} mi`
  const statRows = (rows: Array<[string, string]>) => rows.map(([label, value]) => (
    <div key={label} className="flex items-center justify-between gap-2 border-b border-border/50 py-1.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="text-xs font-medium tabular-nums text-foreground">{value}</strong>
    </div>
  ))
  return (
    <Card className="m-0 hidden min-w-0 lg:flex">
      <CardContent className="grid min-h-[330px] flex-1 grid-cols-[minmax(84px,0.68fr)_minmax(145px,1fr)_minmax(170px,1.18fr)] items-start gap-x-3 py-3">
        <div className="col-span-3 flex min-w-0 items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">{showStats ? "My Stats" : "Last 4 Weeks"}</p>
          <div className="flex items-center rounded-full border border-border p-0.5 text-xs" role="group" aria-label="Activity summary view">
            <button type="button" aria-pressed={!showStats} onClick={() => setShowStats(false)} className={`rounded-full px-3 py-1 ${!showStats ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>Activity</button>
            <button type="button" aria-pressed={showStats} onClick={() => setShowStats(true)} className={`rounded-full px-3 py-1 ${showStats ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>Stats</button>
          </div>
        </div>
        {showStats ? (
          <div className="col-span-3 grid h-[278px] min-h-0 grid-cols-2 gap-4 overflow-hidden">
            <section className="min-w-0" aria-label="Last four weeks activity statistics">
              <div className="mb-2 flex items-center gap-1.5">
                {activitySports.map((sport) => {
                  const Icon = activitySportPresentation[sport].Icon
                  return <button key={sport} type="button" aria-label={activitySportPresentation[sport].label} aria-pressed={statsSport === sport} onClick={() => setStatsSport(sport)} className={`rounded-full border p-1.5 ${statsSport === sport ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}><Icon className="size-4" /></button>
                })}
              </div>
              <h3 className="mb-1 text-xs font-semibold">Last 4 Weeks</h3>
              {statRows([
                ["Activities / Week", (recentTotals.activities / 4).toLocaleString("en-US", { maximumFractionDigits: 1 })],
                ["Avg Distance / Week", distanceValue(recentTotals.distanceMeters / 4)],
                ["Avg Time / Week", formatHours(recentTotals.hours / 4)],
                ["Elev Gain / Week", `${Math.round(recentTotals.elevationMeters / 4 / METERS_PER_FOOT).toLocaleString("en-US")} ft`],
              ])}
            </section>
            <section className="min-w-0" aria-label="Best efforts during the last four weeks">
              <h3 className="mb-1 text-xs font-semibold">{effortSport ? `Best ${effortSport === "run" ? "Run" : "Swim"} Efforts · Last 4 Weeks` : "Best Efforts · Last 4 Weeks"}</h3>
              {!effortSport ? (
                <p className="text-[11px] leading-snug text-muted-foreground">Distance-based pace efforts aren’t available for this sport.</p>
              ) : (
                <>
                  {effortByDistance.size === 0 && <p className="mb-1 text-[10px] leading-3 text-muted-foreground">No recorded best-pace efforts in this period.</p>}
                  {effortDistances.map(({ meters, label }) => {
                    const effort = effortByDistance.get(meters)
                    return (
                      <div key={meters} className="flex items-center justify-between gap-2 border-b border-border/50 py-1 last:border-b-0">
                        <span className="truncate text-xs text-muted-foreground">{label}</span>
                        <strong className="shrink-0 text-xs font-medium tabular-nums text-foreground">{effort ? formatRecordedTime(effort.seconds) : "—"}</strong>
                      </div>
                    )
                  })}
                </>
              )}
            </section>
          </div>
        ) : (
          <>
        <div className="min-w-0 self-start pt-2">
          <p className="mt-2 text-5xl font-semibold leading-none tracking-tight tabular-nums xl:text-6xl">
            {count}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">Total Activities</p>
        </div>
        <TooltipProvider delay={150}>
        <div className="grid min-w-0 grid-cols-7 gap-x-1 pt-2 pr-3" aria-label="Completed activities by weekday for the last four weeks">
          {weekdayLabels.map((day, index) => (
            <span key={`${day}-${index}`} className="mb-2 text-center text-xs font-medium text-muted-foreground">
              {day}
            </span>
          ))}
          {weekDays.flatMap((week, weekIndex) =>
            week.map(({ key, date, count: dayCount }) => {
              const isToday = key === today
              const label = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
              const showDate = hoveredDay === key || (hoveredDay === null && isToday)
              return (
                <div key={`${weekIndex}-${key}`} className="relative flex h-8 items-center justify-center">
                  {dayCount > 0 ? (
                    <button
                        type="button"
                        className="flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        style={{ width: 24, height: 24 }}
                        onMouseEnter={() => setHoveredDay(key)}
                        onMouseLeave={() => setHoveredDay(null)}
                        onFocus={() => setHoveredDay(key)}
                        onBlur={() => setHoveredDay(null)}
                        aria-label={`${label}: ${dayCount} completed ${dayCount === 1 ? "activity" : "activities"}`}
                      >
                        {showDate ? (
                          <span aria-hidden="true" className="text-[11px] font-semibold leading-none text-foreground underline underline-offset-2">
                            {date.getUTCDate()}
                          </span>
                        ) : (
                          <span
                            aria-hidden="true"
                            className="block rounded-full bg-foreground transition-[width,height]"
                            style={{ width: `${10 + Math.min(dayCount - 1, 4) * 2}px`, height: `${10 + Math.min(dayCount - 1, 4) * 2}px` }}
                          />
                        )}
                    </button>
                  ) : isToday ? (
                    <span className="text-[11px] font-semibold leading-none text-foreground underline underline-offset-2">
                      {date.getUTCDate()}
                    </span>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
        </TooltipProvider>
        <ActivityWeekBars context={context} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function ChartAreaInteractive({
  context,
  compactDesktop = false,
}: {
  context: TrainingContext
  compactDesktop?: boolean
}) {
  const isMobile = useIsMobile()
  const [sport, setSport] = useState<SportFilter>("all")
  const [historyMetric, setHistoryMetric] = useState<HistoryMetric>("time")
  const [inspectIndex, setInspectIndex] = useState<number | null>(null)
  const [savedWeeks, setSavedWeeks] = useState<HistoryWeek[] | null>(null)
  useEffect(() => {
    let active = true
    void apiFetch("/api/training-history", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Training history ${response.status}`)
        const result = await response.json() as { weeks?: unknown } | null
        return validatedHistoryWeeks(result?.weeks)
      })
      .then((weeks) => {
        if (active && weeks) setSavedWeeks(weeks)
      })
      .catch(() => {
        // The current context remains available while a history read retries on remount.
      })
    return () => { active = false }
  }, [context.synced_at])
  const records = useMemo(
    () => completedHistory(context, sport),
    [context, sport]
  )
  const history = useMemo(
    () => savedWeeks?.map((row) => ({ week: row.week, ...row[sport] })) ?? twelveWeekHistory(records, dashboardToday(context)),
    [savedWeeks, records, sport, context]
  )
  const chartHistory = useMemo(() => {
    return history.map((row) => ({
      ...row,
      value:
        historyMetric === "time"
          ? row.hours
          : chartDistance(row.distanceMeters, sport),
    }))
  }, [history, historyMetric, sport])
  const selectedIndex = inspectIndex ?? chartHistory.length - 1
  const selectedWeek = chartHistory[selectedIndex]
  const selectedWeekIsCurrent = selectedIndex === chartHistory.length - 1
  const selectedWeekLabel = selectedWeek
    ? new Date(selectedWeek.week + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : ""
  const yAxisMax = Math.max(1, ...chartHistory.map((row) => row.value))
  const yAxisTicks = [0, yAxisMax / 2, yAxisMax]
  const inspectHistory = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!chartHistory.length) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const left = 0
    const right = 32
    if (bounds.width <= left + right) return
    const ratio = Math.max(
      0,
      Math.min(
        1,
        (event.clientX - bounds.left - left) / (bounds.width - left - right)
      )
    )
    setInspectIndex(Math.round(ratio * (chartHistory.length - 1)))
  }

  return (
    <Card className="dashboard-history-card training-history-card m-0 min-w-0">
      <CardContent className="p-0">
        <div
          className="training-history-filter-scroll"
          aria-label="Filter training history by sport"
        >
          {isMobile ? (
            <MobileFilterTabs
              label="Filter training history by sport"
              items={sportOptions.map(({ value, label, icon }) => ({
                value,
                label,
                icon,
              }))}
              value={sport}
              onChange={setSport}
              className="training-history-mobile-filters"
            />
          ) : (
            <div className="training-history-filters" role="group">
              {sportOptions.map(({ value, label, icon: Icon }) => (
                <F7Button
                  key={value}
                  active={sport === value}
                  round
                  outline
                  aria-pressed={sport === value}
                  onClick={(event) => {
                    event.preventDefault()
                    setSport(value)
                  }}
                >
                  <Icon className="size-4" />
                  <span>{label}</span>
                </F7Button>
              ))}
            </div>
          )}
        </div>

        <section
          className="training-history-summary"
          aria-label={selectedWeekIsCurrent ? "This week training totals" : "Week of " + selectedWeekLabel + " training totals"}
        >
          <h2>{selectedWeekIsCurrent ? "This week" : "Week of " + selectedWeekLabel}</h2>
          <div className="training-history-totals">
            <div>
              <span>Duration</span>
              <strong>{formatHours(selectedWeek?.hours ?? 0)}</strong>
            </div>
            <div>
              <span>Distance</span>
              <strong>{formatDistance(selectedWeek?.distanceMeters ?? 0, sport)}</strong>
            </div>
            <div>
              <span>Elev gain</span>
              <strong>
                {Math.round(
                  (selectedWeek?.elevationMeters ?? 0) / METERS_PER_FOOT
                ).toLocaleString("en-US")}{" "}
                ft
              </strong>
            </div>
          </div>
        </section>

        <section
          className="training-history-chart"
          aria-label={`Completed training ${historyMetric} over the past 12 weeks`}
        >
          <div className="training-history-chart-heading">
            <h3>Past 12 weeks</h3>
            {!isMobile && (
              <Select
                value={historyMetric}
                onValueChange={(value) =>
                  value && setHistoryMetric(value as HistoryMetric)
                }
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Training history metric"
                  className="h-8 w-24 rounded-lg px-2 text-sm font-medium shadow-none"
                >
                  <SelectValue>
                    {historyMetric === "time" ? "Time" : "Distance"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="time">Time</SelectItem>
                  <SelectItem value="distance">Distance</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div
            className="relative touch-pan-y select-none"
            onPointerDown={(event) => {
              if (!isMobile) return
              event.currentTarget.setPointerCapture(event.pointerId)
              inspectHistory(event)
            }}
            onPointerMove={(event) => {
              if (isMobile && event.buttons) inspectHistory(event)
            }}
            onPointerUp={(event) => {
              if (!isMobile) return
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId)
            }}
          >
            {inspectIndex != null && chartHistory[inspectIndex] && (
              <div className="hidden">
                <div
                  className="absolute top-0 bottom-0 border-l-2 border-foreground"
                  style={{
                    left: `${(inspectIndex / Math.max(1, chartHistory.length - 1)) * 100}%`,
                  }}
                >
                  <span
                    role="status"
                    className="hidden"
                    style={{
                      transform:
                        inspectIndex === 0
                          ? "translateX(4px)"
                          : inspectIndex === chartHistory.length - 1
                            ? "translateX(calc(-100% - 4px))"
                            : "translateX(-50%)",
                    }}
                  >
                    {historyMetric === "time"
                      ? formatHours(chartHistory[inspectIndex].value)
                      : formatChartDistance(
                          chartHistory[inspectIndex].value,
                          sport
                        )}
                  </span>
                </div>
              </div>
            )}
            <ChartContainer
              config={historyChartConfig}
              className={`w-full ${isMobile ? "h-[170px]" : compactDesktop ? "h-[190px]" : "h-[320px]"}`}
            >
              <AreaChart
                data={chartHistory}
                accessibilityLayer
                margin={{ top: 16, right: 0, left: 0, bottom: 8 }}
              >
                <defs>
                  <linearGradient
                    id="trainingHistoryFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--color-value)"
                      stopOpacity={0.38}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--color-value)"
                      stopOpacity={0.025}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="week"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                  interval={0}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value, index) =>
                    monthTick(String(value), index, chartHistory)
                  }
                />
                <YAxis
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  width={32}
                  domain={[0, yAxisMax]}
                  ticks={yAxisTicks}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => {
                    const amount = Number(value)
                    if (historyMetric === "distance") {
                      if (sport === "swim") return `${Math.round(amount)}yd`
                      if (amount === 0) return "0mi"
                      return `${amount.toFixed(amount < 10 ? 1 : 0)}mi`
                    }
                    if (amount === 0) return "0h"
                    return amount < 1
                      ? `${Math.round(amount * 60)}m`
                      : `${amount.toFixed(amount < 10 ? 1 : 0)}h`
                  }}
                />
                {isMobile && selectedWeek && (
                  <ReferenceLine
                    x={selectedWeek.week}
                    stroke="var(--foreground)"
                    strokeWidth={2}
                    ifOverflow="extendDomain"
                  />
                )}
                {!isMobile && (
                  <RechartsTooltip
                    cursor={{
                      stroke: "var(--border)",
                      strokeDasharray: "3 3",
                    }}
                    isAnimationActive={false}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const value = Number(payload[0]?.value ?? 0)
                      const weekDate = new Date(`${String(label)}T12:00:00Z`)
                      const weekLabel = Number.isNaN(weekDate.getTime())
                        ? String(label)
                        : `Week of ${weekDate.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            timeZone: "UTC",
                          })}`
                      return (
                        <div className="pointer-events-none min-w-28 rounded-lg border border-border/60 bg-background px-3 py-2 shadow-lg">
                          <div className="text-xs text-muted-foreground">
                            {weekLabel}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-foreground tabular-nums">
                            {historyMetric === "time"
                              ? formatHours(value)
                              : formatChartDistance(value, sport)}
                          </div>
                        </div>
                      )
                    }}
                  />
                )}
                <Area
                  dataKey="value"
                  type="linear"
                  stroke="var(--color-value)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="url(#trainingHistoryFill)"
                  dot={(props) => {
                    const pointIndex = Number(props.index)
                    const cx = Number(props.cx)
                    const cy = Number(props.cy)
                    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null
                    const selected = pointIndex === selectedIndex
                    return (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={selected ? 4.5 : 3}
                        fill={selected ? "var(--color-value)" : "var(--card)"}
                        stroke="var(--color-value)"
                        strokeWidth={selected ? 2 : 1.5}
                        style={
                          selected
                            ? { filter: "drop-shadow(0 0 4px var(--color-value))" }
                            : undefined
                        }
                      />
                    )
                  }}
                  activeDot={{
                    r: 5,
                    fill: "var(--color-value)",
                    strokeWidth: 2,
                    style: { filter: "drop-shadow(0 0 4px var(--color-value))" },
                  }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          </div>
        </section>
      </CardContent>
    </Card>
  )
}
