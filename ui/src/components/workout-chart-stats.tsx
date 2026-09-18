import type { WorkoutSummaryValues } from "@/lib/training-context"
import { formatSignalClock } from "@/lib/interval-signals"

export function WorkoutChartStats({
  track,
  sport,
  summary = {},
}: {
  track: string
  sport: string
  summary?: WorkoutSummaryValues | null
}) {
  const data = summary || {}
  const swim = /swim/i.test(sport),
    run = /run/i.test(sport)
  const number = (
    value: number | null | undefined,
    unit: string,
    digits = 0
  ) =>
    value != null && Number.isFinite(value)
      ? `${value.toLocaleString("en-US", { maximumFractionDigits: digits })}${unit ? " " + unit : ""}`
      : null
  const pace = (speed: number | null | undefined) =>
    speed != null && speed > 0
      ? `${formatSignalClock((swim ? 100 : 1609.344) / speed)} /${swim ? "100 yd" : "mi"}`
      : null
  const speed = (value: number | null | undefined) =>
    number(value == null ? null : value * 2.2369362921, "mi/h", 1)
  const time = (seconds: number | null | undefined) =>
    seconds != null && Number.isFinite(seconds)
      ? formatSignalClock(seconds)
      : null
  const rows: Array<[string, string | null]> =
    track === "pace"
      ? [
          ["Avg pace", pace(data.average_speed)],
          ["Max pace", pace(data.max_speed)],
          ["Moving time", time(data.duration_seconds)],
          ["Elapsed time", time(data.elapsed_time_seconds)],
          ["Elapsed pace", pace(data.elapsed_speed)],
        ]
      : track === "speed"
        ? [
            ["Avg speed", speed(data.average_speed)],
            ["Max speed", speed(data.max_speed)],
            ["Moving time", time(data.duration_seconds)],
            ["Elapsed time", time(data.elapsed_time_seconds)],
          ]
        : track === "heartRate"
          ? [
              ["Avg heart rate", number(data.average_hr, "bpm")],
              ["Max heart rate", number(data.max_hr, "bpm")],
            ]
          : track === "cadence"
            ? [
                [
                  swim ? "Avg stroke rate" : "Avg cadence",
                  number(
                    data.average_cadence,
                    swim ? "strokes/min" : run ? "spm" : "rpm"
                  ),
                ],
                [
                  swim ? "Max stroke rate" : "Max cadence",
                  number(
                    data.max_cadence,
                    swim ? "strokes/min" : run ? "spm" : "rpm"
                  ),
                ],
              ]
            : track === "power"
              ? [
                  ["Avg power", number(data.average_power, "W")],
                  ["Total work", number(data.work_kj, "kJ", 1)],
                  ["Max power", number(data.max_power, "W")],
                  [
                    "Weighted avg power (NP)",
                    number(data.normalized_power, "W"),
                  ],
                  ["Training load", number(data.tss, "TSS")],
                  [
                    "Intensity",
                    number(
                      data.intensity_factor == null
                        ? null
                        : data.intensity_factor * 100,
                      "%",
                      1
                    ),
                  ],
                ]
              : [
                  ["Calories", number(data.calories, "Cal")],
                  [
                    "Elevation gain",
                    number(
                      data.elevation_gain == null
                        ? null
                        : data.elevation_gain / 0.3048,
                      "ft"
                    ),
                  ],
                  [
                    "Elevation loss",
                    number(
                      data.elevation_loss == null
                        ? null
                        : data.elevation_loss / 0.3048,
                      "ft"
                    ),
                  ],
                ]
  const visible =
    track === "totals" ? rows.filter((row) => row[1] != null) : rows
  if (!visible.length) return null
  const title: Record<string, string> = {
    totals: "Workout",
    heartRate: "Heart rate",
    cadence: "Cadence",
    pace: "Pace",
    speed: "Speed",
    power: "Power",
  }
  return (
    <dl
      aria-label={`${title[track] || track} statistics`}
      className="space-y-5 py-5 md:hidden"
    >
      {visible.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="text-right text-base font-semibold tabular-nums">
            {value ?? "—"}
          </dd>
        </div>
      ))}
    </dl>
  )
}
