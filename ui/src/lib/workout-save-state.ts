import type { PlannedWorkout, TrainingContext } from "./training-context"
import { preserveRecordedWorkout } from "../../../app-backend/lib/workout-recording-merge.mjs"

/** Accept one verified workout without losing archived dates or recorded data. */
export function mergeVerifiedWorkout(
  context: TrainingContext,
  incoming: PlannedWorkout,
  temporaryId?: string
) {
  const rows = new Map<string | object, PlannedWorkout>(
    [...context.history, ...context.planned].map((row) => [
      (row as PlannedWorkout).id || row,
      row as PlannedWorkout,
    ])
  )
  const current = rows.get(incoming.id)
  const recording =
    incoming.activity_id && incoming.status === "completed"
      ? incoming
      : current?.activity_id && current.status === "completed"
        ? current
        : null
  const workout: PlannedWorkout = recording
    ? {
        ...preserveRecordedWorkout(incoming, { ...recording, completed: true }),
        planned_workout_date:
          incoming.planned_workout_date || recording.planned_workout_date,
      }
    : incoming
  if (temporaryId && temporaryId !== workout.id) rows.delete(temporaryId)
  rows.set(workout.id, workout)
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: context.athlete.time_zone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const sessions = [...rows.values()].filter(
    (row): row is PlannedWorkout & { workout_date: string } =>
      Boolean(row.workout_date)
  )
  return {
    workout,
    context: {
      ...context,
      history: sessions.filter((row) => row.workout_date <= today),
      planned: sessions.filter((row) => row.workout_date >= today),
    },
  }
}
