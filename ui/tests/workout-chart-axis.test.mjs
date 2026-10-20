import { test } from "node:test"
import assert from "node:assert/strict"
import {
  recordedChartDomain,
  recordedChartWindow,
  recordedChartSegments,
  recordedDistanceAxis,
  recordedSplitEndpointLabel,
  smoothedChartValue,
} from "../src/lib/workout-chart-axis.ts"

test("split endpoint labels preserve full miles and stop at the partial recorded finish", () => {
  const first = 125
  const axis = recordedDistanceAxis([
    { time: 0, distance: first },
    { time: 600, distance: first + 5 * 1609.344 },
    { time: 900, distance: first + 7.05 * 1609.344 },
  ])
  assert.equal(recordedSplitEndpointLabel(axis, 0), "0 mi")
  assert.equal(recordedSplitEndpointLabel(axis, 600), "5 mi")
  assert.equal(recordedSplitEndpointLabel(axis, 900), "7.05 mi")
  assert.equal(recordedSplitEndpointLabel(axis, 1200), "7.05 mi")
  assert.equal(recordedSplitEndpointLabel(null, 900), "—")
  assert.equal(recordedSplitEndpointLabel(axis, NaN), "—")
})

test("zoomed lines interpolate both boundaries without changing recorded samples", () => {
  const points = [
    { time: 60, value: 140 },
    { time: 70, value: 142 },
    { time: 80, value: 146 },
  ]
  const original = structuredClone(points)
  assert.deepEqual(
    recordedChartWindow(points, 62, 76, (p) => p.value),
    [
      { time: 62, value: 140.4 },
      { time: 70, value: 142 },
      { time: 76, value: 144.4 },
    ]
  )
  assert.deepEqual(points, original)
  assert.deepEqual(
    recordedChartWindow(points, 70, 80, (p) => p.value),
    points.slice(1)
  )
})

test("a window entirely between samples still renders edge to edge", () => {
  assert.deepEqual(
    recordedChartSegments(
      [
        { time: 0, value: 0 },
        { time: 10, value: 100 },
      ],
      2,
      8,
      (p) => p.value
    ),
    [
      [
        { time: 2, value: 20 },
        { time: 8, value: 80 },
      ],
    ]
  )
})

test("zoom boundaries never extrapolate or fill missing signals and device gaps", () => {
  const points = [
    { time: 5, value: 0 },
    { time: 10, value: null },
    { time: 15, value: 50 },
    { time: 50, value: 100 },
  ]
  for (const [start, end] of [
    [0, 4],
    [6, 9],
    [16, 49],
    [51, 60],
  ])
    assert.deepEqual(
      recordedChartSegments(points, start, end, (p) => p.value),
      []
    )
  assert.deepEqual(
    recordedChartSegments(points, 0, 60, (p) => p.value)
      .flat()
      .map((p) => p.time),
    [5, 15, 50]
  )
  assert.deepEqual(
    recordedChartWindow(points, 2, 8, (p) => p.value),
    [
      { time: 2, value: null },
      { time: 5, value: 0 },
      { time: 8, value: null },
    ]
  )
})

test("reduced zoom windows retain interpolated endpoints, zeros and short peaks", () => {
  const points = Array.from({ length: 5000 }, (_, time) => ({
    time,
    value: time === 2501 ? 1500 : time === 200 ? 0 : 100,
  }))
  const [segment] = recordedChartSegments(
    points,
    62.4,
    4096.7,
    (p) => p.value,
    80
  )
  assert.equal(segment[0].time, 62.4)
  assert.equal(segment.at(-1).time, 4096.7)
  assert.ok(segment.some((p) => p.time === 2501 && p.value === 1500))
  assert.ok(segment.some((p) => p.time === 200 && p.value === 0))
  assert.ok(segment.length <= 84)
})

test("fractional samples and distance mode retain exact selected boundaries", () => {
  const points = [
    { time: 0, value: 10, distance: 0 },
    { time: 10.0000001, value: 20, distance: 100 },
    { time: 20, value: 30, distance: 300 },
  ]
  const axis = recordedDistanceAxis(points)
  const range = [axis.atDistance(62), axis.atDistance(245)]
  const [line] = recordedChartSegments(points, ...range, (p) => p.value)
  assert.equal(axis.atTime(line[0].time), 62)
  assert.ok(Math.abs(axis.atTime(line.at(-1).time) - 245) < 1e-9)
  assert.deepEqual(
    recordedChartWindow(points, 20, 20, (p) => p.value),
    []
  )
  assert.deepEqual(
    recordedChartWindow(points, 30, 10, (p) => p.value),
    []
  )
})

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
