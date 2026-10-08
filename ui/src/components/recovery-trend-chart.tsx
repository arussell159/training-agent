import { useId, useRef, useState, type PointerEvent } from "react"
import {
  recoveryTrendGeometry,
  type RecoveryTrendPoint,
} from "@/lib/recovery-trend"

export function RecoveryTrendChart({
  data,
  current,
  metric,
}: {
  data: RecoveryTrendPoint[]
  current?: number | null
  metric: "hrv" | "resting_hr"
}) {
  const { points, daily, average, band } = recoveryTrendGeometry(data, current)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const pressed = useRef(false)
  const descriptionId = useId()
  const label = metric === "hrv" ? "HRV" : "Resting heart rate"
  const unit = metric === "hrv" ? "ms" : "bpm"
  const selected =
    activeIndex == null
      ? null
      : points[Math.min(activeIndex, points.length - 1)]
  const selectPoint = (event: PointerEvent<HTMLDivElement>) => {
    if (!points.length) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 320
    setActiveIndex(
      Math.max(
        0,
        Math.min(
          points.length - 1,
          Math.round(((x - 8) / 304) * (points.length - 1))
        )
      )
    )
  }
  return (
    <div
      role="group"
      aria-label={`${label} trend`}
      aria-describedby={selected ? descriptionId : undefined}
      tabIndex={points.length ? 0 : undefined}
      className="relative h-20 w-full touch-pan-y rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-24"
      onPointerDown={(event) => {
        pressed.current = true
        selectPoint(event)
      }}
      onPointerMove={(event) => {
        if (pressed.current) selectPoint(event)
      }}
      onPointerUp={() => {
        pressed.current = false
        setActiveIndex(null)
      }}
      onPointerCancel={() => {
        pressed.current = false
        setActiveIndex(null)
      }}
      onPointerLeave={() => {
        pressed.current = false
        setActiveIndex(null)
      }}
      onFocus={() => setActiveIndex(points.length - 1)}
      onBlur={() => setActiveIndex(null)}
      onKeyDown={(event) => {
        if (!points.length) return
        const index = activeIndex ?? points.length - 1
        const next =
          event.key === "ArrowLeft"
            ? index - 1
            : event.key === "ArrowRight"
              ? index + 1
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? points.length - 1
                  : null
        if (next !== null) {
          event.preventDefault()
          setActiveIndex(Math.max(0, Math.min(points.length - 1, next)))
        } else if (event.key === "Escape") setActiveIndex(null)
      }}
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 320 96"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          points.length
            ? `${label}: daily readings, seven-day average, and baseline range`
            : `No ${label} history yet`
        }
      >
        {[8, 36, 64, 92].map((y) => (
          <path
            key={y}
            d={`M8,${y}H312`}
            stroke="var(--border)"
            strokeDasharray="3 3"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {band && <path d={band} fill="var(--muted)" fillOpacity={0.8} />}
        <path
          d={average}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={daily}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        {points.map((point) => (
          <path
            key={point.date}
            d={`M${point.x},${point.y}h0.01`}
            stroke="var(--primary)"
            strokeWidth={4}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {selected && (
        <>
          <span id={descriptionId} className="sr-only" aria-live="polite">
            {selected.date}: {selected.value} {unit}. Seven-day average{" "}
            {selected.average} {unit}. Use the left and right arrow keys to
            inspect days.
          </span>
          <div
            className="pointer-events-none absolute text-sm font-semibold whitespace-nowrap text-foreground tabular-nums [text-shadow:0_1px_2px_var(--background),0_0_7px_var(--background),0_0_12px_var(--background)]"
            aria-hidden="true"
            style={{
              left: `${Math.max(15, Math.min(85, (selected.x / 320) * 100))}%`,
              top: `${Math.max(24, (selected.y / 96) * 100)}%`,
              transform: "translate(-50%, -130%)",
            }}
          >
            {selected.value.toFixed(0)} {unit}
          </div>
        </>
      )}
    </div>
  )
}
