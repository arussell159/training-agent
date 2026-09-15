import {WorkoutDescription} from '@/components/workout-description'
import {lazy,Suspense} from 'react'
import {formatDuration} from '@/lib/duration'
import { MobileHeaderMenu } from "@/components/ui/mobile-header-menu"
const WorkoutAnalysis=lazy(()=>import('@/components/workout-analysis').then(m=>({default:m.WorkoutAnalysis})))
import {WorkoutRouteMap} from '@/components/workout-route-map'
import { WorkoutProfile } from "@/components/workout-profile"
import { WorkoutSummary } from "@/components/workout-summary"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import {
  ArrowLeft,
  Bike,
  CheckCircle2,
  Clock3,
  Dumbbell,
  Footprints,
  Gauge,
  Waves,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  completedMinutes,
  durationMinutes,
  type PlannedWorkout,
} from "@/lib/training-context"



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


export function WorkoutDetailPage({
  workout,
  onBack,
}: {
  workout: PlannedWorkout
  onBack: () => void
}) {
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

        <WorkoutRouteMap workout={workout}/>
        <div className="grid grid-cols-2 gap-3">
          <Card size="sm">
            <CardContent className="flex min-w-0 items-center gap-2 px-3">
              <Clock3 className="size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">
                  Duration
                </p>
                <p className="whitespace-nowrap text-sm font-semibold tabular-nums">
                  {workout.status === "completed" && completed
                    ? formatDuration(completed)
                    : formatDuration(durationMinutes(workout))}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="flex items-center gap-3">
              <Gauge className="size-5 text-muted-foreground" />
              <div>
                <p className="whitespace-nowrap text-[11px] text-muted-foreground">{workout.status === "completed" ? "Distance" : "Est. distance"}</p>
                <p className="font-semibold tabular-nums">
                  {plannedDistanceLabel(workout)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <WorkoutProfile workout={workout} />
        <WorkoutDescription workout={workout}/>
        <WorkoutSummary workout={workout} />
        <Suspense fallback={<div className="h-44 animate-pulse rounded-xl bg-muted/30"/>}><WorkoutAnalysis workout={workout}/></Suspense>

      </article>
    </div>
  )
}
