import { useEffect, useMemo, useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  dashboardPaceClient,
  dashboardPaceGridRows,
  dashboardPacePlotRows,
  dashboardPaceSeconds,
  dashboardPaceTime,
  dashboardPaceUnit,
  dashboardPaceEffort,
  type DashboardPaceCurve as Curve,
  type DashboardPacePoint,
  type DashboardPaceSport,
} from "@/lib/dashboard-pace-curve"
import { newDashboardPowerSettings } from "@/lib/dashboard-power-curve"
import {
  resolveDashboardChartRange,
  type DashboardChartRange,
} from "@/lib/dashboard-chart-settings"
import type { DashboardChartInstance } from "@/lib/dashboard-charts"
import { trainingCacheScope } from "@/lib/training-context"
import { fitnessPeakEffortTarget } from "@/lib/fitness-history"
import { openActivityEffort } from "@/lib/activity-effort-navigation"

const date = (value: string | null) =>
  value
    ? `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(2, 4)}`
    : "—"
const rangeLabel = (range: DashboardChartRange) =>
  `${date(range.start)} - ${date(range.end)}`
const distance = (meters: number) =>
  meters >= 1000
    ? `${Number((meters / 1000).toFixed(4))} km`
    : `${Number(meters.toFixed(4))} m`
export function DashboardPaceCurve({
  instance,
  today,
  dashboardRange,
  refresh,
  globalSport,
}: {
  instance: DashboardChartInstance
  today: string
  dashboardRange: DashboardChartRange
  refresh: number
  globalSport: string
}) {
  const selected = instance.settings.sports.filter(
    (sport) =>
      globalSport === "all" || globalSport.toLowerCase() === sport.toLowerCase()
  )
  const sport =
    selected.length === 1 && ["Run", "Swim"].includes(selected[0])
      ? (selected[0] as DashboardPaceSport)
      : null
  const config = instance.pace || newDashboardPowerSettings(dashboardRange),
    scope = trainingCacheScope()
  const [loaded, setLoaded] = useState<{
      primary: Curve
      comparison: Curve | null
    } | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [page, setPage] = useState(0)
  let primary: DashboardChartRange | undefined,
    comparison: DashboardChartRange | undefined,
    problem = ""
  try {
    primary = resolveDashboardChartRange(
      instance.settings,
      today,
      dashboardRange
    )
    if (config.comparison)
      comparison = resolveDashboardChartRange(
        config.comparisonRange,
        today,
        dashboardRange
      )
  } catch (reason) {
    problem =
      reason instanceof Error
        ? reason.message
        : "Choose valid pace curve dates."
  }
  const start = primary?.start,
    end = primary?.end,
    comparisonStart = comparison?.start,
    comparisonEnd = comparison?.end
  useEffect(() => {
    if (!sport || !start || !end) {
      setBusy(false)
      return
    }
    const controller = new AbortController(),
      options = { signal: controller.signal, revision: refresh * 1000 + retry }
    setBusy(true)
    setError("")
    void Promise.all([
      dashboardPaceClient.load(scope, sport, { start, end }, today, options),
      comparisonStart && comparisonEnd
        ? dashboardPaceClient.load(
            scope,
            sport,
            { start: comparisonStart, end: comparisonEnd },
            today,
            options
          )
        : Promise.resolve(null),
    ])
      .then(([primary, comparison]) => {
        if (!controller.signal.aborted) {
          setLoaded({ primary, comparison })
          setPage(0)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Recorded pace history could not load."
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [
    scope,
    sport,
    start,
    end,
    comparisonStart,
    comparisonEnd,
    today,
    refresh,
    retry,
  ])
  const rows = useMemo(
      () =>
        loaded ? dashboardPaceGridRows(loaded.primary, loaded.comparison) : [],
      [loaded]
    ),
    plot = useMemo(
      () =>
        loaded ? dashboardPacePlotRows(loaded.primary, loaded.comparison) : [],
      [loaded]
    )
  if (problem) return <p role="alert">{problem}</p>
  if (!sport)
    return (
      <p className="dta-empty">
        Choose Run or Swim individually in this chart’s settings to view
        recorded pace by distance. Curves for other or combined workout types
        are unavailable.
      </p>
    )
  const source = (curve: Curve, point: DashboardPacePoint | undefined) => {
    const effort = point ? dashboardPaceEffort(curve, point) : null,
      target = effort ? fitnessPeakEffortTarget(effort, curve.sport) : null
    return target ? (
      <button
        type="button"
        aria-label={`Open recorded ${distance(point!.distance_meters)} effort on ${date(point!.date)}`}
        title={point!.name || "Open source workout"}
        onClick={() => openActivityEffort(target)}
      >
        {date(point!.date)}
      </button>
    ) : (
      date(point?.date || null)
    )
  }
  const stale =
    loaded &&
    (loaded.primary.sport !== sport ||
      loaded.primary.range.start !== start ||
      loaded.primary.range.end !== end ||
      loaded.comparison?.range.start !== comparisonStart ||
      loaded.comparison?.range.end !== comparisonEnd)
  const visible = rows.slice(page * 50, (page + 1) * 50)
  return (
    <div className="ddc-pace-curve">
      <p className="dta-data-note">
        {loaded?.primary.sport || sport} pace ·{" "}
        {dashboardPaceUnit(loaded?.primary.sport || sport)}
      </p>
      {busy && (
        <p role="status">
          Loading pace chart…{loaded ? " Previous results remain visible." : ""}
        </p>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry pace curve
          </button>
        </p>
      )}
      {stale && (
        <p className="dta-data-note">
          Displayed {loaded.primary.sport} range: {loaded.primary.range.start} –{" "}
          {loaded.primary.range.end}
        </p>
      )}
      {loaded && (
        <>
          <p className="ddc-power-ranges">
            Primary: {loaded.primary.range.start} – {loaded.primary.range.end}
            {loaded.comparison
              ? ` · Comparison: ${loaded.comparison.range.start} – ${loaded.comparison.range.end}`
              : ""}
          </p>
          {[loaded.primary, loaded.comparison].flatMap((curve, index) =>
            curve?.warning
              ? [
                  <p key={index} className="dta-data-note" role="status">
                    {curve.warning}
                  </p>,
                ]
              : []
          )}
          {[loaded.primary, loaded.comparison].some(
            (curve) => curve && curve.effectiveRange?.end !== curve.range.end
          ) && (
            <p className="dta-data-note">
              Future dates contain no recorded efforts. Available measurements
              end at {today}.
            </p>
          )}
          {config.display === "chart" ? (
            <div
              className="dta-chart"
              role="img"
              aria-label={`Recorded ${loaded.primary.sport} pace by exact distance`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={plot}
                  margin={{ top: 12, right: 22, bottom: 15, left: 0 }}
                  accessibilityLayer
                >
                  <CartesianGrid vertical={false} stroke="#e9e9e9" />
                  <XAxis
                    dataKey="meters"
                    type="number"
                    scale="log"
                    domain={[
                      Math.min(100, plot[0]?.meters || 100),
                      Math.max(
                        loaded.primary.sport === "Run" ? 30000 : 1000,
                        plot.at(-1)?.meters || 1000
                      ),
                    ]}
                    tickFormatter={distance}
                    tick={{ fontSize: 9 }}
                  />
                  <YAxis
                    reversed
                    tickFormatter={(value) => dashboardPaceTime(value)}
                    width={60}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    labelFormatter={(value) => distance(Number(value))}
                    formatter={(value, name) => [
                      typeof value === "number"
                        ? `${dashboardPaceTime(value)} ${dashboardPaceUnit(loaded.primary.sport)}`
                        : "—",
                      name,
                    ]}
                  />
                  <Legend />
                  <Line
                    dataKey="primary"
                    name="Primary"
                    type="linear"
                    connectNulls={false}
                    stroke="#d52424"
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                  {loaded.comparison && (
                    <Line
                      dataKey="comparison"
                      name="Comparison"
                      type="linear"
                      connectNulls={false}
                      stroke="#167eac"
                      dot={false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <>
              <div className="ddc-power-grid">
                <table>
                  <caption className="sr-only">
                    Recorded pace by distance
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="sr-only">Distance</span>
                      </th>
                      <th scope="col">
                        <span className="sr-only">Primary effort date</span>
                      </th>
                      <th
                        scope="col"
                        aria-label={
                          rangeLabel(loaded.primary.range) +
                          " pace " +
                          dashboardPaceUnit(loaded.primary.sport)
                        }
                      >
                        {rangeLabel(loaded.primary.range)}
                      </th>
                      <th scope="col">
                        {loaded.comparison && (
                          <span className="sr-only">
                            Comparison effort date
                          </span>
                        )}
                      </th>
                      <th
                        scope="col"
                        aria-label={
                          loaded.comparison
                            ? rangeLabel(loaded.comparison.range) +
                              " comparison pace " +
                              dashboardPaceUnit(loaded.primary.sport)
                            : undefined
                        }
                      >
                        {loaded.comparison
                          ? rangeLabel(loaded.comparison.range)
                          : ""}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.meters}>
                        <th scope="row">{row.label}</th>
                        <td>{source(loaded.primary, row.primary)}</td>
                        <td colSpan={loaded.comparison ? 1 : 3}>
                          {dashboardPaceTime(
                            dashboardPaceSeconds(
                              loaded.primary.sport,
                              row.primary?.value ?? null
                            )
                          )}
                        </td>
                        {loaded.comparison && (
                          <>
                            <td>{source(loaded.comparison, row.comparison)}</td>
                            <td>
                              {dashboardPaceTime(
                                dashboardPaceSeconds(
                                  loaded.primary.sport,
                                  row.comparison?.value ?? null
                                )
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && (
                <nav aria-label="Pace grid pages">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Previous pace rows
                  </button>
                  <span>
                    {page * 50 + 1}–{Math.min(rows.length, (page + 1) * 50)} of{" "}
                    {rows.length}
                  </span>
                  <button
                    type="button"
                    disabled={(page + 1) * 50 >= rows.length}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next pace rows
                  </button>
                </nav>
              )}
            </>
          )}
          {!loaded.primary.points.some((point) => point.value !== null) &&
            !loaded.comparison?.points.some(
              (point) => point.value !== null
            ) && (
              <p className="dta-empty">
                No recorded pace efforts are available for the selected ranges.
              </p>
            )}
          {config.display === "grid" &&
            !rows.length &&
            loaded.primary.points.some((point) => point.value !== null) && (
              <p className="dta-empty">
                No recorded efforts are available at the shown distances.
              </p>
            )}
        </>
      )}
    </div>
  )
}
