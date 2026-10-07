import assert from "node:assert/strict"
import { test } from "node:test"
import { validHistoryDay, validatedHistoryWeeks } from "../src/lib/training-history-view.ts"

const weeks = () => Array.from({ length: 12 }, (_, index) => {
  const date = new Date("2026-07-20T12:00:00Z")
  date.setUTCDate(date.getUTCDate() + index * 7)
  const totals = () => ({ hours: index / 2, distanceMeters: index * 1000, elevationMeters: index * 10 })
  return { week: date.toISOString().slice(0, 10), all: totals(), run: totals(), bike: totals(), swim: totals() }
})

test("complete compact history preserves all twelve dated sport totals", () => {
  const source = weeks()
  assert.deepEqual(validatedHistoryWeeks(source), source)
  assert.notEqual(validatedHistoryWeeks(source)?.[0], source[0])
})

test("incomplete and malformed history can fall back to training context", () => {
  for (const source of [null, {}, [], weeks().slice(0, 11), [...weeks(), weeks()[0]], Array(12).fill(null)]) {
    assert.equal(validatedHistoryWeeks(source), null)
  }
  const missingSport = weeks()
  delete missingSport[3].run
  assert.equal(validatedHistoryWeeks(missingSport), null)
})

test("invalid calendar days cannot reach date formatting", () => {
  for (const value of [undefined, "2026-99-99", "2026-02-29", "2026-02-31", "invalid"]) assert.equal(validHistoryDay(value), false)
  assert.equal(validHistoryDay("2024-02-29"), true)
  assert.equal(validHistoryDay("2026-10-06"), true)
})

test("duplicate, unordered and discontinuous weeks cannot mislabel the chart", () => {
  for (const order of [[1, 0], [0, 0], [0, 2]]) {
    const source = weeks()
    source[0] = weeks()[order[0]]
    source[1] = weeks()[order[1]]
    assert.equal(validatedHistoryWeeks(source), null)
  }
  const notMonday = weeks()
  notMonday[0].week = "2026-07-21"
  assert.equal(validatedHistoryWeeks(notMonday), null)
})

test("invalid totals cannot inject NaN, Infinity or negative chart bounds", () => {
  for (const value of [-1, NaN, Infinity, "2", null]) {
    const source = weeks()
    source[5].bike.distanceMeters = value
    assert.equal(validatedHistoryWeeks(source), null)
  }
})
