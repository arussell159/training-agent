import { MobileHeaderMenu } from "@/components/ui/mobile-header-menu"
import { hasWorkoutStructure } from "@/lib/workout-structure"
import {
  ArrowLeft,
  Bike,
  CheckCircle2,
  Clock3,
  Dumbbell,
  Footprints,
  Gauge,
  Sunrise,
  Sunset,
  Target,
  Waves,
  Zap,
} from "lucide-react"
import { Area, AreaChart, XAxis, YAxis } from "recharts"

import { workoutProfile } from "@/components/section-cards"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { Separator } from "@/components/ui/separator"
import {
  completedMinutes,
  type PlannedWorkout,
} from "@/lib/training-context"

const workoutChartConfig = {
  intensity: { label: "Intensity", color: "var(--chart-2)" },
} satisfies ChartConfig

type WorkoutSection = {
  title: string
  steps: string[]
}

function SportIcon({ sport }: { sport: string }) {
  const value = sport.toLowerCase()
  const className = "size-5"
  if (value.includes("swim")) return <Waves className={className} />
  if (value.includes("bike")) return <Bike className={className} />
  if (value.includes("run")) return <Footprints className={className} />
  return <Dumbbell className={className} />
}

function disciplineColor(sport: string) {
  const value = sport.toLowerCase()
  if (value.includes("swim")) return "text-cyan-500"
  if (value.includes("bike")) return "text-violet-500"
  if (value.includes("run")) return "text-lime-600"
  if (value.includes("strength")) return "text-orange-500"
  return "text-slate-500"
}

function formatDate(workout: PlannedWorkout) {
  if (!workout.workout_date) return workout.date
  const date = new Date(`${workout.workout_date}T12:00:00`)
  if (Number.isNaN(date.getTime())) return workout.date
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function splitSteps(value: string) {
  return value
    .replace(/\r/g, "")
    .split(/\n+|,\s*(?=\d+\s*[x×]\s*\()/)
    .map((step) => step.trim().replace(/^[-•]\s*/, ""))
    .filter(Boolean)
}

function workoutSections(value: string): WorkoutSection[] {
  const content = value.trim()
  if (!content) return []
  const matches = [...content.matchAll(/(Warm Up|Main Set|Warm Down):/gi)]
  if (!matches.length) return [{ title: "Workout", steps: splitSteps(content) }]

  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? content.length
    const label = match[1].toLowerCase()
    const title = label === "warm up" ? "Warm up" : label === "warm down" ? "Warm down" : "Main set"
    return {
      title,
      steps: splitSteps(content.slice(start, end).replace(/^\s+|\s+$/g, "")),
    }
  })
}

function SectionIcon({ title }: { title: string }) {
  if (title === "Warm up") return <Sunrise className="size-5" />
  if (title === "Warm down") return <Sunset className="size-5" />
  if (title === "Main set") return <Zap className="size-5" />
  return <Target className="size-5" />
}

export function WorkoutDetailPage({
  workout,
  onBack,
}: {
  workout: PlannedWorkout
  onBack: () => void
}) {
  const description = workout.details ?? workout.goal ?? ""
  const profile = workoutProfile(workout.title, workout.sport, description)
  const sections = workoutSections(description)
  const hasStructuredGoal = /(Warm Up|Main Set|Warm Down):/i.test(workout.goal ?? "")
  const completed = completedMinutes(workout)
  const statusLabel =
    workout.status === "completed"
      ? "Completed"
      : workout.status === "today"
        ? "Today"
        : "Planned"

  return (
    <div className="min-h-svh w-full min-w-0 bg-background">
      <header className="mobile-site-header sticky top-0 z-40 flex h-14 items-center border-b bg-background/95 px-2 backdrop-blur md:px-4">
        <Button type="button" variant="ghost" onClick={onBack} className="gap-2 px-2" aria-label="Back">
          <ArrowLeft className="size-4" />
          <span className="hidden md:inline">Back</span>
        </Button>
        <Separator orientation="vertical" className="mx-2 hidden h-5 md:block" />
        <span className="mobile-header-title truncate text-sm font-semibold">Workout</span>
      <MobileHeaderMenu /></header>

      <article className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:p-5 md:gap-6 md:p-6">
        <section className="space-y-3 px-1 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={workout.status === "completed" ? "default" : "secondary"}>
              {workout.status === "completed" && <CheckCircle2 className="size-3" />}
              {statusLabel}
            </Badge>
            <span className="text-sm text-muted-foreground">{formatDate(workout)}</span>
          </div>
          <div className="flex items-start gap-3">
            <span className={`mt-1 ${disciplineColor(workout.sport)}`}>
              <SportIcon sport={workout.sport} />
            </span>
            <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
              {workout.title}
            </h1>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Card size="sm">
            <CardContent className="flex items-center gap-3">
              <Clock3 className="size-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">
                  {workout.status === "completed" ? "Completed" : "Duration"}
                </p>
                <p className="font-semibold tabular-nums">
                  {workout.status === "completed" && completed
                    ? `${completed} min`
                    : workout.duration}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="flex items-center gap-3">
              <Gauge className="size-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Training load</p>
                <p className="font-semibold tabular-nums">
                  {Math.round(workout.load ?? 0)} TSS
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {!hasStructuredGoal && workout.goal && (
          <Card className="border-primary/20 bg-primary/5" size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Target className="size-4" /> Session focus
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base leading-6">{workout.goal}</p>
            </CardContent>
          </Card>
        )}

        {hasWorkoutStructure(workout.structure) && <Card size="sm">
          <CardHeader>
            <CardTitle>Workout profile</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={workoutChartConfig}
              className="h-28 w-full sm:h-32"
              aria-label="Workout intensity profile"
            >
              <AreaChart data={profile} accessibilityLayer>
                <XAxis dataKey="position" type="number" hide domain={["dataMin", "dataMax"]} />
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
          </CardContent>
        </Card>}

        <section className="space-y-3" aria-labelledby="workout-instructions">
          <div className="flex items-center justify-between px-1">
            <h2 id="workout-instructions" className="text-lg font-semibold">
              Workout instructions
            </h2>
            <span className="text-xs text-muted-foreground">{workout.sport}</span>
          </div>

          <div className="space-y-7 px-1">
            {sections.map((section) => (
              <section key={section.title} className="space-y-3">
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <span className={disciplineColor(workout.sport)}>
                    <SectionIcon title={section.title} />
                  </span>
                  {section.title}
                </h3>
                <div className="space-y-2">
                  {section.steps.map((step, index) => (
                    <p key={`${section.title}-${index}`} className="text-base leading-7">
                      {step}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      </article>
    </div>
  )
}
