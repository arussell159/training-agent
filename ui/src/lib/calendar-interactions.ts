import type { PlannedWorkout, TrainingContext } from "./training-context"

// A concurrently received completion stays visible until the authoritative
// refresh detaches it from the deleted plan. A plan delete cannot hide a ride.
export function removeVerifiedCalendarPlans(
  context: TrainingContext,
  ids: string[]
) {
  const deleted = new Set(ids)
  const keep = (item: {
    id?: string
    completed?: unknown
    status?: string
    activity_id?: string | null
  }) =>
    !item.id ||
    !deleted.has(item.id) ||
    Boolean(item.completed) ||
    item.status === "completed" ||
    Boolean(item.activity_id)
  return {
    ...context,
    planned: context.planned.filter(keep),
    history: context.history.filter(keep),
  }
}

export type CalendarClipboard = {
  kind: "workout" | "day" | "week"
  mode: "copy" | "cut"
  workoutIds: string[]
  label: string
  sourceStart?: string
  workoutDates?: string[]
  attempt?: {
    date: string
    items: { id: string; creationId: string; date?: string }[]
    completed: number
  }
}
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">
const storageKey = (scope: string) => `calendar-clipboard:v1:${scope}`
const browserStorage = () => {
  try {
    return localStorage
  } catch {
    return undefined
  }
}
const validId = (value: unknown) =>
  typeof value === "string" && /^event:[1-9]\d*$/.test(value)
const validDate = (value: unknown) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value
export function readCalendarClipboard(
  scope: string,
  storage: StorageLike | undefined = browserStorage()
): CalendarClipboard | null {
  try {
    const value = JSON.parse(
      storage?.getItem(storageKey(scope)) || "null"
    ) as CalendarClipboard | null
    if (
      !value ||
      !["workout", "day", "week"].includes(value.kind) ||
      !["copy", "cut"].includes(value.mode) ||
      typeof value.label !== "string" ||
      value.label.length > 1000 ||
      !Array.isArray(value.workoutIds) ||
      !value.workoutIds.length ||
      value.workoutIds.length > 100 ||
      !value.workoutIds.every(validId) ||
      new Set(value.workoutIds).size !== value.workoutIds.length
    )
      return null
    if (
      value.kind === "week" &&
      (!validDate(value.sourceStart) ||
        !Array.isArray(value.workoutDates) ||
        value.workoutDates.length !== value.workoutIds.length ||
        value.workoutDates.some(
          (date) =>
            !validDate(date) ||
            Date.parse(date) < Date.parse(value.sourceStart!) ||
            Date.parse(date) > Date.parse(value.sourceStart!) + 6 * 86400000
        ))
    )
      return null
    const attempt = value.attempt
    if (
      attempt &&
      (!validDate(attempt.date) ||
        !Array.isArray(attempt.items) ||
        attempt.items.length !== value.workoutIds.length ||
        new Set(attempt.items.map((item) => item?.creationId)).size !==
          attempt.items.length ||
        !Number.isInteger(attempt.completed) ||
        attempt.completed < 0 ||
        attempt.completed > attempt.items.length ||
        attempt.items.some(
          (item, i) =>
            !item ||
            item.id !== value.workoutIds[i] ||
            (item.date != null && !validDate(item.date)) ||
            (value.kind === "week" &&
              item.date !==
                new Date(
                  Date.parse(value.workoutDates![i]) +
                    Date.parse(attempt.date) -
                    Date.parse(value.sourceStart!)
                )
                  .toISOString()
                  .slice(0, 10)) ||
            (value.kind !== "week" &&
              item.date != null &&
              item.date !== attempt.date) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              item.creationId
            )
        ))
    )
      return null
    return value
  } catch {
    return null
  }
}

