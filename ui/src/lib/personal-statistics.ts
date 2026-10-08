import type { PerformanceData, PerformanceRecord } from "./personal-statistics-preview"

export type PerformanceSport = "Run" | "Bike" | "Swim"
export type PersonalBestWindow = { oldest: string | null; newest: string }
export type PersonalBestRange = "all" | "recent" | "year" | "custom"
export type PersonalBestEffort = {
  sport: PerformanceSport
  kind: "power" | "pace"
  duration_seconds: number | null
  distance_meters: number | null
  requested_distance_meters?: number | null
  value: number
  unit: "watts" | "m/s"
  activity_id: string | null
  date: string | null
  name: string | null
  estimated: false
  watts_per_kg?: number | null
}
export type PersonalStatisticsData = PerformanceData & {
  bestEfforts: PersonalBestEffort[]
  bestEffortsWindow: PersonalBestWindow
  bestEffortsError?: string
}

export const RUN_PERSONAL_BESTS = [
  { meters: 400, label: "400 m" }, { meters: 800, label: "800 m" }, { meters: 804.672, label: "½ mile" },
  { meters: 1000, label: "1 km" }, { meters: 1500, label: "1.5 km" }, { meters: 1609.344, label: "1 mile" },
  { meters: 3000, label: "3 km" }, { meters: 3218.688, label: "2 miles" }, { meters: 5000, label: "5 km" },
  { meters: 10000, label: "10 km" }, { meters: 15000, label: "15 km" },
  { meters: 16093.44, label: "10 miles" }, { meters: 20000, label: "20 km" },
  { meters: 21097.5, label: "Half marathon" }, { meters: 30000, label: "30 km" },
  { meters: 42195, label: "Marathon" },
] as const
export const BIKE_PERSONAL_BESTS = [
  { seconds: 5, label: "5 sec" }, { seconds: 10, label: "10 sec" },
  { seconds: 30, label: "30 sec" }, { seconds: 60, label: "1 min" },
  { seconds: 300, label: "5 min" }, { seconds: 600, label: "10 min" },
  { seconds: 1200, label: "20 min" }, { seconds: 3600, label: "1 hour" },
] as const
export const SWIM_PERSONAL_BESTS = [
  { meters: 100, label: "100 m" }, { meters: 200, label: "200 m" },
  { meters: 400, label: "400 m" }, { meters: 1000, label: "1 km" },
  { meters: 1500, label: "1.5 km" },
  { meters: 91.44, label: "100 yd" }, { meters: 182.88, label: "200 yd" },
  { meters: 365.76, label: "400 yd" }, { meters: 548.64, label: "600 yd" },
  { meters: 731.52, label: "800 yd" }, { meters: 914.4, label: "1,000 yd" },
  { meters: 1931.2128, label: "1.2 miles" }, { meters: 3862.4256, label: "2.4 miles" },
] as const

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function nonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}
function positive(value: unknown): number | null {
  const number = nonnegative(value)
  return number != null && number > 0 ? number : null
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function validPerformanceDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T12:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

export function personalBestWindow(range: PersonalBestRange, today: string, custom?: { oldest: string; newest: string }): PersonalBestWindow | null {
  if (!validPerformanceDate(today)) return null
  if (range === "all") return { oldest: null, newest: today }
  if (range === "custom") return custom && validPerformanceDate(custom.oldest) && validPerformanceDate(custom.newest) && custom.oldest <= custom.newest && custom.newest <= today ? { ...custom } : null
  if (range === "year") return { oldest: `${today.slice(0, 4)}-01-01`, newest: today }
  const start = new Date(`${today}T12:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 27)
  return { oldest: start.toISOString().slice(0, 10), newest: today }
}

export function samePersonalBestWindow(left: PersonalBestWindow, right: PersonalBestWindow) {
  return left.oldest === right.oldest && left.newest === right.newest
}

/** Curves are authoritative. Activity averages and achievement flags never create best efforts. */
export function normalizedPersonalStatistics(value: unknown): PersonalStatisticsData {
  const data = object(value)
  if (!data || !["intervals", "synthetic-local-preview"].includes(String(data.source)) || !validPerformanceDate(data.today) || !Array.isArray(data.records)) throw new Error("Intervals.icu returned invalid performance statistics.")
  const today = data.today
  const seen = new Set<string>()
  const records = data.records.flatMap((value): PerformanceRecord[] => {
    const record = object(value)
    if (!record || !validPerformanceDate(record.date) || record.date > today || !text(record.sport)) return []
    const id = text(record.id)
    if (id && seen.has(id)) return []
    if (id) seen.add(id)
    return [{
      ...(id ? { id } : {}), date: record.date, sport: text(record.sport)!, name: text(record.name) || "",
      distance_meters: nonnegative(record.distance_meters) ?? 0,
      duration_seconds: nonnegative(record.duration_seconds) ?? 0,
      elevation_meters: nonnegative(record.elevation_meters) ?? 0,
    }]
  })
  const rawWindow = object(data.bestEffortsWindow)
  const validWindow = rawWindow && (rawWindow.oldest === null || validPerformanceDate(rawWindow.oldest)) && validPerformanceDate(rawWindow.newest) && rawWindow.newest <= today && (rawWindow.oldest === null || rawWindow.oldest <= rawWindow.newest)
  const window = validWindow
    ? { oldest: rawWindow.oldest as string | null, newest: rawWindow.newest as string }
    : { oldest: null, newest: today }
  const bestEfforts = (Array.isArray(data.bestEfforts) && validWindow ? data.bestEfforts : []).flatMap((value): PersonalBestEffort[] => {
    const effort = object(value)
    if (!effort || effort.estimated !== false || !["Run", "Bike", "Swim"].includes(String(effort.sport))) return []
    const sport = effort.sport as PerformanceSport
    const power = sport === "Bike" && effort.kind === "power" && effort.unit === "watts"
    const pace = sport !== "Bike" && effort.kind === "pace" && effort.unit === "m/s"
    const number = power ? nonnegative(effort.value) : positive(effort.value)
    const duration = positive(effort.duration_seconds)
    const distance = positive(effort.distance_meters)
    if ((!power && !pace) || number == null || duration == null || (pace && (distance == null || !Number.isFinite(distance / number)))) return []
    const date = validPerformanceDate(effort.date) ? effort.date : null
    if (date && (date > window.newest || (window.oldest && date < window.oldest))) return []
    return [{
      sport, kind: power ? "power" : "pace", value: number, unit: power ? "watts" : "m/s",
      duration_seconds: duration, distance_meters: distance,
      requested_distance_meters: positive(effort.requested_distance_meters),
      activity_id: text(effort.activity_id), date, name: text(effort.name), estimated: false,
      watts_per_kg: power ? nonnegative(effort.watts_per_kg) : null,
    }]
  })
  return {
    records, today, source: data.source as string, synced_at: text(data.synced_at) || "",
    bestEfforts, bestEffortsWindow: window,
    ...(text(data.bestEffortsError) ? { bestEffortsError: text(data.bestEffortsError)! } : !validWindow && data.bestEfforts != null ? { bestEffortsError: "Intervals.icu returned an invalid personal-best date range. Please retry." } : {}),
  }
}

export function bestCurveEffort(efforts: PersonalBestEffort[], sport: PerformanceSport, target: number) {
  let best: PersonalBestEffort | null = null
  for (const effort of efforts) {
    if (effort.sport !== sport) continue
    const anchor = sport === "Bike" ? effort.duration_seconds : effort.requested_distance_meters ?? effort.distance_meters
    if (anchor == null || Math.abs(anchor - target) > (sport === "Bike" ? 0.001 : 0.01)) continue
    if (!best || effort.value > best.value) best = effort
  }
  return best
}

export function formatEffortTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—"
  const whole = Math.max(1, Math.round(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor(whole / 60) % 60
  const remainder = String(whole % 60).padStart(2, "0")
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`
}

export function formatEffortPace(effort: PersonalBestEffort) {
  if (effort.kind !== "pace") return "—"
  const unitMeters = effort.sport === "Swim" ? 91.44 : 1609.344
  return `${formatEffortTime(unitMeters / effort.value)}${effort.sport === "Swim" ? "/100 yd" : "/mi"}`
}
