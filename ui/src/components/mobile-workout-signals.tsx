import { METERS_PER_100_YARDS } from "../../../app-backend/lib/swim-units.mjs"
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react"
import type { RecordedPoint } from "@/lib/segment-statistics"
import {
  formatSignalClock,
  intervalSignals,
  tooltipPosition,
} from "@/lib/interval-signals"
import { WorkoutLapsPage } from "@/components/workout-laps-page"
import { WorkoutLapChart } from "@/components/workout-lap-chart"
import { WorkoutChartStats } from "@/components/workout-chart-stats"
import { WorkoutDfaChart } from "@/components/workout-dfa-chart"
import type { DfaStatistics } from "@/components/workout-analysis"
import type { WorkoutSummaryValues } from "@/lib/training-context"

type Lap = {
  id: string
  label: string
  start: number
  end: number
  distance?: number | null
  speed?: number | null
}
export function MobileWorkoutSignals({
  points,
  laps,
  duration,
  sport,
  summary,
  dfa,
  onLapSelect,
  afterLaps,
}: {
  points: RecordedPoint[]
  laps: Lap[]
  duration: number
  sport: string
  dfa?: DfaStatistics | null
  summary?: WorkoutSummaryValues | null
  onLapSelect?: (lap: Lap | null) => void
  afterLaps?: ReactNode
}) {
  const [time, setTime] = useState<number | null>(null),
    [lap, setLap] = useState<Lap | null>(null)
  const [lapsOpen, setLapsOpen] = useState(false)
  const closeLaps = useCallback(() => setLapsOpen(false), [])
  const swim = /swim/i.test(sport),
    run = /run/i.test(sport)
  const [activeTrack, setActiveTrack] = useState<string | null>(null)
  const lapSection = useRef<HTMLDivElement>(null)
  const intervals = useMemo(() => intervalSignals(points, laps), [points, laps])
  const value = (p: RecordedPoint, key: string) =>
    key === "pace"
      ? p.speed != null && p.speed > 0.15
        ? (swim ? METERS_PER_100_YARDS : 1609.344) / p.speed
        : null
      : key === "speed"
        ? p.speed == null
          ? null
          : p.speed * 2.2369362921
        : key === "power"
          ? p.power
          : key === "heartRate"
            ? p.heartRate
            : p.cadence
  const tracks = [
    ...(!run && !swim ? ["power"] : []),
    "heartRate",
    run || swim ? "pace" : "speed",
    "cadence",
  ].filter((key) => points.some((p) => value(p, key) != null))
  const label = (key: string) =>
    key === "heartRate"
      ? "Heart rate"
      : key === "pace"
        ? "Pace"
        : key === "power"
          ? "Power"
          : key === "speed"
            ? "Speed"
            : swim
              ? "Stroke rate"
              : "Cadence"
  const unit = (key: string) =>
    key === "pace"
      ? swim
        ? "min/100 yd"
        : "min/mi"
      : key === "power"
        ? "W"
        : key === "speed"
          ? "mi/h"
          : key === "heartRate"
            ? "bpm"
            : run
              ? "spm"
              : swim
                ? "strokes/min"
                : "rpm"
  const clock = formatSignalClock
  const format = (v: number | null | undefined, key: string) =>
    v == null
      ? "—"
      : key === "pace"
        ? clock(v)
        : key === "speed"
          ? v.toFixed(1)
          : Math.round(v).toLocaleString()
  const nearest =
    time == null
      ? null
      : points.reduce<RecordedPoint | null>(
          (best, p) =>
            !best || Math.abs(p.time - time) < Math.abs(best.time - time)
              ? p
              : best,
          null
        )
  const interval = intervals.find((i) =>
    lap
      ? i.lap.id === lap.id
      : time != null && time >= i.lap.start && time < i.lap.end
  )
  const averagePoint = interval?.point
  const move = (e: PointerEvent<SVGSVGElement>, key: string) => {
    setActiveTrack(key)
    if (!e.isPrimary) return
    setLap(null)
    onLapSelect?.(null)
    const b = e.currentTarget.getBoundingClientRect()
    setTime(
      Math.max(
        0,
        Math.min(
          duration,
          ((((e.clientX - b.left) / b.width) * 400 - 40) / 344) * duration
        )
      )
    )
  }
  useEffect(() => {
    if (!lap && time == null) return
    const clear = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest("[data-workout-lap-control], [data-workout-signal]")
      )
        return
      setLap(null)
      setTime(null)
      setActiveTrack(null)
      onLapSelect?.(null)
    }
    document.addEventListener("pointerdown", clear, true)
    return () => document.removeEventListener("pointerdown", clear, true)
  }, [lap, time, onLapSelect])
  const selectLap = (selected: Lap) => {
    setLap(selected)
    setTime(null)
    setActiveTrack(null)
    onLapSelect?.(selected)
    const box = !lapsOpen ? lapSection.current?.getBoundingClientRect() : null
    if (box && (box.top < 56 || box.bottom > window.innerHeight - 96))
      lapSection.current?.scrollIntoView({ block: "start", behavior: "smooth" })
  }
  const x = (t: number) => 40 + (t / Math.max(1, duration)) * 344
  return (
    <section
      className="mx-auto w-full max-w-2xl space-y-5"
      aria-label="Recorded workout graphs"
    >
      {lapsOpen && (
        <WorkoutLapsPage
          points={points}
          laps={laps}
          sport={sport}
          selected={lap}
          onSelect={selectLap}
          onClose={closeLaps}
        />
      )}
      <div ref={lapSection} className="scroll-mt-16 space-y-2">
        <WorkoutLapChart
          points={points}
          laps={laps}
          sport={sport}
          selected={lap}
          onSelect={selectLap}
        />
        {intervals.length > 0 && (
          <div className="flex justify-end">
            <button
              type="button"
              className="min-h-11 px-1 text-sm font-semibold text-primary"
              onClick={() => setLapsOpen(true)}
            >
              View workout
            </button>
          </div>
        )}
        {afterLaps}
      </div>
      {!swim && /bike|ride|cycl|run/i.test(sport) && (
        <WorkoutDfaChart points={points} duration={duration} statistics={dfa} />
      )}
      {tracks.map((key) => {
        const samples = points.filter(
          (_, i) => i % Math.max(1, Math.floor(points.length / 800)) === 0
        )
        const plateau = swim && (key === "pace" || key === "cadence")
        const values = (plateau ? intervals.map((i) => i.point) : points)
          .map((p) => value(p, key))
          .filter((v): v is number => v != null)
        if (!values.length) return null
        const lo = key === "pace" ? Math.min(...values) * 0.85 : 0,
          hi = Math.max(lo + 1, ...values) * 1.08
        const y = (v: number) =>
          key === "pace"
            ? 40 + ((v - lo) / (hi - lo)) * 160
            : 200 - ((v - lo) / (hi - lo)) * 160
        let line = "",
          area = "",
          first = 0,
          last = 0,
          open = false
        const fillParts: string[] = []
        if (plateau) {
          for (const i of intervals) {
            const v = value(i.point, key)
            if (v == null) continue
            const start = x(i.lap.start),
              end = x(Math.min(duration, i.lap.end))
            line += `M${start},${y(v)} L${end},${y(v)} `
            fillParts.push(
              `M${start},200 L${start},${y(v)} L${end},${y(v)} L${end},200 Z`
            )
          }
        } else {
          for (const p of samples) {
            const v = value(p, key)
            if (v == null) {
              if (open) fillParts.push(`${area} L${last},200 L${first},200 Z`)
              open = false
              continue
            }
            const px = x(p.time)
            line += `${open ? "L" : "M"}${px},${y(v)} `
            if (!open) {
              area = `M${px},${y(v)} `
              first = px
            } else area += `L${px},${y(v)} `
            last = px
            open = true
          }
          if (open) fillParts.push(`${area} L${last},200 L${first},200 Z`)
        }
        const inspected = lap ? averagePoint : plateau ? averagePoint : nearest
        const inspectedValue = inspected ? value(inspected, key) : null
        const color = key === "heartRate" ? "#f43f5e" : "#26bcec"
        return (
          <div key={key} className="relative">
            <h3 className="mb-1 text-base font-semibold">{label(key)}</h3>
            {time != null && activeTrack === key && (
              <div
                role="status"
                style={{
                  left: tooltipPosition(time, duration),
                  transform: "translateX(-50%)",
                }}
                className="pointer-events-none absolute top-7 z-[999] text-sm font-semibold whitespace-nowrap text-foreground tabular-nums [text-shadow:0_1px_2px_var(--background),0_0_7px_var(--background),0_0_12px_var(--background)]"
              >
                {format(inspectedValue, key)} {unit(key)}
              </div>
            )}
            <svg
              data-workout-signal
              viewBox="0 0 400 232"
              className="block h-auto w-full touch-pan-y select-none"
              role="img"
              aria-label={`${label(key)} over the full workout. Slide your finger to inspect values.`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                move(e, key)
              }}
              onPointerMove={(e) => {
                if (e.buttons) move(e, key)
              }}
              onPointerUp={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId)
                setTime(null)
                setActiveTrack(null)
              }}
              onPointerCancel={() => {
                setTime(null)
                setActiveTrack(null)
              }}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <g key={f}>
                  <line
                    x1="40"
                    x2="384"
                    y1={40 + 160 * f}
                    y2={40 + 160 * f}
                    stroke="currentColor"
                    opacity=".12"
                  />
                  <text
                    x="35"
                    y={44 + 160 * f}
                    textAnchor="end"
                    fontSize="10"
                    fill="currentColor"
                    opacity=".6"
                  >
                    {format(
                      key === "pace" ? lo + f * (hi - lo) : hi - f * (hi - lo),
                      key
                    )}
                  </text>
                  <line
                    x1={40 + 344 * f}
                    x2={40 + 344 * f}
                    y1="40"
                    y2="200"
                    stroke="currentColor"
                    opacity=".08"
                  />
                  <text
                    x={40 + 344 * f}
                    y="222"
                    textAnchor="middle"
                    fontSize="10"
                    fill="currentColor"
                    opacity=".6"
                  >
                    {clock(duration * f)}
                  </text>
                </g>
              ))}
              {lap && (
                <rect
                  x={x(Math.max(0, lap.start))}
                  width={Math.max(
                    0,
                    x(Math.min(duration, lap.end)) - x(Math.max(0, lap.start))
                  )}
                  y="40"
                  height="160"
                  fill="#94a3b8"
                  opacity=".15"
                />
              )}
              {swim &&
                laps.map((l) => (
                  <line
                    key={l.id}
                    x1={x(l.start)}
                    x2={x(l.start)}
                    y1="40"
                    y2="200"
                    stroke="currentColor"
                    opacity=".18"
                    strokeDasharray="3 3"
                  />
                ))}
              <path d={fillParts.join(" ")} fill={color} fillOpacity=".65" />
              <path d={line} stroke={color} strokeWidth="1.2" fill="none" />
              {time != null && activeTrack === key && (
                <g>
                  <line
                    x1={x(time)}
                    x2={x(time)}
                    y1="40"
                    y2="200"
                    stroke="#475569"
                    strokeDasharray="3 3"
                  />
                  {inspectedValue != null && (
                    <circle
                      cx={x(time)}
                      cy={y(inspectedValue)}
                      r="4"
                      fill="white"
                      stroke={color}
                      strokeWidth="2"
                    />
                  )}
                </g>
              )}
            </svg>
            <WorkoutChartStats track={key} sport={sport} summary={summary} />
          </div>
        )
      })}
      <WorkoutChartStats track="totals" sport={sport} summary={summary} />
    </section>
  )
}
