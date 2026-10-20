import {
  formatRecordedSignal,
  recordedSignalInfo,
  recordedSignalValue,
  type SignalStatistics,
} from "@/lib/workout-signal-statistics"
import type { RecordedPoint } from "@/lib/segment-statistics"

export type WorkoutSignalOverview = {
  title: string
  primary: { label: string; value: string; unit?: string }[]
  details: { label: string; value: string; unit?: string }[]
}

export function WorkoutSignalStatistics({
  rows,
  sport,
  rangeLabel,
  cursor,
  overview,
}: {
  rows: SignalStatistics[]
  sport: string
  rangeLabel: string
  cursor: RecordedPoint | null
  overview?: WorkoutSignalOverview
}) {
  return (
    <aside
      className="analysis-statistics"
      aria-label="Recorded signal statistics"
    >
      <h3>{overview?.title || "Signal statistics"}</h3>
      {overview && (
        <>
          <dl className="analysis-inspector-primary">
            {overview.primary.map((metric) => (
              <div key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>
                  {metric.value}
                  <small>{metric.unit && ` ${metric.unit}`}</small>
                </dd>
              </div>
            ))}
          </dl>
          <dl className="analysis-inspector-details">
            {overview.details.map((metric) => (
              <div key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>
                  {metric.value}
                  <small>{metric.unit && ` ${metric.unit}`}</small>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {(!overview || rangeLabel !== "Full workout") && (
        <p className="analysis-statistics-range">{rangeLabel}</p>
      )}
      <p className="analysis-cursor-time" aria-label="Values at graph cursor">
        {cursor
          ? `Cursor · ${Math.floor(cursor.time / 60)}:${String(Math.floor(cursor.time % 60)).padStart(2, "0")}`
          : "Hover over a graph or route to inspect"}
      </p>
      <table>
        <caption className="sr-only">
          Minimum, time-weighted average and maximum of recorded signals for{" "}
          {rangeLabel.toLowerCase()}
        </caption>
        <thead>
          <tr>
            <th scope="col">Signal</th>
            <th scope="col">Min</th>
            <th scope="col">Avg</th>
            <th scope="col">Max</th>
            <th scope="col">Cursor</th>
            <th scope="col">
              <span className="sr-only">Unit</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const info = recordedSignalInfo(row.key, sport)
            return (
              <tr key={row.key} data-signal-statistics={row.key}>
                <th scope="row">
                  <i
                    aria-hidden="true"
                    style={{ backgroundColor: info.color }}
                  />
                  {info.label}
                </th>
                {[row.minimum, row.average, row.maximum].map((value, index) => (
                  <td key={index}>
                    {formatRecordedSignal(value, row.key, sport)}
                  </td>
                ))}
                <td className="analysis-cursor-value">
                  {formatRecordedSignal(
                    cursor ? recordedSignalValue(cursor, row.key, sport) : null,
                    row.key,
                    sport
                  )}
                </td>
                <td className="analysis-statistics-unit">{info.unit}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </aside>
  )
}
