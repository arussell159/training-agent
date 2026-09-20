import { useEffect, useMemo, useRef, useState } from "react"
import {
  Bike,
  CalendarClock,
  Check,
  Dumbbell,
  Footprints,
  Sun,
  Waves,
  Zap,
} from "lucide-react"

import { Card } from "@/components/ui/card"
import { formatDuration } from "@/lib/duration"
import { dashboardToday } from "@/lib/dashboard-metrics"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import {
  completedMinutes,
  durationMinutes,
  type PlannedWorkout,
  type TrainingContext,
} from "@/lib/training-context"

const DAY_RANGE = 14

function dateAt(day: string, offset: number) {
  const value = new Date(`${day}T12:00:00`)
  value.setDate(value.getDate() + offset)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

function sportKind(sport: string) {
  const value = sport.toLowerCase()
  if (value.includes("swim")) return "swim"
  if (
    value.includes("bike") ||
    value.includes("ride") ||
    value.includes("brick")
  )
    return "bike"
  if (value.includes("run")) return "run"
  if (value.includes("strength")) return "strength"
  return "other"
}

const sportColor = {
  swim: "bg-cyan-500",
  bike: "bg-orange-500",
  run: "bg-lime-500",
  strength: "bg-violet-500",
  other: "bg-slate-400",
} as const

function SportGlyph({ sport }: { sport: string }) {
  const kind = sportKind(sport)
  if (kind === "swim") return <Waves aria-hidden="true" />
  if (kind === "bike") return <Bike aria-hidden="true" />
  if (kind === "run") return <Footprints aria-hidden="true" />
  if (kind === "strength") return <Dumbbell aria-hidden="true" />
  return <CalendarClock aria-hidden="true" />
}

function allSessions(context: TrainingContext) {
  const candidates = [
    ...context.planned,
    ...(context.history.filter((item) => "id" in item) as PlannedWorkout[]),
  ]
  const sessions = new Map<string, PlannedWorkout>()
  for (const workout of candidates) {
    const key = workout.activity_id
      ? `activity:${workout.activity_id}`
      : workout.id
    const current = sessions.get(key)
    if (!current || workout.id.startsWith("event:")) sessions.set(key, workout)
  }
  return [...sessions.values()].sort((a, b) =>
    String(
      a.scheduled_start_at || a.recorded_start_local || a.title
    ).localeCompare(
      String(b.scheduled_start_at || b.recorded_start_local || b.title)
    )
  )
}

function sessionDuration(workout: PlannedWorkout) {
  const minutes =
    workout.status === "completed" && completedMinutes(workout) > 0
      ? completedMinutes(workout)
      : durationMinutes(workout)
  return minutes > 0 ? formatDuration(minutes) : "—"
}

function sessionSummary(workout: PlannedWorkout) {
  const completed = workout.status === "completed"
  return completed
    ? workout.workout_summary?.completed
    : workout.workout_summary?.planned
}

function sessionTime(workout: PlannedWorkout) {
  const source =
    workout.status === "completed"
      ? workout.recorded_start_local
      : workout.scheduled_start_at
  const match = source?.match(/T(\d{2}):(\d{2})/)
  if (!match) return "—"
  const hour = Number(match[1])
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`
}

function sessionTss(workout: PlannedWorkout) {
  const value =
    sessionSummary(workout)?.tss ??
    (workout.status === "completed"
      ? workout.completed_data?.tss
      : workout.planned?.tss) ??
    workout.load
  return value != null && Number.isFinite(value) ? Math.round(value) : null
}

function stressLabel(tss: number | null) {
  if (tss == null) return "Stress unavailable"
  if (tss < 50) return "Low stress"
  if (tss < 100) return "Moderate stress"
  if (tss < 150) return "High stress"
  return "Extreme stress"
}

type Coordinates = { latitude: number; longitude: number }
type Weather = { temperatureF: number | null; humidity: number | null }

function useSessionWeather(
  workout: PlannedWorkout,
  fallbackLocation: Coordinates | null
) {
  const summary = sessionSummary(workout)
  const directTemperature =
    summary?.temperature_c != null ? summary.temperature_c * (9 / 5) + 32 : null
  const directHumidity = summary?.humidity_percent ?? null
  const fallbackLatitude = fallbackLocation?.latitude
  const fallbackLongitude = fallbackLocation?.longitude
  const [weather, setWeather] = useState<Weather>({
    temperatureF: directTemperature,
    humidity: directHumidity,
  })

  useEffect(() => {
    setWeather({ temperatureF: directTemperature, humidity: directHumidity })
    if (directTemperature != null && directHumidity != null) return
    const latitude = summary?.latitude ?? fallbackLatitude
    const longitude = summary?.longitude ?? fallbackLongitude
    if (latitude == null || longitude == null || !workout.workout_date) return
    const controller = new AbortController()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 5)
    const historical = workout.workout_date < cutoff.toISOString().slice(0, 10)
    const base = historical
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast"
    const query = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      start_date: workout.workout_date,
      end_date: workout.workout_date,
      hourly: "temperature_2m,relative_humidity_2m",
      temperature_unit: "fahrenheit",
      timezone: "auto",
    })
    void fetch(`${base}?${query}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Weather unavailable")
        return response.json()
      })
      .then((result) => {
        const times = result.hourly?.time as string[] | undefined
        if (!times?.length) return
        const start =
          workout.recorded_start_local ||
          workout.scheduled_start_at ||
          `${workout.workout_date}T12:00`
        const target = Date.parse(start)
        const index = times.reduce(
          (best, time, current) =>
            Math.abs(Date.parse(time) - target) <
            Math.abs(Date.parse(times[best]) - target)
              ? current
              : best,
          0
        )
        setWeather({
          temperatureF:
            directTemperature ?? result.hourly.temperature_2m?.[index] ?? null,
          humidity:
            directHumidity ??
            result.hourly.relative_humidity_2m?.[index] ??
            null,
        })
      })
      .catch(() => {})
    return () => controller.abort()
  }, [
    directHumidity,
    directTemperature,
    fallbackLatitude,
    fallbackLongitude,
    summary?.latitude,
    summary?.longitude,
    workout.recorded_start_local,
    workout.scheduled_start_at,
    workout.workout_date,
  ])
  return weather
}

