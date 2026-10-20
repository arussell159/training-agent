import { useMemo, useState } from "react"
import {
  analysisRangeMetrics,
  type AnalysisLap,
  type AnalysisRange,
} from "@/lib/analysis-360"
import type { RecordedPoint } from "@/lib/segment-statistics"
import {
  Analysis360Table,
  type AnalysisColumn,
  type AnalysisTableRow,
} from "./analysis-360-table"
import { analysisClock } from "./analysis-360-charts"
import { formatRecordedSignal } from "@/lib/workout-signal-statistics"

const number =
  (digits = 0) =>
  (value: number) =>
    value.toLocaleString("en-US", { maximumFractionDigits: digits })
const baseColumns: AnalysisColumn[] = [
  { key: "name", label: "Name" },
  { key: "source", label: "Source" },
  { key: "duration", label: "Elapsed time", format: analysisClock },
  { key: "distance", label: "Distance (mi)", format: number(2) },
  { key: "tss", label: "TSS", format: number() },
  { key: "normalizedPower", label: "NP (W)", format: number() },
  { key: "power", label: "Avg power (W)", format: number() },
  { key: "heartRate", label: "Avg heart rate (bpm)", format: number() },
  { key: "intensity", label: "IF", format: number(2) },
  { key: "variability", label: "VI", format: number(2) },
  { key: "work", label: "Work (kJ)", format: number() },
  { key: "cadence", label: "Avg cadence (rpm)", format: number() },
  { key: "speed", label: "Avg speed (mph)", format: number(2) },
]

export function Analysis360Laps({
  sport,
  laps,
  points,
  ftp,
  selected,
  onToggle,
  onSelect,
  onCompare,
  comparison = false,
}: {
  sport: string
  laps: AnalysisLap[]
  points: RecordedPoint[]
  ftp: number | null
  selected: string[]
  onToggle: (id: string) => void
  onSelect: (range: AnalysisRange | null) => void
  onCompare: () => void
  comparison?: boolean
}) {
  const swim = /swim/i.test(sport),
    pace = swim || /run/i.test(sport)
  const columns = useMemo(
    () =>
      baseColumns.map((column) =>
        column.key === "distance" && swim
          ? { ...column, label: "Distance (yd)", format: number() }
          : column.key === "speed" && pace
            ? {
                ...column,
                label: swim ? "Avg pace (min/100 yd)" : "Avg pace (min/mi)",
                format: (value: number) =>
                  formatRecordedSignal(value, "pace", sport),
              }
            : column.key === "cadence"
              ? {
                  ...column,
                  label: swim
                    ? "Avg stroke rate (strokes/min)"
                    : pace
                      ? "Avg cadence (spm)"
                      : column.label,
                }
              : column
      ),
    [sport, swim, pace]
  )
  const [sources, setSources] = useState<AnalysisLap["source"][]>([
    "Device",
    "Detected Interval",
    "User",
    "Detected Climb",
  ])
  const rows = useMemo(
    () =>
      laps.map((lap) => {
        const metrics = analysisRangeMetrics(points, lap.start, lap.end, ftp)
        return {
          id: lap.id,
          name: lap.label,
          source: lap.source,
          duration: metrics.duration,
          distance:
            metrics.distance == null
              ? null
              : metrics.distance / (swim ? 0.9144 : 1609.344),
          tss: metrics.tss,
          normalizedPower: metrics.normalizedPower,
          power: metrics.power,
          heartRate: metrics.heartRate,
          intensity: metrics.intensity,
          variability: metrics.variability,
          work: metrics.work,
          cadence: metrics.cadence,
          speed:
            metrics.speed == null
              ? null
              : pace
                ? metrics.speed > 0.15
                  ? (swim ? 91.44 : 1609.344) / metrics.speed
                  : null
                : metrics.speed * 2.2369362920544,
        } satisfies AnalysisTableRow
      }),
    [laps, points, ftp, swim, pace]
  )
  const chosen = selected
    .map((id) => rows.find((row) => row.id === id))
    .filter((row): row is (typeof rows)[number] => Boolean(row))
  const baseline = chosen[0]
  const visibleRows = rows.filter((row) => sources.includes(row.source))
  return (
    <div className="a360-laps">
      <div className="a360-source-filters" aria-label="Lap sources">
        {(
          [
            ["Device", "Device"],
            ["User", "User"],
            ["Detected Climb", "Detected Climbs"],
            ["Detected Interval", "Detected Intervals"],
          ] as const
        ).map(([key, label]) => {
          const count = laps.filter((lap) => lap.source === key).length
          return (
            <button
              key={key}
              type="button"
              disabled={!count}
              aria-pressed={sources.includes(key)}
              onClick={() =>
                setSources((current) =>
                  current.includes(key)
                    ? current.filter((source) => source !== key)
                    : [...current, key]
                )
              }
            >
              {label} ({count})
            </button>
          )
        })}
      </div>
      <Analysis360Table
        columns={columns}
        rows={visibleRows}
        label="Recorded laps"
        selected={selected}
        onToggle={onToggle}
        onSelect={(id) => {
          const lap = laps.find((lap) => lap.id === id)
          if (lap) onSelect([lap.start, lap.end])
        }}
        filename="workout-laps.csv"
      >
        {!comparison && (
          <button
            type="button"
            disabled={selected.length < 2}
            onClick={onCompare}
          >
            Compare Laps
          </button>
        )}
      </Analysis360Table>
      {comparison &&
        (chosen.length < 2 ? (
          <p className="a360-empty">Select at least two laps to compare</p>
        ) : (
          <section className="a360-lap-comparison" aria-label="Lap Compare">
            <h3>Lap Compare</h3>
            <div className="a360-grid-scroll">
              <table>
                <thead>
                  <tr>
                    {columns.slice(0, 10).map((column) => (
                      <th key={column.key}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chosen.map((row, index) => (
                    <tr key={row.id}>
                      {columns.slice(0, 10).map((column) => {
                        const value = row[column.key as keyof typeof row],
                          base = baseline[column.key as keyof typeof baseline]
                        return (
                          <td key={column.key}>
                            {value == null
                              ? "—"
                              : typeof value === "number" && column.format
                                ? column.format(value)
                                : value}
                            {column.key === "name" && index === 0 && (
                              <small className="a360-baseline">Baseline</small>
                            )}
                            {index > 0 &&
                              typeof value === "number" &&
                              typeof base === "number" && (
                                <small className="a360-delta">
                                  {value - base >= 0 ? "+" : "−"}
                                  {column.format
                                    ? column.format(Math.abs(value - base))
                                    : Math.abs(value - base).toFixed(2)}
                                </small>
                              )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </div>
  )
}
