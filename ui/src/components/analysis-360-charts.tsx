import { useId, useMemo, useRef, type PointerEvent } from "react"
import type { RecordedPoint } from "@/lib/segment-statistics"
import {
  analysisSelection,
  analysisSeriesSegments,
  analysisZoneTimes,
  type AnalysisRange,
  type AnalysisTile,
} from "@/lib/analysis-360"
import { recordedDistanceAxis } from "@/lib/workout-chart-axis"
import {
  recordedSignalInfo,
  recordedSignalStatistics,
  recordedSignalValue,
  formatRecordedSignal,
  type RecordedSignal,
} from "@/lib/analysis-360-signals"

export const analysisClock = (seconds: number) => {
  const value = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(value / 3600)).padStart(2, "0")}:${String(Math.floor((value % 3600) / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
}
const palette = [
  "#3047dc",
  "#02bda5",
  "#86b740",
  "#f5ad32",
  "#ec5678",
  "#a945bf",
  "#81349c",
]
const channelColor = (key: RecordedSignal, primary: boolean) =>
  primary
    ? "#3448dd"
    : key === "heartRate"
      ? "#db4d7d"
      : key === "elevation"
        ? "#8b95a8"
        : key === "speed" || key === "pace"
          ? "#4297df"
          : "#12abaf"
export type ZoneConfiguration = {
  key: "power" | "speed"
  threshold: number
  boundaries: number[]
} | null

export function Analysis360SignalChart({
  points,
  sport,
  duration,
  tile,
  range,
  selection,
  cursor,
  cursorPoint,
  onCursor,
  onSelect,
  zoneConfiguration,
}: {
  points: RecordedPoint[]
  sport: string
  duration: number
  tile: AnalysisTile
  range: AnalysisRange
  selection: AnalysisRange | null
  cursor: number | null
  cursorPoint: RecordedPoint | null
  onCursor: (time: number | null) => void
  onSelect: (range: AnalysisRange | null) => void
  zoneConfiguration: ZoneConfiguration
}) {
  const gradient = useId().replaceAll(":", "")
  const drag = useRef<{ time: number; x: number } | null>(null),
    moved = useRef(false)
  const [start, end] = range
  const distanceAxis = useMemo(() => recordedDistanceAxis(points), [points])
  const distanceMode =
    tile.axis === "distance" &&
    Boolean(
      distanceAxis && distanceAxis.atTime(end) > distanceAxis.atTime(start)
    )
  const position = (time: number) =>
    distanceMode ? distanceAxis!.atTime(time) : time
  const left = position(start),
    span = Math.max(0.001, position(end) - left)
  const x = (time: number) => ((position(time) - left) / span) * 1000
  const rows = useMemo(
    () => recordedSignalStatistics(points, start, end, sport),
    [points, start, end, sport]
  )
  const series = useMemo(
    () =>
      tile.channels.map((key) => {
        const segments = analysisSeriesSegments(points, key, sport, start, end)
        const values = segments.flat().map((point) => point.value)
        return {
          key,
          segments,
          minimum: values.length
            ? values.reduce((a, b) => Math.min(a, b), Infinity)
            : null,
          maximum: values.length
            ? values.reduce((a, b) => Math.max(a, b), -Infinity)
            : null,
        }
      }),
    [points, tile.channels, sport, start, end]
  )
  const primary = tile.channels[0]
  const primaryRow = rows.find((row) => row.key === primary)
  const domain = (key: RecordedSignal) => {
    const row = rows.find((row) => row.key === key),
      line = series.find((series) => series.key === key),
      minimum = Math.min(
        row?.minimum ?? line?.minimum ?? 0,
        line?.minimum ?? row?.minimum ?? 0
      ),
      maximum = Math.max(
        row?.maximum ?? line?.maximum ?? 1,
        line?.maximum ?? row?.maximum ?? 1
      )
    return maximum > minimum
      ? [minimum, maximum]
      : [Math.max(0, minimum - 1), maximum + 1]
  }
  const timeAt = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect(),
      fraction = Math.max(
        0,
        Math.min(1, (event.clientX - bounds.left) / bounds.width)
      )
    return distanceMode
      ? distanceAxis!.atDistance(left + fraction * span)
      : start + fraction * (end - start)
  }
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { time: timeAt(event), x: event.clientX }
    moved.current = false
  }
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const time = timeAt(event)
    onCursor(time)
    if (drag.current && Math.abs(event.clientX - drag.current.x) > 4) {
      moved.current = true
      onSelect(analysisSelection(drag.current.time, time, duration))
    }
  }
  const up = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current && moved.current)
      onSelect(analysisSelection(drag.current.time, timeAt(event), duration))
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const selectionStart = selection ? Math.max(start, selection[0]) : 0,
    selectionEnd = selection ? Math.min(end, selection[1]) : 0
  const draw = (key: RecordedSignal, index: number) => {
    const [minimum, maximum] = domain(key),
      line = series.find((series) => series.key === key)
    const path =
      line?.segments
        .map((segment) =>
          segment
            .map(
              (point, index) =>
                `${index ? "L" : "M"}${x(point.time).toFixed(2)},${(98 - ((point.value - minimum) / (maximum - minimum)) * 94).toFixed(2)}`
            )
            .join(" ")
        )
        .join(" ") || ""
    return (
      <path
        key={key}
        data-analysis360-signal={key}
        d={path}
        fill="none"
        stroke={
          index === 0 && tile.zones && zoneConfiguration?.key === key
            ? `url(#${gradient}-${key})`
            : channelColor(key, index === 0)
        }
        strokeWidth={1.3}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    )
  }
  const canvas = (keys: RecordedSignal[], primaryKey: RecordedSignal) => {
    const [minimum, maximum] = domain(primaryKey)
    return (
      <div className="a360-plot-row">
        <div className="a360-channel-stats">
          {tile.kind === "stacked" && (
            <strong>{recordedSignalInfo(primaryKey, sport).label}</strong>
          )}
          {tile.kind === "multi" && (
            <span style={{ color: "#be55cb" }}>
              {primaryRow && recordedSignalInfo(primary, sport).label}
            </span>
          )}
          {[
            ["Max", rows.find((row) => row.key === primaryKey)?.maximum],
            ["Avg", rows.find((row) => row.key === primaryKey)?.average],
            ["Min", rows.find((row) => row.key === primaryKey)?.minimum],
          ].map(([label, value]) => (
            <div key={label as string}>
              {label}:{" "}
              {formatRecordedSignal(value as number | null, primaryKey, sport)}{" "}
              <span>{recordedSignalInfo(primaryKey, sport).unit}</span>
            </div>
          ))}
        </div>
        <div className="a360-plot-column">
          <div
            className="a360-y-axis"
            style={{ color: tile.kind === "multi" ? "#be55cb" : undefined }}
            aria-hidden="true"
          >
            <span>{formatRecordedSignal(maximum, primaryKey, sport)}</span>
            <span>
              {formatRecordedSignal((minimum + maximum) / 2, primaryKey, sport)}
            </span>
            <span>{formatRecordedSignal(minimum, primaryKey, sport)}</span>
          </div>
          <div className="a360-signal-canvas">
            <svg
              viewBox="0 0 1000 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${recordedSignalInfo(primaryKey, sport).label} recorded chart. Drag to select, then use Zoom.`}
              tabIndex={0}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => {
                drag.current = null
              }}
              onPointerLeave={() => {
                if (!drag.current) onCursor(null)
              }}
              onKeyDown={(event) => {
                if (event.key === "Home" || event.key === "End") {
                  event.preventDefault()
                  onCursor(event.key === "Home" ? start : end)
                }
                if (
                  event.shiftKey &&
                  (event.key === "ArrowRight" || event.key === "ArrowLeft")
                ) {
                  event.preventDefault()
                  const anchor = selection?.[0] ?? start,
                    last =
                      (selection?.[1] ?? start) +
                      ((end - start) / 20) *
                        (event.key === "ArrowRight" ? 1 : -1)
                  onSelect(analysisSelection(anchor, last, duration))
                }
              }}
            >
              <defs>
                <linearGradient
                  id={`${gradient}-${primaryKey}`}
                  x1="0"
                  x2="0"
                  y1="1"
                  y2="0"
                >
                  {zoneConfiguration?.key === primaryKey ? (
                    zoneConfiguration.boundaries.map((bound, index) => (
                      <stop
                        key={index}
                        offset={`${Math.max(0, Math.min(100, (((zoneConfiguration.threshold * bound) / 100 - minimum) / (maximum - minimum)) * 100))}%`}
                        stopColor={palette[Math.min(index, palette.length - 1)]}
                      />
                    ))
                  ) : (
                    <stop stopColor="#3448dd" />
                  )}
                </linearGradient>
              </defs>
              <rect
                width="1000"
                height="100"
                fill={tile.zones ? "#e8ecfc" : "transparent"}
              />
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                <line
                  key={fraction}
                  x1={fraction * 1000}
                  x2={fraction * 1000}
                  y1="0"
                  y2="100"
                  stroke="currentColor"
                  opacity=".055"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {keys.map(draw)}
              {selection && selectionEnd > selectionStart && (
                <rect
                  className="a360-selection"
                  x={x(selectionStart)}
                  y="0"
                  width={x(selectionEnd) - x(selectionStart)}
                  height="100"
                  fill="#2444e0"
                  fillOpacity=".13"
                />
              )}
              {cursor != null && cursor >= start && cursor <= end && (
                <line
                  x1={x(cursor)}
                  x2={x(cursor)}
                  y1="0"
                  y2="100"
                  stroke="#8792a1"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            {cursor != null &&
              cursorPoint &&
              cursor >= start &&
              cursor <= end && (
                <div
                  className="a360-chart-tooltip"
                  style={{
                    left: `${Math.min(76, Math.max(0, x(cursor) / 10 + 1))}%`,
                  }}
                >
                  {keys.map((key) => (
                    <div
                      key={key}
                      style={{ color: channelColor(key, keys.length === 1) }}
                    >
                      {keys.length > 1 &&
                        `${recordedSignalInfo(key, sport).label}: `}
                      {formatRecordedSignal(
                        recordedSignalValue(cursorPoint, key, sport),
                        key,
                        sport
                      )}{" "}
                      {recordedSignalInfo(key, sport).unit}
                    </div>
                  ))}
                  <small>{analysisClock(cursor)}</small>
                </div>
              )}
          </div>
          <div
            className="a360-x-axis"
            aria-label={
              distanceMode ? "Chart distance axis" : "Chart duration axis"
            }
          >
            {Array.from({ length: 5 }, (_, index) => (
              <span key={index}>
                {distanceMode
                  ? /swim/i.test(sport)
                    ? `${Math.round((left + (span * index) / 4) / 0.9144)} yd`
                    : `${((left + (span * index) / 4) / 1609.344).toFixed(1)} mi`
                  : analysisClock(start + ((end - start) * index) / 4)}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }
  if (!tile.channels.length)
    return (
      <p className="a360-empty">Choose a recorded channel in chart settings.</p>
    )
  return (
    <div
      className={`a360-signal-charts ${tile.kind === "stacked" ? "a360-stacked" : ""}`}
      style={{
        minHeight:
          tile.kind === "stacked" ? tile.height - 32 : tile.height - 32,
      }}
    >
      {tile.kind === "stacked"
        ? tile.channels.map((key) => <div key={key}>{canvas([key], key)}</div>)
        : canvas(tile.channels, primary)}
    </div>
  )
}

export function Analysis360Zones({
  points,
  configuration,
  range,
}: {
  points: RecordedPoint[]
  configuration: ZoneConfiguration
  range: AnalysisRange
}) {
  const zones = useMemo(
    () =>
      configuration
        ? analysisZoneTimes(
            points,
            configuration.key,
            configuration.threshold,
            configuration.boundaries,
            range[0],
            range[1]
          )
        : [],
    [points, configuration, range]
  )
  if (!zones.length)
    return (
      <p className="a360-empty">
        Configure sport zones in Settings to view time in zones.
      </p>
    )
  const total = zones.reduce((sum, zone) => sum + zone.seconds, 0)
  return (
    <div className="a360-zones">
      {zones.map((zone, index) => (
        <div key={zone.label}>
          <span>{zone.label}</span>
          <div>
            <i
              style={{
                width: `${total ? (zone.seconds / total) * 100 : 0}%`,
                background: palette[Math.min(index, palette.length - 1)],
              }}
            />
          </div>
          <span>{analysisClock(zone.seconds)}</span>
          <span>{total ? ((zone.seconds / total) * 100).toFixed(1) : 0}%</span>
        </div>
      ))}
    </div>
  )
}