export function prepareCalendarPaste(
  clipboard: CalendarClipboard,
  date: string,
  createId: () => string
): NonNullable<CalendarClipboard["attempt"]> {
  if (!validDate(date)) throw Error("Choose a valid destination date.")
  const delta =
    clipboard.kind === "week"
      ? Date.parse(date) - Date.parse(clipboard.sourceStart!)
      : 0
  const items = clipboard.workoutIds.map((id, index) => ({
    id,
    creationId: createId(),
    date:
      clipboard.kind === "week"
        ? new Date(Date.parse(clipboard.workoutDates![index]) + delta)
            .toISOString()
            .slice(0, 10)
        : date,
  }))
  if (items.some((item) => !validDate(item.date)))
    throw Error(
      "Choose a destination that keeps every workout within a valid calendar date."
    )
  return { date, items, completed: 0 }
}
export function writeCalendarClipboard(
  scope: string,
  value: CalendarClipboard | null,
  storage: StorageLike | undefined = browserStorage()
) {
  if (!storage)
    throw Error(
      "Local recovery storage is unavailable. Enable site storage before pasting workouts."
    )
  if (value) storage.setItem(storageKey(scope), JSON.stringify(value))
  else storage.removeItem(storageKey(scope))
}
export function calendarDiscipline(sport: string) {
  if (/swim/i.test(sport)) return "swim"
  if (/bike|ride|cycling|brick/i.test(sport)) return "bike"
  if (/run/i.test(sport)) return "run"
  if (/strength|weight.?training/i.test(sport)) return "strength"
  return "other"
}
export function projectCalendarMove(
  context: TrainingContext,
  id: string,
  date: string,
  today: string
): TrainingContext {
  const update = <T extends object>(workout: T): T =>
    "id" in workout && workout.id === id
      ? {
          ...workout,
          workout_date: date,
          day: new Date(`${date}T12:00:00`)
            .toLocaleDateString("en-US", { weekday: "short" })
            .toUpperCase(),
          date: new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          }),
          status: date === today ? "today" : "upcoming",
        }
      : workout
  return {
    ...context,
    planned: context.planned.map(update),
    history: context.history.map(update),
  }
}
// Restore only this attempted move. New recordings, edits and other calendar
// changes arriving during the request must survive a failed move.
export function rollbackCalendarMove(
  current: TrainingContext,
  before: TrainingContext,
  id: string,
  attemptedDate: string
): TrainingContext {
  const original = [...before.planned, ...before.history].find(
    (workout) => "id" in workout && workout.id === id
  ) as PlannedWorkout | undefined
  if (!original) return current
  const rollback = <T extends object>(item: T): T => {
    const workout = item as T & Partial<PlannedWorkout>
    if (
      workout.id !== id ||
      workout.workout_date !== attemptedDate ||
      workout.status === "completed" ||
      workout.activity_id
    )
      return item
    return {
      ...item,
      workout_date: original.workout_date,
      day: original.day,
      date: original.date,
      status: original.status,
    }
  }
  return {
    ...current,
    planned: current.planned.map(rollback),
    history: current.history.map(rollback),
  }
}

// Only restore unconfirmed removals. A newer completion or unrelated calendar
// update must survive a failed delete.
export function rollbackCalendarDeletion(current: TrainingContext, before: TrainingContext, ids: string[]): TrainingContext {
  const restore = new Set(ids)
  const existing = new Set([...current.history, ...current.planned].map(row => (row as PlannedWorkout).id))
  const missing = (row: object) => "id" in row && restore.has(String(row.id)) && !existing.has(String(row.id))
  return {
    ...current,
    history: [...current.history, ...before.history.filter(missing)],
    planned: [...current.planned, ...before.planned.filter(missing)],
  }
}

export function applyVerifiedCalendarPair(context: TrainingContext, plannedId: string, completedId: string, workout: PlannedWorkout, today: string): TrainingContext {
  if (workout.id !== plannedId || String(workout.activity_id) !== completedId.replace(/^activity:/, "") || workout.status !== "completed" || !workout.workout_date)
    throw Error("The verified recording does not match these workouts.")
  const rows = new Map([...context.history, ...context.planned].map(row => [(row as PlannedWorkout).id, row as PlannedWorkout]))
  rows.delete(completedId)
  rows.set(plannedId, workout)
  const sessions = [...rows.values()].filter((row): row is PlannedWorkout & {workout_date:string} => Boolean(row.workout_date))
  return { ...context, history: sessions.filter(row => row.workout_date <= today), planned: sessions.filter(row => row.workout_date >= today) }
}