function SessionSlide({
  workout,
  onOpen,
  fallbackLocation,
}: {
  workout: PlannedWorkout
  onOpen: () => void
  fallbackLocation: Coordinates | null
}) {
  const completed = workout.status === "completed"
  const distance = plannedDistanceLabel(workout)
  const kind = sportKind(workout.sport)
  const weather = useSessionWeather(workout, fallbackLocation)
  const tss = sessionTss(workout)
  const weatherLabel = [
    weather.temperatureF != null
      ? `${Math.round(weather.temperatureF)}°F`
      : null,
    weather.humidity != null ? `${Math.round(weather.humidity)}%` : null,
  ]
    .filter(Boolean)
    .join(" | ")
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative w-full shrink-0 snap-center text-left"
      aria-label={`Open ${workout.title}`}
    >
      <div className="flex items-center justify-center px-12">
        <span className="absolute top-0.5 left-3 flex size-9 items-center justify-center rounded-full border-2 border-current text-primary [&>svg]:size-4">
          <SportGlyph sport={workout.sport} />
        </span>
        <span className="text-base font-semibold tracking-wide uppercase">
          {kind === "other" ? workout.sport : kind}
        </span>
      </div>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center px-3 text-center">
        <span className="flex min-w-0 flex-col items-center">
          <span className="flex size-11 items-center justify-center rounded-full border-4 border-muted text-muted-foreground">
            <Sun className="size-5" aria-hidden="true" />
          </span>
          <strong className="mt-2 text-sm tabular-nums">
            {sessionTime(workout)}
          </strong>
          <span className="mt-0.5 min-h-4 text-[11px] text-muted-foreground">
            {weatherLabel || "Weather unavailable"}
          </span>
        </span>
        <span
          className={`flex size-20 items-center justify-center rounded-full border-[6px] ${completed ? "border-emerald-500/80 text-emerald-500" : "border-primary/45 text-primary"}`}
        >
          {completed ? (
            <Check className="size-8" strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <SportGlyph sport={workout.sport} />
          )}
        </span>
        <span className="flex min-w-0 flex-col items-center">
          <span className="flex size-11 items-center justify-center rounded-full border-4 border-primary/45 text-primary">
            <Zap className="size-5" aria-hidden="true" />
          </span>
          <strong className="mt-2 text-sm tabular-nums">
            {tss == null ? "—" : `${tss} TSS`}
          </strong>
          <span className="mt-0.5 text-[11px] text-muted-foreground">
            {stressLabel(tss)}
          </span>
        </span>
      </div>
      <div className="px-4 text-center">
        <h2 className="mt-4 line-clamp-2 text-lg leading-tight font-semibold">
          {workout.title}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {completed ? "Completed" : "Planned"}
        </p>
      </div>
      <div className="mt-5 grid grid-cols-2 divide-x divide-border px-7 pb-2 text-center">
        <div className="px-1">
          <p className="text-base font-semibold tabular-nums">
            {sessionDuration(workout)}
          </p>
          <p className="text-[11px] text-muted-foreground">Duration</p>
        </div>
        <div className="px-1">
          <p className="text-base font-semibold tabular-nums">{distance}</p>
          <p className="text-[11px] text-muted-foreground">Distance</p>
        </div>
      </div>
    </button>
  )
}

