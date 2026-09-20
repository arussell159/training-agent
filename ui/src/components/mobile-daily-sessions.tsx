import { useEffect, useMemo, useRef, useState } from "react"
import { Clock3 } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { dashboardToday } from "@/lib/dashboard-metrics"
import { formatDuration } from "@/lib/duration"
import {
  durationMinutes,
  type PlannedWorkout,
  type TrainingContext,
} from "@/lib/training-context"
import { workoutProfileSegments } from "@/lib/workout-structure"

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

function selectedDayLabel(day: string, today: string) {
  if (day === today) return "Today’s workout"
  return `${new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
  })} workout`
}

function trainingLoad(workout: PlannedWorkout) {
  return Math.round(
    workout.workout_summary?.completed?.tss ??
      workout.workout_summary?.planned?.tss ??
      workout.completed_data?.tss ??
      workout.planned?.tss ??
      workout.load ??
      0
  )
}

function compactProfile(workout: PlannedWorkout) {
  const segments = workoutProfileSegments(workout.structure)
  if (segments.length <= 96) return segments
  const size = Math.ceil(segments.length / 96)
  return Array.from(
    { length: Math.ceil(segments.length / size) },
    (_, index) => {
      const group = segments.slice(index * size, (index + 1) * size)
      const width = group.reduce((sum, segment) => sum + segment.width, 0)
      const intensity = width
        ? group.reduce(
            (sum, segment) => sum + segment.intensity * segment.width,
            0
          ) / width
        : 0
      return { width, intensity }
    }
  )
}

function profileBarColor(intensity: number) {
  if (intensity <= 8) return "bg-muted-foreground/25"
  if (intensity < 45) return "bg-primary/45"
  if (intensity < 70) return "bg-primary/70"
  return "bg-primary"
}

function DashboardWorkoutProfile({ workout }: { workout: PlannedWorkout }) {
  const bars = compactProfile(workout)
  if (!bars.length) return null
  return (
    <div
      className="relative h-24 overflow-hidden rounded-xl border border-border/70 bg-muted/25 p-2.5 shadow-inner"
      role="img"
      aria-label="Workout intensity profile"
    >
      <span className="pointer-events-none absolute inset-x-2.5 top-1/3 border-t border-border/45" />
      <span className="pointer-events-none absolute inset-x-2.5 top-2/3 border-t border-border/45" />
      <div className="relative z-10 flex h-full items-end gap-px">
        {bars.map((bar, index) => (
          <span
            key={index}
            className={`min-w-0 rounded-t-[3px] shadow-[0_-1px_0_rgba(255,255,255,0.16)] ${profileBarColor(bar.intensity)}`}
            style={{
              flexBasis: 0,
              flexGrow: Math.max(1, bar.width),
              height: `${Math.max(7, bar.intensity)}%`,
            }}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  )
}

function SessionCard({
  workout,
  dayLabel,
  activeSession,
  sessionCount,
  onOpen,
}: {
  workout: PlannedWorkout
  dayLabel: string
  activeSession: number
  sessionCount: number
  onOpen: () => void
}) {
  const completed = workout.status === "completed"
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Open ${workout.title}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        onOpen()
      }}
      className="relative w-full shrink-0 snap-center overflow-hidden border-transparent shadow-sm ring-1 ring-inset ring-border"
    >
      <CardHeader className="gap-3">
        <CardDescription>
          {dayLabel}
          {completed && <span className="ml-2 text-primary">Completed</span>}
        </CardDescription>
        {sessionCount > 1 && (
          <div
            className="absolute top-4 right-4 flex items-center gap-1.5"
            aria-label={`${activeSession + 1} of ${sessionCount} sessions`}
          >
            <span className="text-xs font-semibold tabular-nums">
              {activeSession + 1}/{sessionCount}
            </span>
            <span className="flex gap-1">
              {Array.from({ length: sessionCount }, (_, index) => (
                <span
                  key={index}
                  className={`h-1.5 rounded-full transition-all ${index === activeSession ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/35"}`}
                />
              ))}
            </span>
          </div>
        )}
        <CardTitle>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">
            {workout.title}
          </h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-end gap-4">
        <DashboardWorkoutProfile workout={workout} />
        <div className="grid grid-cols-2 gap-4 border-t pt-4">
          <div>
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="mt-1 flex items-center gap-2 font-medium">
              <Clock3 className="size-4" />
              {formatDuration(durationMinutes(workout))}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Training load</p>
            <p className="mt-1 font-medium tabular-nums">
              {trainingLoad(workout)} TSS
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
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
      {selectedSessions.length ? (
        <div
          ref={sessionScroller}
          className="flex snap-x snap-mandatory [scrollbar-width:none] gap-3 overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
          onScroll={(event) => {
            const first = event.currentTarget
              .firstElementChild as HTMLElement | null
            const step = first ? first.offsetWidth + 12 : 0
            if (!step) return
            setActiveSession(
              Math.min(
                selectedSessions.length - 1,
                Math.max(0, Math.round(event.currentTarget.scrollLeft / step))
              )
            )
          }}
        >
          {selectedSessions.map((workout) => (
            <SessionCard
              key={workout.id}
              workout={workout}
              dayLabel={selectedDayLabel(selectedDate, today)}
              activeSession={activeSession}
              sessionCount={selectedSessions.length}
              onOpen={() => onWorkoutOpen?.(workout)}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardDescription>
              {selectedDayLabel(selectedDate, today)}
            </CardDescription>
            <CardTitle>
              <h1 className="text-2xl leading-tight font-semibold tracking-tight">
                No workout scheduled
              </h1>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 border-t pt-4">
              <div>
                <p className="text-xs text-muted-foreground">Duration</p>
                <p className="mt-1 flex items-center gap-2 font-medium">
                  <Clock3 className="size-4" />—
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Training load</p>
                <p className="mt-1 font-medium">0 TSS</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div
        ref={dateScroller}
        className="mt-3 flex snap-x snap-mandatory [scrollbar-width:none] gap-1.5 overflow-x-auto overscroll-x-contain px-0.5 py-1 [&::-webkit-scrollbar]:hidden"
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
              className={`flex min-w-[62px] snap-center flex-col items-center rounded-xl border-2 px-2 py-2.5 transition-colors ${isToday ? "border-primary bg-muted/80 text-foreground" : selected ? "border-foreground/20 bg-muted/80 text-foreground" : "border-transparent bg-muted/40 text-muted-foreground"}`}
              aria-pressed={selected}
              aria-current={isToday ? "date" : undefined}
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
