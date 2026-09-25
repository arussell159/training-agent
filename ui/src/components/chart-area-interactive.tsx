import { useMemo, useState, type ComponentType } from "react"
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

const METERS_PER_MILE = 1609.344
const METERS_PER_YARD = 0.9144
const METERS_PER_FOOT = 0.3048

type SportFilter = "all" | "run" | "bike" | "swim"
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

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function completedHistory(context: TrainingContext, filter: SportFilter) {
  const records = new Map<string, TrainingContext["history"][number]>()
  for (const item of context.history) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.workout_date ?? "")) continue
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
  now = new Date()
) {
  const currentWeek = weekStart(dateKey(now))
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

export function ChartAreaInteractive({
  context,
}: {
  context: TrainingContext
}) {
  const isMobile = useIsMobile()
  const [sport, setSport] = useState<SportFilter>("all")
  const [historyMetric, setHistoryMetric] = useState<HistoryMetric>("time")
  const [inspectIndex, setInspectIndex] = useState<number | null>(null)
  const records = useMemo(
    () => completedHistory(context, sport),
    [context, sport]
  )
  const history = useMemo(() => twelveWeekHistory(records), [records])
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
    <Card className="training-history-card m-0 min-w-0">
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
              className={`w-full ${isMobile ? "h-[170px]" : "h-[320px]"}`}
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
                  isAnimationActive
                  animationBegin={0}
                  animationDuration={450}
                  animationEasing="linear"
                />
              </AreaChart>
            </ChartContainer>
          </div>
        </section>
      </CardContent>
    </Card>
  )
}
