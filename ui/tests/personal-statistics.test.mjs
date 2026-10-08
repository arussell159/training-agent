import test from "node:test"
import assert from "node:assert/strict"
import {
  bestCurveEffort,
  formatEffortPace,
  formatEffortTime,
  normalizedPersonalStatistics,
  personalBestWindow,
  samePersonalBestWindow,
  validPerformanceDate,
} from "../src/lib/personal-statistics.ts"
import { curveBestEfforts } from "../../app-backend/lib/performance-curves.mjs"

globalThis.fetch = () => { throw new Error("Unexpected network request in personal-statistics tests") }

const record = (overrides = {}) => ({
  id: "i101", date: "2026-10-05", sport: "Run", name: "Synthetic fixture run",
  distance_meters: 6000, duration_seconds: 1800, elevation_meters: 20,
  ...overrides,
})
const power = (overrides = {}) => ({
  sport: "Bike", kind: "power", duration_seconds: 60, distance_meters: null,
  value: 420, unit: "watts", activity_id: "i102", date: "2026-10-04", name: "Synthetic fixture ride", estimated: false,
  ...overrides,
})
const pace = (overrides = {}) => ({
  sport: "Run", kind: "pace", duration_seconds: 1000, distance_meters: 5000,
  value: 5, unit: "m/s", activity_id: "i101", date: "2026-10-05", name: "Synthetic fixture run", estimated: false,
  ...overrides,
})
const payload = (overrides = {}) => ({
  records: [record()], today: "2026-10-08", source: "intervals", synced_at: "2026-10-08T12:00:00Z",
  bestEfforts: [], bestEffortsWindow: { oldest: null, newest: "2026-10-08" },
  ...overrides,
})

test("activity averages and achievement flags never create a personal best", () => {
  const data = normalizedPersonalStatistics(payload({ records: [record({
    achievements: [{ type: "BEST_PACE", distance: 5000, secs: 700 }, { type: "BEST_POWER", secs: 60, watts: 999 }],
  })] }))
  assert.equal(data.records.length, 1)
  assert.equal(data.records[0].duration_seconds, 1800)
  assert.deepEqual(data.bestEfforts, [])
  assert.equal(bestCurveEffort(data.bestEfforts, "Run", 5000), null)
  assert.throws(() => normalizedPersonalStatistics(payload({ source: "local-placeholder" })), /invalid performance statistics/)
})

test("actual power and pace curve rows retain values, precision, origin and provider W/kg", () => {
  const data = normalizedPersonalStatistics(payload({ bestEfforts: [power({ watts_per_kg: 5.25 }), pace({ duration_seconds: 1000.4 })] }))
  const bike = bestCurveEffort(data.bestEfforts, "Bike", 60)
  assert.equal(bike.value, 420)
  assert.equal(bike.watts_per_kg, 5.25)
  assert.equal(bike.activity_id, "i102")
  const run = bestCurveEffort(data.bestEfforts, "Run", 5000)
  assert.equal(run.duration_seconds, 1000.4)
  assert.equal(formatEffortTime(run.duration_seconds), "16:40")
  assert.equal(formatEffortPace(run), "5:22/mi")
  const withoutWeight = normalizedPersonalStatistics(payload({ bestEfforts: [power()] }))
  assert.equal(withoutWeight.bestEfforts[0].watts_per_kg, null)
})

test("the real native curve adapter contract normalizes without achievement flags or activity averages", () => {
  const bestEfforts = [
    ...curveBestEfforts({ curve: { secs: [5, 60], values: [0, 420], watts_per_kg: [0, 5.25] }, activities: {} }, "Ride"),
    ...curveBestEfforts({ curve: { distance: [400, 800, 1500, 1609, 3000], values: [70, 150, 300, 320, 650] }, activities: {} }, "Run"),
    ...curveBestEfforts({ curve: { distance: [100, 400], values: [90, 380] }, activities: {} }, "Swim"),
  ]
  const data = normalizedPersonalStatistics(payload({ bestEfforts }))
  assert.equal(bestCurveEffort(data.bestEfforts, "Bike", 5).value, 0)
  assert.equal(bestCurveEffort(data.bestEfforts, "Bike", 60).watts_per_kg, 5.25)
  assert.equal(bestCurveEffort(data.bestEfforts, "Run", 800).duration_seconds, 150)
  assert.equal(bestCurveEffort(data.bestEfforts, "Run", 1500).duration_seconds, 300)
  assert.equal(bestCurveEffort(data.bestEfforts, "Run", 3000).duration_seconds, 650)
  assert.equal(bestCurveEffort(data.bestEfforts, "Run", 1609.344).distance_meters, 1609)
  assert.equal(formatEffortTime(bestCurveEffort(data.bestEfforts, "Swim", 400).duration_seconds), "6:20")
})

