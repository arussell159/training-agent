import test from "node:test"
import assert from "node:assert/strict"
import { replayMapQuality } from "../src/lib/route-replay-map-quality.ts"

const ride = {
  distance: 180000,
  tourSeconds: 120,
  speed: 1,
  latitude: 40,
  width: 1000,
  threeD: true,
}

test("long fast tours widen coverage by actual travel rate and retain satellite camera tilt", () => {
  const normal = replayMapQuality(ride),
    fast = replayMapQuality({ ...ride, speed: 100 })
  assert.equal(normal.travelRate, 1500)
  assert.equal(fast.travelRate, 150000)
  assert.ok(fast.zoom < normal.zoom - 5)
  assert.ok(fast.pitch > 0 && fast.pitch < normal.pitch)
  assert.equal(normal.terrain, true)
  assert.equal(fast.terrain, false)
  // Equal travel rates should request the same coverage regardless of labels.
  assert.deepEqual(
    replayMapQuality({ ...ride, distance: 18000, speed: 10 }),
    normal
  )
})

test("2D skips terrain entirely and slower tours restore detailed 3D", () => {
  assert.equal(replayMapQuality({ ...ride, threeD: false }).terrain, false)
  assert.equal(replayMapQuality({ ...ride, threeD: false }).pitch, 0)
  const walking = replayMapQuality({
    ...ride,
    distance: 3000,
    tourSeconds: 60,
    speed: 1,
  })
  assert.equal(walking.terrain, true)
  assert.equal(walking.pitch, 74)
  assert.ok(walking.zoom > 14)
})

test("camera coverage scales with viewport and latitude without nonfinite zoom values", () => {
  const desktop = replayMapQuality(ride),
    phone = replayMapQuality({ ...ride, width: 320 })
  assert.ok(phone.zoom < desktop.zoom)
  const polar = replayMapQuality({ ...ride, latitude: 85 })
  assert.ok(polar.zoom < desktop.zoom)
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const quality = replayMapQuality({
      distance: invalid,
      tourSeconds: invalid,
      speed: invalid,
      latitude: invalid,
      width: invalid,
      threeD: true,
    })
    assert.ok(Number.isFinite(quality.zoom))
    assert.ok(Number.isFinite(quality.travelRate))
    assert.ok(quality.zoom >= 5 && quality.zoom <= 15.5)
  }
})
