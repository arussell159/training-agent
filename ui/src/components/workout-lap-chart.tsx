import { METERS_PER_100_YARDS } from "../../../app-backend/lib/swim-units.mjs"
import { useMemo, useRef, useState } from "react"
import {
  formatSignalClock,
  intervalSignals,
  type RecordedLap,
} from "@/lib/interval-signals"
import type { RecordedPoint } from "@/lib/segment-statistics"
import { lapHeartRatePath } from "@/lib/lap-heart-rate"

export function WorkoutLapChart({
  points,
  laps,
  sport,
  selected,
  onSelect,
  expanded = false,
}: {
  points: RecordedPoint[]
  laps: RecordedLap[]
  sport: string
  selected: RecordedLap | null
  onSelect: (lap: RecordedLap) => void
  expanded?: boolean
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const swim = /swim/i.test(sport),
    pace = /swim|run/i.test(sport)
  const intervals = useMemo(() => intervalSignals(points, laps), [points, laps])
  const signal = (point: RecordedPoint) =>
    pace
      ? point.speed != null && point.speed > 0.15
        ? (swim ? METERS_PER_100_YARDS : 1609.344) / point.speed
        : null
      : point.power
  const bars = intervals
    .map((item, index) => ({ ...item, index, value: signal(item.point) }))
    .filter(
      (item): item is typeof item & { value: number } =>
        item.value != null && Number.isFinite(item.value)
    )
  if (!bars.length) return null
  const duration = Math.max(
    1,
    bars.reduce((sum, bar) => sum + bar.lap.end - bar.lap.start, 0)
  )
  const width = expanded ? Math.max(480, bars.length * 60) : 480
  const gap = 2,
    plotWidth = width - gap * (bars.length - 1)
  let elapsed = 0
  const positions = new Map(
    bars.map((bar, index) => {
      const left = (elapsed / duration) * plotWidth + index * gap
      const barWidth = ((bar.lap.end - bar.lap.start) / duration) * plotWidth
      elapsed += bar.lap.end - bar.lap.start
      return [
        bar.lap.id,
        { left, width: barWidth, center: left + barWidth / 2 },
      ]
    })
  )
  const heartRatePath =
    !swim && /run|bike|ride|cycl/i.test(sport)
      ? lapHeartRatePath(
          points,
          bars.map(({ lap }) => ({
            start: lap.start,
            end: lap.end,
            ...positions.get(lap.id)!,
          }))
        )
      : ""
  const minimum = Math.min(...bars.map((bar) => bar.value)),
    maximum = Math.max(...bars.map((bar) => bar.value))
  const low = pace ? Math.max(0, minimum - 10) : 0,
    high = pace ? Math.max(low + 20, maximum + 10) : Math.max(1, maximum * 1.1)
  const y = (value: number) =>
    pace
      ? 20 + ((value - low) / (high - low)) * 170
      : 190 - ((value - low) / (high - low)) * 170
  const unit = pace ? (swim ? "min/100 yd" : "min/mi") : "W"
  const format = (value: number) =>
    pace ? formatSignalClock(value) : Math.round(value).toLocaleString()
  const select = (lap: RecordedLap, clientX?: number) => {
    onSelect(lap)
    const viewport = scroll.current
    if (!viewport) return
    if (clientX == null) {
      const center = positions.get(lap.id)!.center
      viewport.scrollTo({
        left: Math.max(0, center - viewport.clientWidth / 2),
        behavior: "smooth",
      })
    }
  }
  return (
    <section
      aria-label="Lap chart"
      data-workout-lap-control
      className="space-y-2 md:hidden"
    >
      {!expanded && <h3 className="text-xl font-bold">
        {swim ? "Swim intervals" : "Laps"}
      </h3>}
      <div className="relative">
        <div
          className="absolute top-0 bottom-0 left-0 z-10 w-12 bg-background"
          aria-hidden="true"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <span
              key={f}
              className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground"
              style={{ top: 20 + 170 * f }}
            >
              {format(pace ? low + f * (high - low) : high - f * (high - low))}
            </span>
          ))}
          <span className="absolute right-2 bottom-2 text-[10px] text-muted-foreground">{pace ? (swim ? "/100 yd" : "/mi") : "W"}</span>
        </div>
        <div className="relative ml-12">
          <div
            ref={scroll}
            className={expanded ? "overflow-x-auto overscroll-x-contain pb-1" : "pb-1"}
          >
            <svg
              width={expanded ? width : "100%"}
              height="228"
              viewBox={`0 0 ${width} 228`}
              preserveAspectRatio="none"
              className="block select-none"
              role="group"
              aria-label={expanded ? "Scrollable interval averages" : "Lap averages"}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <line
                  key={f}
                  x1="0"
                  x2={width}
                  y1={20 + 170 * f}
                  y2={20 + 170 * f}
                  stroke="currentColor"
                  opacity=".08"
                />
              ))}
              {bars.map((bar) => {
                const position = positions.get(bar.lap.id)!,
                  left = position.left,
                  barWidth = position.width,
                  top = y(bar.value)
                return (
                  <g
                    key={bar.lap.id}
                    data-workout-lap-control
                    role="button"
                    tabIndex={0}
                    aria-label={`${bar.lap.label}, ${format(bar.value)} ${unit}, duration ${formatSignalClock(bar.lap.end - bar.lap.start)}`}
                    aria-pressed={selected?.id === bar.lap.id}
                    className="cursor-pointer outline-none focus:opacity-70"
                    onPointerEnter={() => setHovered(bar.lap.id)}
                    onPointerLeave={() => setHovered(null)}
                    onClick={(event) =>
                      select(
                        bar.lap,
                        event.detail === 0 ? undefined : event.clientX
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        select(bar.lap)
                      }
                    }}
                  >
                    <rect
                      x={left}
                      y={0}
                      width={barWidth}
                      height="228"
                      fill="transparent"
                    />
                    <rect
                      x={left}
                      y={top}
                      width={barWidth}
                      height={Math.max(2, 190 - top)}
                      rx={Math.min(7, barWidth / 2)}
                      fill={
                        selected?.id === bar.lap.id || hovered === bar.lap.id
                          ? "#b8d5f3"
                          : "#287ed7"
                      }
                    />
                    {barWidth > 22 && (
                      <text
                        x={left + barWidth / 2}
                        y="214"
                        textAnchor="middle"
                        fontSize="11"
                        fill="currentColor"
                        opacity=".65"
                      >
                        {bar.index + 1}
                      </text>
                    )}
                  </g>
                )
              })}
              {heartRatePath && (
                <path
                  d={heartRatePath}
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  pointerEvents="none"
                  role="img"
                  aria-label="Recorded heart rate over laps"
                />
              )}
            </svg>
          </div>
        </div>
      </div>
    </section>
  )
}
