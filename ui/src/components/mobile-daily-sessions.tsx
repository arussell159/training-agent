import { useEffect, useRef, useState, type TouchEvent } from "react"
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
  workouts,
  dayLabel,
  onOpen,
  onMoveDay,
}: {
  workouts: PlannedWorkout[]
  dayLabel: string
  onOpen: (workout: PlannedWorkout) => void
  onMoveDay: (offset: number) => void
}) {
  const workout = workouts[0]
  const multiple = workouts.length > 1
  const completed = workout?.status === "completed"
  return (
    <Card
      role={workout && !multiple ? "button" : "group"}
      tabIndex={0}
      aria-label={multiple ? `${dayLabel}: ${workouts.length} workouts` : workout ? `Open ${workout.title}` : `${dayLabel}: no workout scheduled`}
      onClick={workout && !multiple ? () => onOpen(workout) : undefined}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault()
          onMoveDay(event.key === "ArrowRight" ? 1 : -1)
          return
        }
        if (!workout || multiple || (event.key !== "Enter" && event.key !== " "))
          return
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onOpen(workout)
      }}
      className="mobile-dashboard-workout relative h-[320px] w-full overflow-hidden border-transparent shadow-sm ring-1 ring-inset ring-border"
    >
      <CardHeader className="gap-3">
        <CardDescription>
          {dayLabel}
          {!multiple && completed && <span className="ml-2 text-primary">Completed</span>}
        </CardDescription>
        {multiple ? (
          <span className="absolute top-4 right-4 text-xs font-medium text-muted-foreground">
            {workouts.length} workouts
          </span>
        ) : (
          <CardTitle>
            <h1 className="line-clamp-2 text-2xl leading-tight font-semibold tracking-tight">
              {workout?.title ?? "No workout scheduled"}
            </h1>
          </CardTitle>
        )}
      </CardHeader>
      {multiple ? (
        <CardContent className={`flex min-h-0 flex-1 flex-col ${workouts.length > 2 ? "overflow-y-auto" : "overflow-hidden"}`}>
          {workouts.map((session) => (
            <div
              key={session.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ${session.title}`}
              className="flex min-h-[120px] shrink-0 cursor-pointer flex-col justify-between border-t py-2 first:border-t-0"
              onClick={(event) => {
                event.stopPropagation()
                onOpen(session)
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                event.stopPropagation()
                onOpen(session)
              }}
            >
              <h2 className="line-clamp-2 text-[15px] leading-5 font-semibold">{session.title}</h2>
              <div className="h-12 overflow-hidden">
                <WorkoutProfile workout={session} compact />
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>{formatDuration(durationMinutes(session))}</span>
                <span>{trainingLoad(session)} TSS</span>
                {session.status === "completed" && <span className="text-primary">Completed</span>}
              </div>
            </div>
          ))}
        </CardContent>
      ) : (
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
      )}
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
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const ignoreClickUntil = useRef(0)
  const selectedSessions = dailyWorkouts(context, selectedDate)

  useEffect(() => {
    setSelectedDate(today)
  }, [today])

  const moveDay = (offset: number) => {
    ignoreClickUntil.current = Date.now() + 500
    setSelectedDate((day) => dateAt(day, offset))
  }

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (touch) swipeStart.current = { x: touch.clientX, y: touch.clientY }
  }

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    const touch = event.changedTouches[0]
    swipeStart.current = null
    if (!start || !touch) return

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return

    moveDay(deltaX < 0 ? 1 : -1)
  }

  return (
    <div
      className="col-span-2 min-w-0 touch-pan-y md:hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        swipeStart.current = null
      }}
    >
      <SessionCard
        workouts={selectedSessions}
        dayLabel={selectedDayLabel(selectedDate, today)}
        onMoveDay={moveDay}
        onOpen={(workout) => {
          if (Date.now() >= ignoreClickUntil.current) onWorkoutOpen?.(workout)
        }}
      />
    </div>
  )
}
