import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import {
  normalizedPersonalStatistics,
  samePersonalBestWindow,
  type PersonalBestEffort,
} from "@/lib/personal-statistics"
import { recordedPowerCurve, type AnalysisRange } from "@/lib/analysis-360"
import type { RecordedPoint } from "@/lib/segment-statistics"
import type { PlannedWorkout } from "@/lib/training-context"
import { Analysis360Table, type AnalysisColumn } from "./analysis-360-table"
import { analysisClock } from "./analysis-360-charts"
import { LoadingRegion } from "./loading-layouts"
import { Skeleton } from "./ui/skeleton"

const columns: AnalysisColumn[] = [
  { key: "seconds", label: "Duration", format: analysisClock },
  {
    key: "watts",
    label: "Peak Power (W)",
    format: (value) => Math.round(value).toLocaleString(),
  },
  { key: "modeled", label: "Modeled Power (W)" },
  { key: "wattsPerKg", label: "Peak Power (W/kg)" },
  { key: "title", label: "Workout Title" },
  { key: "date", label: "Date" },
]

export function Analysis360Power({
  points,
  duration,
  workout,
  onSelect,
}: {
  points: RecordedPoint[]
  duration: number
  workout: PlannedWorkout
  onSelect: (range: AnalysisRange) => void
}) {
  const curve = useMemo(
    () => recordedPowerCurve(points, duration),
    [points, duration]
  )
  const [history, setHistory] = useState<PersonalBestEffort[]>([]),
    [loading, setLoading] = useState(/bike|ride|cycl/i.test(workout.sport)),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0)
  const [showHistory, setShowHistory] = useState(true),
    [showRide, setShowRide] = useState(true)
  const date = workout.workout_date || new Date().toISOString().slice(0, 10)
  useEffect(() => {
    if (!/bike|ride|cycl/i.test(workout.sport)) return
    const controller = new AbortController(),
      start = new Date(`${date}T12:00:00Z`)
    start.setUTCDate(start.getUTCDate() - 89)
    const expected = { oldest: start.toISOString().slice(0, 10), newest: date }
    setLoading(true)
    setError("")
    void apiFetch(`/api/personal-statistics?${new URLSearchParams(expected)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await response.json()
        if (!response.ok)
          throw Error(value.error || "Power history could not be loaded.")
        const data = normalizedPersonalStatistics(value)
        if (!samePersonalBestWindow(data.bestEffortsWindow, expected))
          throw Error("Power history returned a different date range.")
        if (data.bestEffortsError) throw Error(data.bestEffortsError)
        if (!controller.signal.aborted)
          setHistory(
            data.bestEfforts.filter(
              (effort) => effort.kind === "power" && effort.sport === "Bike"
            )
          )
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setHistory([])
          setError(
            reason instanceof Error
              ? reason.message
              : "Power history could not be loaded."
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [workout.sport, date, retry])
  const historical = history
    .filter((effort) => effort.duration_seconds && effort.value >= 0)
    .map((effort) => ({
      seconds: effort.duration_seconds!,
      watts: effort.value,
    }))
    .sort((a, b) => a.seconds - b.seconds)
  const last = Math.max(
      1,
      ...curve.map((point) => point.seconds),
      ...historical.map((point) => point.seconds)
    ),
    max = Math.max(
      1,
      ...curve.map((point) => point.watts),
      ...historical.map((point) => point.watts)
    )
  const path = (values: { seconds: number; watts: number }[]) =>
    values
      .map(
        (point, index) =>
          `${index ? "L" : "M"}${((Math.log(point.seconds) / Math.max(1, Math.log(last))) * 1000).toFixed(2)},${(235 - (point.watts / max) * 225).toFixed(2)}`
      )
      .join(" ")
  const rows = useMemo(
    () =>
      curve.map((point) => ({
        id: String(point.seconds),
        seconds: point.seconds,
        watts: point.watts,
        modeled: null,
        wattsPerKg: null,
        title: workout.title,
        date: workout.workout_date || "",
      })),
    [curve, workout.title, workout.workout_date]
  )
  if (!curve.length)
    return (
      <p className="a360-empty">
        No recorded power channel is available for this workout.
      </p>
    )
  return (
    <div className="a360-power">
      <dl className="a360-modeled-metrics">
        {[
          ["mFTP", "W"],
          ["FRC", "kJ"],
          ["Pmax", "W"],
          ["TTE", ""],
        ].map(([label, unit]) => (
          <div
            key={label}
            title="This modeled metric is not supplied by the connected provider."
          >
            <dt>{label}</dt>
            <dd>
              — <small>{unit}</small>
            </dd>
          </div>
        ))}
      </dl>
      <div className="a360-power-plot">
        <div className="a360-power-y">
          {[1, 0.75, 0.5, 0.25, 0].map((fraction) => (
            <span key={fraction}>{Math.round(max * fraction)}</span>
          ))}
        </div>
        <svg
          viewBox="0 0 1000 250"
          preserveAspectRatio="none"
          role="img"
          aria-label="Recorded power duration curves. This workout and available last 90 day peaks."
        >
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              x2="1000"
              y1={235 - fraction * 225}
              y2={235 - fraction * 225}
              stroke="currentColor"
              opacity=".08"
            />
          ))}
          {showHistory && historical.length > 0 && (
            <path
              d={path(historical)}
              fill="none"
              stroke="#ff8b35"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {showRide && (
            <path
              d={path(curve)}
              fill="none"
              stroke="#6c4fc3"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <div className="a360-power-x">
          {[1, 10, 60, 300, 1200, 3600]
            .filter((seconds) => seconds <= last)
            .map((seconds) => (
              <span
                key={seconds}
                style={{
                  left: `${(Math.log(seconds) / Math.max(1, Math.log(last))) * 100}%`,
                }}
              >
                {analysisClock(seconds)}
              </span>
            ))}
        </div>
      </div>
      <div className="a360-curve-legend">
        <label title="The connected provider does not supply a modeled power curve.">
          <input type="checkbox" disabled />{" "}
          <i style={{ background: "#2444df" }} />
          Modeled
        </label>
        <label>
          <input
            type="checkbox"
            checked={showHistory}
            onChange={(event) => setShowHistory(event.target.checked)}
          />
          <i style={{ background: "#ff8b35" }} />
          Last 90 Days
        </label>
        <label>
          <input
            type="checkbox"
            checked={showRide}
            onChange={(event) => setShowRide(event.target.checked)}
          />
          <i style={{ background: "#6c4fc3" }} />
          This Ride
        </label>
      </div>
      {loading && (
        <LoadingRegion
          label="Loading 90-day power history"
          className="a360-data-status"
        >
          <div className="flex gap-4 py-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-3 w-32 max-w-[28%]" />
            ))}
          </div>
        </LoadingRegion>
      )}
      {error && (
        <p role="alert" className="a360-data-status">
          {error}{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      <Analysis360Table
        columns={columns}
        rows={rows}
        label="Workout peak power"
        onSelect={(id) => {
          const point = curve.find((point) => String(point.seconds) === id)
          if (point) onSelect([point.start, point.end])
        }}
        filename="workout-power-curve.csv"
      />
    </div>
  )
}
