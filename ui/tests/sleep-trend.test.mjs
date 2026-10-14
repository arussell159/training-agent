import test from "node:test"
import assert from "node:assert/strict"
import { recoverySeries } from "../src/lib/dashboard-metrics.ts"

const context = (wellness_history) => ({ history: [], wellness_history })

test("sleep duration accepts recorded seconds or hours without treating missing values as zero", () => {
  const data = recoverySeries(
    context([
      { date: "2026-10-01", sleepSecs: 27000 },
      { id: "2026-10-02", sleep: 28800 },
      { date: "2026-10-03", sleepSecs: null, sleep_hours: 6.5 },
      { date: "2026-10-04", sleepScore: 80 },
      { date: "2026-10-05", sleepSecs: NaN },
      { date: "2026-10-06", sleep: -1 },
      { date: "2026-10-07", sleep_hours: Infinity },
    ]),
    "sleep"
  )
  assert.deepEqual(
    data.map(({ date, value }) => ({ date, value })),
    [
      { date: "2026-10-01", value: 450 },
      { date: "2026-10-02", value: 480 },
      { date: "2026-10-03", value: 390 },
    ]
  )
})

test("missing sleep nights do not extend the trend beyond the HRV/RHR period", () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    hrv: 55,
    restingHR: 48,
    sleepSecs: index === 28 ? null : 27000,
  }))
  const source = context(rows)
  const hrv = recoverySeries(source, "hrv")
  const rhr = recoverySeries(source, "resting_hr")
  const sleep = recoverySeries(source, "sleep")
  assert.equal(sleep.length, 13)
  assert.equal(sleep[0].date, hrv[0].date)
  assert.equal(sleep.at(-1).date, rhr.at(-1).date)
  assert.ok(!sleep.some((point) => point.date === "2026-09-29"))
})

test("sleep average uses calendar days, keeps prior warmup readings, and honors recorded zero", () => {
  const data = recoverySeries(
    context([
      { date: "2026-10-01", sleepSecs: 36000 },
      { date: "2026-10-08", sleepSecs: 21600, hrv: 55 },
      { date: "2026-10-10", sleepSecs: 28800, hrv: 55 },
      { date: "2026-10-11", sleepSecs: 0, hrv: 55 },
    ]),
    "sleep"
  )
  assert.equal(data[0].average, 360)
  assert.equal(data[1].average, 420)
  assert.equal(data[1].baselineLow, 315)
  assert.equal(data[1].baselineHigh, 525)
  assert.equal(data.at(-1).value, 0)
  assert.deepEqual(recoverySeries(context([]), "sleep"), [])
})
