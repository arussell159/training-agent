import test from "node:test"
import assert from "node:assert/strict"
import { recoveryTrendGeometry } from "../src/lib/recovery-trend.ts"

const point = (value, day = 1) => ({
  date: `2026-10-${String(day).padStart(2, "0")}`,
  value,
  average: value - 1,
  baselineLow: value - 5,
  baselineHigh: value + 5,
})

test("recovery trend handles empty, flat, and single-day histories", () => {
  assert.deepEqual(recoveryTrendGeometry([]), {
    points: [],
    daily: "",
    average: "",
    band: "",
  })
  const single = recoveryTrendGeometry([point(0)])
  assert.equal(single.points[0].x, 160)
  assert.equal(single.band, "")
  for (const values of [[point(60), point(60, 2)], [point(0)]]) {
    const chart = recoveryTrendGeometry(values)
    assert.ok(!/NaN|Infinity/.test(chart.daily + chart.average + chart.band))
    assert.ok(chart.points.every((p) => p.y >= 8 && p.y <= 92))
  }
})

test("today's value changes the scale without inventing a historical reading", () => {
  const values = [point(40), point(45, 2)]
  const normal = recoveryTrendGeometry(values)
  const elevated = recoveryTrendGeometry(values, 100)
  assert.equal(elevated.points.length, 2)
  assert.ok(elevated.points[1].y > normal.points[1].y)
  assert.equal(elevated.points[1].value, 45)
})

test("invalid readings cannot produce invalid SVG geometry", () => {
  const chart = recoveryTrendGeometry([
    point(50),
    point(NaN, 2),
    { ...point(55, 3), baselineHigh: Infinity },
  ])
  assert.equal(chart.points.length, 1)
  assert.equal(chart.points[0].value, 50)
  assert.ok(!/NaN|Infinity/.test(chart.daily + chart.average + chart.band))
})

test("smooth recovery lines do not overshoot measured peaks and troughs", () => {
  const chart = recoveryTrendGeometry([10, 20, 80, 30, 30, 40, 5].map(point))
  const segments = [
    ...chart.daily.matchAll(
      /C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/g
    ),
  ]
  assert.equal(segments.length, chart.points.length - 1)
  for (let index = 0; index < segments.length; index++) {
    const from = chart.points[index].y,
      to = chart.points[index + 1].y
    const control1 = Number(segments[index][2]),
      control2 = Number(segments[index][4])
    for (let step = 0; step <= 20; step++) {
      const t = step / 20,
        u = 1 - t
      const y =
        u ** 3 * from +
        3 * u ** 2 * t * control1 +
        3 * u * t ** 2 * control2 +
        t ** 3 * to
      assert.ok(
        y >= Math.min(from, to) - 0.01 && y <= Math.max(from, to) + 0.01
      )
    }
  }
})
