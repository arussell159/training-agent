import {
  useEffect,
  useId,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ChartContainer } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  defaultFitnessAnchors,
  fitnessAnchorLabel,
  fitnessPeakEffortTarget,
  type FitnessAnchor,
  type FitnessHistory,
  type FitnessPeak,
  type FitnessSport,
} from "@/lib/fitness-history"
import {
  fitnessGraphSeries,
  fitnessGraphDomain,
  formatFitnessGraphValue,
  formatFitnessGraphDate,
  type FitnessGraphPoint,
} from "@/lib/fitness-history-graph"

const config = { value: { label: "Peak effort", color: "var(--chart-2)" } }
const anchorKey = (anchor: FitnessAnchor) =>
  `${anchor.duration_seconds}:${anchor.distance_meters}`

export function FitnessHistoryGraph({
  history,
  sport,
  loading,
  selection,
  onAnchorChange,
  onPointSelect,
  onEffortOpen,
}: {
  history: FitnessHistory | null
  sport: FitnessSport
  loading: boolean
  selection: Partial<Record<FitnessSport, string>>
  onAnchorChange: (key: string) => void
  onPointSelect: (point: FitnessGraphPoint) => void
  onEffortOpen?: (peak: FitnessPeak, sport: FitnessSport) => void
}) {
  const isMobile = useIsMobile()
  const anchors = history?.anchors ?? defaultFitnessAnchors(sport)
  const anchor =
    anchors.find((item) => anchorKey(item) === selection[sport]) ??
    anchors[Math.min(2, anchors.length - 1)]
  const rows = history?.months.slice(0, 12)
  const points = useMemo(
    () => fitnessGraphSeries(rows ?? [], anchor, sport),
    [rows, anchor, sport]
  )
  const [inspectIndex, setInspectIndex] = useState<number | null>(null)
  useEffect(() => {
    setInspectIndex(null)
  }, [sport, anchor.duration_seconds, anchor.distance_meters])
  const latestValueIndex = points.reduce(
    (latest, point, index) => (point.value != null ? index : latest),
    -1
  )
  const selectedIndex = inspectIndex ?? latestValueIndex
  const selectedPoint = selectedIndex >= 0 ? points[selectedIndex] : undefined
  const domain = fitnessGraphDomain(points, sport)
  const hasValues = points.some((point) => point.value !== null)
  const first = points[0]?.time ?? 0
  const last = points.at(-1)?.time ?? first
  const singleSpan = 15 * 86_400_000
  const timeDomain: [number, number] =
    first === last ? [first - singleSpan, last + singleSpan] : [first, last]
  const tickCount = Math.min(points.length, isMobile ? 3 : 4)
  const ticks = Array.from(
    { length: tickCount },
    (_, index) =>
      points[
        Math.round((index * (points.length - 1)) / Math.max(1, tickCount - 1))
      ].time
  )
  const gradient = `fitness-peak-${useId().replace(/:/g, "")}`
  const effort = fitnessAnchorLabel(anchor, sport)
  const inspectHistory = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!points.length) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const plotStart = 0
    const plotEndInset = 32
    const plotWidth = bounds.width - plotStart - plotEndInset
    if (plotWidth <= 0) return
    const ratio = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left - plotStart) / plotWidth)
    )
    const targetTime = timeDomain[0] + ratio * (timeDomain[1] - timeDomain[0])
    let closestIndex = 0
    for (let index = 1; index < points.length; index += 1) {
      if (
        Math.abs(points[index].time - targetTime) <
        Math.abs(points[closestIndex].time - targetTime)
      ) {
        closestIndex = index
      }
    }
    setInspectIndex(closestIndex)
    onPointSelect(points[closestIndex])
  }
  const openPoint = (point: FitnessGraphPoint) => {
    if (
      point.value == null ||
      !point.peak ||
      !fitnessPeakEffortTarget(point.peak, sport)
    )
      return
    onPointSelect(point)
    onEffortOpen?.(point.peak, sport)
  }
  const renderPoint = (
    props: {
      cx?: number
      cy?: number
      index?: number
      payload?: FitnessGraphPoint
    }
  ) => {
    const cx = Number(props.cx),
      cy = Number(props.cy),
      point = props.payload
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || point?.value == null)
      return null
    const selected = props.index === selectedIndex
    const circle = (
      <circle
        cx={cx}
        cy={cy}
        r={selected ? 4.5 : 3}
        fill={selected ? "var(--color-value)" : "var(--card)"}
        stroke="var(--color-value)"
        strokeWidth={selected ? 2 : 1.5}
        style={
          selected
            ? { filter: "drop-shadow(0 0 4px var(--color-value))" }
            : undefined
        }
      />
    )
    if (
      isMobile ||
      !onEffortOpen ||
      !point.peak ||
      !fitnessPeakEffortTarget(point.peak, sport)
    )
      return <g pointerEvents="none">{circle}</g>
    return (
      <g
        role="button"
        tabIndex={0}
        aria-label={`Open ${effort} effort ${formatFitnessGraphValue(point.value, sport)} from ${formatFitnessGraphDate(point.time, "months")}`}
        className="cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={(event) => {
          event.stopPropagation()
          openPoint(point)
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          event.stopPropagation()
          if (!event.repeat) openPoint(point)
        }}
      >
        <rect
          x={cx - 12}
          y={cy - 12}
          width={24}
          height={24}
          fill="transparent"
        />
        {circle}
      </g>
    )
  }

  return (
    <section
      className="fitness-history-graph training-history-chart flex min-h-0 flex-1 flex-col"
      aria-label={`${effort} ${sport === "Ride" ? "power" : "pace"} history for the past 12 months`}
    >
      <div className="training-history-chart-heading shrink-0">
        <h3>Past 12 months</h3>
        {!isMobile && (
          <label className="min-w-0">
            <span className="sr-only">Peak effort</span>
            <select
              aria-label="Peak effort"
              className="!h-8 !w-24 !min-w-0 rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={anchorKey(anchor)}
              onChange={(event) => onAnchorChange(event.target.value)}
            >
              {anchors.map((item) => (
                <option key={anchorKey(item)} value={anchorKey(item)}>
                  {fitnessAnchorLabel(item, sport)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div
        className="relative min-h-0 flex-1 touch-pan-y select-none"
        onPointerDown={(event) => {
          if (isMobile) event.currentTarget.setPointerCapture(event.pointerId)
          inspectHistory(event)
        }}
        onPointerMove={(event) => {
          if (isMobile ? event.buttons : true) inspectHistory(event)
        }}
        onClick={(event) => {
          if (isMobile) return
          if ((event.target as Element).closest(".recharts-cartesian-axis"))
            return
          const point =
            inspectIndex == null ? undefined : points[inspectIndex]
          if (point) openPoint(point)
        }}
        onPointerUp={(event) => {
          if (!isMobile) return
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
      >
        {loading ? (
          <div
            role="status"
            aria-label="Loading peak effort graph"
            className="absolute inset-0 flex items-center"
          >
            <Skeleton className="h-3/4 w-full" />
          </div>
        ) : !hasValues ? (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center px-3 text-center text-sm text-muted-foreground"
          >
            No recorded peak for this effort and period.
          </div>
        ) : (
          <ChartContainer
            config={config}
            className="absolute inset-0 !aspect-auto h-full w-full"
          >
            <AreaChart
              data={points}
              accessibilityLayer
              margin={{ top: 16, right: 0, left: 0, bottom: 8 }}
            >
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-value)"
                    stopOpacity={0.38}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-value)"
                    stopOpacity={0.025}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              {(isMobile || inspectIndex != null) && selectedPoint && (
                <ReferenceLine
                  x={selectedPoint.time}
                  stroke="var(--foreground)"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                />
              )}
              <XAxis
                type="number"
                scale="time"
                dataKey="time"
                domain={timeDomain}
                ticks={ticks}
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                tick={{ fontSize: 11 }}
                tickFormatter={(time) =>
                  formatFitnessGraphDate(Number(time), "months")
                }
              />
              <YAxis
                orientation="right"
                domain={domain}
                reversed={sport !== "Ride"}
                axisLine={false}
                tickLine={false}
                width={32}
                tickCount={4}
                tick={{ fontSize: 11 }}
                tickFormatter={(value) =>
                  formatFitnessGraphValue(Number(value), sport)
                }
              />
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                content={({ active, payload, label }) => {
                  const point = payload?.find(
                    (item) => item.dataKey === "value"
                  )
                  const value = point?.value
                  if (
                    !active ||
                    typeof value !== "number" ||
                    !Number.isFinite(value)
                  )
                    return null
                  return (
                    <div className="pointer-events-none rounded-lg border border-border/60 bg-background px-3 py-2 shadow-lg">
                      <div className="text-xs text-muted-foreground">
                        {formatFitnessGraphDate(Number(label), "months")}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-foreground tabular-nums">
                        {formatFitnessGraphValue(value, sport)}
                      </div>
                    </div>
                  )
                }}
              />
              <Area
                dataKey="value"
                type="linear"
                connectNulls={false}
                baseValue={sport === "Ride" ? "dataMin" : "dataMax"}
                stroke="var(--color-value)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#${gradient})`}
                isAnimationActive={false}
                dot={(props) => renderPoint(props)}
                activeDot={(props) => renderPoint(props)}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </div>
    </section>
  )
}
