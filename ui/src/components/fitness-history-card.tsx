import { lazy, Suspense, useEffect, useId, useState } from "react"
import { Bike, Footprints, Waves } from "lucide-react"
import { Button as F7Button } from "framework7-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { MobileFilterTabs } from "@/components/ui/mobile-filter-tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { Skeleton } from "@/components/ui/skeleton"
import { PageErrorBoundary } from "@/components/page-error-boundary"
import {
  cachedFitnessHistory,
  defaultFitnessAnchors,
  fitnessAnchorLabel,
  fitnessDistance,
  fitnessDuration,
  fitnessPeakValue,
  fitnessPeakEffortTarget,
  fitnessPeriodLabel,
  loadFitnessHistory,
  type FitnessHistory,
  type FitnessPeak,
  type FitnessPeriod,
  type FitnessSport,
  type FitnessTotal,
} from "@/lib/fitness-history"
import {
  fitnessGraphSeries,
  formatFitnessGraphValue,
  type FitnessGraphPoint,
} from "@/lib/fitness-history-graph"

const sports = [
  { type: "Ride", label: "Bike", icon: Bike },
  { type: "Run", label: "Run", icon: Footprints },
  { type: "Swim", label: "Swim", icon: Waves },
] as const
const shortPeriodLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
})
const FitnessHistoryGraph = lazy(() =>
  import("@/components/fitness-history-graph").then((module) => ({
    default: module.FitnessHistoryGraph,
  }))
)

