import type { WorkoutSummaryValues } from "./training-context"
export type PlannedValueKey =
  | "duration_seconds"
  | "distance_meters"
  | "average_speed"
  | "average_power"
  | "normalized_power"
  | "calories"
  | "elevation_gain"
  | "elevation_loss"
  | "tss"
  | "intensity_factor"
  | "work_kj"
export function plannedValueRows(sport: string) {
  const swim = /swim/i.test(sport),
    bike = /bike|ride/i.test(sport)
  return [
    { key: "duration_seconds", label: "Duration", unit: "h:m:s" },
    { key: "distance_meters", label: "Distance", unit: swim ? "yd" : "mi" },
    {
      key: "average_speed",
      label: bike ? "Average speed" : "Average pace",
      unit: bike ? "mph" : swim ? "min/100yd" : "min/mi",
    },
    { key: "calories", label: "Calories", unit: "kcal" },
    { key: "elevation_gain", label: "Elevation gain", unit: "ft" },
    { key: "tss", label: "TSS", unit: "TSS" },
    { key: "intensity_factor", label: "IF", unit: "IF" },
    bike
      ? { key: "normalized_power", label: "Normalized power", unit: "W" }
      : { key: "elevation_loss", label: "Elevation loss", unit: "ft" },
    { key: "work_kj", label: "Work", unit: "kJ" },
  ] as Array<{ key: PlannedValueKey; label: string; unit: string }>
}
const round = (value: number, decimals: number) =>
  String(Number(value.toFixed(decimals)))
export function formatPlannedValue(
  key: PlannedValueKey,
  value: number | null | undefined,
  sport: string,
  completed = false
) {
  if (value == null || !Number.isFinite(value)) return ""
  const swim = /swim/i.test(sport)
  if (key === "duration_seconds") {
    const seconds = Math.round(value)
    return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
  }
  if (key === "average_speed") {
    if (/bike|ride/i.test(sport)) return (value * 2.2369362921).toFixed(1)
    if (value <= 0) return ""
    const seconds = Math.round(
      (swim ? (completed ? 91.44 : 100) : 1609.344) / value
    )
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  }
  if (key === "distance_meters")
    return round(
      value / (swim ? (completed ? 0.9144 : 1) : 1609.344),
      swim ? 0 : 2
    )
  if (key === "elevation_gain" || key === "elevation_loss")
    return round(value / 0.3048, 0)
  return round(
    value,
    key === "intensity_factor" ? 2 : key === "work_kj" ? 1 : 0
  )
}
export function plannedValueDraft(
  values: WorkoutSummaryValues | null | undefined,
  sport: string
) {
  return Object.fromEntries(
    plannedValueRows(sport).map(({ key }) => [
      key,
      formatPlannedValue(key, values?.[key], sport),
    ])
  ) as Record<PlannedValueKey, string>
}
export function parsePlannedValue(
  key: PlannedValueKey,
  text: string,
  sport: string
): number | null {
  if (!text.trim()) return null
  const fail = () => {
    throw Error(
      `Enter a valid ${plannedValueRows(sport)
        .find((row) => row.key === key)
        ?.label.toLowerCase()}.`
    )
  }
  if (
    key === "duration_seconds" ||
    (key === "average_speed" && !/bike|ride/i.test(sport))
  ) {
    const pattern =
      key === "duration_seconds" ? /^\d+:\d{1,2}:\d{2}$/ : /^\d+:\d{2}$/
    if (!pattern.test(text.trim())) return fail()
    const parts = text.trim().split(":").map(Number)
    if (parts.slice(1).some((part) => part >= 60)) return fail()
    const seconds = parts.reduce((total, part) => total * 60 + part, 0)
    if (key === "duration_seconds") {
      if (seconds > 604800) return fail()
      return seconds
    }
    if (seconds <= 0) return fail()
    return (/swim/i.test(sport) ? 100 : 1609.344) / seconds
  }
  if (!/^\d+(?:\.\d+)?$/.test(text.trim())) return fail()
  const value = Number(text)
  if (
    !Number.isFinite(value) ||
    value > 1e8 ||
    (key === "intensity_factor" && value > 5) ||
    (key === "tss" && !Number.isInteger(value))
  )
    return fail()
  if (key === "distance_meters")
    return value * (/swim/i.test(sport) ? 1 : 1609.344)
  if (key === "elevation_gain" || key === "elevation_loss")
    return value * 0.3048
  if (key === "average_speed") return value / 2.2369362921
  return value
}
export function changedPlannedValues(
  draft: Record<PlannedValueKey, string>,
  saved: Record<PlannedValueKey, string>,
  sport: string
) {
  return Object.fromEntries(
    plannedValueRows(sport)
      .filter(({ key }) => draft[key] !== saved[key])
      .map(({ key }) => [key, parsePlannedValue(key, draft[key], sport)])
  ) as Partial<WorkoutSummaryValues>
}
