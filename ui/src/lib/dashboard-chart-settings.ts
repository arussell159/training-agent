export const dashboardChartDatePresets = [
  ["dashboard", "Use Dashboard Settings"],
  ["custom", "Custom dates"],
  ["through-today", "Custom date through today"],
  ["7", "Last 7 days"],
  ["14", "Last 14 days"],
  ["28", "Last 28 days"],
  ["90", "Last 90 days"],
  ["180", "Last 180 days"],
  ["365", "Last 365 days"],
  ["730", "Last 730 days"],
  ["week", "This week"],
  ["month", "This month"],
  ["year", "This year"],
  ["last-week", "Last week"],
  ["last-month", "Last month"],
  ["last-3-months", "Last 3 months"],
  ["last-year", "Last year"],
  ["last-2-years", "Last 2 years"],
  ["week-last-year", "This week last year"],
  ["month-last-year", "This month last year"],
  ["next-week", "Next week"],
  ["28+7", "Last 28 and next 7 days"],
  ["90+21", "Last 90 and next 21 days"],
  ["180+45", "Last 180 and next 45 days"],
  ["through-next-week", "Custom date through next 7 days"],
] as const
export type ChartDatePreset = (typeof dashboardChartDatePresets)[number][0]
export const dashboardChartSports = [
  "Swim",
  "Bike",
  "Run",
  "Brick",
  "Crosstrain",
  "Race",
  "Day off",
  "Mtn Bike",
  "Strength",
  "Custom",
  "XC-Ski",
  "Rowing",
  "Walk",
  "Other",
] as const
export type DashboardChartSport = (typeof dashboardChartSports)[number]
export type DashboardChartRange = { start: string; end: string }
export type DashboardChartSettings = DashboardChartRange & {
  title: string
  sports: DashboardChartSport[]
  preset: ChartDatePreset
  period: "day" | "week"
  showAverage: boolean
}
const dayMs = 86_400_000
const key = (date: Date) => date.toISOString().slice(0, 10)
const date = (value: string) => new Date(`${value}T12:00:00Z`)
const shift = (value: string, days: number) =>
  key(new Date(+date(value) + days * dayMs))
const month = (value: string, offset = 0) => {
  const next = date(`${value.slice(0, 7)}-01`)
  next.setUTCMonth(next.getUTCMonth() + offset)
  return key(next)
}
const monday = (value: string) =>
  shift(value, -((date(value).getUTCDay() + 6) % 7))
export const validDashboardDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(+date(value)) &&
  key(date(value)) === value
export function dashboardRangeError(range: DashboardChartRange): string {
  if (!validDashboardDate(range.start) || !validDashboardDate(range.end))
    return "Choose valid start and end dates."
  if (range.start > range.end)
    return "The start date must be on or before the end date."
  if (+date(range.end) - +date(range.start) > 36_600 * dayMs)
    return "Choose a date range of at most 100 years."
  return ""
}
export function resolveDashboardChartRange(
  settings: Pick<DashboardChartSettings, "preset" | "start" | "end">,
  today: string,
  dashboard: DashboardChartRange
): DashboardChartRange {
  if (!validDashboardDate(today))
    throw Error("The athlete date is unavailable.")
  const { preset } = settings
  if (!dashboardChartDatePresets.some(([id]) => id === preset))
    throw Error("Choose a supported chart date range.")
  const thisMonth = month(today),
    thisWeek = monday(today),
    year = date(today).getUTCFullYear()
  let result: DashboardChartRange
  if (preset === "dashboard") result = { ...dashboard }
  else if (preset === "custom")
    result = { start: settings.start, end: settings.end }
  else if (preset === "through-today" || preset === "through-next-week")
    result = {
      start: settings.start,
      end: shift(today, preset === "through-today" ? 0 : 7),
    }
  else if (/^\d+$/.test(preset))
    result = { start: shift(today, 1 - Number(preset)), end: today }
  else if (preset.includes("+")) {
    const [past, future] = preset.split("+").map(Number)
    result = { start: shift(today, 1 - past), end: shift(today, future) }
  } else if (
    preset === "week" ||
    preset === "last-week" ||
    preset === "next-week" ||
    preset === "week-last-year"
  ) {
    const offset =
      preset === "last-week"
        ? -7
        : preset === "next-week"
          ? 7
          : preset === "week-last-year"
            ? -364
            : 0
    const start = shift(thisWeek, offset)
    result = { start, end: shift(start, 6) }
  } else if (
    preset === "month" ||
    preset === "last-month" ||
    preset === "last-3-months" ||
    preset === "month-last-year"
  ) {
    const first =
      preset === "last-month"
        ? -1
        : preset === "last-3-months"
          ? -3
          : preset === "month-last-year"
            ? -12
            : 0
    const afterLast = preset === "last-3-months" ? 0 : first + 1
    result = {
      start: month(thisMonth, first),
      end: shift(month(thisMonth, afterLast), -1),
    }
  } else if (
    preset === "year" ||
    preset === "last-year" ||
    preset === "last-2-years"
  ) {
    const startYear =
      preset === "year" ? year : preset === "last-year" ? year - 1 : year - 2
    result = {
      start: `${startYear}-01-01`,
      end: `${preset === "year" ? year : year - 1}-12-31`,
    }
  } else throw Error("Choose a supported chart date range.")
  const problem = dashboardRangeError(result)
  if (problem) throw Error(problem)
  return result
}
export function validDashboardChartSettings(
  value: unknown
): value is DashboardChartSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const settings = value as DashboardChartSettings
  return (
    typeof settings.title === "string" &&
    settings.title.length <= 500 &&
    Array.isArray(settings.sports) &&
    settings.sports.length <= dashboardChartSports.length &&
    new Set(settings.sports).size === settings.sports.length &&
    settings.sports.every((sport) => dashboardChartSports.includes(sport)) &&
    dashboardChartDatePresets.some(([id]) => id === settings.preset) &&
    (settings.period === "day" || settings.period === "week") &&
    typeof settings.showAverage === "boolean" &&
    !dashboardRangeError(settings)
  )
}
