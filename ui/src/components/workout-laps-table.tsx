import { useEffect, useRef } from "react"
import {
  formatSignalClock,
  type RecordedLap,
  intervalSignals,
} from "@/lib/interval-signals"

export function WorkoutLapsTable({
  intervals,
  sport,
  selected,
  onSelect,
}: {
  intervals: ReturnType<typeof intervalSignals>
  sport: string
  selected: RecordedLap | null
  onSelect: (lap: RecordedLap) => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<string, HTMLTableRowElement>())
  const swim = /swim/i.test(sport),
    pace = /run|swim/i.test(sport)
  const power = !pace && intervals.some((item) => item.point.power != null)
  const heartRate = !swim && /run|bike|ride|cycl/i.test(sport)
  useEffect(() => {
    const viewport = scroll.current,
      row = selected ? rows.current.get(selected.id) : null
    if (!viewport || !row) return
    const head =
      viewport.querySelector("thead")?.getBoundingClientRect().height || 0
    const box = viewport.getBoundingClientRect(),
      item = row.getBoundingClientRect()
    if (item.top < box.top + head || item.bottom > box.bottom)
      viewport.scrollTo({
        top: viewport.scrollTop + item.top - box.top - head,
        behavior: "smooth",
      })
  }, [selected])
  if (!intervals.length) return null
  return (
    <div
      ref={scroll}
      className="max-h-60 overflow-y-auto overscroll-y-contain rounded-xl border bg-card shadow-sm"
      data-workout-lap-control
      aria-label="Laps table"
    >
      <table className="w-full text-right text-xs tabular-nums">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Lap</th>
            <th className="px-2 py-2 font-medium">Time</th>
            <th className="px-2 py-2 font-medium">{pace ? "Pace" : "Speed"}</th>
            {power && <th className="px-2 py-2 font-medium">Power</th>}
            {heartRate && (
              <th className="px-2 py-2 font-medium" title="Average heart rate">
                HR
                <span className="block text-[10px] font-normal text-muted-foreground">
                  bpm
                </span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {intervals.map(({ lap, point }, index) => (
            <tr
              key={lap.id}
              ref={(element) => {
                if (element) rows.current.set(lap.id, element)
                else rows.current.delete(lap.id)
              }}
              aria-selected={selected?.id === lap.id}
              className={`border-t ${selected?.id === lap.id ? "bg-sky-100 dark:bg-sky-950" : "hover:bg-muted/40"}`}
              onClick={() => onSelect(lap)}
            >
              <td className="px-3 py-2 text-left">
                <button
                  type="button"
                  className="text-left"
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelect(lap)
                  }}
                  aria-label={`Select ${lap.label}`}
                >
                  <span>{index + 1}</span>
                  {lap.distance != null && (
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {swim
                        ? `${Math.round(lap.distance / 0.9144)} yd`
                        : `${(lap.distance / 1609.344).toFixed(2)} mi`}
                    </span>
                  )}
                </button>
              </td>
              <td className="px-2 py-2">
                {formatSignalClock(lap.end - lap.start)}
              </td>
              <td className="px-2 py-2">
                {point.speed != null && point.speed > 0
                  ? pace
                    ? `${formatSignalClock((swim ? 91.44 : 1609.344) / point.speed)} /${swim ? "100 yd" : "mi"}`
                    : `${(point.speed * 2.2369362921).toFixed(1)} mi/h`
                  : "—"}
              </td>
              {power && (
                <td className="px-2 py-2">
                  {point.power != null ? `${Math.round(point.power)} W` : "—"}
                </td>
              )}
              {heartRate && (
                <td className="px-2 py-2">
                  {point.heartRate != null && Number.isFinite(point.heartRate)
                    ? Math.round(point.heartRate)
                    : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
