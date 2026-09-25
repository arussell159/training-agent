import { DetailSheetRow } from "@/components/detail-sheet-row"
import { canEditWorkout } from "@/lib/workout-permissions"
import { useIsMobile } from "@/hooks/use-mobile"
import { WorkoutDescription } from "@/components/workout-description"
import { METERS_PER_100_YARDS } from "../../../app-backend/lib/swim-units.mjs"
import {
  WorkoutEditor,
  WorkoutEditorMenu,
  useEditedWorkout,
} from "@/components/workout-editor"
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
import { WorkoutRouteMap } from "@/components/workout-route-map"
import { TrainingZonesDisplay } from "@/components/training-zones-display"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import {
  workoutStepLabel,
  type WorkoutStep,
} from "@/lib/workout-structure"
import {
  ArrowLeft,
  Bike,
  ChevronRight,
  Dumbbell,
  Footprints,
  Pencil,
  Repeat2,
  Trash2,
  Waves,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  changeWorkout,
  completedMinutes,
  cachedTrainingContext,
  durationMinutes,
  loadTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"
import {
  roleNames,
  stepLabel,
  workoutTotals,
  type WorkoutModel,
  type WorkoutNode,
} from "../../../app-backend/lib/workout-editor-model.mjs"


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

function structureDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remainder = rounded % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`
}

function repeatSummary(node: Extract<WorkoutNode, { kind: "repeat" }>, model: WorkoutModel) {
  const totals = workoutTotals({ ...model, steps: [node] })
  const distance = totals.distance
    ? `${(
        totals.distance / (/swim/i.test(model.sport) ? 0.9144 : 1609.344)
      ).toLocaleString("en-US", {
        maximumFractionDigits: /swim/i.test(model.sport) ? 0 : 2,
      })} ${/swim/i.test(model.sport) ? "yd" : "mi"}`
    : null
  return [structureDuration(totals.seconds), distance].filter(Boolean).join(" · ")
}

function WorkoutStructureNode({
  node,
  model,
  depth,
  onEdit,
}: {
  node: WorkoutNode
  model: WorkoutModel
  depth: number
  onEdit: (id: string) => void
}) {
  if (node.kind === "repeat") {
    const recovery = [node.recovery, node.setRecovery].filter(
      (item): item is Extract<WorkoutNode, { kind: "step" }> => Boolean(item)
    )
    return (
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <button
          type="button"
          className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={() => onEdit(node.id)}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Repeat2 className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">
              Repeat {node.repetitions}×
              {node.sets > 1 ? ` · ${node.sets} sets` : ""}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {repeatSummary(node, model)}
            </span>
          </span>
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
            Edit repeat
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
        <div className="space-y-2 border-t bg-muted/15 p-3">
          {node.steps.map((child) => (
            <WorkoutStructureNode
              key={child.id}
              node={child}
              model={model}
              depth={depth + 1}
              onEdit={onEdit}
            />
          ))}
          {recovery.map((child) => (
            <WorkoutStructureNode
              key={child.id}
              node={child}
              model={model}
              depth={depth + 1}
              onEdit={onEdit}
            />
          ))}
        </div>
      </section>
    )
  }
  return (
    <button
      type="button"
      className="flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ marginLeft: depth ? Math.min(depth, 2) * 4 : 0 }}
      onClick={() => onEdit(node.id)}
    >
      <span className="h-9 w-1 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{roleNames[node.role]}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {stepLabel(node)}
        </span>
      </span>
      <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
        Edit interval
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

function WorkoutStructureOverview({
  model,
  onEdit,
}: {
  model: WorkoutModel
  onEdit: (id: string) => void
}) {
  return (
    <section id="workout-structure" className="rounded-xl border bg-background p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Workout structure</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Open a repeat or interval to edit its prescription.
        </p>
      </div>
      <div className="space-y-2">
        {model.steps.map((node) => (
          <WorkoutStructureNode
            key={node.id}
            node={node}
            model={model}
            depth={0}
            onEdit={onEdit}
          />
        ))}
      </div>
    </section>
  )
}

function legacyWorkoutSteps(value?: string | null): WorkoutStep[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    const steps = Array.isArray(parsed) ? parsed : parsed?.steps ?? parsed?.structure
    return Array.isArray(steps) ? steps : []
  } catch {
    return []
  }
}

function LegacyStructureNode({
  step,
  sport,
  path,
  onEdit,
}: {
  step: WorkoutStep
  sport: string
  path: string
  onEdit: () => void
}) {
  if (step.steps?.length) {
    const repetitions = Math.max(1, Number(step.reps || 1))
    return (
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <button
          type="button"
          className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={onEdit}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Repeat2 className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Repeat {repetitions}×</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {step.steps.length} interval{step.steps.length === 1 ? "" : "s"} per repeat
            </span>
          </span>
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
            Edit repeat
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
        <div className="space-y-2 border-t bg-muted/15 p-3">
          {step.steps.map((child, index) => (
            <LegacyStructureNode
              key={`${path}.${index}`}
              step={child}
              sport={sport}
              path={`${path}.${index}`}
              onEdit={onEdit}
            />
          ))}
        </div>
      </section>
    )
  }
  const role =
    step.intensity === "rest"
      ? "Rest"
      : step.text?.trim() ||
        (step.intensity
          ? `${step.intensity.charAt(0).toUpperCase()}${step.intensity.slice(1)}`
          : "Interval")
  return (
    <button
      type="button"
      className="flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onEdit}
    >
      <span className="h-9 w-1 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{role}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {workoutStepLabel(step, sport)}
        </span>
      </span>
      <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
        Edit interval
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

function LegacyWorkoutStructureOverview({
  structure,
  sport,
  onEdit,
}: {
  structure?: string | null
  sport: string
  onEdit: () => void
}) {
  const steps = legacyWorkoutSteps(structure)
  if (!steps.length) return null
  return (
    <section id="workout-structure" className="rounded-xl border bg-background p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Workout structure</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Open any repeat or interval to edit the full prescription.
        </p>
      </div>
      <div className="space-y-2">
        {steps.map((step, index) => (
          <LegacyStructureNode
            key={index}
            step={step}
            sport={sport}
            path={String(index)}
            onEdit={onEdit}
          />
        ))}
      </div>
    </section>
  )
}

export function WorkoutDetailPage({
  workout: initialWorkout,
  onBack,
}: {
  workout: PlannedWorkout
  onBack: () => void
}) {
  const workout = useEditedWorkout(initialWorkout)
  const mobile = useIsMobile()
  const editable = canEditWorkout(workout)
  const library = workout.id.startsWith("library:")
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorFocusId, setEditorFocusId] = useState<string | undefined>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")
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
      ? Math.round(
          (swim
            ? workout.status === "completed"
              ? METERS_PER_100_YARDS
              : 100
            : 1609.344) / values.average_speed
        )
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

  const workoutActions = [
    ...(editable
      ? [
        {
          value: "edit",
          label: "Edit workout",
          disabled: deleting,
          onSelect: () => {
            setEditorFocusId(undefined)
            setEditorOpen(true)
          },
        },
        {
          value: "delete",
          label: "Delete workout",
          disabled: deleting,
          onSelect: () => setDeleteOpen(true),
        },
      ]
      : []),
  ]

  const deleteWorkout = async () => {
    if (deleting || !editable) return
    setDeleting(true)
    setDeleteError("")
    try {
      await changeWorkout(workout.id, "delete")
      setDeleteOpen(false)
      onBack()
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Unable to delete workout."
      )
    } finally {
      setDeleting(false)
    }
  }

  const openEditor = (focusId?: string) => {
    if (!editable) return
    setEditorFocusId(focusId)
    setEditorOpen(true)
  }

  return (
    <div className="min-h-svh w-full min-w-0 max-w-full overflow-x-clip bg-background">
      <MobileSiteNavbar
        fixed
        className={workout.status === "completed" && !swim ? "workout-map-navbar" : undefined}
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
        actions={workoutActions}
      />
      {editorOpen && editable && (
        <WorkoutEditor
          workout={workout}
          initialFocusId={editorFocusId}
          onClose={() => {
            setEditorOpen(false)
            setEditorFocusId(undefined)
          }}
        />
      )}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workout?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete “{workout.title}” from this app and Intervals.icu? This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void deleteWorkout()
              }}
            >
              <Trash2 />
              {deleting ? "Deleting…" : "Delete workout"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {workout.status === "completed" && (
      <div className="hidden min-h-svh min-w-0 flex-col md:flex">
        <div className="min-h-0 flex-1 bg-muted/20">
          <div
            className={
              workout.status === "completed"
                ? "mx-auto w-full max-w-[1800px] p-4 xl:p-5"
                : "mx-auto grid w-full max-w-[1800px] grid-cols-[280px_minmax(0,1fr)] items-start gap-4 p-4 xl:grid-cols-[300px_minmax(0,1fr)] xl:p-5"
            }
          >
            {workout.status !== "completed" && (
            <aside className="sticky top-20 min-w-0 space-y-4 self-start">
              <nav className="rounded-xl border bg-card p-2 shadow-sm" aria-label="Workout sections">
                {[
                  ["workout-overview", "Overview"],
                  ["workout-structure", "Workout structure"],
                  ["workout-details", "Details and zones"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className="flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() =>
                      document.getElementById(id)?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      })
                    }
                  >
                    {label}
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </button>
                ))}
              </nav>

              <section id="workout-overview" className="scroll-mt-24 space-y-4">
                <div className={`rounded-xl border p-4 shadow-sm ${heroTone}`}>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <p className="text-[10px] font-medium tracking-wide uppercase opacity-65">
                        Duration
                      </p>
                      <p className="mt-1 text-xl font-bold tabular-nums">
                        {workout.planned_time_label ||
                          movingTime ||
                          formatDuration(durationMinutes(workout))}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium tracking-wide uppercase opacity-65">
                        Distance
                      </p>
                      <p className="mt-1 text-xl font-bold tabular-nums">
                        {distanceLabel}
                      </p>
                    </div>
                    {load != null && (
                      <div>
                        <p className="text-[10px] font-medium tracking-wide uppercase opacity-65">
                          Training load
                        </p>
                        <p className="mt-1 text-base font-semibold tabular-nums">
                          {numeric(load)} TSS
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-medium tracking-wide uppercase opacity-65">
                        Sport
                      </p>
                      <p className="mt-1 text-base font-semibold">{workout.sport}</p>
                    </div>
                  </div>
                </div>
                <WorkoutSummary
                  workout={workout}
                  showElapsed={false}
                  embedded
                  section="overview"
                />
              </section>

              <section className="rounded-xl border bg-card p-4 shadow-sm">
                <WorkoutDescription workout={workout} title="Description" />
              </section>
            </aside>
            )}

            <main className="min-w-0 space-y-4" aria-label="Workout details workspace">
              {workout.status === "completed" ? (
                <section id="workout-analysis" className="scroll-mt-24">
                  <Suspense
                    fallback={<div className="h-44 animate-pulse rounded-xl border bg-muted/30" />}
                  >
                    <WorkoutAnalysis workout={workout} />
                  </Suspense>
                </section>
              ) : (
                <>
                  {(workout.structure || workout.editor_model) && (
                    <section className="rounded-xl border bg-card p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold">Workout profile</h2>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Select an interval to open its editor.
                          </p>
                        </div>
                        {editable && (
                          <Button variant="outline" size="sm" onClick={() => openEditor()}>
                            <Pencil className="size-4" />
                            Edit all
                          </Button>
                        )}
                      </div>
                      <WorkoutProfile
                        workout={workout}
                        desktopDetail
                        tall
                        enableEditOnClick={editable}
                        onEditNode={openEditor}
                      />
                    </section>
                  )}
                  {workout.editor_model ? (
                    <WorkoutStructureOverview model={workout.editor_model} onEdit={openEditor} />
                  ) : workout.structure ? (
                    <LegacyWorkoutStructureOverview
                      structure={workout.structure}
                      sport={workout.sport}
                      onEdit={() => openEditor()}
                    />
                  ) : (
                    <section id="workout-structure" className="rounded-xl border bg-card p-5 shadow-sm">
                      <h2 className="text-base font-semibold">Workout structure</h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Open the workout editor to view and edit each interval and repeat.
                      </p>
                      {editable && (
                        <Button className="mt-4" onClick={() => openEditor()}>
                          <Pencil className="size-4" />
                          Open workout editor
                        </Button>
                      )}
                    </section>
                  )}
                  <section id="workout-details" className="scroll-mt-24">
                    <TrainingZonesDisplay sport={workout.sport} zones={athleteZones} />
                  </section>
                </>
              )}
            </main>
          </div>
        </div>
      </div>
      )}

      {workout.status !== "completed" && (
        <div className="hidden md:block">
          <div className="mx-auto w-full max-w-5xl px-6 pt-5">
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
              {!library && <WorkoutEditorMenu workout={workout} />}
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
                  {workout.planned_time_label ||
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
              {(workout.structure || workout.editor_model) && (
                <div className="mt-3 overflow-hidden">
                  <WorkoutProfile
                    workout={workout}
                    compact
                    desktopDetail
                    tall
                    enableEditOnClick={!library}
                  />
                </div>
              )}
            </section>
          </div>

          <div className="mx-auto w-full max-w-5xl px-6">
            <WorkoutDetailSurface
              completed={false}
              onClose={onBack}
              className="relative z-10 flex w-full min-w-0 flex-col gap-6 bg-background pt-5 pb-10"
            >
              <div className="grid items-start gap-5 lg:grid-cols-[minmax(340px,0.9fr)_minmax(0,1.1fr)]">
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
            </WorkoutDetailSurface>
          </div>
        </div>
      )}

      {mobile && workout.status === "completed" && !swim && (
        <div className="workout-mobile-map sticky top-0 z-0 transform-gpu will-change-transform md:hidden">
          <WorkoutRouteMap
            workout={workout}
            onAvailable={setMobileMapAvailable}
            topPadding={56}
            bottomPadding={28}
          />
        </div>
      )}

      {mobile && <div className="mx-auto w-full max-w-5xl px-0 md:hidden">
        <WorkoutDetailSurface
          completed={workout.status === "completed"}
          onClose={onBack}
          className={`relative z-10 flex w-full min-w-0 transform-gpu flex-col gap-6 bg-background px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(0,0,0,0.08)] will-change-transform sm:px-7 md:px-0 md:pt-5 md:pb-10 md:shadow-none ${mobileMapAvailable && !swim ? "-mt-7 rounded-t-[28px] pt-3" : "pt-[76px]"}`}
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
                <h1 className="truncate text-lg leading-tight font-bold">
                  {workout.title}
                </h1>
                <div className="mt-3 flex items-center justify-between gap-4 text-center">
                  <SportIcon sport={workout.sport} />
                  <p className="flex-1 text-base font-semibold tabular-nums">
                    {workout.planned_time_label ||
                      formatDuration(durationMinutes(workout))}
                  </p>
                  {distanceLabel !== "—" && (
                    <p className="flex-1 text-base font-semibold tabular-nums">
                      {distanceLabel}
                    </p>
                  )}
                  {load != null && (
                    <p className="flex-1 text-base font-semibold tabular-nums">
                      {numeric(load)}{" "}
                      <span className="text-[11px] font-medium text-muted-foreground">
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
                className="my-3 grid h-9 grid-cols-2 rounded-md bg-muted/70 p-0.5 text-sm font-semibold"
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
          <Suspense
            fallback={<div className="h-44 animate-pulse border bg-muted/30" />}
          >
            <WorkoutAnalysis workout={workout} />
          </Suspense>
          <div className="workout-detail-links md:contents">
          {workout.status === "completed" && (
            <div className="contents md:hidden">
              <DetailSheetRow
                title="Workout Details"
                date={formatWorkoutDate(workout)}
                dark
              >
                <WorkoutDescription workout={workout} title="Workout Details" />
              </DetailSheetRow>
            </div>
          )}

          </div>
        </WorkoutDetailSurface>
      </div>}
    </div>
  )
}
