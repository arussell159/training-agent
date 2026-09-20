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

function clock(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds))
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`
}

function sessionSpeed(workout: PlannedWorkout) {
  const speed = sessionSummary(workout)?.average_speed
  const kind = sportKind(workout.sport)
  const label = kind === "run" || kind === "swim" ? "Avg pace" : "Avg speed"
  if (speed == null || speed <= 0) return { label, value: "—" }
  if (kind === "run") return { label, value: `${clock(1609.344 / speed)}/mi` }
  if (kind === "swim") return { label, value: `${clock(91.44 / speed)}/100y` }
  return { label, value: `${(speed * 2.236936).toFixed(1)} mph` }
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

function useBrowserLocation(enabled: boolean) {
  const [location, setLocation] = useState<Coordinates | null>(null)
  useEffect(() => {
    if (!enabled || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        setLocation({
          latitude: coords.latitude,
          longitude: coords.longitude,
        }),
      () => {},
      { enableHighAccuracy: false, maximumAge: 60 * 60 * 1000, timeout: 5000 }
    )
  }, [enabled])
  return location
}

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
  const weather = useSessionWeather(workout, fallbackLocation)
  const tss = sessionTss(workout)
  const speed = sessionSpeed(workout)
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
      className="relative w-full shrink-0 snap-center px-1 py-8 text-left"
      aria-label={`Open ${workout.title}`}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-3 text-center">
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
      <div className="mt-8 grid grid-cols-3 divide-x divide-border px-5 text-center">
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
        <div className="px-1">
          <p className="text-base font-semibold tabular-nums">{speed.value}</p>
          <p className="text-[11px] text-muted-foreground">{speed.label}</p>
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
  const [activeSession, setActiveSession] = useState(0)
  const sessionScroller = useRef<HTMLDivElement>(null)
  const sessions = useMemo(() => allSessions(context), [context])
  const selectedSessions = sessions.filter(
    (workout) => workout.workout_date === today
  )
  const savedLocation = (() => {
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
  const browserLocation = useBrowserLocation(savedLocation == null)
  const fallbackLocation = savedLocation ?? browserLocation

  useEffect(() => {
    setActiveSession(0)
    sessionScroller.current?.scrollTo({ left: 0, behavior: "smooth" })
  }, [today])

  return (
    <div className="col-span-2 min-w-0 md:hidden">
      <Card className="relative gap-0 overflow-hidden py-0 shadow-md ring-1 ring-foreground/10">
        {selectedSessions.length > 0 && (
          <div className="grid min-h-16 grid-cols-[1fr_auto_1fr] items-center border-b border-border/70 px-4 py-3">
            <span className="flex size-10 items-center justify-center rounded-full border-2 border-primary text-primary [&>svg]:size-4">
              <SportGlyph
                sport={selectedSessions[activeSession]?.sport || "workout"}
              />
            </span>
            <span className="text-base font-semibold tracking-wide uppercase">
              {(() => {
                const workout = selectedSessions[activeSession]
                if (!workout) return "Workout"
                const kind = sportKind(workout.sport)
                return kind === "other" ? workout.sport : kind
              })()}
            </span>
            <span
              className="flex items-center justify-end gap-1.5"
              aria-label={`${activeSession + 1} of ${selectedSessions.length} sessions`}
            >
              {selectedSessions.length > 1 && (
                <>
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
                </>
              )}
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
              Nothing planned for today.
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}
