import { heartRateSportMatches } from "../../../app-backend/lib/heart-rate-curve-model.mjs"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  dashboardPowerGridDurations,
  dashboardPowerClient,
  dashboardPowerSelection,
  dashboardPowerPlotRows,
  newDashboardPowerSettings,
  type DashboardPowerCurve as Curve,
  type DashboardPowerPoint,
} from "@/lib/dashboard-power-curve"
import {
  resolveDashboardChartRange,
  type DashboardChartRange,
} from "@/lib/dashboard-chart-settings"
import type { DashboardChartInstance } from "@/lib/dashboard-charts"
import { trainingCacheScope, type PlannedWorkout } from "@/lib/training-context"
import { loadHistoricalWorkout } from "@/lib/training-history-range"

const duration = (seconds: number) =>
  seconds < 60 ? `${seconds} sec` : `${seconds / 60} min`
const dateLabel = (date: string | null | undefined) =>
  date ? `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(2, 4)}` : "—"
const rangeLabel = (range: DashboardChartRange) =>
  `${dateLabel(range.start)} - ${dateLabel(range.end)}`
const number = (value: number | null | undefined) =>
  value == null
    ? "—"
    : value.toLocaleString("en-US", { maximumFractionDigits: 1 })
export function DashboardPowerCurve({
  instance,
  today,
  dashboardRange,
  refresh,
  globalSport,
  onWorkoutOpen,
}: {
  instance: DashboardChartInstance
  today: string
  dashboardRange: DashboardChartRange
  refresh: number
  globalSport: string
  onWorkoutOpen: (workout: PlannedWorkout) => void
}) {
  const config = instance.power || newDashboardPowerSettings(dashboardRange)
  const [loaded, setLoaded] = useState<{
      primary: Curve
      comparison: Curve | null
      tags: string[]
      sport: string
    } | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [opening, setOpening] = useState<string | null>(null),
    [openError, setOpenError] = useState("")
  const sourceController = useRef<AbortController | null>(null)
  useEffect(() => () => sourceController.current?.abort(), [])
  let primary: DashboardChartRange | undefined,
    comparison: DashboardChartRange | undefined,
    problem = "",
    sport = "all"
  try {
    sport = dashboardPowerSelection(instance.settings.sports, globalSport)
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
      reason instanceof Error ? reason.message : "Choose valid curve dates."
  }
  const start = primary?.start,
    end = primary?.end,
    comparisonStart = comparison?.start,
    comparisonEnd = comparison?.end,
    scope = trainingCacheScope(),
    tagKey = JSON.stringify(instance.tags || [])
  useEffect(() => {
    if (!start || !end || problem) {
      setBusy(false)
      return
    }
    const controller = new AbortController(),
      options = {
        signal: controller.signal,
        revision: refresh * 1000 + retry,
        tags: JSON.parse(tagKey) as string[],
        sport,
      }
    setBusy(true)
    setError("")
    void Promise.all([
      dashboardPowerClient.load(scope, { start, end }, today, options),
      comparisonStart && comparisonEnd
        ? dashboardPowerClient.load(
            scope,
            { start: comparisonStart, end: comparisonEnd },
            today,
            options
          )
        : Promise.resolve(null),
    ])
      .then(([primary, comparison]) => {
        if (!controller.signal.aborted)
          setLoaded({
            primary,
            comparison,
            tags: JSON.parse(tagKey) as string[],
            sport,
          })
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Recorded power history could not load."
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [
    scope,
    start,
    end,
    comparisonStart,
    comparisonEnd,
    today,
    refresh,
    retry,
    tagKey,
    sport,
    problem,
  ])
  const rows = useMemo(
    () =>
      dashboardPowerGridDurations.map((seconds) => ({
        seconds,
        primary: loaded?.primary.points.find(
          (point) => point.duration_seconds === seconds
        ),
        comparison: loaded?.comparison?.points.find(
          (point) => point.duration_seconds === seconds
        ),
      })),
    [loaded]
  )
  const plotRows = useMemo(
    () =>
      loaded ? dashboardPowerPlotRows(loaded.primary, loaded.comparison) : [],
    [loaded]
  )
  if (problem) return <p role="alert">{problem}</p>
  const open = async (effort: DashboardPowerPoint) => {
    if (!effort.activity_id || sourceController.current) return
    const controller = new AbortController()
    sourceController.current = controller
    setOpening(effort.activity_id)
    setOpenError("")
    try {
      const workout = await loadHistoricalWorkout(
        "activity:" + effort.activity_id,
        { signal: controller.signal }
      )
      if (
        (workout.activity_id !== effort.activity_id &&
          workout.id !== "activity:" + effort.activity_id) ||
        workout.workout_date !== effort.date ||
        (workout.activity_type != null &&
          (effort.native_type
            ? workout.activity_type !== effort.native_type
            : !heartRateSportMatches(workout.activity_type, "Ride")))
      )
        throw Error(
          "The source recording returned a different identity, date or sport."
        )
      if (!controller.signal.aborted) onWorkoutOpen(workout)
    } catch (reason) {
      if (!controller.signal.aborted)
        setOpenError(
          reason instanceof Error
            ? reason.message
            : "Source recording could not load."
        )
    } finally {
      if (!controller.signal.aborted) setOpening(null)
      if (sourceController.current === controller)
        sourceController.current = null
    }
  }
  const source = (effort: DashboardPowerPoint | undefined) =>
    effort ? (
      effort.activity_id && effort.date ? (
        <button
          type="button"
          disabled={opening !== null}
          title={effort.name || "Open source recording"}
          aria-label={
            "Open power source recording for " +
            duration(effort.duration_seconds!) +
            " on " +
            dateLabel(effort.date)
          }
          onClick={() => void open(effort)}
        >
          {Math.round(effort.value)}
        </button>
      ) : (
        <span>{Math.round(effort.value)}</span>
      )
    ) : (
      "—"
    )
  const stale =
    !!loaded &&
    (JSON.stringify(loaded.tags) !== tagKey ||
      loaded.sport !== sport ||
      loaded.primary.range.start !== start ||
      loaded.primary.range.end !== end ||
      loaded.comparison?.range.start !== comparisonStart ||
      loaded.comparison?.range.end !== comparisonEnd)
  return (
    <div className="ddc-power-curve">
      {opening && <p role="status">Opening source recording…</p>}
      {openError && <p role="alert">{openError}</p>}
      {loaded &&
        (loaded.tags.length > 0 || JSON.stringify(loaded.tags) !== tagKey) && (
          <p className="dta-data-note">
            Displayed recording tags:{" "}
            {loaded.tags.length ? loaded.tags.join(", ") : "All"}
          </p>
        )}
      {busy && (
        <p role="status">
          Loading chart…
          {loaded ? " Previous power results remain visible." : ""}
        </p>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry power curve
          </button>
        </p>
      )}
      {stale && (
        <p className="dta-data-note">
          Displayed primary range: {loaded!.primary.range.start} –{" "}
          {loaded!.primary.range.end}
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
                  <p role="status" className="dta-data-note" key={index}>
                    {curve.warning}
                  </p>,
                ]
              : []
          )}
          {[loaded.primary, loaded.comparison].some(
            (curve) => curve && !curve.full
          ) && (
            <p className="dta-data-note">
              Limited duration coverage: only the available recorded points are
              shown.
            </p>
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
              aria-label="Recorded peak power by exact effort duration"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={plotRows}
                  margin={{ top: 12, right: 22, bottom: 15, left: 0 }}
                  accessibilityLayer
                >
                  <CartesianGrid vertical={false} stroke="#e9e9e9" />
                  <XAxis
                    type="number"
                    dataKey="seconds"
                    name="Duration"
                    scale="log"
                    domain={[
                      Math.min(5, plotRows[0]?.seconds || 5),
                      Math.max(5400, plotRows.at(-1)?.seconds || 5400),
                    ]}
                    ticks={[5, 20, 120, 600, 3600]}
                    tickFormatter={duration}
                    tick={{ fontSize: 9 }}
                  />
                  <YAxis
                    type="number"
                    name="Power"
                    unit=" W"
                    tick={{ fontSize: 10 }}
                    width={55}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    labelFormatter={(value) => duration(Number(value))}
                    formatter={(value, name) =>
                      typeof value === "number"
                        ? [
                            name === "Duration"
                              ? duration(value)
                              : `${number(value)} W`,
                            name,
                          ]
                        : ["—", name]
                    }
                  />
                  <Legend />
                  <Line
                    name="Primary"
                    dataKey="primary"
                    type="linear"
                    connectNulls={false}
                    stroke={loaded.primary.full ? "#d52424" : "none"}
                    dot={
                      loaded.primary.full ? false : { r: 3, fill: "#d52424" }
                    }
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                  {loaded.comparison && (
                    <Line
                      name="Comparison"
                      dataKey="comparison"
                      type="linear"
                      connectNulls={false}
                      stroke={loaded.comparison.full ? "#167eac" : "none"}
                      dot={
                        loaded.comparison.full
                          ? false
                          : { r: 3, fill: "#167eac" }
                      }
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="ddc-power-grid">
              <table>
                <caption className="sr-only">
                  Recorded peak power by duration
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Duration</span>
                    </th>
                    <th scope="col">
                      <span className="sr-only">Primary effort date</span>
                    </th>
                    <th
                      scope="col"
                      aria-label={
                        rangeLabel(loaded.primary.range) + " power watts"
                      }
                    >
                      {rangeLabel(loaded.primary.range)}
                    </th>
                    {loaded.comparison && (
                      <>
                        <th scope="col">
                          <span className="sr-only">
                            Comparison effort date
                          </span>
                        </th>
                        <th
                          scope="col"
                          aria-label={
                            rangeLabel(loaded.comparison.range) +
                            " comparison power watts"
                          }
                        >
                          {rangeLabel(loaded.comparison.range)}
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.seconds}>
                      <th scope="row">{duration(row.seconds)}</th>
                      <td>{dateLabel(row.primary?.date)}</td>
                      <td>{source(row.primary)}</td>
                      {loaded.comparison && (
                        <>
                          <td>{dateLabel(row.comparison?.date)}</td>
                          <td>{source(row.comparison)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loaded.primary.points.length &&
            !loaded.comparison?.points.length && (
              <p className="dta-empty">
                No recorded power efforts are available for these exact
                durations in the selected ranges.
              </p>
            )}
        </>
      )}
    </div>
  )
}
