import test from "node:test"
import assert from "node:assert/strict"
import {
  prepareReplayRoute,
  replayFrame,
  replayBearing,
  prepareReplayCamera,
  replayCameraBearing,
  replayTourSeconds,
  replayGeometry,
  replayTrimProgress,
} from "../src/lib/route-replay.ts"

const point = (time, longitude, values = {}) => ({
  time,
  latitude: 30,
  longitude,
  ...values,
})

test("long rides scale the tour duration instead of being compressed into a minute", () => {
  const route = prepareReplayRoute([point(0, -95), point(14400, -94)], true)
  assert.ok(replayTourSeconds(route) >= 600)
  assert.equal(
    replayTourSeconds(
      prepareReplayRoute([point(0, -95), point(60, -94.999)], true)
    ),
    60
  )
  assert.ok(
    replayTourSeconds(
      prepareReplayRoute([point(0, -95), point(1, -94)], false)
    ) > 600
  )
})

test("a 100,000-point recording has bounded geometry, exact endpoints and monotonic trim", () => {
  const route = prepareReplayRoute(
    Array.from({ length: 100000 }, (_, i) => point(i, -95 + i / 100000)),
    true
  )
  const geometry = replayGeometry(route)
  assert.ok(geometry.coordinates.length <= 6001)
  assert.deepEqual(geometry.coordinates[0], [-95, 30])
  assert.ok(
    Math.abs(geometry.coordinates.at(-1)[0] - route.points.at(-1).longitude) <
      1e-7
  )
  let previous = 0
  for (let i = 0; i <= 1000; i++) {
    const trim = replayTrimProgress(
      route,
      geometry,
      replayFrame(route, i / 1000)
    )
    assert.ok(Number.isFinite(trim) && trim >= previous && trim <= 1)
    previous = trim
  }
  assert.equal(previous, 1)
})

test("static geometry unwraps the date line and handles stationary recordings", () => {
  const route = prepareReplayRoute([point(0, 179.9), point(60, -179.9)], true)
  const geometry = replayGeometry(route)
  assert.ok(Math.abs(geometry.coordinates[1][0] - 180.1) < 1e-8)
  assert.ok(
    Math.abs(
      replayTrimProgress(route, geometry, replayFrame(route, 0.5)) - 0.5
    ) < 0.001
  )
  const still = prepareReplayRoute([point(0, -95), point(60, -95)], true)
  assert.equal(
    replayTrimProgress(still, replayGeometry(still), replayFrame(still, 0.5)),
    0
  )
})

test("very long tours retain continuous headings between camera samples", () => {
  const headings = Array.from({ length: 1201 }, (_, i) => (i / 1200) * 180)
  let previous = 0
  for (let i = 0; i <= 10000; i++) {
    const next = replayCameraBearing(headings, i / 10000, 0.5, 100000)
    assert.ok(next >= previous - 1e-9 && next - previous < 0.2)
    previous = next
  }
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

test("camera anticipates a sharp turnaround without reversing its pan", () => {
  const route = prepareReplayRoute(
    [point(0, -95), point(50, -94.99), point(100, -95)],
    true
  )
  const camera = prepareReplayCamera(route)
  const before = replayCameraBearing(camera, 0.46)
  assert.ok(before > 91, "rotation should start before the turnaround")
  assert.ok(replayCameraBearing(camera, 0.49) > 140)
  let previous = replayCameraBearing(camera, 0.4)
  for (let progress = 0.401; progress <= 0.6; progress += 0.001) {
    const next = replayCameraBearing(camera, progress)
    assert.ok(
      next >= previous - 0.01,
      "pan must not change direction at the reversal"
    )
    assert.ok(
      Math.abs(next - previous) < 5,
      "heading must not jump at the turn"
    )
    previous = next
  }
  assert.ok(Math.abs(previous - 270) < 1)
  assert.equal(
    replayFrame(route, 0.5).longitude,
    -94.99,
    "camera smoothing must not cut the recorded route corner"
  )
})

test("camera keeps a continuous bearing across compass north and during stops", () => {
  const route = prepareReplayRoute(
    [
      point(0, -95, { latitude: 30 }),
      point(40, -95.0005, { latitude: 30.01 }),
      point(60, -95.0005, { latitude: 30.01 }),
      point(100, -95, { latitude: 30.02 }),
    ],
    true
  )
  const camera = prepareReplayCamera(route)
  for (let i = 0; i <= 100; i++)
    assert.ok(Math.abs(replayCameraBearing(camera, i / 100)) < 5)
  const still = prepareReplayCamera(
    prepareReplayRoute([point(0, -95), point(60, -95)], true)
  )
  assert.equal(replayCameraBearing(still, 0.5), 0)
})

test("faster playback previews a turnaround farther in advance", () => {
  const route = prepareReplayRoute(
    [point(0, -95), point(50, -94.99), point(100, -95)],
    true
  )
  const camera = prepareReplayCamera(route)
  assert.ok(Math.abs(replayCameraBearing(camera, 0.36, 1) - 90) < 1)
  assert.ok(replayCameraBearing(camera, 0.36, 5) > 95)
})
