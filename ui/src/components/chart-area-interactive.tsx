import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {formatDuration} from '@/lib/duration'
import {workoutDurations} from '@/lib/dashboard-metrics'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  completedMinutes,
  durationMinutes,
  type TrainingContext,
} from "@/lib/training-context"

const currentWeekChartConfig = {
  completed: { label: "Completed", color: "var(--chart-2)" },
  remaining: { label: "Planned", color: "var(--muted)" },
} satisfies ChartConfig

const historyChartConfig = {
  completed: { label: "Duration", color: "var(--chart-2)" },
} satisfies ChartConfig

function formatHours(hours: number) {
  return formatDuration(hours * 60)
}

function weekStart(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

function currentWeekByDay(context: TrainingContext) {
  const localDateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  const today = new Date()
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))

  const workoutsById = new Map<string, (typeof context.planned)[number]>()
  for (const workout of [...context.planned, ...(context.history as (typeof context.planned)[number][])]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workout.workout_date ?? "")) continue
    const key = String(workout.id ?? `${workout.workout_date}:${workout.title ?? workout.sport}`)
    workoutsById.set(key, { ...workoutsById.get(key), ...workout })
  }
  const datedWorkouts = [...workoutsById.values()]

  if (datedWorkouts.length) {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday)
      date.setDate(monday.getDate() + index)
      return {
        key: localDateKey(date),
        day: date.toLocaleDateString("en-US", {
          weekday: "short",
        }).toUpperCase(),
        planned: 0,
        completed: 0,
        remaining: 0,
      }
    })

    for (const workout of datedWorkouts) {
      const day = days.find((item) => item.key === workout.workout_date)
      if (!day) continue
      const amounts = workoutDurations(workout)
      day.planned += amounts.planned / 60
      day.completed += amounts.completed / 60
      day.remaining += amounts.remaining / 60
    }
    return days.map((day) => ({
      ...day,
      remaining: day.remaining,
    }))
  }

  const labels = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
  return labels.map((label) => {
    const workouts = context.planned.filter(
      (workout) => workout.day.slice(0, 3).toUpperCase() === label
    )
    const planned =
      workouts.reduce((sum, workout) => sum + durationMinutes(workout), 0) / 60
    const completed =
      workouts.reduce((sum, workout) => sum + completedMinutes(workout), 0) / 60
    return {
      key: label,
      day: label,
      planned,
      completed,
      remaining: Math.max(0, planned - completed),
    }
  })
}

function groupHistoryByWeek(context: TrainingContext) {
  const weeks = new Map<string, { week: string; completed: number }>()

  for (const item of context.history.slice(-90)) {
    const key = weekStart(item.workout_date)
    const current = weeks.get(key) ?? { week: key, completed: 0 }
    current.completed += Number(item.completed?.duration_minutes ?? 0) / 60
    weeks.set(key, current)
  }

  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week))
}

export function ChartAreaInteractive({ context }: { context: TrainingContext }) {
  const currentWeek = currentWeekByDay(context)
  const weeklyHistory = groupHistoryByWeek(context)
  const plannedTotal = currentWeek.reduce((sum, item) => sum + item.planned, 0)
  const completedTotal = currentWeek.reduce(
    (sum, item) => sum + item.completed,
    0
  )

  return (
    <div className="grid min-w-0 gap-3 sm:gap-4 xl:grid-cols-12">
      <Card className="min-w-0 [--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(4)] xl:col-span-5">
        <CardHeader>
          <CardTitle>This week</CardTitle>
          <CardAction className="hidden text-right sm:block">
            <p className="text-sm font-semibold tabular-nums">
              {formatHours(plannedTotal)}
            </p>
            <p className="text-xs text-muted-foreground">planned</p>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={currentWeekChartConfig}
            className="aspect-auto h-[220px] w-full sm:h-[260px]"
          >
            <BarChart data={currentWeek} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                width={32}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => `${Number(value).toFixed(0)}h`}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    formatter={(_value, name, _item, _index, payload) => {
                      if (name === "remaining") return null
                      const day = payload as unknown as {
                        completed?: number
                        planned?: number
                      }
                      return (
                        <div className="grid min-w-32 flex-1 gap-1">
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">Completed</span>
                            <span className="font-mono font-medium">
                              {formatHours(Number(day.completed ?? 0))}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">Planned</span>
                            <span className="font-mono font-medium">
                              {formatHours(Number(day.planned ?? 0))}
                            </span>
                          </div>
                        </div>
                      )
                    }}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="completed"
                stackId="duration"
                fill="var(--color-completed)"
                radius={[0, 0, 4, 4]}
              />
              <Bar
                dataKey="remaining"
                stackId="duration"
                fill="var(--color-remaining)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
          <div className="mt-3 grid grid-cols-2 divide-x border-t pt-3 text-sm sm:mt-4 sm:pt-4">
            <div>
              <p className="text-xs text-muted-foreground">Planned</p>
              <p className="mt-1 font-semibold tabular-nums">
                {formatHours(plannedTotal)}
              </p>
            </div>
            <div className="pl-5">
              <p className="text-xs text-muted-foreground">Completed</p>
              <p className="mt-1 font-semibold tabular-nums">
                {formatHours(completedTotal)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 [--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(4)] xl:col-span-7">
        <CardHeader>
          <CardTitle>Training history</CardTitle>
          <CardAction>
            <span className="text-xs text-muted-foreground">Hours</span>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={historyChartConfig}
            className="aspect-auto h-[240px] w-full sm:h-[330px]"
          >
            <BarChart data={weeklyHistory} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="week"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tick={{ fontSize: 10 }}
                tickFormatter={(value) =>
                  new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }
              />
              <YAxis
                width={30}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => `${Number(value).toFixed(0)}h`}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(value) =>
                      `Week of ${new Date(`${value}T12:00:00`).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric" }
                      )}`
                    }
                    formatter={(value) => (
                      <div className="flex min-w-32 flex-1 justify-between gap-4">
                        <span className="text-muted-foreground">Duration</span>
                        <span className="font-mono font-medium tabular-nums">
                          {formatHours(Number(value))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Bar
                dataKey="completed"
                fill="var(--color-completed)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}
