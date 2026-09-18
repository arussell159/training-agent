import { WorkoutDescription } from "@/components/workout-description"
import {
  WorkoutEditor,
  WorkoutEditorMenu,
  useEditedWorkout,
} from "@/components/workout-editor"
import { WorkoutCoachButton } from "@/components/workout-coach-button"
import { lazy, Suspense, useEffect, useState } from "react"
import { formatDuration } from "@/lib/duration"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { WorkoutDetailSurface } from "@/components/workout-detail-surface"
const WorkoutAnalysis = lazy(() =>
  import("@/components/workout-analysis").then((m) => ({
    default: m.WorkoutAnalysis,
  }))
)
import { WorkoutProfile } from "@/components/workout-profile"
import { WorkoutSummary } from "@/components/workout-summary"
import { WorkoutMapSplits } from "@/components/workout-map-splits"
import { WorkoutRouteMap } from "@/components/workout-route-map"
import { TrainingZonesDisplay } from "@/components/training-zones-display"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import {
  ArrowLeft,
  Bike,
  ChevronRight,
  Dumbbell,
  Footprints,
  Waves,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  completedMinutes,
  cachedTrainingContext,
  durationMinutes,
  loadTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"

function SportIcon({ sport }: { sport: string }) {
  const value = sport.toLowerCase(),
    className = "size-5"
  if (value.includes("swim")) return <Waves className={className} />
  if (value.includes("bike")) return <Bike className={className} />
  if (value.includes("run")) return <Footprints className={className} />
  return <Dumbbell className={className} />
}

function formatWorkoutDate(workout: PlannedWorkout) {
  if (!workout.workout_date) return workout.date
  const date = new Date(`${workout.workout_date}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? workout.date
    : date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
}

function formatWorkoutTime(workout: PlannedWorkout) {
  const value = workout.recorded_start_local || workout.scheduled_start_at
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

export function WorkoutDetailPage({
  workout: initialWorkout,
  onBack,
}: {
  workout: PlannedWorkout
  onBack: () => void
}) {
  const workout = useEditedWorkout(initialWorkout)
  const [editorOpen, setEditorOpen] = useState(false)
  const [plannedTab, setPlannedTab] = useState<"summary" | "zones">("summary")
  const [athleteZones, setAthleteZones] = useState(
    cachedTrainingContext().athlete.zones
  )
  const [mobileMapAvailable, setMobileMapAvailable] = useState(
    workout.status === "completed" &&
      Boolean(workout.activity_id || workout.id.startsWith("activity:"))
  )
  const completed = completedMinutes(workout)
  const values =
    workout.status === "completed"
      ? workout.workout_summary?.completed
      : workout.workout_summary?.planned
  const swim = /swim/i.test(workout.sport),
    bike = /bike|ride/i.test(workout.sport)
  const numeric = (value: number | null | undefined, digits = 0) =>
    value != null && Number.isFinite(value)
      ? value.toLocaleString("en-US", { maximumFractionDigits: digits })
      : null
  const pace =
    values?.average_speed && values.average_speed > 0
      ? Math.round((swim ? 91.44 : 1609.344) / values.average_speed)
      : null
  const duration =
    values?.duration_seconds != null
      ? Math.round(values.duration_seconds)
      : null
  const movingTime =
    duration != null
      ? duration >= 3600
        ? `${Math.floor(duration / 3600)}:${String(Math.floor((duration % 3600) / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`
        : `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`
      : Number.isFinite(workout.actualDurationMinutes)
        ? formatDuration(completed)
        : null
  const stats = [
    {
      label: workout.status === "completed" ? "Distance" : "Est. distance",
      value: plannedDistanceLabel(workout),
    },
    {
      label: "Elevation gain",
      value:
        values?.elevation_gain != null
          ? `${numeric(values.elevation_gain / 0.3048)} ft`
          : null,
    },
    {
      label: workout.status === "completed" ? "Moving time" : "Planned time",
      value:
        workout.status === "completed"
          ? movingTime
          : workout.planned_time_label ||
            formatDuration(durationMinutes(workout)),
    },
    {
      label: bike ? "Avg power" : "Avg pace",
      value: bike
        ? values?.average_power != null
          ? `${numeric(values.average_power)} W`
          : null
        : pace
          ? `${Math.floor(pace / 60)}:${String(pace % 60).padStart(2, "0")} /${swim ? "100 yd" : "mi"}`
          : null,
    },
    {
      label: bike ? "Avg speed" : "Avg heart rate",
      value: bike
        ? values?.average_speed != null
          ? `${numeric(values.average_speed * 2.236936, 1)} mi/h`
          : null
        : values?.average_hr != null
          ? `${numeric(values.average_hr)} bpm`
          : null,
    },
    {
      label: "Calories",
      value:
        values?.calories != null ? `${numeric(values.calories)} Cal` : null,
    },
    ...(!bike
      ? [
          {
            label: "Max heart rate",
            value:
              values?.max_hr != null ? `${numeric(values.max_hr)} bpm` : null,
          },
        ]
      : []),
  ].filter((stat) => stat.value && stat.value !== "—")
  const statusLabel =
    workout.status === "completed"
      ? "Completed"
      : workout.status === "today"
        ? "Today"
        : "Planned"
  const load = values?.tss ?? workout.load
  const distanceLabel = plannedDistanceLabel(workout)
  const heroTone =
    workout.status === "completed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
      : "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
  useEffect(() => {
    let active = true
    void loadTrainingContext()
      .then((context) => {
        if (active) setAthleteZones(context.athlete.zones)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="min-h-svh w-full min-w-0 bg-background">
      <MobileSiteNavbar
        fixed
        onBack={onBack}
        title={
          swim
            ? "Swim"
            : bike
              ? "Ride"
              : /run/i.test(workout.sport)
                ? "Run"
                : workout.sport
        }
        onEditWorkout={
          workout.id.startsWith("event:")
            ? () => setEditorOpen(true)
            : undefined
        }
      />
      {editorOpen && (
        <WorkoutEditor workout={workout} onClose={() => setEditorOpen(false)} />
      )}

      {workout.status === "completed" && (
        <div className="workout-mobile-map sticky top-0 z-0 transform-gpu will-change-transform md:hidden">
          <WorkoutRouteMap
            workout={workout}
            onAvailable={setMobileMapAvailable}
            topPadding={56}
          />
        </div>
      )}

      <div className="mx-auto hidden w-full max-w-5xl px-6 pt-5 md:block">
        <div className="mb-4 flex min-h-10 flex-wrap items-center gap-2 text-sm">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="mr-1 rounded-lg"
            aria-label="Back to workouts"
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <h1 className="font-semibold text-blue-600 dark:text-blue-400">
            {formatWorkoutDate(workout)}
            {formatWorkoutTime(workout) && (
              <span className="ml-2 tabular-nums">
                {formatWorkoutTime(workout)}
              </span>
            )}
          </h1>
          <WorkoutEditorMenu workout={workout} />
        </div>
        <section
          className={`rounded-xl border px-4 py-3 shadow-sm ${heroTone}`}
          aria-label="Workout overview"
        >
          <h1 className="min-w-0 truncate text-base font-bold">
            {workout.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-7 gap-y-2">
            <SportIcon sport={workout.sport} />
            <span className="text-[1.4rem] leading-none font-semibold tabular-nums">
              {(workout.status !== "completed" && workout.planned_time_label) ||
                movingTime ||
                formatDuration(durationMinutes(workout))}
            </span>
            <span className="text-[1.4rem] leading-none font-semibold tabular-nums">
              {plannedDistanceLabel(workout)}
            </span>
            {load != null && (
              <span className="text-[1.4rem] leading-none font-semibold tabular-nums">
                {numeric(load)} <span className="text-xs">TSS</span>
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-4 text-xs font-medium opacity-80">
            <span>{workout.sport}</span>
            <span>{statusLabel}</span>
          </div>
        </section>
        {workout.structure && (
          <div className="mt-4 overflow-hidden border bg-muted/20 px-2 pt-2">
            <WorkoutProfile
              workout={workout}
              compact
              desktopDetail
              tall={workout.status !== "completed"}
              enableEditOnClick
            />
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-5xl px-0 md:px-6">
        <WorkoutDetailSurface
          completed={workout.status === "completed"}
          onClose={onBack}
          className={`relative z-10 flex w-full min-w-0 transform-gpu flex-col gap-6 bg-background px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(0,0,0,0.08)] will-change-transform sm:px-7 md:px-0 md:pt-5 md:pb-10 md:shadow-none ${mobileMapAvailable ? "-mt-7 rounded-t-[28px] pt-3" : "pt-[76px]"}`}
        >
          <section
            className={`pt-1 md:hidden ${workout.status === "completed" ? "space-y-5" : "hidden"}`}
          >
            <div className="flex items-start gap-3">
              <h1 className="text-[27px] leading-tight font-bold tracking-tight sm:text-3xl">
                {workout.title}
              </h1>
            </div>
          </section>

          {workout.status === "completed" && (
            <section
              aria-label="Workout highlights"
              className="grid grid-cols-2 gap-x-6 gap-y-7 py-3 text-center md:hidden"
            >
              {stats.map((stat) => (
                <div key={stat.label}>
                  <p className="text-xs text-muted-foreground sm:text-sm">
                    {stat.label}
                  </p>
                  <p className="mt-1.5 text-lg font-bold tracking-tight tabular-nums sm:text-2xl">
                    {stat.value}
                  </p>
                </div>
              ))}
            </section>
          )}

          {workout.status !== "completed" && (
            <section className="md:hidden" aria-label="Planned workout">
              <div className="border-b pb-4">
                <h1 className="truncate text-base leading-tight font-bold">
                  {workout.title}
                </h1>
                <div className="mt-3 flex items-center justify-between gap-4 text-center">
                  <SportIcon sport={workout.sport} />
                  <p className="flex-1 text-sm font-semibold tabular-nums">
                    {workout.planned_time_label ||
                      formatDuration(durationMinutes(workout))}
                  </p>
                  {distanceLabel !== "—" && (
                    <p className="flex-1 text-sm font-semibold tabular-nums">
                      {distanceLabel}
                    </p>
                  )}
                  {load != null && (
                    <p className="flex-1 text-sm font-semibold tabular-nums">
                      {numeric(load)}{" "}
                      <span className="text-[9px] font-medium text-muted-foreground">
                        TSS
                      </span>
                    </p>
                  )}
                </div>
                <div className="mt-2">
                  <WorkoutProfile
                    workout={workout}
                    mobilePlanned
                    enableEditOnClick
                  />
                </div>
              </div>
              <div
                role="tablist"
                aria-label="Workout view"
                className="my-3 grid h-8 grid-cols-2 rounded-md bg-muted/70 p-0.5 text-xs font-semibold"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={plannedTab === "summary"}
                  onClick={() => setPlannedTab("summary")}
                  className={`rounded-[5px] transition ${plannedTab === "summary" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                >
                  Summary
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={plannedTab === "zones"}
                  onClick={() => setPlannedTab("zones")}
                  className={`rounded-[5px] transition ${plannedTab === "zones" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                >
                  Zones
                </button>
              </div>
              {plannedTab === "summary" ? (
                <div className="pt-1">
                  <WorkoutDescription
                    workout={workout}
                    title="Workout Details"
                    mobileCompact
                  />
                </div>
              ) : (
                <TrainingZonesDisplay
                  sport={workout.sport}
                  zones={athleteZones}
                />
              )}
            </section>
          )}
          <div className="hidden items-start gap-5 md:grid lg:grid-cols-[minmax(340px,0.9fr)_minmax(0,1.1fr)]">
            <div className="min-w-0">
              <WorkoutSummary
                workout={workout}
                showElapsed={false}
                embedded
                section="overview"
              />
            </div>
            <div className="min-w-0 space-y-3">
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <WorkoutDescription workout={workout} title="Description" />
              </div>
              <WorkoutSummary
                workout={workout}
                showElapsed={false}
                embedded
                section="recorded"
              />
            </div>
          </div>
          {workout.status === "completed" && (
            <WorkoutMapSplits workout={workout} />
          )}
          <Suspense
            fallback={<div className="h-44 animate-pulse border bg-muted/30" />}
          >
            <WorkoutAnalysis workout={workout} />
          </Suspense>
          {workout.status === "completed" && (
            <div className="contents md:hidden">
              <WorkoutDescription workout={workout} collapsible />
              {(workout.structure || workout.editor_model) && (
                <details key={workout.id} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
                    Workout profile
                  </summary>
                  <div className="mt-3">
                    <WorkoutProfile workout={workout} enableEditOnClick />
                  </div>
                </details>
              )}
            </div>
          )}

          <WorkoutCoachButton workout={workout} />
        </WorkoutDetailSurface>
      </div>
    </div>
  )
}
