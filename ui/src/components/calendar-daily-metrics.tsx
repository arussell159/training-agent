import { HeartPulse, EllipsisVertical } from "lucide-react"
import { calendarMetricSummary } from "@/lib/calendar-metrics"
export function CalendarDailyMetrics({
  row,
  onOpen,
}: {
  row?: Record<string, unknown>
  onOpen: () => void
}) {
  if (!row) return null
  const values = calendarMetricSummary(row)
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
        <EllipsisVertical
          className="calendar-metrics-options"
          aria-hidden="true"
        />
      </span>
      <p>
        {values[0].label}:{" "}
        {values[0].value}{" "}
        {values[0].unit}
      </p>
      {values.length > 1 && <small>{values.length - 1} more…</small>}
    </button>
  )
}
