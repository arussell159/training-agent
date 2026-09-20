import { useMemo, useState, type ComponentType } from "react"
import { Activity, Bike, Footprints, Waves } from "lucide-react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Button as F7Button, Card, CardContent } from "framework7-react"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { MobileSelect } from "@/components/ui/mobile-native-controls"
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

function numeric(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function nested(record: HistoryRecord, key: string) {
  const value = record[key]
  return value && typeof value === "object"
    ? (value as HistoryRecord)
    : undefined
}

function firstNumber(...values: unknown[]) {
  return values.map(numeric).find((value) => value != null)
}

function completedValues(item: TrainingContext["history"][number]) {
  const raw = item as unknown as HistoryRecord
  const completed = nested(raw, "completed")
  const completedData = nested(raw, "completed_data")
  const workoutSummary = nested(raw, "workout_summary")
  const summaryCompleted = workoutSummary && nested(workoutSummary, "completed")
  const seconds = firstNumber(
    completedData?.duration_seconds,
    completed?.duration_seconds,
    summaryCompleted?.duration_seconds,
    raw.duration_seconds
  )
  const minutes = firstNumber(
    raw.actualDurationMinutes,
    completedData?.duration_minutes,
    completed?.duration_minutes,
    summaryCompleted?.duration_minutes,
    raw.duration_minutes
  )
  return {
    hours: seconds != null ? seconds / 3600 : (minutes ?? 0) / 60,
    distanceMeters:
      firstNumber(
        completedData?.distance_meters,
        completed?.distance_meters,
        summaryCompleted?.distance_meters,
        raw.distance_meters
      ) ?? 0,
    elevationMeters:
      firstNumber(
        completedData?.elevation_gain,
        completed?.elevation_gain,
        summaryCompleted?.elevation_gain,
        raw.elevation_gain
      ) ?? 0,
  }
}

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
    const raw = item as unknown as HistoryRecord
    const key = String(
      raw.activity_id ??
        raw.id ??
        `${item.workout_date}:${raw.title ?? raw.name ?? sportFor(item)}`
    )
    const previous = records.get(key)
    records.set(
      key,
      previous ? ({ ...previous, ...item } as typeof item) : item
    )
  }
  return [...records.values()].filter((item) => completedValues(item).hours > 0)
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
    }
  })
  const byWeek = new Map(rows.map((row) => [row.week, row]))
  for (const item of records) {
    const row = byWeek.get(weekStart(item.workout_date))
    if (row) {
      const values = completedValues(item)
      row.hours += values.hours
      row.distanceMeters += values.distanceMeters
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
  if (index === 0 && rows[1]?.week.slice(0, 7) !== month) return ""
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

function weekTotals(records: TrainingContext["history"], now = new Date()) {
  const start = weekStart(dateKey(now))
  return records.reduce(
    (total, item) => {
      if (weekStart(item.workout_date) !== start) return total
      const values = completedValues(item)
      total.hours += values.hours
      total.distanceMeters += values.distanceMeters
      total.elevationMeters += values.elevationMeters
      return total
    },
    { hours: 0, distanceMeters: 0, elevationMeters: 0 }
  )
}

export function ChartAreaInteractive({
  context,
}: {
  context: TrainingContext
}) {
  const [sport, setSport] = useState<SportFilter>("all")
  const [historyMetric, setHistoryMetric] = useState<HistoryMetric>("time")
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
  const totals = useMemo(() => weekTotals(records), [records])

  return (
    <Card className="training-history-card m-0 min-w-0">
      <CardContent className="p-0">
        <div
          className="training-history-filter-scroll"
          aria-label="Filter training history by sport"
        >
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
        </div>

        <section
          className="training-history-summary"
          aria-label="This week training totals"
        >
          <h2>This week</h2>
          <div className="training-history-totals">
            <div>
              <span>Time</span>
              <strong>{formatHours(totals.hours)}</strong>
            </div>
            <div>
              <span>Distance</span>
              <strong>{formatDistance(totals.distanceMeters, sport)}</strong>
            </div>
            <div>
              <span>Elev gain</span>
              <strong>
                {Math.round(
                  totals.elevationMeters / METERS_PER_FOOT
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
            <MobileSelect
              aria-label="Training history metric"
              value={historyMetric}
              onValueChange={(value) =>
                setHistoryMetric(value as HistoryMetric)
              }
              options={[
                { value: "time", label: "Time" },
                { value: "distance", label: "Distance" },
              ]}
              className="training-history-metric-select"
            >
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
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="time">Time</SelectItem>
                  <SelectItem value="distance">Distance</SelectItem>
                </SelectContent>
              </Select>
            </MobileSelect>
          </div>
          <ChartContainer
            config={historyChartConfig}
            className="h-[245px] w-full sm:h-[320px]"
          >
            <AreaChart
              data={chartHistory}
              accessibilityLayer
              margin={{ top: 16, right: 8, left: 0, bottom: 0 }}
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
                tickMargin={12}
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
                width={44}
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
              <ChartTooltip
                cursor={{ stroke: "var(--border)" }}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(value) =>
                      `Week of ${new Date(
                        `${value}T12:00:00Z`
                      ).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      })}`
                    }
                    formatter={(value) => (
                      <div className="flex min-w-32 flex-1 justify-between gap-4">
                        <span className="text-muted-foreground">
                          {historyMetric === "time" ? "Time" : "Distance"}
                        </span>
                        <span className="font-mono font-medium tabular-nums">
                          {historyMetric === "time"
                            ? formatHours(Number(value))
                            : formatChartDistance(Number(value), sport)}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Area
                dataKey="value"
                type="linear"
                stroke="var(--color-value)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="url(#trainingHistoryFill)"
                dot={{ r: 3, fill: "var(--card)", strokeWidth: 2 }}
                activeDot={{
                  r: 5,
                  fill: "var(--card)",
                  strokeWidth: 2,
                }}
                isAnimationActive
                animationBegin={0}
                animationDuration={450}
                animationEasing="linear"
              />
            </AreaChart>
          </ChartContainer>
        </section>
      </CardContent>
    </Card>
  )
}
