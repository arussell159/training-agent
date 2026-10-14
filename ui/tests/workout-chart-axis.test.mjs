import { test } from "node:test"
import assert from "node:assert/strict"
import {
  recordedChartDomain,
  recordedDistanceAxis,
  smoothedChartValue,
} from "../src/lib/workout-chart-axis.ts"

test("display smoothing uses its time window and preserves gaps and the source data", () => {
  const points = [
    { time: 0, value: 10 },
    { time: 1, value: 100 },
    { time: 2, value: 10 },
    { time: 3, value: null },
    { time: 4, value: 1000 },
  ]
  const original = structuredClone(points)
  const read = (point) => point.value
  assert.equal(smoothedChartValue(points, 1, 0, read), 100)
  assert.equal(smoothedChartValue(points, 1, 4, read), 40)
  assert.equal(smoothedChartValue(points, 3, 10, read), null)
  assert.equal(smoothedChartValue(points, 4, 10, read), 1000)
  assert.deepEqual(points, original)
})

test("signal scales include zero, negative elevation and all recorded extrema", () => {
  assert.deepEqual(recordedChartDomain(147, 221), { minimum: 0, maximum: 300 })
  const negative = recordedChartDomain(-20, 66)
  assert.ok(negative.minimum <= -20 && negative.maximum >= 66)
  const pace = recordedChartDomain(360, 420, true)
  assert.ok(pace.minimum > 0 && pace.minimum <= 360 && pace.maximum >= 420)
  assert.ok(recordedChartDomain(0, 0).maximum > 0)
})
test("distance coordinates and pointer selection follow recorded changes in speed", () => {
  const axis = recordedDistanceAxis([
    { time: 0, distance: 0 },
    { time: 10, distance: 100 },
    { time: 20, distance: 120 },
    { time: 30, distance: 300 },
  ])
  assert.equal(axis.atTime(15), 110)
  assert.equal(axis.atDistance(110), 15)
  assert.equal(axis.atDistance(210), 25)
  assert.equal(axis.atTime(-10), 0)
  assert.equal(axis.atDistance(1000), 30)
})
test("stopped samples stay usable; missing, constant or backwards distance streams use time", () => {
  const axis = recordedDistanceAxis([
    { time: 0, distance: 0 },
    { time: 10, distance: 100 },
    { time: 20, distance: 100 },
    { time: 30, distance: 200 },
  ])
  assert.equal(axis.atTime(15), 100)
  assert.equal(axis.atDistance(150), 25)
  for (const points of [
    [],
    [{ time: 0, distance: 0 }],
    [
      { time: 0, distance: 0 },
      { time: 10, distance: 0 },
    ],
    [
      { time: 0, distance: 100 },
      { time: 10, distance: 50 },
    ],
  ])
    assert.equal(recordedDistanceAxis(points), null)
})