test("provider explicit zero power and W/kg remain known, while pace zero stays unavailable", () => {
  const data = normalizedPersonalStatistics(payload({ bestEfforts: [power({ value: 0, watts_per_kg: 0 }), pace({ value: 0 })] }))
  assert.equal(data.bestEfforts.length, 1)
  assert.equal(bestCurveEffort(data.bestEfforts, "Bike", 60).value, 0)
  assert.equal(bestCurveEffort(data.bestEfforts, "Bike", 60).watts_per_kg, 0)
})

test("explicit server preview fixtures retain their source without becoming a production error fallback", () => {
  const data = normalizedPersonalStatistics(payload({ source: "synthetic-local-preview", bestEfforts: [power()] }))
  assert.equal(data.source, "synthetic-local-preview")
  assert.equal(data.bestEfforts[0].value, 420)
})

test("missing anchors stay missing rather than borrowing nearby durations or distances", () => {
  const data = normalizedPersonalStatistics(payload({ bestEfforts: [power({ duration_seconds: 59 }), pace({ distance_meters: 4999 })] }))
  assert.equal(bestCurveEffort(data.bestEfforts, "Bike", 60), null)
  assert.equal(bestCurveEffort(data.bestEfforts, "Run", 5000), null)
})

test("nominal converted anchors use the provider's original distance and elapsed time", () => {
  const data = normalizedPersonalStatistics(payload({ bestEfforts: [pace({
    distance_meters: 1609, requested_distance_meters: 1609.344, duration_seconds: 320, value: 1609 / 320,
  })] }))
  const effort = bestCurveEffort(data.bestEfforts, "Run", 1609.344)
  assert.equal(effort.distance_meters, 1609)
  assert.equal(effort.duration_seconds, 320)
  assert.equal(formatEffortTime(effort.duration_seconds), "5:20")
  assert.equal(formatEffortPace(effort), "5:20/mi")
})

test("sport-specific best selection chooses only actual efforts at the same anchor", () => {
  const data = normalizedPersonalStatistics(payload({ bestEfforts: [
    power(), power({ value: 450 }), pace(), pace({ value: 5.5 }),
    pace({ sport: "Swim", distance_meters: 400, duration_seconds: 300, value: 400 / 300 }),
  ] }))
  assert.equal(bestCurveEffort(data.bestEfforts, "Bike", 60).value, 450)
  assert.equal(bestCurveEffort(data.bestEfforts, "Run", 5000).value, 5.5)
  assert.equal(bestCurveEffort(data.bestEfforts, "Run", 400), null)
  assert.equal(bestCurveEffort(data.bestEfforts, "Swim", 400).duration_seconds, 300)
})

test("selected date windows filter curves while all activity statistics stay complete", () => {
  const data = normalizedPersonalStatistics(payload({
    records: [record(), record({ id: "i100", date: "2025-01-01" })],
    bestEffortsWindow: { oldest: "2026-10-01", newest: "2026-10-07" },
    bestEfforts: [pace(), pace({ date: "2026-09-30", value: 7 }), power({ date: "2026-10-08" }), power({ date: null })],
  }))
  assert.equal(data.records.length, 2)
  assert.equal(data.bestEfforts.length, 2)
  assert.equal(bestCurveEffort(data.bestEfforts, "Run", 5000).value, 5)
  assert.equal(bestCurveEffort(data.bestEfforts, "Bike", 60).date, null)
  assert.equal(samePersonalBestWindow(data.bestEffortsWindow, { oldest: null, newest: "2026-10-08" }), false)
})