export function MobileDailySessions({
  context,
  onWorkoutOpen,
}: {
  context: TrainingContext
  onWorkoutOpen?: (workout: PlannedWorkout) => void
}) {
  const today = dashboardToday(context)
  const [selectedDate, setSelectedDate] = useState(today)
  const [activeSession, setActiveSession] = useState(0)
  const sessionScroller = useRef<HTMLDivElement>(null)
  const dateScroller = useRef<HTMLDivElement>(null)
  const sessions = useMemo(() => allSessions(context), [context])
  const days = useMemo(
    () =>
      Array.from({ length: DAY_RANGE * 2 + 1 }, (_, index) =>
        dateAt(today, index - DAY_RANGE)
      ),
    [today]
  )
  const selectedSessions = sessions.filter(
    (workout) => workout.workout_date === selectedDate
  )
  const fallbackLocation = (() => {
    for (const workout of sessions) {
      const values = workout.workout_summary?.completed
      if (values?.latitude != null && values.longitude != null)
        return { latitude: values.latitude, longitude: values.longitude }
    }
    const athlete = context.athlete as TrainingContext["athlete"] & {
      latitude?: number
      longitude?: number
    }
    return athlete.latitude != null && athlete.longitude != null
      ? { latitude: athlete.latitude, longitude: athlete.longitude }
      : null
  })()

  useEffect(() => {
    setActiveSession(0)
    sessionScroller.current?.scrollTo({ left: 0, behavior: "smooth" })
  }, [selectedDate])

  useEffect(() => {
    dateScroller.current
      ?.querySelector<HTMLElement>(`[data-session-date="${today}"]`)
      ?.scrollIntoView({ inline: "center", block: "nearest" })
  }, [today])

  return (
    <div className="col-span-2 min-w-0 md:hidden">
      <Card className="relative gap-0 py-5 shadow-lg ring-2 ring-foreground/15">
        {selectedSessions.length > 1 && (
          <div
            className="absolute top-5 right-3 z-10 flex items-center gap-1.5"
            aria-label={`${activeSession + 1} of ${selectedSessions.length} sessions`}
          >
            <span className="text-xs font-semibold tabular-nums">
              {activeSession + 1}/{selectedSessions.length}
            </span>
            <span className="flex gap-1">
              {selectedSessions.map((workout, index) => (
                <span
                  key={workout.id}
                  className={`h-1.5 rounded-full transition-all ${index === activeSession ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/35"}`}
                />
              ))}
            </span>
          </div>
        )}
        {selectedSessions.length ? (
          <div
            ref={sessionScroller}
            className="flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain p-0.5 [&::-webkit-scrollbar]:hidden"
            onScroll={(event) => {
              const width = event.currentTarget.clientWidth
              if (width)
                setActiveSession(
                  Math.min(
                    selectedSessions.length - 1,
                    Math.max(
                      0,
                      Math.round(event.currentTarget.scrollLeft / width)
                    )
                  )
                )
            }}
          >
            {selectedSessions.map((workout) => (
              <SessionSlide
                key={workout.id}
                workout={workout}
                onOpen={() => onWorkoutOpen?.(workout)}
                fallbackLocation={fallbackLocation}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center">
            <span className="flex size-14 items-center justify-center rounded-full border-4 border-muted text-muted-foreground">
              <CalendarClock className="size-6" aria-hidden="true" />
            </span>
            <h2 className="mt-3 text-lg font-semibold">
              No sessions scheduled
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose another day below.
            </p>
          </div>
        )}
      </Card>

      <div
        ref={dateScroller}
        className="mt-3 flex snap-x snap-mandatory [scrollbar-width:none] gap-1.5 overflow-x-auto overscroll-x-contain rounded-xl bg-muted/35 p-2 ring-1 ring-foreground/5 [&::-webkit-scrollbar]:hidden"
        aria-label="Choose training day"
      >
        {days.map((day) => {
          const date = new Date(`${day}T12:00:00`)
          const daySessions = sessions.filter(
            (workout) => workout.workout_date === day
          )
          const selected = day === selectedDate
          const isToday = day === today
          return (
            <button
              key={day}
              type="button"
              data-session-date={day}
              onClick={() => setSelectedDate(day)}
              className={`flex min-w-[62px] snap-center flex-col items-center rounded-xl px-2 py-2 ring-1 transition-colors ${isToday ? "bg-primary/5 text-foreground ring-2 ring-primary" : selected ? "bg-card text-foreground ring-primary/50" : "bg-card/70 text-muted-foreground ring-foreground/10"}`}
              aria-pressed={selected}
            >
              <span className="text-lg font-semibold tabular-nums">
                {date.getDate()}
              </span>
              <span className="text-xs">
                {date.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <span className="mt-2 flex min-h-1 items-center justify-center gap-1">
                {daySessions.map((workout) => (
                  <span
                    key={workout.id}
                    className={`h-1 w-4 rounded-full ${sportColor[sportKind(workout.sport)]}`}
                    aria-hidden="true"
                  />
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
