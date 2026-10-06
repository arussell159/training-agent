import test from "node:test"
import assert from "node:assert/strict"
import {
  createRouteCursorIndex,
  nearestRouteCursorPoint,
} from "../src/lib/route-cursor.ts"

const location = (time, latitude = 30, longitude = -95) => ({
  time,
  latitude,
  longitude,
})

test("cursor locations use recorded GPS only and never mutate the recording", () => {
  const recording = [
    location(20),
    location(0),
    location(10),
    { time: 15, latitude: null, longitude: null },
    location(25, 86),
    location(30, 30, 181),
    location(NaN),
    location(40, Infinity),
    location(50, 30, NaN),
  ]
  const original = recording.slice()
  const index = createRouteCursorIndex(recording)
  assert.deepEqual(
    index.map((point) => point.time),
    [0, 10, 20]
  )
  assert.deepEqual(recording, original)
  assert.notEqual(index[0], recording[1])
})

test("hover picks the nearest recorded timestamp and clamps at route endpoints", () => {
  const index = createRouteCursorIndex([
    location(0),
    location(10),
    location(60),
  ])
  assert.equal(nearestRouteCursorPoint(index, -5), index[0])
  assert.equal(nearestRouteCursorPoint(index, 10), index[1])
  assert.equal(nearestRouteCursorPoint(index, 11), index[1])
  assert.equal(nearestRouteCursorPoint(index, 36), index[2])
  assert.equal(nearestRouteCursorPoint(index, 100), index[2])
  assert.equal(nearestRouteCursorPoint(index, 5), index[0])
})

test("leaving a chart, missing GPS and invalid cursors clear the location", () => {
  const index = createRouteCursorIndex([location(0)])
  assert.equal(nearestRouteCursorPoint(index, null), null)
  assert.equal(nearestRouteCursorPoint(index, NaN), null)
  assert.equal(nearestRouteCursorPoint(index, Infinity), null)
  assert.equal(nearestRouteCursorPoint([], 10), null)
})

test("duplicate timestamps and large recordings keep hover lookups bounded", () => {
  const duplicates = createRouteCursorIndex([
    location(10, 30),
    location(10, 31),
  ])
  assert.equal(nearestRouteCursorPoint(duplicates, 10), duplicates[0])
  const points = Array.from({ length: 100000 }, (_, time) => location(time))
  let reads = 0
  const indexed = new Proxy(points, {
    get(target, property) {
      if (/^\d+$/.test(String(property))) reads += 1
      return Reflect.get(target, property)
    },
  })
  assert.equal(nearestRouteCursorPoint(indexed, 54321.8), points[54322])
  assert.ok(reads <= 20, `Expected a binary lookup, got ${reads} point reads`)
})
