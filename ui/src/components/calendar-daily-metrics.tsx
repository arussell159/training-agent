import { HeartPulse } from "lucide-react"
export function CalendarDailyMetrics({
  row,
  onOpen,
}: {
  row?: Record<string, unknown>
  onOpen: () => void
}) {
  if (!row) return null
  const fields = [
    ["sleepSecs", "Sleep Hours", 3600, "hrs"],
    ["restingHR", "Resting Heart Rate", 1, "bpm"],
    ["hrv", "HRV", 1, "ms"],
    ["sleepScore", "Sleep Score", 1, ""],
    ["weight", "Weight", 1, "kg"],
    ["spO2", "Blood Oxygen", 1, "%"],
    ["stress", "Stress", 1, ""],
  ] as const
  const values = fields
    .filter(
      ([key]) => typeof row[key] === "number" && Number.isFinite(row[key])
    )
    .map(([key, label, divisor, unit]) => ({
      label,
      value: Number(row[key]) / divisor,
      unit,
    }))
  if (!values.length) return null
  return (
    <button
      className="calendar-daily-metrics"
      type="button"
      onClick={onOpen}
      aria-label="View daily metrics"
    >
      <span>
        <HeartPulse />
        Metrics
      </span>
      <p>
        {values[0].label}:{" "}
        {values[0].value.toFixed(values[0].unit === "hrs" ? 2 : 0)}{" "}
        {values[0].unit}
      </p>
      {values.length > 1 && <small>{values.length - 1} more…</small>}
    </button>
  )
}
