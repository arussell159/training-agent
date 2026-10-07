export type HistorySport = "all" | "run" | "bike" | "swim"
export type HistoryTotals = { hours: number; distanceMeters: number; elevationMeters: number }
export type HistoryWeek = { week: string } & Record<HistorySport, HistoryTotals>

export function validHistoryDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Reject incomplete/corrupt compact charts; the context stays a safe fallback. */
export function validatedHistoryWeeks(value: unknown): HistoryWeek[] | null {
  if (!Array.isArray(value) || value.length !== 12) return null
  const weeks: HistoryWeek[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || !validHistoryDay(candidate.week)) return null
    const date = new Date(`${candidate.week}T12:00:00Z`)
    if (date.getUTCDay() !== 1) return null
    if (weeks.length && date.getTime() - Date.parse(`${weeks.at(-1)!.week}T12:00:00Z`) !== 7 * 86400000) return null
    const totals = {} as Record<HistorySport, HistoryTotals>
    for (const sport of ["all", "run", "bike", "swim"] as const) {
      const source = candidate[sport]
      if (!source || typeof source !== "object") return null
      for (const key of ["hours", "distanceMeters", "elevationMeters"] as const) {
        if (typeof source[key] !== "number" || !Number.isFinite(source[key]) || source[key] < 0) return null
      }
      totals[sport] = { hours: source.hours, distanceMeters: source.distanceMeters, elevationMeters: source.elevationMeters }
    }
    weeks.push({ week: candidate.week, ...totals })
  }
  return weeks
}
