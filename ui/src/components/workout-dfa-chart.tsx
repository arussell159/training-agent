import { useEffect, useRef, useState } from "react"
import type { RecordedPoint } from "@/lib/segment-statistics"
import type { DfaStatistics } from "@/components/workout-analysis"
import { formatSignalClock } from "@/lib/interval-signals"

export function WorkoutDfaChart({
  points,
  duration,
  statistics,
}: {
  points: RecordedPoint[]
  duration: number
  statistics?: DfaStatistics | null
}) {
  const root = useRef<SVGSVGElement>(null)
  const [selected, setSelected] = useState<RecordedPoint | null>(null)
  useEffect(() => {
    if (!selected) return
    const clear = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setSelected(null)
    }
    document.addEventListener("pointerdown", clear, true)
    return () => document.removeEventListener("pointerdown", clear, true)
  }, [selected])
  const valid = (p: RecordedPoint) =>
    p.dfaA1 != null &&
    p.dfaA1 >= 0.01 &&
    (p.dfaArtifacts == null || p.dfaArtifacts <= 5)
  const readings = points.filter(valid)
  const maximum =
    readings.reduce((max, p) => Math.max(max, p.dfaA1!), 1.5) * 1.05
  const x = (time: number) => 40 + (time / Math.max(1, duration)) * 344
  const y = (value: number) => 196 - (value / maximum) * 160
  let line = "",
    previous: RecordedPoint | null = null
  for (const p of points) {
    if (!valid(p)) {
      previous = null
      continue
    }
    line += `${previous && p.time - previous.time <= 30 ? "L" : "M"}${x(p.time).toFixed(2)},${y(p.dfaA1!).toFixed(2)} `
    previous = p
  }
  const number = (n?: number | null, suffix = "") =>
    n != null && Number.isFinite(n) ? n.toFixed(2) + suffix : "—"
  const rows = statistics
    ? [
        ["Avg DFA a1", number(statistics.average)],
        ["Min DFA a1", number(statistics.minimum)],
        ["Max DFA a1", number(statistics.maximum)],
        [
          "Valid recording",
          statistics.validPercent == null
            ? "—"
            : statistics.validPercent.toFixed(1) + "%",
        ],
        ["Valid time", formatSignalClock(statistics.validSeconds)],
        ["Avg artifacts", number(statistics.averageArtifacts, "%")],
        [
          "Artifact coverage",
          statistics.artifactCoveragePercent == null
            ? "—"
            : statistics.artifactCoveragePercent.toFixed(1) + "%",
        ],
      ]
    : []
  return (
    <section
      aria-label="DFA a1"
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") setSelected(null)
      }}
    >
      <h3 className="mb-1 text-base font-semibold">DFA a1</h3>
      {!readings.length ? (
        <p className="py-5 text-sm text-muted-foreground">
          {statistics
            ? "No usable DFA a1 samples in this recording."
            : "DFA a1 was not recorded for this workout."}
        </p>
      ) : (
        <>
          {selected && (
            <div
              role="status"
              className="pointer-events-none absolute top-8 right-2 z-10 rounded-lg border bg-white px-3 py-2 text-xs text-slate-900 shadow-sm"
            >
              <p>{formatSignalClock(selected.time)}</p>
              <strong>{number(selected.dfaA1)} DFA a1</strong>
              {selected.dfaArtifacts != null && (
                <p>{number(selected.dfaArtifacts, "%")} artifacts</p>
              )}
            </div>
          )}
          <svg
            ref={root}
            viewBox="0 0 400 232"
            className="block h-auto w-full touch-pan-y select-none"
            role="img"
            aria-label="Recorded DFA a1 over the full workout. Slide to inspect; tap outside to dismiss."
            tabIndex={0}
            onPointerDown={(e) => {
              if (!e.isPrimary) return
              const bounds = e.currentTarget.getBoundingClientRect()
              const time = Math.max(
                0,
                Math.min(
                  duration,
                  ((((e.clientX - bounds.left) / bounds.width) * 400 - 40) /
                    344) *
                    duration
                )
              )
              setSelected(
                readings.reduce((a, b) =>
                  Math.abs(a.time - time) < Math.abs(b.time - time) ? a : b
                )
              )
            }}
            onPointerMove={(e) => {
              if (!e.buttons || !e.isPrimary) return
              const bounds = e.currentTarget.getBoundingClientRect()
              const time =
                ((((e.clientX - bounds.left) / bounds.width) * 400 - 40) /
                  344) *
                duration
              setSelected(
                readings.reduce((a, b) =>
                  Math.abs(a.time - time) < Math.abs(b.time - time) ? a : b
                )
              )
            }}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line
                  x1="40"
                  x2="384"
                  y1={36 + 160 * f}
                  y2={36 + 160 * f}
                  stroke="currentColor"
                  opacity=".12"
                />
                <text
                  x="35"
                  y={40 + 160 * f}
                  textAnchor="end"
                  fontSize="10"
                  fill="currentColor"
                  opacity=".6"
                >
                  {(maximum * (1 - f)).toFixed(2)}
                </text>
                <text
                  x={40 + 344 * f}
                  y="222"
                  textAnchor="middle"
                  fontSize="10"
                  fill="currentColor"
                  opacity=".6"
                >
                  {formatSignalClock(duration * f)}
                </text>
              </g>
            ))}
            <path d={line} stroke="#7c3aed" strokeWidth="1.5" fill="none" />
            {selected && (
              <>
                <line
                  x1={x(selected.time)}
                  x2={x(selected.time)}
                  y1="36"
                  y2="196"
                  stroke="#475569"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={x(selected.time)}
                  cy={y(selected.dfaA1!)}
                  r="4"
                  fill="white"
                  stroke="#7c3aed"
                  strokeWidth="2"
                />
              </>
            )}
          </svg>
        </>
      )}
      {!!rows.length && (
        <dl aria-label="DFA a1 statistics" className="space-y-5 py-5">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4"
            >
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-right text-base font-semibold tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
