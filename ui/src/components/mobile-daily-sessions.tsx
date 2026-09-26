import { useEffect, useRef, useState, type PointerEvent } from "react"
import { Clock3 } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { dailyWorkouts, dashboardToday } from "@/lib/dashboard-metrics"
import { WorkoutProfile } from "@/components/workout-profile"
import { formatDuration } from "@/lib/duration"
import {
  durationMinutes,
  type PlannedWorkout,
  type TrainingContext,
} from "@/lib/training-context"

function dateAt(day: string, offset: number) {
  const value = new Date(`${day}T12:00:00`)
  value.setDate(value.getDate() + offset)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

function selectedDayLabel(day: string, today: string) {
  const date = new Date(`${day}T12:00:00`)
  const label = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
  if (day === today) return `Today · ${label}`
  if (day === dateAt(today, -1)) return `Yesterday · ${label}`
  if (day === dateAt(today, 1)) return `Tomorrow · ${label}`
  return label
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

function SessionCard({
  workout,
  dayLabel,
  activeSession,
  sessionCount,
  onOpen,
  onSelectSession,
  onMoveDay,
}: {
  workout?: PlannedWorkout
  dayLabel: string
  activeSession: number
  sessionCount: number
  onOpen: () => void
  onSelectSession: (index: number) => void
  onMoveDay: (offset: number) => void
}) {
  const completed = workout?.status === "completed"
  return (
    <Card
      role={workout ? "button" : "group"}
      tabIndex={0}
      aria-label={workout ? `Open ${workout.title}` : `${dayLabel}: no workout scheduled`}
      onClick={workout ? onOpen : undefined}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault()
          onMoveDay(event.key === "ArrowRight" ? 1 : -1)
          return
        }
        if (!workout || (event.key !== "Enter" && event.key !== " "))
          return
        event.preventDefault()
        onOpen()
      }}
      className="mobile-dashboard-workout relative h-[320px] w-full overflow-hidden border-transparent shadow-sm ring-1 ring-inset ring-border"
    >
      <CardHeader className="gap-3">
        <CardDescription>
          {dayLabel}
          {completed && <span className="ml-2 text-primary">Completed</span>}
        </CardDescription>
        {sessionCount > 1 && (
          <div className="absolute top-3 right-3 flex items-center gap-1" aria-label={`${activeSession + 1} of ${sessionCount} workouts`}>
            <button
              type="button"
              aria-label="Show next workout for this day"
              className="flex h-7 min-w-8 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums"
              onClick={(event) => {
                event.stopPropagation()
                onSelectSession((activeSession + 1) % sessionCount)
              }}
            >
              {activeSession + 1}/{sessionCount}
            </button>
            {Array.from({ length: sessionCount }, (_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Show workout ${index + 1} of ${sessionCount}`}
                aria-current={index === activeSession ? "true" : undefined}
                className="flex size-7 items-center justify-center rounded-full"
                onClick={(event) => {
                  event.stopPropagation()
                  onSelectSession(index)
                }}
              >
                <span aria-hidden="true" className={`h-1.5 rounded-full transition-all ${index === activeSession ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/40"}`} />
              </button>
            ))}
          </div>
        )}
        <CardTitle>
          <h1 className="line-clamp-2 text-2xl leading-tight font-semibold tracking-tight">
            {workout?.title ?? "No workout scheduled"}
          </h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-end gap-0">
        <div className="h-20 shrink-0 overflow-hidden">
          {workout && <WorkoutProfile workout={workout} compact tall />}
        </div>
        <div className="grid grid-cols-2 gap-4 border-t pt-4">
          <div>
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="mt-1 flex items-center gap-2 font-medium">
              <Clock3 className="size-4" />
              {workout ? formatDuration(durationMinutes(workout)) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Training load</p>
            <p className="mt-1 font-medium tabular-nums">
              {workout ? trainingLoad(workout) : 0} TSS
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
  const swipeStart = useRef<{ id: number; x: number; y: number } | null>(null)
  const ignoreClickUntil = useRef(0)
  const selectedSessions = dailyWorkouts(context, selectedDate)
  const visibleSession = Math.min(activeSession, Math.max(0, selectedSessions.length - 1))

  useEffect(() => {
    setSelectedDate(today)
    setActiveSession(0)
  }, [today])

  const moveDay = (offset: number) => {
    ignoreClickUntil.current = Date.now() + 500
    setActiveSession(0)
    setSelectedDate((day) => dateAt(day, offset))
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.isPrimary) swipeStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || start.id !== event.pointerId) return

    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return

    moveDay(deltaX < 0 ? 1 : -1)
  }

  return (
    <div
      className="col-span-2 min-w-0 touch-pan-y md:hidden"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        swipeStart.current = null
      }}
    >
      <SessionCard
        workout={selectedSessions[visibleSession]}
        dayLabel={selectedDayLabel(selectedDate, today)}
        activeSession={visibleSession}
        sessionCount={selectedSessions.length}
        onMoveDay={moveDay}
        onSelectSession={(index) => {
          if (Date.now() >= ignoreClickUntil.current) setActiveSession(index)
        }}
        onOpen={() => {
          if (Date.now() >= ignoreClickUntil.current) {
            const workout = selectedSessions[visibleSession]
            if (workout) onWorkoutOpen?.(workout)
          }
        }}
      />
    </div>
  )
}
