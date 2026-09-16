import {formatDuration} from '@/lib/duration'
import {durationMinutes} from '@/lib/training-context'
import {recoverySeries, todaysWorkout} from '@/lib/dashboard-metrics'
import { Activity, Clock3, Gauge, HeartPulse } from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type { PlannedWorkout, TrainingContext } from "@/lib/training-context"
import { EventsCard } from "@/components/race-events"

const recoveryChartConfig = {
  value: { label: "Daily value", color: "var(--primary)" },
  average: { label: "7-day average", color: "var(--muted-foreground)" },
  baselineHigh: { label: "Baseline high", color: "var(--muted)" },
  baselineLow: { label: "Baseline low", color: "var(--card)" },
} satisfies ChartConfig

const workoutChartConfig = {
  intensity: { label: "Intensity", color: "var(--chart-2)" },
} satisfies ChartConfig

function latestRecoverySeries(
  context: TrainingContext,
  key: "hrv" | "resting_hr"
) {
  return recoverySeries(context, key)
}

export function workoutProfile(title = "", sport = "", details = "") {
  const segments: { width: number; intensity: number }[] = []
  const push = (intensity: number, width = 1) => {
    segments.push({ width: Math.max(1, width), intensity })
  }

  const structuredSets = [...details.matchAll(/(\d+)\s*[x×]\s*\(([^)]+)\)/gi)]
  for (const set of structuredSets) {
    const repeats = Number(set[1])
    const parts = set[2].split(/\s*\+\s*/)
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      for (const part of parts) {
        const amount = Number(part.match(/\d+(?:\.\d+)?/)?.[0] ?? 1)
        const unit = part.match(/\b(hours?|hrs?|mins?|minutes?|secs?|seconds?|yds?|yards?|meters?|km)\b/i)?.[0]?.toLowerCase()
        let width = amount
        if (unit?.startsWith("hour") || unit?.startsWith("hr")) width *= 3600
        else if (unit?.startsWith("min")) width *= 60
        else if (unit === "km") width *= 1000

        const zones = [...part.matchAll(/Z([1-5])/gi)].map((match) => Number(match[1]))
        const zone = zones.length
          ? zones.reduce((sum, value) => sum + value, 0) / zones.length
          : /rest|easy|valley|cool-down/i.test(part)
            ? 1
            : /threshold|surge|strong|build/i.test(part)
              ? 4
              : 2
        push(12 + zone * 17, width)
      }
    }
  }

  if (!segments.length) {
    const titleSets = [...title.matchAll(/(\d+)\s*[x×]\s*(\d+)\s*(min|m|yd|km)?/gi)].map(
      (match) => ({ repeats: Number(match[1]), amount: Number(match[2]) })
    )
    const baseAmount = Math.max(
      1,
      Math.min(...titleSets.map((set) => set.amount), 100)
    )
    ;[28, 34, 40, 46].forEach((intensity) => push(intensity))
    if (titleSets.length) {
      titleSets.forEach((set, setIndex) => {
        const width = Math.min(
          12,
          Math.max(1, Math.round(set.amount / baseAmount))
        )
        for (let repeat = 0; repeat < set.repeats; repeat += 1) {
          push(58 + setIndex * 18, width)
          if (repeat < set.repeats - 1) push(30)
        }
        if (setIndex < titleSets.length - 1) push(24, 2)
      })
    } else {
      push(sport === "Recovery" ? 20 : 48, 16)
    }
    ;[42, 34, 26, 18].forEach((intensity) => push(intensity))
  }

  let position = 0
  return segments.flatMap((segment) => {
    const start = { position, intensity: segment.intensity }
    position += segment.width
    return [start, { position, intensity: segment.intensity }]
  })
}

function RecoveryTrendCard({
  context,
  metric,
}: {
  context: TrainingContext
  metric: "hrv" | "resting_hr"
}) {
  const data = latestRecoverySeries(context, metric)
  const isHrv = metric === "hrv"
  const liveValue = isHrv
    ? context.wellness?.hrv
    : context.wellness?.resting_hr
  const current = liveValue ?? data.at(-1)?.value
  const low = Math.min(...data.map((item) => Math.min(item.baselineLow, item.value)), current ?? 0)
  const high = Math.max(...data.map((item) => Math.max(item.baselineHigh, item.value)), current ?? 1)

  return (
    <Card className="min-w-0 overflow-hidden [--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(4)] lg:col-span-2">
      <CardHeader className="pb-0">
        <CardDescription>{isHrv ? "HRV" : "RHR"}</CardDescription>
        <CardTitle className="text-2xl tabular-nums sm:text-3xl">
          {current ?? '—'}
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            {isHrv ? "ms" : "bpm"}
          </span>
        </CardTitle>
        <CardAction>
          {isHrv ? (
            <Activity className="size-4 text-muted-foreground" />
          ) : (
            <HeartPulse className="size-4 text-muted-foreground" />
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="px-1 pb-2 sm:px-2 sm:pb-3">
        <ChartContainer config={recoveryChartConfig} className="h-20 w-full sm:h-24">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="date" hide />
            <YAxis domain={[low - 2, high + 2]} hide />
            <Area
              dataKey="baselineHigh"
              type="monotone"
              fill="var(--color-baselineHigh)"
              fillOpacity={0.8}
              stroke="none"
              tooltipType="none"
            />
            <Area
              dataKey="baselineLow"
              type="monotone"
              fill="var(--color-baselineLow)"
              fillOpacity={1}
              stroke="none"
              tooltipType="none"
            />
            <Line
              dataKey="average"
              type="monotone"
              stroke="var(--color-average)"
              strokeDasharray="3 3"
              strokeWidth={1}
              dot={false}
              tooltipType="none"
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) =>
                    new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  }
                  formatter={(value, _name, _item, _index, payload) => {
                    const point = payload as unknown as { average?: number; date?: string; baselineLow?: number; baselineHigh?: number }
                    const unit = isHrv ? "ms" : "bpm"
                    const dateLabel = point.date
                      ? new Date(`${point.date}T12:00:00`).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "Date"
                    return (
                      <div className="grid min-w-36 flex-1 gap-1">
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">{dateLabel}</span>
                          <span className="font-mono font-medium tabular-nums">
                            {Number(value).toFixed(0)} {unit}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">7-day average</span>
                          <span className="font-mono font-medium tabular-nums">
                            {Number(point.average ?? value).toFixed(1)} {unit}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Range</span><span className="font-mono font-medium tabular-nums">{point.baselineLow}–{point.baselineHigh} {unit}</span></div>
                      </div>
                    )
                  }}
                />
              }
            />
            <Line
              dataKey="value"
              type="monotone"
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={{ r: 2, fill: "var(--color-value)", strokeWidth: 0 }}
            />
          </ComposedChart>
        </ChartContainer>
        {data.length > 0 && <div className="flex flex-wrap justify-between gap-1 px-3 pt-1 text-[11px] text-muted-foreground" aria-label={`${isHrv ? 'HRV' : 'Resting heart rate'} baseline range`}><span>Low {data.at(-1)!.baselineLow}</span><span>Avg {data.at(-1)!.average}</span><span>High {data.at(-1)!.baselineHigh} {isHrv ? 'ms' : 'bpm'}</span></div>}
      </CardContent>
    </Card>
  )
}

