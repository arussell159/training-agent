import { useEffect, useMemo, useRef, useState } from "react"
import {
  Bike,
  CalendarClock,
  Check,
  Dumbbell,
  Footprints,
  Waves,
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

function SessionSlide({
  workout,
  onOpen,
}: {
  workout: PlannedWorkout
  onOpen: () => void
}) {
  const completed = workout.status === "completed"
  const distance = plannedDistanceLabel(workout)
  const kind = sportKind(workout.sport)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative w-full shrink-0 snap-center text-left"
      aria-label={`Open ${workout.title}`}
    >
      <div className="flex items-center justify-center px-12">
        <span className="absolute left-3 flex size-9 items-center justify-center rounded-full border-2 border-current text-primary [&>svg]:size-4">
          <SportGlyph sport={workout.sport} />
        </span>
        <span className="text-base font-semibold tracking-wide uppercase">
          {kind === "other" ? workout.sport : kind}
        </span>
      </div>
      <div className="flex flex-col items-center px-4 pt-3 text-center">
        <span
          className={`flex size-16 items-center justify-center rounded-full border-[5px] ${completed ? "border-emerald-500/80 text-emerald-500" : "border-primary/45 text-primary"}`}
        >
          {completed ? (
            <Check className="size-8" strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <SportGlyph sport={workout.sport} />
          )}
        </span>
        <h2 className="mt-2 line-clamp-2 text-lg leading-tight font-semibold">
          {workout.title}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {completed ? "Completed" : "Planned"}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-border px-2 text-center">
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
          <p className="text-base font-semibold tabular-nums">
            {workout.load != null ? Math.round(workout.load) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">TSS</p>
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
      <Card className="relative gap-0 py-3">
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
            className="flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
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
        className="mt-2 flex snap-x snap-mandatory [scrollbar-width:none] gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [&::-webkit-scrollbar]:hidden"
        aria-label="Choose training day"
      >
        {days.map((day) => {
          const date = new Date(`${day}T12:00:00`)
          const daySessions = sessions.filter(
            (workout) => workout.workout_date === day
          )
          const selected = day === selectedDate
          return (
            <button
              key={day}
              type="button"
              data-session-date={day}
              onClick={() => setSelectedDate(day)}
              className={`flex min-w-[62px] snap-center flex-col items-center rounded-xl px-2 py-2 ring-1 transition-colors ${selected ? "bg-card text-foreground ring-primary/35" : "bg-card/55 text-muted-foreground ring-foreground/5"}`}
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
