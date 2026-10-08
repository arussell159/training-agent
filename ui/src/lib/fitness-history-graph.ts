import type {
  FitnessAnchor,
  FitnessPeak,
  FitnessPeriod,
  FitnessSport,
} from "./fitness-history.ts"
import { validHistoryDay } from "./training-history-view.ts"

export type FitnessGraphPeriod = "weeks" | "months"
export type FitnessGraphPoint = {
  date: string
  period: string
  time: number
  value: number | null
  source?: FitnessPeak["source"]
  activity_id?: string | null
  peak?: FitnessPeak
}

/** Each point is the measured period peak; gaps stay gaps and periods stay chronological. */
export function fitnessGraphSeries(
  periods: FitnessPeriod[],
  anchor: FitnessAnchor,
  sport: FitnessSport
): FitnessGraphPoint[] {
  return periods
    .filter((period) => validHistoryDay(period.start))
    .map((period) => {
      const peak = period.peaks.find((peak) =>
        sport === "Ride"
          ? peak.duration_seconds === anchor.duration_seconds &&
            peak.unit === "watts"
          : peak.unit === "m/s" &&
            peak.distance_meters != null &&
            anchor.distance_meters != null &&
            Math.abs(peak.distance_meters - anchor.distance_meters) <=
              (sport === "Swim" ? 0.5 : 0.01)
      )
      const raw = peak?.value
      let value: number | null =
        typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null
      if (sport !== "Ride")
        value =
          value != null && value > 0
            ? (sport === "Run" ? 1609.344 : 91.44) / value
            : null
      if (value != null && !Number.isFinite(value)) value = null
      const date = peak?.date ?? period.start
      return {
        date,
        period: period.start,
        time: Date.parse(`${period.start.slice(0, 7)}-01T12:00:00Z`),
        value,
        source: peak?.source,
        activity_id: peak?.activity_id,
        peak,
      }
    })
    .sort((left, right) => left.time - right.time)
}

export function fitnessGraphDomain(
  points: FitnessGraphPoint[],
  sport: FitnessSport
): [number, number] {
  const values = points.flatMap((point) =>
    point.value != null && Number.isFinite(point.value) && point.value >= 0
      ? [point.value]
      : []
  )
  if (!values.length) return sport === "Ride" ? [0, 1] : [60, 120]
  const min = Math.min(...values),
    max = Math.max(...values)
  const padding = Math.max(
    sport === "Ride" ? 1 : 5,
    (max - min) * 0.15,
    max === min ? max * 0.05 : 0
  )
  const bottom = Math.max(0, min - padding),
    top = max + padding
  return [
    Number.isFinite(bottom) ? bottom : 0,
    Number.isFinite(top) ? top : max,
  ]
}

export function formatFitnessGraphValue(
  value: number | null,
  sport: FitnessSport
): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—"
  if (sport === "Ride") return Math.round(value).toLocaleString("en-US")
  const seconds = Math.round(value)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return "—"
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

const monthFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})
const weekFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})
export function formatFitnessGraphDate(
  time: number,
  period: FitnessGraphPeriod
): string {
  if (!Number.isFinite(time) || !Number.isFinite(new Date(time).getTime()))
    return "—"
  const date = new Date(time)
  if (period === "months")
    return `${monthFormat.format(date)} '${String(date.getUTCFullYear()).slice(-2)}`
  return weekFormat.format(date)
}