import { hasWorkoutStructure, structuredWorkoutProfile } from "@/lib/workout-structure"

export function SectionCards({
  context,
  onWorkoutOpen,
}: {
  context: TrainingContext
  onWorkoutOpen?: (workout: PlannedWorkout) => void
}) {
  const today = todaysWorkout(context)
  const fitness = context.metrics.fitness == null ? '—' : Math.round(context.metrics.fitness)
  const fatigue = context.metrics.fatigue == null ? '—' : Math.round(context.metrics.fatigue)
  const form = context.metrics.form == null ? '—' : Math.round(context.metrics.form)
  const profile = structuredWorkoutProfile(today?.structure)

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-12">
      <Card
        role={onWorkoutOpen ? "button" : undefined}
        tabIndex={onWorkoutOpen ? 0 : undefined}
        aria-label={onWorkoutOpen && today ? `Open ${today.title}` : undefined}
        onClick={() => today && onWorkoutOpen?.(today)}
        onKeyDown={(event) => {
          if (!onWorkoutOpen || (event.key !== "Enter" && event.key !== " ")) return
          event.preventDefault()
          if (today) onWorkoutOpen(today)
        }}
        className="col-span-2 min-w-0 lg:col-span-6 lg:row-span-2"
      >
        <CardHeader className="gap-3">
          <CardDescription>
            Today&apos;s workout
            {today?.status === 'completed' && <span className="ml-2 text-primary">Completed</span>}
          </CardDescription>
          <CardTitle>
            <h1 className="text-2xl leading-tight font-semibold tracking-tight md:text-3xl">
              {today?.title ?? "No workout scheduled"}
            </h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col justify-end gap-3">
          {hasWorkoutStructure(today?.structure) && <div>
            <ChartContainer
              config={workoutChartConfig}
              className="h-20 w-full"
              aria-label="Workout intensity profile"
            >
              <AreaChart data={profile} accessibilityLayer>
                <XAxis
                  dataKey="position"
                  type="number"
                  hide
                  domain={["dataMin", "dataMax"]}
                />
                <YAxis hide domain={[0, 100]} />
                <Area
                  dataKey="intensity"
                  type="linear"
                  fill="var(--color-intensity)"
                  fillOpacity={1}
                  stroke="none"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          </div>}
          <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">
            {today?.goal ?? "Keep the day easy and protect recovery."}
          </p>
          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <div>
              <p className="text-xs text-muted-foreground">Duration</p>
              <p className="mt-1 flex items-center gap-2 font-medium">
                <Clock3 className="size-4" /> {today ? formatDuration(durationMinutes(today)) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Training load</p>
              <p className="mt-1 font-medium tabular-nums">
                {today?.load ?? 0} TSS
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <EventsCard context={context} />
      <RecoveryTrendCard context={context} metric="hrv" />
      <RecoveryTrendCard context={context} metric="resting_hr" />

      <Card className="col-span-2 min-w-0 [--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(4)] lg:col-span-6">
        <CardHeader>
          <CardTitle>Intervals.icu fitness</CardTitle>
          <CardAction>
            <Gauge className="size-4 text-muted-foreground" />
          </CardAction>
        </CardHeader>
        <CardContent className="grid grid-cols-3 divide-x border-t pt-3 sm:pt-4">
          <div className="min-w-0 pr-2 sm:pr-4">
            <p className="text-xs text-muted-foreground">Fitness</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {fitness} <span className="text-xs font-normal">CTL</span>
            </p>
          </div>
          <div className="min-w-0 px-2 sm:px-5">
            <p className="text-xs text-muted-foreground">Fatigue</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {fatigue} <span className="text-xs font-normal">ATL</span>
            </p>
          </div>
          <div className="min-w-0 pl-2 sm:pl-5">
            <p className="text-xs text-muted-foreground">Form</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {typeof form === 'number' && form > 0 ? "+" : ""}
              {form} <span className="text-xs font-normal">TSB</span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