export function FitnessHistoryCard({
  enabled = true,
  onEffortOpen,
}: {
  enabled?: boolean
  onEffortOpen?: (peak: FitnessPeak, sport: FitnessSport) => void
}) {
  const isMobile = useIsMobile()
  const [sport, setSport] = useState<FitnessSport>("Ride")
  const [view, setView] = useState<"table" | "graph">("table")
  const [graphSelection, setGraphSelection] = useState<
    Partial<Record<FitnessSport, string>>
  >({})
  const [activeGraphPoint, setActiveGraphPoint] = useState<{
    sport: FitnessSport
    anchor: string
    point: FitnessGraphPoint
  } | null>(null)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{
    sport: FitnessSport
    data: FitnessHistory | null
    error: boolean
  } | null>(() => ({
    sport: "Ride",
    data: cachedFitnessHistory("Ride"),
    error: false,
  }))
  const titleId = useId()
  const changeSport = (nextSport: FitnessSport) => {
    setActiveGraphPoint(null)
    setSport(nextSport)
  }
  const changeAnchor = (key: string) => {
    setActiveGraphPoint(null)
    setGraphSelection((previous) => ({ ...previous, [sport]: key }))
  }
  const changeView = (checked: boolean) => {
    setActiveGraphPoint(null)
    setView(checked ? "graph" : "table")
  }
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let active = true
    const reset = () => {
      controller.abort()
      setResult(null)
      setRetry((value) => value + 1)
    }
    window.addEventListener("fitness-history-reset", reset)
    void loadFitnessHistory(sport, controller.signal).then(
      (data) => {
        if (active && !controller.signal.aborted)
          setResult({ sport, data, error: false })
      },
      () => {
        if (active && !controller.signal.aborted)
          setResult({ sport, data: null, error: true })
      }
    )
    return () => {
      active = false
      controller.abort()
      window.removeEventListener("fitness-history-reset", reset)
    }
  }, [sport, retry, enabled])

  const data =
    result?.sport === sport ? result.data : cachedFitnessHistory(sport)
  const error = result?.sport === sport && result.error
  const loading = !data && !error
  const anchors = data?.anchors ?? defaultFitnessAnchors(sport)
  const columns = 3 + anchors.length
  const calculatedPeaks =
    data &&
    [...data.weeks, ...data.months].some((period) =>
      period.peaks.some((peak) => peak.source === "calculated-activity-curves")
    )
  const sourceNotice = !data?.configured
    ? ""
    : data.source === "synthetic-local-preview"
      ? "Fake data · local preview"
      : calculatedPeaks
        ? "Intervals.icu · calculated from activity curves"
        : "Intervals.icu · recorded performance curves"
  const partialCoverage = data?.configured && data.peakCoverage === "partial"
  const sourceTitle =
    sourceNotice + (partialCoverage ? " · Partial peak coverage" : "")
  const anchorKey = (anchor: (typeof anchors)[number]) =>
    `${anchor.duration_seconds}:${anchor.distance_meters}`
  const selectedAnchor =
    anchors.find((anchor) => anchorKey(anchor) === graphSelection[sport]) ??
    anchors[Math.min(2, anchors.length - 1)]
  const allGraphPoints = fitnessGraphSeries(
    [...(data?.months ?? []), ...(data?.comparisonMonths ?? [])],
    selectedAnchor,
    sport
  )
  const graphPoints = fitnessGraphSeries(
    (data?.months ?? []).slice(0, 12),
    selectedAnchor,
    sport
  )
  const latestGraphPoint =
    graphPoints.filter((point) => point.value != null).at(-1) ?? null
  const selectedAnchorKey = anchorKey(selectedAnchor)
  const selectedGraphPoint =
    activeGraphPoint?.sport === sport &&
    activeGraphPoint.anchor === selectedAnchorKey
      ? (allGraphPoints.find(
          (point) => point.period === activeGraphPoint.point.period
        ) ?? latestGraphPoint)
      : latestGraphPoint
  const previousYearPoint = (() => {
    if (!selectedGraphPoint) return null
    const [year, month] = selectedGraphPoint.period.slice(0, 7).split("-")
    const previousYearMonth = `${Number(year) - 1}-${month}`
    return (
      allGraphPoints.find((point) =>
        point.period.startsWith(previousYearMonth)
      ) ?? null
    )
  })()
  const trend =
    selectedGraphPoint?.value != null &&
    previousYearPoint?.value != null &&
    previousYearPoint.value !== 0
      ? ((selectedGraphPoint.value - previousYearPoint.value) /
          previousYearPoint.value) *
        100
      : null
  const trendLabel =
    trend == null
      ? "—"
      : trend < 0
        ? `(${Math.abs(trend).toFixed(1)}%)`
        : `${trend.toFixed(1)}%`
  const graphValueLabel = (value: number | null | undefined) =>
    formatFitnessGraphValue(value ?? null, sport)
  const selectedPointLabel = selectedGraphPoint
    ? selectedGraphPoint.date === selectedGraphPoint.period
      ? shortPeriodLabel.format(
          new Date(`${selectedGraphPoint.period}T12:00:00Z`)
        )
      : fitnessPeriodLabel(selectedGraphPoint.date)
    : "—"
  const total = (
    period: FitnessPeriod,
    key: FitnessTotal,
    formatted: string
  ) =>
    formatted === "—"
      ? formatted
      : formatted + (period.incomplete[key] ? "+" : "")
  const canOpenPeak = (peak: FitnessPeak | undefined) =>
    !!onEffortOpen && !!peak && !!fitnessPeakEffortTarget(peak, sport)
  const openPeak = (peak: FitnessPeak | undefined) => {
    if (peak && fitnessPeakEffortTarget(peak, sport))
      onEffortOpen?.(peak, sport)
  }
  const periodRows = (periods: FitnessPeriod[], month = false) =>
    periods.map((period) => (
      <tr
        key={period.start}
        className="border-b border-border/60 last:border-0 hover:bg-muted/40"
      >
        <th
          scope="row"
          className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium whitespace-nowrap md:py-1"
          title={`${period.start} to ${period.end} · ${period.activities} recorded ${period.activities === 1 ? "activity" : "activities"}`}
        >
          {fitnessPeriodLabel(period.start, month)}
        </th>
        <td className="px-2 py-2 text-right whitespace-nowrap md:py-1">
          {total(
            period,
            "duration_seconds",
            fitnessDuration(period.duration_seconds)
          )}
        </td>
        <td className="px-2 py-2 text-right whitespace-nowrap md:py-1">
          {total(
            period,
            "distance_meters",
            fitnessDistance(period.distance_meters, sport)
          )}
        </td>
        {period.peaks.map((peak, index) => (
          <td
            key={index}
            className="px-2 py-2 text-right whitespace-nowrap md:py-1"
            title={`Best recorded ${fitnessAnchorLabel(peak, sport)}`}
          >
            {canOpenPeak(peak) ? (
              <button
                type="button"
                className="relative !inline !h-auto !min-h-0 !w-auto !min-w-0 !rounded-sm !border-0 !bg-transparent !p-0 !text-inherit underline decoration-primary/40 underline-offset-2 before:absolute before:-inset-x-2 before:-inset-y-2 hover:!text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:before:-inset-y-1"
                style={{ font: "inherit" }}
                aria-label={`Open ${fitnessAnchorLabel(peak, sport)} effort ${fitnessPeakValue(peak.value, sport)} from ${fitnessPeriodLabel(peak.date ?? period.start)}`}
                onClick={() => openPeak(peak)}
              >
                {fitnessPeakValue(peak.value, sport)}
              </button>
            ) : (
              fitnessPeakValue(peak.value, sport)
            )}
          </td>
        ))}
      </tr>
    ))

  return (
    <Card
      className={`dashboard-history-card training-history-card fitness-history-card dashboard-fitness-history-card m-0 min-w-0 ${view === "table" ? "fitness-history-table-view" : ""}`}
      aria-labelledby={titleId}
      style={
        isMobile && view === "graph"
          ? { height: 350, minHeight: 350 }
          : undefined
      }
    >
      <CardContent
        className="flex min-h-0 flex-1 flex-col p-0"
        style={
          isMobile && view === "graph"
            ? { flex: "1 1 0%", minHeight: 0 }
            : undefined
        }
      >
        <div className="training-history-filter-scroll fitness-history-filter-bar">
          <div className="fitness-history-filter-bar-controls">
            {isMobile ? (
              <MobileFilterTabs
                label="Fitness history sport"
                items={sports.map(({ type, label, icon }) => ({
                  value: type,
                  label,
                  icon,
                }))}
                value={sport}
                onChange={changeSport}
                className="training-history-mobile-filters"
              />
            ) : (
              <div
                className="training-history-filters fitness-history-filters"
                role="group"
                aria-label="Fitness history sport"
              >
                {sports.map(({ type, label, icon: Icon }) => (
                  <F7Button
                    key={type}
                    active={sport === type}
                    round
                    outline
                    aria-pressed={sport === type}
                    onClick={(event) => {
                      event.preventDefault()
                      changeSport(type)
                    }}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span>{label}</span>
                  </F7Button>
                ))}
              </div>
            )}
            <div
              role="group"
              aria-label="Fitness history view"
              className={`fitness-history-view-toggle ${isMobile ? "ml-auto" : ""}`}
            >
              <span id={`${titleId}-table-label`} className="sr-only">
                Table
              </span>
              <Switch
                className="h-6 w-11"
                thumbClassName="size-5 group-data-checked:translate-x-5"
                checked={view === "graph"}
                onCheckedChange={changeView}
                aria-labelledby={`${titleId}-table-label ${titleId}-graph-label`}
              />
              <span id={`${titleId}-graph-label`} className="sr-only">
                Graph
              </span>
            </div>
          </div>
        </div>
        <section className="training-history-summary shrink-0">
          <div className="flex items-start justify-between gap-2">
            <h2 id={titleId} className="min-w-0 flex-1 whitespace-nowrap">
              Fitness history
            </h2>
            {isMobile && view === "graph" && (
              <label className="shrink-0">
                <span className="sr-only">Peak effort</span>
                <select
                  aria-label="Peak effort"
                  className="!h-8 !w-24 !min-w-0 rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={anchorKey(selectedAnchor)}
                  onChange={(event) => changeAnchor(event.target.value)}
                >
                  {anchors.map((anchor) => (
                    <option key={anchorKey(anchor)} value={anchorKey(anchor)}>
                      {fitnessAnchorLabel(anchor, sport)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {view === "graph" && (
            <div className="training-history-totals">
              <div>
                <span>
                  {selectedGraphPoint &&
                  selectedGraphPoint.date !== selectedGraphPoint.period
                    ? "Date"
                    : "Period"}
                </span>
                <strong>
                  {canOpenPeak(selectedGraphPoint?.peak) ? (
                    <button
                      type="button"
                      className="relative !inline !h-auto !min-h-0 !w-auto !min-w-0 !rounded-sm !border-0 !bg-transparent !p-0 !text-inherit underline decoration-primary/40 underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-1 hover:!text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      style={{ font: "inherit" }}
                      aria-label={`Open ${fitnessAnchorLabel(selectedAnchor, sport)} effort from ${selectedPointLabel}`}
                      onClick={() => openPeak(selectedGraphPoint?.peak)}
                    >
                      {selectedPointLabel}
                    </button>
                  ) : (
                    selectedPointLabel
                  )}
                </strong>
              </div>
              <div>
                <span>Effort</span>
                <strong>{graphValueLabel(selectedGraphPoint?.value)}</strong>
              </div>
              <div>
                <span>Change</span>
                <strong>{trendLabel}</strong>
              </div>
            </div>
          )}
        </section>
        <div
          className="flex h-4 min-h-4 shrink-0 items-center gap-1 px-3 text-[10px] leading-4 text-muted-foreground md:px-[18px]"
          title={sourceTitle || undefined}
          aria-label={sourceTitle || undefined}
        >
          <span className="min-w-0 truncate">{sourceNotice}</span>
          {partialCoverage && (
            <span className="shrink-0">· Partial peak coverage</span>
          )}
        </div>
        {error ? (
          <div
            role="status"
            className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm"
          >
            <p>Fitness history could not load.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setResult(null)
                setRetry((value) => value + 1)
              }}
            >
              Try again
            </Button>
          </div>
        ) : data && !data.configured ? (
          <div
            role="status"
            className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground"
          >
            Connect Intervals.icu in Settings to see your recorded history.
          </div>
        ) : view === "graph" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <PageErrorBoundary resetKey={`${sport}:fitness-history-graph`}>
              <Suspense
                fallback={
                  <div
                    role="status"
                    aria-label="Loading graph view"
                    className="flex min-h-0 flex-1 items-center px-3"
                  >
                    <Skeleton className="h-3/4 w-full" />
                  </div>
                }
              >
                <FitnessHistoryGraph
                  history={data}
                  sport={sport}
                  loading={loading}
                  selection={graphSelection}
                  onPointSelect={(point) =>
                    setActiveGraphPoint({
                      sport,
                      anchor: selectedAnchorKey,
                      point,
                    })
                  }
                  onAnchorChange={changeAnchor}
                  onEffortOpen={onEffortOpen}
                />
              </Suspense>
            </PageErrorBoundary>
          </div>
        ) : (
          <div
            className="fitness-history-table-region min-w-0 overflow-x-auto rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0 md:flex-1 md:overflow-auto"
            tabIndex={0}
            role="region"
            aria-label={`${sports.find((item) => item.type === sport)?.label} fitness history table`}
            aria-busy={loading || undefined}
          >
            <table
              className="w-full border-collapse text-[11px] tabular-nums md:text-xs"
              aria-label={`Recorded ${sports.find((item) => item.type === sport)?.label} totals and peak efforts`}
            >
              <thead className="sticky top-0 z-20 bg-card text-muted-foreground">
                <tr className="border-b">
                  <th
                    scope="col"
                    className="sticky left-0 bg-card px-3 py-2 text-left font-medium md:py-1"
                  >
                    Period
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-2 text-right font-medium whitespace-nowrap md:py-1"
                  >
                    Time<span className="block text-[10px]">h:mm</span>
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-2 text-right font-medium whitespace-nowrap md:py-1"
                  >
                    Distance
                    <span className="block text-[10px]">
                      {sport === "Swim" ? "yd" : "mi"}
                    </span>
                  </th>
                  {anchors.map((anchor, index) => (
                    <th
                      key={index}
                      scope="col"
                      className="px-2 py-2 text-right font-medium whitespace-nowrap md:py-1"
                    >
                      {fitnessAnchorLabel(anchor, sport)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={columns}
                    className="bg-muted/40 px-3 py-2 text-left font-semibold md:py-1"
                  >
                    Last 4 weeks
                  </th>
                </tr>
                {loading
                  ? Array.from({ length: 4 }, (_, index) => (
                      <tr
                        key={index}
                        className="border-b border-border/60 last:border-0"
                      >
                        {Array.from({ length: columns }, (_, column) => (
                          <td key={column} className="px-2 py-2 md:py-1">
                            <Skeleton className="h-[1lh] w-10" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : periodRows(data?.weeks ?? [])}
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={columns}
                    className="bg-muted/40 px-3 py-2 text-left font-semibold md:py-1"
                  >
                    Past 12 months
                  </th>
                </tr>
                {loading
                  ? Array.from({ length: 12 }, (_, index) => (
                      <tr
                        key={index}
                        className="border-b border-border/60 last:border-0"
                      >
                        {Array.from({ length: columns }, (_, column) => (
                          <td key={column} className="px-2 py-2 md:py-1">
                            <Skeleton className="h-[1lh] w-10" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : periodRows((data?.months ?? []).slice(0, 12), true)}
                {data &&
                  ![...data.weeks, ...data.months].some(
                    (period) => period.activities > 0
                  ) && (
                    <tr>
                      <td
                        colSpan={columns}
                        className="px-3 py-4 text-center text-muted-foreground"
                      >
                        No recorded activities for this sport yet.
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
