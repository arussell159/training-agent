import type { PlannedWorkout } from "@/lib/training-context"
import { Button } from "@/components/ui/button"
import { WorkoutProfile } from "@/components/workout-profile"
import { stepLabel, type WorkoutNode } from "../../../app-backend/lib/workout-editor-model.mjs"

function Intervals({ nodes }: { nodes: WorkoutNode[] }) {
  return <ol className="space-y-3 border-l border-border pl-4">{nodes.map(node => <li key={node.id}>
    <p className="font-medium">{node.kind === "repeat" ? `${node.repetitions} × ${node.label}` : node.label}</p>
    {node.kind === "repeat" ? <Intervals nodes={node.steps} /> : <p className="text-muted-foreground">{stepLabel(node)}</p>}
    {node.notes && <p className="whitespace-pre-wrap text-muted-foreground">{node.notes}</p>}
  </li>)}</ol>
}

export function TrainingPeaksWorkoutDetails({workout, onBack}: {workout: PlannedWorkout; onBack?: () => void}) {
  const values = workout.workout_summary?.planned
  // Construct the link from the verified ID; never render a provider-supplied URL.
  const id = /^trainingpeaks:([1-9]\d*)$/.exec(workout.id)?.[1]
  return <article className="mx-auto w-full max-w-3xl space-y-6 p-5 pb-24 text-sm" data-trainingpeaks-workout={workout.id}>
    {onBack && <Button variant="ghost" onClick={onBack}>Back</Button>}
    <header className="space-y-2">
      <p className="text-muted-foreground">{workout.sport} · {workout.workout_date} · TrainingPeaks</p>
      <h1 className="text-2xl font-semibold tracking-tight">{workout.title}</h1>
      <p className="text-muted-foreground">Plan and edit this workout in TrainingPeaks. Changes appear here after the next plan refresh.</p>
      {id && <a className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4" href={`https://app.trainingpeaks.com/athlete/workout/${id}`} target="_blank" rel="noopener noreferrer">Open in TrainingPeaks</a>}
    </header>
    <dl className="flex flex-wrap gap-x-8 gap-y-3 rounded-xl border p-4">
      <div><dt className="text-muted-foreground">Duration</dt><dd className="mt-1 font-semibold tabular-nums">{workout.duration}</dd></div>
      {values?.distance_meters != null && <div><dt className="text-muted-foreground">Distance</dt><dd className="mt-1 font-semibold tabular-nums">{(values.distance_meters / 1000).toLocaleString(undefined,{maximumFractionDigits:2})} km</dd></div>}
      {values?.tss != null && <div><dt className="text-muted-foreground">TSS</dt><dd className="mt-1 font-semibold tabular-nums">{Math.round(values.tss)}</dd></div>}
      {values?.intensity_factor != null && <div><dt className="text-muted-foreground">IF</dt><dd className="mt-1 font-semibold tabular-nums">{values.intensity_factor.toFixed(2)}</dd></div>}
    </dl>
    {workout.editor_model && <section className="space-y-4" aria-label="Planned intervals"><WorkoutProfile workout={workout} tall /><Intervals nodes={workout.editor_model.steps} /></section>}
    {(workout.manual_description || workout.goal) && <section className="space-y-2"><h2 className="font-semibold">Description</h2><p className="whitespace-pre-wrap break-words">{workout.manual_description || workout.goal}</p></section>}
    {workout.trainingpeaks_warnings?.length ? <p role="status" className="text-muted-foreground">The plan is imported. View its interval chart in TrainingPeaks because this structure cannot be displayed exactly here.</p> : null}
  </article>
}
