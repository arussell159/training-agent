export type CalendarAnchor = { top: number; scrollY: number }

// The calendar disables native scroll anchoring, so this adjustment accounts
// for layout growth while preserving any user scroll since the capture.
export function calendarAnchorAdjustment(
  anchor: CalendarAnchor,
  currentTop: number,
  currentScrollY: number,
) {
  return currentTop - anchor.top + currentScrollY - anchor.scrollY
}

export function calendarWeekKey(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}

export function calendarRange(today: Date, around?: Date) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 28)
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 84)
  if (around && around < start) start.setTime(around.getTime())
  if (around && around > end) end.setTime(around.getTime())
  return { start: calendarWeekKey(start), end: calendarWeekKey(end) }
}

export function extendCalendarRange(
  current: { start: string; end: string },
  date: Date,
) {
  const week = calendarWeekKey(date)
  if (week >= current.start && week <= current.end) return current
  return {
    start: week < current.start ? week : current.start,
    end: week > current.end ? week : current.end,
  }
}

export function indexCalendarWorkouts<T extends { workout_date?: string }>(workouts: T[]) {
  const result = new Map<string, T[]>()
  for (const workout of workouts) {
    if (!workout.workout_date) continue
    const date = new Date(`${workout.workout_date}T12:00:00`)
    if (!Number.isFinite(date.getTime())) continue
    const week = calendarWeekKey(date)
    const list = result.get(week)
    if (list) list.push(workout)
    else result.set(week, [workout])
  }
  return result
}
