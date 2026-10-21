import {
  aggregateDailyMetrics,
  type AggregateAnalysis,
} from "./aggregate-analysis.ts"
import {
  dashboardChartDefinition,
  type DashboardChartInstance,
} from "./dashboard-charts.ts"
import {
  dashboardRangeError,
  validDashboardDate,
  type DashboardChartRange,
} from "./dashboard-chart-settings.ts"
import {
  calendarMetricFields,
  type CalendarMetricKey,
} from "../../../app-backend/lib/calendar-metrics-model.mjs"
export type DashboardSeriesRow = {
  date: string
  value: number | null
  missing: number
}
export function dashboardPerformanceSeries(
  wellness: readonly Record<string, unknown>[],
  range: DashboardChartRange
) {
  const problem = dashboardRangeError(range)
  if (problem) throw Error(problem)
  const numeric = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null
  const byDate = new Map(
    wellness.flatMap((row) => {
      const date = row.date ?? row.id
      return validDashboardDate(date) &&
        date >= range.start &&
        date <= range.end
        ? [
            [
              date,
              {
                date,
                fitness: numeric(row.ctl),
                fatigue: numeric(row.atl),
                form: numeric(row.tsb),
              },
            ] as const,
          ]
        : []
    })
  )
  const result = []
  for (
    let date = range.start;
    date <= range.end;
    date = new Date(Date.parse(date + "T12:00:00Z") + 86_400_000)
      .toISOString()
      .slice(0, 10)
  )
    result.push(
      byDate.get(date) || { date, fitness: null, fatigue: null, form: null }
    )
  return result
}
export function dashboardChartSeries(
  instance: DashboardChartInstance,
  analysis: AggregateAnalysis,
  wellness: readonly Record<string, unknown>[],
  range: DashboardChartRange
) {
  const definition = dashboardChartDefinition(instance.type)!
  let rows: DashboardSeriesRow[]
  if (definition.kind === "metrics") {
    rows = aggregateDailyMetrics(wellness, range).map((row) => {
      const value =
        row.entries[(instance.metric || "weight") as CalendarMetricKey].value
      return {
        date: row.date,
        value:
          typeof value === "number" && Number.isFinite(value) ? value : null,
        missing: 0,
      }
    })
    // Each week retains its last recorded snapshot, including an explicit clear.
    if (instance.settings.period === "week")
      rows = [
        ...new Map(
          rows.map((row) => {
            const date = new Date(`${row.date}T12:00:00Z`)
            date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
            return [date.toISOString().slice(0, 10), row] as const
          })
        ).values(),
      ]
  } else
    rows = analysis.periods.map((period) => {
      const measurement = definition.metric
        ? period.metrics[definition.metric]
        : definition.maximum
          ? period.maxima[definition.maximum]
          : undefined
      const value = measurement?.value ?? null
      return {
        date: period.start,
        value:
          definition.kind === "pace"
            ? value != null && value > 0
              ? 1609.344 / value
              : null
            : value,
        missing: measurement?.missing || 0,
      }
    })
  const values = rows.flatMap((row) => (row.value == null ? [] : [row.value]))
  return {
    rows,
    values,
    mean: values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null,
  }
}
export function dashboardClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}
export function dashboardChartFormat(
  instance: DashboardChartInstance,
  value: number
) {
  const definition = dashboardChartDefinition(instance.type)!,
    metric = definition.metric || definition.maximum,
    number = (value: number) =>
      value.toLocaleString("en-US", { maximumFractionDigits: 1 })
  if (metric === "duration_seconds") return dashboardClock(value)
  if (metric === "distance_meters")
    return instance.settings.sports.length === 1 &&
      instance.settings.sports[0] === "Swim"
      ? `${number(value / 0.9144)} yd`
      : `${number(value / 1609.344)} mi`
  if (definition.kind === "pace") {
    const seconds = Math.round(value)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} /mi`
  }
  if (metric === "max_speed") return `${number(value * 2.2369362921)} mph`
  if (metric === "elevation_gain" || metric === "elevation_loss")
    return `${number(value)} m`
  if (metric === "work_kj") return `${number(value)} kJ`
  if (metric === "calories") return `${number(value)} kcal`
  if (metric === "max_hr") return `${number(value)} bpm`
  if (metric === "max_cadence") return `${number(value)} rpm`
  if (metric === "max_power") return `${number(value)} W`
  if (definition.kind === "metrics") {
    const field = calendarMetricFields.find(
      (field) => field.key === (instance.metric || "weight")
    )
    return `${number(value)}${field?.unit ? ` ${field.unit}` : ""}`
  }
  return number(value)
}
