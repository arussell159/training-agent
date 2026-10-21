import test from "node:test"
import assert from "node:assert/strict"
import {
  aggregateMacronutrients,
  newMacronutrientSettings,
  validMacronutrientSettings,
} from "../src/lib/dashboard-macronutrients.ts"

const range = { start: "2026-10-19", end: "2026-10-20" }
const meals = [
  { id: "2026-10-19", carbohydrates: 20, protein: 10, fatTotal: 10 },
  { id: "2026-10-20", carbohydrates: 30, protein: 5, fatTotal: 0 },
]
test("daily native gram totals use declared 4/4/9 energy and retain exact sources", () => {
  const original = structuredClone(meals),
    rows = aggregateMacronutrients(meals, range, "day")
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0].grams, {
    carbohydrates: 20,
    protein: 10,
    fatTotal: 10,
  })
  assert.deepEqual(rows[0].calories, {
    carbohydrates: 80,
    protein: 40,
    fatTotal: 90,
  })
  assert.equal(rows[0].totalCalories, 210)
  assert.ok(Math.abs(rows[0].percentages.fatTotal - 300 / 7) < 1e-12)
  assert.equal(rows[0].sources[0].date, meals[0].id)
  assert.deepEqual(meals, original)
})
test("weekly percent uses energy of recorded totals rather than averaging daily percentages", () => {
  const [row] = aggregateMacronutrients(meals, range, "week")
  assert.equal(row.key, "2026-10-19")
  assert.equal(row.totalCalories, 350)
  assert.deepEqual(row.grams, { carbohydrates: 50, protein: 15, fatTotal: 10 })
  assert.deepEqual(row.calories, {
    carbohydrates: 200,
    protein: 60,
    fatTotal: 90,
  })
  assert.ok(Math.abs(row.percentages.carbohydrates - 400 / 7) < 1e-12)
  assert.equal(row.recordedDays, 2)
  assert.equal(row.calendarDays, 2)
  assert.equal(row.incomplete, false)
})
test("explicit zero nutrition remains recorded, with percentages unavailable for zero calories", () => {
  const [row] = aggregateMacronutrients(
    [{ date: range.start, carbohydrates: 0, protein: 0, fatTotal: 0 }],
    { start: range.start, end: range.start },
    "day"
  )
  assert.equal(row.recordedDays, 1)
  assert.equal(row.totalCalories, 0)
  assert.deepEqual(row.calories, { carbohydrates: 0, protein: 0, fatTotal: 0 })
  assert.deepEqual(row.percentages, {
    carbohydrates: null,
    protein: null,
    fatTotal: null,
  })
})
test("missing nutrients and absent dates never become zero or a complete percentage", () => {
  const rows = aggregateMacronutrients(
    [
      { date: range.start, carbohydrates: 100, protein: 20, fatTotal: null },
      { date: range.end, carbohydrates: null, protein: 30, fatTotal: 5 },
    ],
    { start: range.start, end: "2026-10-21" },
    "day"
  )
  assert.equal(rows[0].calories.carbohydrates, 400)
  assert.equal(rows[0].calories.fatTotal, null)
  assert.equal(rows[0].totalCalories, null)
  assert.equal(rows[0].percentages.protein, null)
  assert.equal(rows[2].recordedDays, 0)
  assert.equal(rows[2].grams.protein, null)
  const [weekly] = aggregateMacronutrients(
    rows.flatMap((row) =>
      row.sources.map((source) => ({ date: source.date, ...source.grams }))
    ),
    { start: range.start, end: "2026-10-21" },
    "week"
  )
  assert.deepEqual(weekly.grams, {
    carbohydrates: null,
    protein: 50,
    fatTotal: null,
  })
  assert.equal(weekly.totalCalories, null)
  assert.equal(weekly.recordedDays, 2)
  assert.equal(weekly.calendarDays, 3)
  assert.equal(weekly.incomplete, true)
})
test("duplicate records do not double nutrition, and conflicts stay unavailable regardless of order", () => {
  const copies = Array.from({ length: 10000 }, () => ({ ...meals[0] }))
  const [same] = aggregateMacronutrients(
    copies,
    { start: range.start, end: range.start },
    "day"
  )
  assert.equal(same.grams.carbohydrates, 20)
  assert.equal(same.recordedDays, 1)
  const conflicting = [
    meals[0],
    { ...meals[0], carbohydrates: null, protein: 11 },
  ]
  const [first] = aggregateMacronutrients(conflicting, range, "day")
  const [reverse] = aggregateMacronutrients(
    [...conflicting].reverse(),
    range,
    "day"
  )
  assert.deepEqual(first, reverse)
  assert.deepEqual(first.grams, {
    carbohydrates: null,
    protein: null,
    fatTotal: 10,
  })
  assert.deepEqual(first.sources[0].conflicts, ["carbohydrates", "protein"])
  assert.equal(first.totalCalories, null)
})
test("week/month grouping uses athlete calendar days across year and leap day boundaries", () => {
  const weekly = aggregateMacronutrients(
    [],
    { start: "2026-10-18", end: "2026-10-20" },
    "week"
  )
  assert.deepEqual(
    weekly.map((row) => [row.key, row.start, row.end, row.calendarDays]),
    [
      ["2026-10-12", "2026-10-18", "2026-10-18", 1],
      ["2026-10-19", "2026-10-19", "2026-10-20", 2],
    ]
  )
  const leap = aggregateMacronutrients(
    [],
    { start: "2024-02-28", end: "2024-03-01" },
    "month"
  )
  assert.deepEqual(
    leap.map((row) => [row.key, row.calendarDays]),
    [
      ["2024-02-01", 2],
      ["2024-03-01", 1],
    ]
  )
  const year = aggregateMacronutrients(
    [],
    { start: "2025-12-31", end: "2026-01-01" },
    "month"
  )
  assert.deepEqual(
    year.map((row) => row.key),
    ["2025-12-01", "2026-01-01"]
  )
})
test("invalid native values, conflicting dates and rows outside the range cannot invent nutrition", () => {
  const rows = aggregateMacronutrients(
    [
      { id: "2026-10-18", carbohydrates: 100 },
      { date: range.start, id: range.end, carbohydrates: 100 },
      {
        date: range.start,
        carbohydrates: "100",
        protein: -1,
        fatTotal: Infinity,
      },
      { date: "2026-02-30", carbohydrates: 100 },
      { id: range.start, calories: 2000, kcal: 1000, weight: 70 },
    ],
    range,
    "day"
  )
  assert.ok(
    rows.every((row) => row.recordedDays === 0 && row.totalCalories === null)
  )
})
test("range and payload limits fail explicitly instead of hanging or truncating", () => {
  assert.throws(
    () =>
      aggregateMacronutrients(
        [],
        { start: "2026-02-30", end: "2026-03-01" },
        "day"
      ),
    /valid nutrition/
  )
  assert.throws(
    () =>
      aggregateMacronutrients(
        [],
        { start: range.end, end: range.start },
        "day"
      ),
    /valid nutrition/
  )
  assert.throws(
    () => aggregateMacronutrients([], range, "year"),
    /valid nutrition/
  )
  assert.throws(
    () =>
      aggregateMacronutrients(
        [],
        { start: "1900-01-01", end: "2026-01-01" },
        "day"
      ),
    /10,000/
  )
  assert.throws(
    () => aggregateMacronutrients(new Array(100001), range, "day"),
    /Too many nutrition records/
  )
})
test("derived same-day evidence is bounded, ignores foreign identities and never recursively trusts nested sources", () => {
  const day = "2026-10-01",
    span = { start: day, end: day },
    valid = { date: day, id: day, carbohydrates: 50, protein: 10, fatTotal: 0 },
    row = {
      date: day,
      id: day,
      carbohydrates: 9999,
      nutrition_sources: [
        valid,
        { ...valid },
        { ...valid, date: "2026-10-02", carbohydrates: 9999 },
        { ...valid, id: "2026-10-02", carbohydrates: 9999 },
        { ...valid, carbohydrates: 9999, nutrition_sources: [valid] },
      ],
    }
  const result = aggregateMacronutrients([row], span, "day")[0]
  assert.deepEqual(result.grams, {
    carbohydrates: 50,
    protein: 10,
    fatTotal: 0,
  })
  assert.equal(result.totalCalories, 240)
  assert.deepEqual(result.sources[0].conflicts, [])
  assert.throws(
    () =>
      aggregateMacronutrients(
        [{ date: day, nutrition_sources: {} }],
        span,
        "day"
      ),
    /source records are invalid/
  )
  assert.throws(
    () =>
      aggregateMacronutrients(
        [{ date: day, nutrition_sources: new Array(100001) }],
        span,
        "day"
      ),
    /source records are invalid/
  )
  assert.equal(
    aggregateMacronutrients(
      [{ date: day, carbohydrates: 999, nutrition_sources: [] }],
      span,
      "day"
    )[0].recordedDays,
    0
  )
})

test("only actual observed nutrition settings can persist", () => {
  assert.deepEqual(newMacronutrientSettings(), {
    period: "week",
    display: "calories",
  })
  assert.equal(
    validMacronutrientSettings({ period: "month", display: "percentage" }),
    true
  )
  assert.equal(
    validMacronutrientSettings({ period: "week", display: "grams" }),
    false
  )
  assert.equal(
    validMacronutrientSettings({
      period: "week",
      display: "calories",
      sports: [],
    }),
    false
  )
})
