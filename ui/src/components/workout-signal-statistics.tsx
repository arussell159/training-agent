import {
  formatRecordedSignal,
  recordedSignalInfo,
  recordedSignalValue,
  type SignalStatistics,
} from "@/lib/workout-signal-statistics"
import type { RecordedPoint } from "@/lib/segment-statistics"

export function WorkoutSignalStatistics({
  rows,
  sport,
  rangeLabel,
  cursor,
}: {
  rows: SignalStatistics[]
  sport: string
  rangeLabel: string
  cursor: RecordedPoint | null
}) {
  return (
    <aside
      className="analysis-statistics"
      aria-label="Recorded signal statistics"
    >
      <h3>Signal statistics</h3>
      <p className="analysis-statistics-range">{rangeLabel}</p>
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
            <th scope="col" className="sr-only">
              Unit
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
                <td className="analysis-statistics-unit">{info.unit}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {cursor && (
        <div
          className="analysis-cursor-statistics"
          aria-label="Values at graph cursor"
        >
          <h4>
            At {Math.floor(cursor.time / 60)}:
            {String(Math.floor(cursor.time % 60)).padStart(2, "0")}
          </h4>
          <dl>
            {rows.map((row) => {
              const info = recordedSignalInfo(row.key, sport)
              return (
                <div key={row.key}>
                  <dt>{info.label}</dt>
                  <dd>
                    {formatRecordedSignal(
                      recordedSignalValue(cursor, row.key, sport),
                      row.key,
                      sport
                    )}{" "}
                    <span>{info.unit}</span>
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>
      )}
    </aside>
  )
}
