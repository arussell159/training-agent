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
  dashboardCadenceClient,
  dashboardCadenceSelection,
  dashboardCadenceGridRows,
  dashboardCadencePlotRows,
  type DashboardCadenceCurve as Curve,
} from "@/lib/dashboard-cadence-curve"
import { newDashboardPowerSettings } from "@/lib/dashboard-power-curve"
import {
  resolveDashboardChartRange,
  type DashboardChartRange,
} from "@/lib/dashboard-chart-settings"
import type { DashboardChartInstance } from "@/lib/dashboard-charts"
import { trainingCacheScope, type PlannedWorkout } from "@/lib/training-context"
import { loadHistoricalWorkout } from "@/lib/training-history-range"
import type { CadenceCurvePoint } from "../../../app-backend/lib/cadence-curve-model.mjs"

const duration = (seconds: number) =>
  seconds < 60 ? `${seconds} sec` : `${seconds / 60} min`
const dateLabel = (date: string | null | undefined) =>
  date ? `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(2, 4)}` : "—"
const rangeLabel = (range: DashboardChartRange) =>
  `${dateLabel(range.start)} - ${dateLabel(range.end)}`
const message = (reason: unknown) =>
  reason instanceof Error
    ? reason.message
    : "Recorded cadence history could not load."
export function DashboardCadenceCurve({
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
  const config = instance.cadence || newDashboardPowerSettings(dashboardRange)
  const [loaded, setLoaded] = useState<{
      primary: Curve
      comparison: Curve | null
      sport: string
      tags: string[]
    } | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [opening, setOpening] = useState<string | null>(null),
    [openError, setOpenError] = useState("")
  let primary: DashboardChartRange | undefined,
    comparison: DashboardChartRange | undefined,
    problem = "",
    sport = ""
  try {
    sport = dashboardCadenceSelection(instance.settings.sports, globalSport)
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
    problem = message(reason)
  }
  const start = primary?.start,
    end = primary?.end,
    comparisonStart = comparison?.start,
    comparisonEnd = comparison?.end,
    scope = trainingCacheScope(),
    tagKey = JSON.stringify(instance.tags || [])
  useEffect(() => {
    if (!start || !end || !sport || problem) {
      setBusy(false)
      return
    }
    const controller = new AbortController(),
      options = {
        signal: controller.signal,
        revision: refresh * 1000 + retry,
        tags: JSON.parse(tagKey) as string[],
      }
    setBusy(true)
    setError("")
    void Promise.all([
      dashboardCadenceClient.load(scope, sport, { start, end }, today, options),
      comparisonStart && comparisonEnd
        ? dashboardCadenceClient.load(
            scope,
            sport,
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
            sport,
            tags: JSON.parse(tagKey) as string[],
          })
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(message(reason))
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
    problem,
    tagKey,
  ])
  const rows = useMemo(
      () =>
        loaded
          ? dashboardCadenceGridRows(loaded.primary, loaded.comparison)
          : [],
      [loaded]
    ),
    plotRows = useMemo(
      () =>
        loaded
          ? dashboardCadencePlotRows(loaded.primary, loaded.comparison)
          : [],
      [loaded]
    )
  const sourceController = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      sourceController.current?.abort()
      sourceController.current = null
    },
    []
  )
  const open = async (point: CadenceCurvePoint) => {
    if (!point.activity_id || sourceController.current) return
    const controller = new AbortController()
    sourceController.current = controller
    setOpening(point.activity_id)
    setOpenError("")
    try {
      const workout = await loadHistoricalWorkout(
        `activity:${point.activity_id}`,
        { signal: controller.signal }
      )
      if (
        (workout.activity_id !== point.activity_id &&
          workout.id !== `activity:${point.activity_id}`) ||
        workout.workout_date !== point.date ||
        (workout.activity_type != null &&
          workout.activity_type !== point.native_type)
      )
        throw Error(
          "The source recording returned a different identity, date or sport. Retry opening the recorded source."
        )
      if (!controller.signal.aborted) onWorkoutOpen(workout)
    } catch (reason) {
      if (!controller.signal.aborted) setOpenError(message(reason))
    } finally {
      if (!controller.signal.aborted) setOpening(null)
      if (sourceController.current === controller)
        sourceController.current = null
    }
  }
  const source = (point: CadenceCurvePoint | undefined) =>
    point?.value != null && point.activity_id ? (
      <button
        type="button"
        disabled={opening !== null}
        aria-label={`Open cadence source recording for ${duration(point.duration_seconds)} on ${dateLabel(point.date)}`}
        title={point.name || "Open source recording"}
        onClick={() => void open(point)}
      >
        {point.value}
      </button>
    ) : (
      "—"
    )
  if (problem) return <p className="dta-empty">{problem}</p>
  const stale =
    !!loaded &&
    (JSON.stringify(loaded.tags) !== tagKey ||
      loaded.sport !== sport ||
      loaded.primary.range.start !== start ||
      loaded.primary.range.end !== end ||
      loaded.comparison?.range.start !== comparisonStart ||
      loaded.comparison?.range.end !== comparisonEnd)
  return (
    <div className="ddc-cadence-curve">
      {busy && (
        <p role="status">
          Loading cadence chart…
          {loaded ? " Previous results remain visible." : ""}
        </p>
      )}
      {error && (
        <p role="alert">
          {error} Previous results are retained.{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry cadence curve
          </button>
        </p>
      )}
      {opening && <p role="status">Opening source recording…</p>}
      {openError && <p role="alert">{openError}</p>}
      {loaded &&
        (loaded.tags.length > 0 || JSON.stringify(loaded.tags) !== tagKey) && (
          <p className="dta-data-note">
            Displayed recording tags:{" "}
            {loaded.tags.length ? loaded.tags.join(", ") : "All"}
          </p>
        )}
      {loaded && (
        <>
          {stale && (
            <p className="dta-data-note">
              Displayed selection: {loaded.sport}; primary range{" "}
              {loaded.primary.range.start} – {loaded.primary.range.end}.
            </p>
          )}
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
              aria-label="Recorded peak cadence by exact effort duration"
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
                    name="Cadence"
                    unit=" RPM"
                    tick={{ fontSize: 10 }}
                    width={65}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    labelFormatter={(value) => duration(Number(value))}
                    formatter={(value, name) => [
                      typeof value === "number" ? `${value} RPM` : "—",
                      name,
                    ]}
                  />
                  <Legend />
                  <Line
                    name="Primary"
                    dataKey="primary"
                    type="linear"
                    connectNulls={false}
                    stroke="#d52424"
                    dot={
                      loaded.primary.points.filter(
                        (point) => point.value !== null
                      ).length === 1
                        ? { r: 3 }
                        : false
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
                      stroke="#167eac"
                      dot={
                        loaded.comparison.points.filter(
                          (point) => point.value !== null
                        ).length === 1
                          ? { r: 3 }
                          : false
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
                  Recorded peak cadence by duration
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Duration</span>
                    </th>
                    <th scope="col">
                      <span className="sr-only">Primary recording date</span>
                    </th>
                    <th
                      scope="col"
                      aria-label={`${rangeLabel(loaded.primary.range)} cadence RPM`}
                    >
                      {rangeLabel(loaded.primary.range)}
                    </th>
                    {loaded.comparison && (
                      <>
                        <th scope="col">
                          <span className="sr-only">
                            Comparison recording date
                          </span>
                        </th>
                        <th
                          scope="col"
                          aria-label={`${rangeLabel(loaded.comparison.range)} comparison cadence RPM`}
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
                      <td>
                        {row.primary?.value != null
                          ? dateLabel(row.primary.date)
                          : "—"}
                      </td>
                      <td>{source(row.primary)}</td>
                      {loaded.comparison && (
                        <>
                          <td>
                            {row.comparison?.value != null
                              ? dateLabel(row.comparison.date)
                              : "—"}
                          </td>
                          <td>{source(row.comparison)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loaded.primary.points.some((point) => point.value !== null) &&
            !loaded.comparison?.points.some(
              (point) => point.value !== null
            ) && (
              <p className="dta-empty">
                No verified recorded cadence efforts are available in the
                selected ranges.
              </p>
            )}
        </>
      )}
    </div>
  )
}
