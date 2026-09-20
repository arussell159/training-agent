import { formatDuration } from "@/lib/duration"
import { durationMinutes } from "@/lib/training-context"
import { recoverySeries, todaysWorkout } from "@/lib/dashboard-metrics"
import { Activity, Clock3, Gauge, HeartPulse, MoonStar } from "lucide-react"
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
import { MobileDailySessions } from "@/components/mobile-daily-sessions"

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
        const unit = part
          .match(
            /\b(hours?|hrs?|mins?|minutes?|secs?|seconds?|yds?|yards?|meters?|km)\b/i
          )?.[0]
          ?.toLowerCase()
        let width = amount
        if (unit?.startsWith("hour") || unit?.startsWith("hr")) width *= 3600
        else if (unit?.startsWith("min")) width *= 60
        else if (unit === "km") width *= 1000

        const zones = [...part.matchAll(/Z([1-5])/gi)].map((match) =>
          Number(match[1])
        )
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
    const titleSets = [
      ...title.matchAll(/(\d+)\s*[x×]\s*(\d+)\s*(min|m|yd|km)?/gi),
    ].map((match) => ({ repeats: Number(match[1]), amount: Number(match[2]) }))
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
  const liveValue = isHrv ? context.wellness?.hrv : context.wellness?.resting_hr
  const current = liveValue ?? data.at(-1)?.value
  const low = Math.min(
    ...data.map((item) => Math.min(item.baselineLow, item.value)),
    current ?? 0
  )
  const high = Math.max(
    ...data.map((item) => Math.max(item.baselineHigh, item.value)),
    current ?? 1
  )

  return (
    <Card className="min-w-0 overflow-hidden [--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(4)] lg:col-span-2">
      <CardHeader className="pb-0">
        <CardDescription>{isHrv ? "HRV" : "RHR"}</CardDescription>
        <CardTitle className="text-2xl tabular-nums sm:text-3xl">
          {current ?? "—"}
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
        <ChartContainer
          config={recoveryChartConfig}
          className="h-20 w-full sm:h-24"
        >
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
                  pointOnly
                  formatter={(value) => {
                    const unit = isHrv ? "ms" : "bpm"
                    return (
                      <span>
                        {Number(value).toFixed(0)} {unit}
                      </span>
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
        {data.length > 0 && (
          <div
            className="flex flex-wrap justify-between gap-1 px-3 pt-1 text-[11px] text-muted-foreground"
            aria-label={`${isHrv ? "HRV" : "Resting heart rate"} baseline range`}
          >
            <span>Low {data.at(-1)!.baselineLow}</span>
            <span>Avg {data.at(-1)!.average}</span>
            <span>
              High {data.at(-1)!.baselineHigh} {isHrv ? "ms" : "bpm"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function sleepDuration(value: number) {
  const totalMinutes = Math.max(0, Math.round(value / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${String(minutes).padStart(2, "0")}m`
}

function sleepLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/ Secs?$/i, "")
}

function formatSleepDetail(key: string, value: unknown) {
  if (typeof value === "number") {
    if (/secs?|seconds?/i.test(key) || /^sleep$/i.test(key))
      return sleepDuration(value)
    if (/hours?/i.test(key)) return `${value.toFixed(1)} h`
    if (/percent|percentage/i.test(key)) return `${Math.round(value)}%`
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)
  }
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "string") return value
  return null
}

function SleepCard({ context }: { context: TrainingContext }) {
  const rows = [...(context.wellness_history || [])].sort((a, b) =>
    String(a.date || a.id || "").localeCompare(String(b.date || b.id || ""))
  )
  const latest =
    rows
      .filter(
        (row) =>
          Object.keys(row).some((key) => /sleep|bed|wake|rem|nap/i.test(key)) ||
          (Array.isArray(row.details) &&
            row.details.some(
              (detail) =>
                detail &&
                typeof detail === "object" &&
                "label" in detail &&
                /sleep|bed|wake|rem|nap/i.test(String(detail.label))
            ))
      )
      .at(-1) || null
  const total =
    context.wellness?.sleep ??
    (typeof latest?.sleepSecs === "number"
      ? latest.sleepSecs
      : typeof latest?.sleep === "number"
        ? latest.sleep
        : typeof latest?.sleep_hours === "number"
          ? latest.sleep_hours * 3600
          : null)
  const details = latest
    ? Object.entries(latest)
        .filter(
          ([key, value]) =>
            value != null &&
            !["sleep", "sleepSecs", "date", "id", "timeStamp"].includes(key) &&
            /sleep|bed|wake|rem|nap/i.test(key)
        )
        .flatMap(([key, value]) => {
          const formatted = formatSleepDetail(key, value)
          return formatted ? [{ label: sleepLabel(key), value: formatted }] : []
        })
    : []
  const legacyDetails = Array.isArray(latest?.details)
    ? latest.details.flatMap((detail) => {
        if (!detail || typeof detail !== "object") return []
        const item = detail as { label?: unknown; value?: unknown }
        if (
          typeof item.label !== "string" ||
          !/sleep|bed|wake|rem|nap/i.test(item.label)
        )
          return []
        const formatted = formatSleepDetail(item.label, item.value)
        return formatted ? [{ label: item.label, value: formatted }] : []
      })
    : []
  const allDetails = [...details, ...legacyDetails].filter(
    (item, index, values) =>
      values.findIndex((candidate) => candidate.label === item.label) === index
  )
  const date = latest?.date || latest?.id || latest?.timeStamp
  return (
    <Card className="col-span-2 min-w-0 [--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(4)] lg:col-span-6">
      <CardHeader>
        <CardDescription>
          Sleep
          {date ? (
            <span className="ml-2">
              {new Date(
                `${String(date).slice(0, 10)}T12:00:00`
              ).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          ) : null}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums sm:text-3xl">
          {total != null && Number.isFinite(total) ? sleepDuration(total) : "—"}
        </CardTitle>
        <CardAction>
          <MoonStar className="size-4 text-muted-foreground" />
        </CardAction>
      </CardHeader>
      <CardContent>
        {allDetails.length ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-3 sm:grid-cols-3 sm:pt-4">
            {allDetails.map((detail) => (
              <div key={detail.label} className="min-w-0">
                <p className="truncate text-xs text-muted-foreground">
                  {detail.label}
                </p>
                <p className="mt-1 font-medium tabular-nums">{detail.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="border-t pt-3 text-xs text-muted-foreground sm:pt-4">
            No additional sleep details are available from Intervals.icu.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

import {
  hasWorkoutStructure,
  structuredWorkoutProfile,
} from "@/lib/workout-structure"

export function SectionCards({
  context,
  onWorkoutOpen,
}: {
  context: TrainingContext
  onWorkoutOpen?: (workout: PlannedWorkout) => void
}) {
  const today = todaysWorkout(context)
  const fitness =
    context.metrics.fitness == null ? "—" : Math.round(context.metrics.fitness)
  const fatigue =
    context.metrics.fatigue == null ? "—" : Math.round(context.metrics.fatigue)
  const form =
    context.metrics.form == null ? "—" : Math.round(context.metrics.form)
  const profile = structuredWorkoutProfile(today?.structure)

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-12">
      <MobileDailySessions context={context} onWorkoutOpen={onWorkoutOpen} />
      <Card
        role={onWorkoutOpen ? "button" : undefined}
        tabIndex={onWorkoutOpen ? 0 : undefined}
        aria-label={onWorkoutOpen && today ? `Open ${today.title}` : undefined}
        onClick={() => today && onWorkoutOpen?.(today)}
        onKeyDown={(event) => {
          if (!onWorkoutOpen || (event.key !== "Enter" && event.key !== " "))
            return
          event.preventDefault()
          if (today) onWorkoutOpen(today)
        }}
        className="col-span-2 hidden min-w-0 md:flex lg:col-span-6 lg:row-span-2"
      >
        <CardHeader className="gap-3">
          <CardDescription>
            Today&apos;s workout
            {today?.status === "completed" && (
              <span className="ml-2 text-primary">Completed</span>
            )}
          </CardDescription>
          <CardTitle>
            <h1 className="text-2xl leading-tight font-semibold tracking-tight md:text-3xl">
              {today?.title ?? "No workout scheduled"}
            </h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col justify-end gap-3">
          {hasWorkoutStructure(today?.structure) && (
            <div>
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
            </div>
          )}
          <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">
            {today?.goal ?? "Keep the day easy and protect recovery."}
          </p>
          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <div>
              <p className="text-xs text-muted-foreground">Duration</p>
              <p className="mt-1 flex items-center gap-2 font-medium">
                <Clock3 className="size-4" />{" "}
                {today ? formatDuration(durationMinutes(today)) : "—"}
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
      <SleepCard context={context} />

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
              {typeof form === "number" && form > 0 ? "+" : ""}
              {form} <span className="text-xs font-normal">TSB</span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
