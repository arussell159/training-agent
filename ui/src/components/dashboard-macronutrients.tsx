import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  aggregateMacronutrients,
  macronutrientFields,
  type MacronutrientSettings,
  type MacronutrientBucket,
} from "@/lib/dashboard-macronutrients"

export function DashboardMacronutrients({
  history,
  range,
  settings,
  title,
}: {
  history: readonly unknown[]
  range: { start: string; end: string }
  settings: MacronutrientSettings
  title: string
}) {
  const { start, end } = range
  const result = useMemo(() => {
    try {
      return {
        rows: aggregateMacronutrients(history, { start, end }, settings.period),
        error: "",
      }
    } catch (reason) {
      return {
        rows: [],
        error:
          reason instanceof Error
            ? reason.message
            : "Nutrition data could not be displayed.",
      }
    }
  }, [history, start, end, settings.period])
  if (result.error) return <p role="alert">{result.error}</p>
  const hasData = result.rows.some((row) => row.recordedDays > 0)
  if (!hasData)
    return (
      <p className="dta-empty">No nutrition data is available to report on</p>
    )
  const percentage = settings.display === "percentage"
  const rows = result.rows.map((row) => ({
    ...row,
    ...(percentage ? row.percentages : row.calories),
  }))
  const format = (value: number) =>
    value.toLocaleString("en-US", {
      maximumFractionDigits: percentage ? 1 : 0,
    }) + (percentage ? "%" : " kcal")
  return (
    <>
      <div
        role="img"
        aria-label={`${title}, recorded nutrition by ${settings.period}`}
        style={{ minWidth: 0 }}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={rows}
            margin={{ top: 12, right: 12, bottom: 8, left: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="key"
              tick={{ fontSize: 10 }}
              tickFormatter={(value) =>
                settings.period === "month"
                  ? String(value).slice(0, 7)
                  : `${Number(String(value).slice(5, 7))}/${Number(String(value).slice(8, 10))}`
              }
            />
            <YAxis
              domain={percentage ? [0, 100] : [0, "auto"]}
              tick={{ fontSize: 10 }}
              tickFormatter={(value) =>
                percentage ? `${value}%` : String(value)
              }
            />
            <Tooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as
                  MacronutrientBucket | undefined
                return active && row ? (
                  <div className="dta-tooltip" role="status">
                    <strong>
                      {row.start}
                      {row.end !== row.start ? ` – ${row.end}` : ""}
                    </strong>
                    {macronutrientFields.map(({ key, label }) => (
                      <p key={key}>
                        {label}:{" "}
                        {row.grams[key] === null
                          ? "Not recorded"
                          : `${row.grams[key]!.toLocaleString("en-US", { maximumFractionDigits: 2 })} g · ${percentage ? (row.percentages[key] === null ? "Percentage unavailable" : format(row.percentages[key]!)) : format(row.calories[key]!)}`}
                      </p>
                    ))}
                    <small>
                      {row.recordedDays} of {row.calendarDays} days recorded
                    </small>
                  </div>
                ) : null
              }}
            />
            <Legend />
            {macronutrientFields.map(({ key, label, color }) => (
              <Bar
                key={key}
                dataKey={key}
                name={label}
                stackId="nutrition"
                fill={color}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {result.rows.some((row) => row.incomplete) && (
        <small className="dta-data-note">
          Some days or nutrients were not recorded. Totals cover the available
          entries.
        </small>
      )}
      {result.rows.some((row) =>
        row.sources.some((source) => source.conflicts.length)
      ) && (
        <small className="dta-data-note">
          Conflicting nutrient values for the same day are unavailable.
        </small>
      )}
      {percentage &&
        !result.rows.some((row) =>
          macronutrientFields.some(({ key }) => row.percentages[key] !== null)
        ) &&
        result.rows.some(
          (row) => row.recordedDays && row.totalCalories === null
        ) && (
          <small className="dta-data-note">
            No complete nutrition totals are available for percentage display.
          </small>
        )}
      {percentage &&
        result.rows.some(
          (row) => row.recordedDays && row.totalCalories === 0
        ) && (
          <small className="dta-data-note">
            Percentages are unavailable for zero recorded calories.
          </small>
        )}
    </>
  )
}
