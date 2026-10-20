import type { PlannedWorkout, TrainingContext } from "./training-context"

type Row = PlannedWorkout & {
  app_pending_operation?: string
  completed?: unknown
}
export type OptimisticWorkoutChange = {
  id: string
  operation: string
  patch?: Partial<PlannedWorkout>
  remove?: boolean
  insert?: PlannedWorkout
}
function normalized(change: OptimisticWorkoutChange): OptimisticWorkoutChange {
  const patch = { ...change.patch }
  const values = patch.workout_summary?.planned
  if (values && "duration_seconds" in values) {
    const seconds = values.duration_seconds
    patch.planned_time_label = null
    patch.plannedDurationMinutes =
      typeof seconds === "number" ? seconds / 60 : 0
    patch.duration = ""
  }
  if (patch.workout_date) {
    const date = new Date(`${patch.workout_date}T12:00:00Z`)
    if (Number.isFinite(date.getTime())) {
      patch.day = date
        .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
        .toUpperCase()
      patch.date = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    }
  }
  return { ...change, patch }
}
const rows = (context: TrainingContext) => [
  ...new Map(
    [...context.history, ...context.planned].map((row) => [
      (row as Row).id || row,
      row as Row,
    ])
  ).values(),
]
function partition(context: TrainingContext, sessions: Row[]): TrainingContext {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: context.athlete.time_zone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  return {
    ...context,
    history: sessions.filter(
      (row) => (row.workout_date || "") <= today
    ) as unknown as TrainingContext["history"],
    planned: sessions.filter((row) => (row.workout_date || "") >= today),
  }
}
export function projectOptimisticWorkout(
  context: TrainingContext,
  change: OptimisticWorkoutChange
): TrainingContext {
  change = normalized(change)
  let sessions = rows(context)
  sessions = sessions.flatMap((row) => {
    if (row.id !== change.id) return [row]
    // Plan removal cannot remove a concurrently paired recording.
    if (change.remove)
      return row.activity_id || row.completed || row.status === "completed"
        ? [row]
        : []
    const patch = { ...change.patch }
    if (row.activity_id || row.status === "completed") {
      delete patch.workout_date
      delete patch.status
      delete patch.day
      delete patch.date
    }
    return [{ ...row, ...patch, app_pending_operation: change.operation }]
  })
  if (change.insert && !sessions.some((row) => row.id === change.id))
    sessions.push({ ...change.insert, app_pending_operation: change.operation })
  return partition(context, sessions)
}
export function rollbackOptimisticWorkout(
  current: TrainingContext,
  before: TrainingContext,
  change: OptimisticWorkoutChange
): TrainingContext {
  change = normalized(change)
  const original = rows(before).find((row) => row.id === change.id)
  let sessions = rows(current)
  if (
    change.remove &&
    original &&
    !sessions.some((row) => row.id === change.id)
  )
    sessions.push(original)
  else
    sessions = sessions.flatMap((row) => {
      if (
        row.id !== change.id ||
        row.app_pending_operation !== change.operation
      )
        return [row]
      if (change.insert && !original) return []
      if (!original) return [row]
      const next = { ...row } as Row & Record<string, unknown>
      for (const key of Object.keys(change.patch || {})) {
        if (
          (row.activity_id || row.status === "completed") &&
          ["workout_date", "status", "day", "date"].includes(key)
        )
          continue
        if (
          JSON.stringify(next[key]) ===
          JSON.stringify((change.patch as Record<string, unknown>)[key])
        )
          next[key] = (original as unknown as Record<string, unknown>)[key]
      }
      delete next.app_pending_operation
      return [next]
    })
  return partition(current, sessions)
}
export function clearOptimisticWorkout(
  context: TrainingContext,
  change: OptimisticWorkoutChange
): TrainingContext {
  return partition(
    context,
    rows(context).flatMap((row) => {
      if (row.app_pending_operation !== change.operation) return [row]
      if (change.insert) return []
      const next = { ...row }
      delete next.app_pending_operation
      return [next]
    })
  )
}
