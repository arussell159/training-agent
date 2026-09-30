import test from "node:test"
import assert from "node:assert/strict"
import {
  prepareReplayRoute,
  replayFrame,
  replayBearing,
} from "../src/lib/route-replay.ts"

const point = (time, longitude, values = {}) => ({
  time,
  latitude: 30,
  longitude,
  ...values,
})
test("playback interpolates by recorded elapsed time, not sample index", () => {
  const route = prepareReplayRoute(
    [
      point(20, -95, { distance: 50, elevation: 10, speed: 2 }),
      point(30, -94.99, { distance: 150, elevation: 20, speed: 4 }),
      point(120, -94.9, { distance: 1050, elevation: 30, speed: 6 }),
    ],
    true
  )
  const frame = replayFrame(route, 0.1)
  assert.equal(route.duration, 100)
  assert.equal(frame.longitude, -94.99)
  assert.equal(frame.distance, 100)
  assert.equal(frame.speed, 4)
  assert.equal(replayFrame(route, 1).distance, 1000)
})
test("invalid GPS and non-increasing timestamps cannot corrupt replay", () => {
  const input = [
    point(1, -95, { latitude: null, distance: 100 }),
    point(10, -95, { distance: 200 }),
    point(10, -90),
    point(9, -85),
    point(20, -94.99, { distance: 300 }),
    point(30, 181),
  ]
  const route = prepareReplayRoute(input, true)
  assert.equal(route.points.length, 2)
  assert.equal(route.points[0].distance, 0)
  assert.equal(replayFrame(route, 1).distance, 100)
  assert.equal(input[1].distance, 200)
})
test("geometry-only previews use distance and never fabricate speed or elevation", () => {
  const route = prepareReplayRoute(
    [
      point(0, -95, { speed: 5, elevation: 30 }),
      point(1, -94.99),
      point(2, -94.9),
    ],
    false
  )
  const frame = replayFrame(route, 0.5)
  assert.equal(route.timed, false)
  assert.ok(Math.abs(frame.longitude + 94.95) < 0.0001)
  assert.equal(frame.speed, null)
  assert.equal(frame.elevation, null)
  assert.ok(frame.distance > 4000)
})
test("date-line crossings follow the short path", () => {
  const route = prepareReplayRoute([point(0, 179.9), point(60, -179.9)], true)
  assert.ok(Math.abs(replayFrame(route, 0.5).longitude - 180) < 0.0001)
  assert.ok(route.distances[1] < 20000)
  assert.ok(replayBearing(route.points[0], route.points[1]) > 0)
})
test("missing signals stay missing and endpoints clamp safely", () => {
  const route = prepareReplayRoute(
    [
      point(10, -95, { speed: null, elevation: 0 }),
      point(20, -94.9, { speed: 4, elevation: 10 }),
    ],
    true
  )
  assert.equal(replayFrame(route, 0.5).speed, null)
  assert.equal(replayFrame(route, 0.5).elevation, 5)
  assert.equal(replayFrame(route, -3).time, 0)
  assert.equal(replayFrame(route, 7).time, 10)
  assert.equal(replayFrame(route, NaN).time, 0)
  assert.equal(replayFrame(prepareReplayRoute([], true), 0), null)
})
test("stationary and reset-distance recordings remain finite", () => {
  const stationary = prepareReplayRoute([point(0, -95), point(1, -95)], false)
  assert.equal(replayFrame(stationary, 0.5).distance, 0)
  const reset = prepareReplayRoute(
    [point(0, -95, { distance: 100 }), point(10, -94.99, { distance: 0 })],
    true
  )
  assert.ok(replayFrame(reset, 1).distance > 900)
})
