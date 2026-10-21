export type MacronutrientPeriod = "day" | "week" | "month"
export type MacronutrientSettings = {
  period: MacronutrientPeriod
  display: "calories" | "percentage"
}
export const newMacronutrientSettings = (): MacronutrientSettings => ({
  period: "week",
  display: "calories",
})
export function validMacronutrientSettings(
  value: unknown
): value is MacronutrientSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    Object.keys(row).length === 2 &&
    ["day", "week", "month"].includes(String(row.period)) &&
    ["calories", "percentage"].includes(String(row.display))
  )
}
// Native Wellness fields are daily grams. General energy conversion is 4/4/9;
// this is not a claim about TrainingPeaks' unpublished aggregation algorithm.
export const macronutrientFields = [
  {
    key: "carbohydrates",
    label: "Carbohydrates",
    caloriesPerGram: 4,
    color: "#176b91",
  },
  { key: "protein", label: "Protein", caloriesPerGram: 4, color: "#bd1818" },
  { key: "fatTotal", label: "Fat", caloriesPerGram: 9, color: "#43a2c6" },
] as const
export type MacronutrientKey = (typeof macronutrientFields)[number]["key"]
type Totals = Record<MacronutrientKey, number | null>
export type NutritionDay = {
  date: string
  grams: Totals
  conflicts: MacronutrientKey[]
}
export type MacronutrientBucket = {
  key: string
  start: string
  end: string
  recordedDays: number
  calendarDays: number
  grams: Totals
  calories: Totals
  percentages: Totals
  totalCalories: number | null
  incomplete: boolean
  sources: NutritionDay[]
}
const blank = (): Totals => ({
  carbohydrates: null,
  protein: null,
  fatTotal: null,
})
const date = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const stamp = Date.parse(`${value}T12:00:00Z`)
  return (
    Number.isFinite(stamp) &&
    new Date(stamp).toISOString().slice(0, 10) === value
  )
}
const shift = (value: string, days: number) =>
  new Date(Date.parse(`${value}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10)
const known = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1_000_000
function bucketStart(value: string, period: MacronutrientPeriod) {
  if (period === "month") return value.slice(0, 7) + "-01"
  if (period === "week")
    return shift(value, -((new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7))
  return value
}
export function aggregateMacronutrients(
  history: readonly unknown[],
  range: { start: string; end: string },
  period: MacronutrientPeriod
): MacronutrientBucket[] {
  if (
    !date(range.start) ||
    !date(range.end) ||
    range.start > range.end ||
    !["day", "week", "month"].includes(period)
  )
    throw Error("Choose a valid nutrition date range and grouping.")
  const days =
    Math.round(
      (Date.parse(`${range.end}T12:00:00Z`) -
        Date.parse(`${range.start}T12:00:00Z`)) /
        86400000
    ) + 1
  if (days > 10000)
    throw Error("Choose a nutrition range of at most 10,000 days.")
  if (history.length > 100000)
    throw Error(
      "Too many nutrition records were returned. Choose a shorter range and retry."
    )
  const sourceRows = new Map<string, Record<string, unknown>[]>()
  let sourceCount = 0
  for (const value of history) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    const row = value as Record<string, unknown>,
      day = row.date ?? row.id
    if (
      !date(day) ||
      (row.date != null && row.id != null && row.date !== row.id) ||
      day < range.start ||
      day > range.end
    )
      continue
    // Historical month merging retains one authoritative wellness snapshot,
    // with separately derived nutrition evidence. Never recursively expand it
    // or accept observations belonging to a different parent day.
    const evidence = Object.hasOwn(row, "nutrition_sources")
      ? row.nutrition_sources
      : [row]
    if (!Array.isArray(evidence) || evidence.length > 100000)
      throw Error(
        "Nutrition source records are invalid. Retry loading this range."
      )
    sourceCount += evidence.length
    if (sourceCount > 100000)
      throw Error(
        "Too many nutrition records were returned. Choose a shorter range and retry."
      )
    for (const candidate of evidence) {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      )
        continue
      const source = candidate as Record<string, unknown>
      if (
        evidence !== undefined &&
        Object.hasOwn(row, "nutrition_sources") &&
        (source.date !== day ||
          (source.id != null && source.id !== day) ||
          Object.keys(source).some(
            (key) =>
              !["date", "id", "carbohydrates", "protein", "fatTotal"].includes(
                key
              )
          ))
      )
        continue
      const existing = sourceRows.get(day)
      if (existing) existing.push(source)
      else sourceRows.set(day, [source])
    }
  }
  const nutrition = new Map<string, NutritionDay>()
  for (const [day, rows] of sourceRows) {
    const grams = blank(),
      conflicts: MacronutrientKey[] = []
    for (const { key } of macronutrientFields) {
      const candidates = rows
        .filter((row) => Object.hasOwn(row, key))
        .map((row) => row[key])
      if (!candidates.length) continue
      if (candidates.every((value) => known(value) && value === candidates[0]))
        grams[key] = candidates[0] as number
      else if (candidates.some(known)) conflicts.push(key)
    }
    if (
      macronutrientFields.some(({ key }) => grams[key] !== null) ||
      conflicts.length
    )
      nutrition.set(day, { date: day, grams, conflicts })
  }
  const buckets = new Map<string, MacronutrientBucket>()
  for (let offset = 0; offset < days; offset++) {
    const day = shift(range.start, offset),
      key = bucketStart(day, period)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        key,
        start: day,
        end: day,
        recordedDays: 0,
        calendarDays: 0,
        grams: blank(),
        calories: blank(),
        percentages: blank(),
        totalCalories: null,
        incomplete: false,
        sources: [],
      }
      buckets.set(key, bucket)
    }
    bucket.end = day
    bucket.calendarDays++
    const source = nutrition.get(day)
    if (source) bucket.sources.push(source)
  }
  for (const bucket of buckets.values()) {
    bucket.recordedDays = bucket.sources.length
    for (const { key, caloriesPerGram } of macronutrientFields) {
      if (
        bucket.recordedDays &&
        bucket.sources.every((source) => source.grams[key] !== null)
      ) {
        bucket.grams[key] = bucket.sources.reduce(
          (sum, source) => sum + source.grams[key]!,
          0
        )
        bucket.calories[key] = bucket.grams[key]! * caloriesPerGram
      }
    }
    const complete =
      bucket.recordedDays > 0 &&
      macronutrientFields.every(({ key }) => bucket.calories[key] !== null)
    bucket.incomplete =
      bucket.recordedDays > 0 &&
      (!complete || bucket.recordedDays < bucket.calendarDays)
    if (complete) {
      bucket.totalCalories = macronutrientFields.reduce(
        (sum, { key }) => sum + bucket.calories[key]!,
        0
      )
      if (bucket.totalCalories > 0)
        for (const { key } of macronutrientFields)
          bucket.percentages[key] =
            (bucket.calories[key]! / bucket.totalCalories) * 100
    }
  }
  return [...buckets.values()]
}
