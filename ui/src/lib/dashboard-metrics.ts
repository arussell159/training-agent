import type {PlannedWorkout, TrainingContext} from './training-context'

export function dailyWorkouts(context: TrainingContext, day: string): PlannedWorkout[] {
  const candidates = [
    ...context.planned,
    ...(context.history.filter((item) => 'id' in item) as PlannedWorkout[]),
  ]
  const sessions = new Map<string, PlannedWorkout>()
  for (const workout of candidates) {
    if (workout.workout_date !== day) continue
    const completedMinutes = Math.max(
      Number(workout.actualDurationMinutes) || 0,
      Number(workout.completed_data?.duration_minutes) || 0,
      (Number(workout.workout_summary?.completed?.duration_seconds) || 0) / 60
    )
    const plannedMinutes = Math.max(
      Number(workout.plannedDurationMinutes) || 0,
      Number(workout.planned?.duration_minutes) || 0,
      (Number(workout.workout_summary?.planned?.duration_seconds) || 0) / 60
    )
    if (completedMinutes <= 0 && plannedMinutes <= 0) continue
    const key = workout.activity_id ? `activity:${workout.activity_id}` : workout.id
    const current = sessions.get(key)
    if (!current || workout.id.startsWith('event:')) sessions.set(key, workout)
  }
  const priority = (sport: string) => /swim|bike|ride|brick|run/i.test(sport) ? 0 : 1
  return [...sessions.values()].sort((a, b) =>
    priority(a.sport) - priority(b.sport) ||
    String(a.scheduled_start_at || a.recorded_start_local || a.title).localeCompare(
      String(b.scheduled_start_at || b.recorded_start_local || b.title)
    )
  )
}

export function dashboardToday(context: TrainingContext, now = new Date()) {
  const zone = context.athlete?.time_zone || 'America/Chicago'
  return new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(now)
}

export function todaysWorkout(context: TrainingContext, now = new Date()) {
  const date = dashboardToday(context, now)
  const workouts = [...context.planned, ...context.history.filter(w => 'id' in w) as PlannedWorkout[]]
  const today = workouts.filter(w => w.workout_date === date)
  // Keep today's planned prescription and its recording visible after completion.
  return today.find(w => typeof w.id === 'string' && w.id.startsWith('event:')) ?? today[0]
}

export function recoverySeries(context: TrainingContext, key: 'hrv' | 'resting_hr') {
  const days = new Map<string, number>()
  for (const row of context.history) {
    const value = row.recovery?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) days.set(row.workout_date, value)
  }
  for (const row of context.wellness_history || []) {
    const date = String(row.date || row.id || '').slice(0, 10)
    const value = key === 'hrv' ? row.hrv : row.restingHR ?? row.resting_hr
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && typeof value === 'number' && Number.isFinite(value)) days.set(date, value)
  }
  const raw = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({date, value}))
  return raw.map((item, index) => {
    const oldest = Date.parse(`${item.date}T12:00:00Z`) - 6 * 86400000
    const window = raw.slice(0, index + 1).filter(p => Date.parse(`${p.date}T12:00:00Z`) >= oldest)
    const average = window.reduce((sum, p) => sum + p.value, 0) / window.length
    const variance = window.reduce((sum, p) => sum + (p.value - average) ** 2, 0) / window.length
    const spread = Math.max(key === 'hrv' ? 5 : 2, Math.sqrt(variance) * 1.75)
    return {...item, average: Number(average.toFixed(1)), baselineLow: Number((average - spread).toFixed(1)), baselineHigh: Number((average + spread).toFixed(1))}
  }).slice(-14)
}

export function workoutDurations(workout: PlannedWorkout) {
  const planned = workout.workout_summary?.planned?.duration_seconds != null
    ? workout.workout_summary.planned.duration_seconds / 60
    : workout.plannedDurationMinutes ?? workout.planned?.duration_minutes ?? 0
  const completed = workout.workout_summary?.completed?.duration_seconds != null
    ? workout.workout_summary.completed.duration_seconds / 60
    : workout.actualDurationMinutes ?? workout.completed_data?.duration_minutes ?? 0
  return {planned, completed, remaining: Math.max(0, planned - completed)}
}