test("calendar ranges include both endpoint days and reject corrupt, future or reversed custom dates", () => {
  assert.deepEqual(personalBestWindow("all", "2026-10-08"), { oldest: null, newest: "2026-10-08" })
  assert.deepEqual(personalBestWindow("recent", "2026-10-08"), { oldest: "2026-09-11", newest: "2026-10-08" })
  assert.deepEqual(personalBestWindow("year", "2026-10-08"), { oldest: "2026-01-01", newest: "2026-10-08" })
  assert.deepEqual(personalBestWindow("custom", "2026-10-08", { oldest: "2024-02-29", newest: "2024-02-29" }), { oldest: "2024-02-29", newest: "2024-02-29" })
  for (const custom of [
    { oldest: "2026-02-31", newest: "2026-10-08" },
    { oldest: "2026-10-07", newest: "2026-10-06" },
    { oldest: "2026-10-07", newest: "2026-10-09" },
  ]) assert.equal(personalBestWindow("custom", "2026-10-08", custom), null)
  assert.equal(validPerformanceDate("2025-02-29"), false)
  assert.equal(validPerformanceDate("2024-02-29"), true)
})

test("malformed curve rows and fabricated estimates cannot produce visible PB values", () => {
  const invalid = [
    power({ estimated: true }), power({ unit: "m/s" }), power({ value: NaN }), power({ value: "450" }),
    power({ duration_seconds: Infinity }), power({ duration_seconds: 0 }), power({ value: -1 }),
    pace({ sport: "Other" }), pace({ distance_meters: null }), pace({ value: 0 }), pace({ duration_seconds: null }),
    pace({ value: Number.MIN_VALUE, distance_meters: Number.MAX_VALUE }), [], null,
  ]
  const data = normalizedPersonalStatistics(payload({ bestEfforts: [...invalid, pace()] }))
  assert.equal(data.bestEfforts.length, 1)
  assert.equal(data.bestEfforts[0].sport, "Run")
})

test("malformed curve windows preserve real activity totals and surface an independent curve error", () => {
  const data = normalizedPersonalStatistics(payload({ bestEfforts: [pace()], bestEffortsWindow: { oldest: "2026-02-31", newest: "2026-10-08" } }))
  assert.equal(data.records.length, 1)
  assert.deepEqual(data.bestEfforts, [])
  assert.match(data.bestEffortsError, /invalid personal-best date range/)
})

test("partial curve failures retain successful sport bests and existing activity records", () => {
  const data = normalizedPersonalStatistics(payload({ bestEfforts: [power()], bestEffortsError: "Run pace curves are unavailable." }))
  assert.equal(data.records.length, 1)
  assert.equal(bestCurveEffort(data.bestEfforts, "Bike", 60).value, 420)
  assert.equal(bestCurveEffort(data.bestEfforts, "Run", 5000), null)
  assert.equal(data.bestEffortsError, "Run pace curves are unavailable.")
})

test("corrupt activity dates/numbers and duplicate IDs cannot inflate statistics or crash formatting", () => {
  const data = normalizedPersonalStatistics(payload({ records: [
    record(), record(), record({ id: "invalid-day", date: "2026-02-31" }), record({ id: "future", date: "2026-10-09" }),
    record({ id: "missing-values", duration_seconds: NaN, distance_meters: -5, elevation_meters: { value: 1 } }),
    null, [],
  ] }))
  assert.equal(data.records.length, 2)
  assert.equal(data.records[1].duration_seconds, 0)
  assert.equal(data.records[1].distance_meters, 0)
  assert.equal(data.records[1].elevation_meters, 0)
})

test("effort time preserves seconds and carries minute/hour rounding correctly", () => {
  assert.equal(formatEffortTime(5), "0:05")
  assert.equal(formatEffortTime(119.6), "2:00")
  assert.equal(formatEffortTime(3599.6), "1:00:00")
  assert.equal(formatEffortTime(NaN), "—")
  assert.equal(formatEffortTime(0), "—")
  assert.equal(formatEffortPace(pace({ sport: "Swim", value: 1.5 })), "1:01/100 yd")
  assert.equal(formatEffortPace(power()), "—")
})
