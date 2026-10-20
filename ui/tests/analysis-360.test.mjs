import test from "node:test"
import assert from "node:assert/strict"
import {
  analysisSelection,
  analysisRangeMetrics,
  recordedPowerCurve,
  recordedPowerSeconds,
  analysisSeriesSegments,
  analysisZoneTimes,
  validAnalysisTiles,
  defaultAnalysisTiles,
  analysisCsv,
  analysisSignalValue,
  analysisSignalStatistics,
} from "../src/lib/analysis-360.ts"

const point = (time, values = {}) => ({
  time,
  power: 200,
  heartRate: 140,
  cadence: 90,
  speed: 5,
  distance: time * 5,
  elevation: time * 0.5,
  ...values,
})
const recording = Array.from({ length: 121 }, (_, time) => point(time))
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`)

test("fractional ten-second timestamps do not create artificial gaps", () => {
  const points = Array.from({ length: 163 }, (_, index) =>
    point((index / 162) * 1620)
  )
  const metrics = analysisRangeMetrics(points, 0, 1620, 250)
  near(metrics.work, 324)
  near(metrics.moving, 1620)
  near(metrics.normalizedPower, 200)
  assert.equal(
    analysisSeriesSegments(points, "power", "Bike", 0, 1620).length,
    1
  )
  assert.ok(
    recordedPowerSeconds(points, 0, 1620).every((value) => value != null)
  )
})

test("selection normalizes reverse drags and clamps to the actual recording", () => {
  assert.deepEqual(analysisSelection(80, 20, 100), [20, 80])
  assert.deepEqual(analysisSelection(-50, 200, 100), [0, 100])
  assert.equal(analysisSelection(20, 20.5, 100), null)
  assert.equal(analysisSelection(120, 150, 100), null)
  assert.equal(analysisSelection(NaN, 20, 100), null)
})
test("range metrics use exact time bounds, consistent units and recorded power", () => {
  const metrics = analysisRangeMetrics(recording, 15, 75, 250)
  assert.equal(metrics.duration, 60)
  near(metrics.distance, 300)
  near(metrics.work, 12)
  near(metrics.normalizedPower, 200)
  near(metrics.variability, 1)
  near(metrics.intensity, 0.8)
  near(metrics.tss, (60 / 36) * 0.64)
  near(metrics.moving, 60)
  near(metrics.gain, 30)
  near(metrics.heartRate, 140)
  near(metrics.cadence, 90)
})
test("missing power and recording gaps never become zero watts or valid peak windows", () => {
  const points = [point(0), point(1), point(20), point(21)]
  const seconds = recordedPowerSeconds(points, 0, 21)
  assert.equal(seconds[0], 200)
  assert.equal(seconds[5], null)
  assert.equal(seconds[20], 200)
  const curve = recordedPowerCurve(points, 21)
  assert.equal(curve.find((row) => row.seconds === 1).watts, 200)
  assert.equal(
    curve.some((row) => row.seconds >= 2),
    false
  )
  assert.equal(analysisRangeMetrics(points, 0, 21, 250).normalizedPower, null)
})

test("force and efficiency channels use physical units and reject absent denominators", () => {
  near(
    analysisSignalValue(
      point(0, { power: 300, cadence: 90 }),
      "torque",
      "Bike"
    ),
    300 / (3 * Math.PI)
  )
  near(
    analysisSignalValue(
      point(0, { power: 200, heartRate: 100 }),
      "efficiency",
      "Bike"
    ),
    2
  )
  assert.equal(
    analysisSignalValue(point(0, { cadence: 0 }), "torque", "Bike"),
    null
  )
  assert.equal(analysisSignalValue(point(0), "torque", "Run"), null)
  assert.equal(
    analysisSignalValue(point(0, { heartRate: null }), "efficiency", "Bike"),
    null
  )
  const stats = analysisSignalStatistics(
    [
      point(0, { power: 100, heartRate: 100 }),
      point(2, { power: 300, heartRate: 100 }),
      point(5),
    ],
    0,
    5,
    "Bike"
  )
  near(stats.find((row) => row.key === "efficiency").average, 2.2)
})
test("zero power remains real coverage and contributes to peak means", () => {
  const points = [
    point(0, { power: 0 }),
    point(1, { power: 200 }),
    point(2, { power: 200 }),
  ]
  const curve = recordedPowerCurve(points, 2)
  assert.equal(curve.find((row) => row.seconds === 1).watts, 200)
  assert.equal(curve.find((row) => row.seconds === 2).watts, 100)
  assert.deepEqual(recordedPowerSeconds(points, 0, 2), [0, 200])
})

test("channel means do not treat the time inside a recording gap as measured coverage", () => {
  const points = [
    point(0, { heartRate: 100 }),
    point(1, { heartRate: 100 }),
    point(20, { heartRate: 200 }),
    point(21, { heartRate: 200 }),
  ]
  const rows = analysisSignalStatistics(points, 0, 21, "Bike")
  near(rows.find((row) => row.key === "heartRate").average, 150)
  const pace = analysisSignalStatistics(
    [point(0, { speed: 2 }), point(1, { speed: 4 }), point(2)],
    0,
    2,
    "Run"
  ).find((row) => row.key === "pace")
  near(pace.average, 1609.344 / 3)
})
test("irregular samples are weighted by covered seconds", () => {
  const points = [
    point(0, { power: 100 }),
    point(2, { power: 300 }),
    point(5, { power: 0 }),
  ]
  assert.deepEqual(
    recordedPowerSeconds(points, 0, 5),
    [100, 100, 300, 300, 300]
  )
  assert.equal(
    recordedPowerCurve(points, 5).find((row) => row.seconds === 5).watts,
    220
  )
})
test("missing channels and short NP windows remain unavailable", () => {
  const points = recording.map((row) => ({
    ...row,
    power: null,
    heartRate: null,
    cadence: null,
    speed: null,
  }))
  const metrics = analysisRangeMetrics(points, 0, 60, 250)
  assert.equal(metrics.normalizedPower, null)
  assert.equal(metrics.intensity, null)
  assert.equal(metrics.tss, null)
  assert.equal(metrics.work, null)
  assert.equal(metrics.moving, null)
  assert.deepEqual(recordedPowerCurve(points, 120), [])
  assert.equal(
    analysisRangeMetrics(recording, 0, 20, 250).normalizedPower,
    null
  )
})
test("chart reduction retains brief peaks, zeros and missing data boundaries", () => {
  const points = Array.from({ length: 5000 }, (_, time) =>
    point(time, { power: time === 1551 ? 1500 : time === 200 ? 0 : 100 })
  )
  points[3000].power = null
  const segments = analysisSeriesSegments(points, "power", "Bike", 0, 4999, 80)
  assert.equal(segments.length, 2)
  assert.ok(
    segments.flat().some((row) => row.time === 1551 && row.value === 1500)
  )
  assert.ok(segments.flat().some((row) => row.time === 200 && row.value === 0))
  assert.ok(segments.flat().length < 500)
  assert.ok(segments[0].at(-1).time < 3000 && segments[1][0].time > 3000)
})
test("series break across a device gap even when both endpoint samples exist", () => {
  const segments = analysisSeriesSegments(
    [point(0), point(1), point(50), point(51)],
    "power",
    "Bike",
    0,
    51
  )
  assert.deepEqual(
    segments.map((segment) => segment.map((row) => row.time)),
    [
      [0, 1],
      [50, 51],
    ]
  )
})

test("Analyze 360 zoom uses interpolated edges and retains actual recording gaps", () => {
  const points = [
    point(60, { power: 100 }),
    point(70, { power: 200 }),
    point(80, { power: 300 }),
  ]
  const [line] = analysisSeriesSegments(points, "power", "Bike", 62, 76)
  assert.deepEqual(line, [
    { time: 62, value: 120 },
    { time: 70, value: 200 },
    { time: 76, value: 260 },
  ])
  assert.deepEqual(
    analysisSeriesSegments([point(0), point(60)], "power", "Bike", 10, 50),
    []
  )
})
test("time in zones uses provider thresholds and clips partial boundary samples", () => {
  const points = [
    point(0, { power: 50 }),
    point(5, { power: 150 }),
    point(10, { power: 250 }),
    point(15, { power: 350 }),
  ]
  const zones = analysisZoneTimes(points, "power", 200, [50, 100, 999], 2, 12)
  assert.deepEqual(
    zones.map((zone) => zone.seconds),
    [3, 5, 2]
  )
  assert.deepEqual(analysisZoneTimes(points, "power", 0, [50, 100], 0, 15), [])
  assert.deepEqual(
    analysisZoneTimes(points, "power", 200, [100, 50], 0, 15),
    []
  )
})
test("stored layouts reject duplicate singleton cards and bound user configuration", () => {
  const tiles = defaultAnalysisTiles([
    "power",
    "heartRate",
    "speed",
    "elevation",
  ])
  assert.ok(
    validAnalysisTiles(tiles, ["power", "heartRate", "speed", "elevation"])
  )
  assert.equal(
    validAnalysisTiles(
      [
        ...tiles,
        { ...tiles.find((tile) => tile.kind === "map"), id: "map-copy" },
      ],
      ["power"]
    ),
    null
  )
  assert.equal(
    validAnalysisTiles([{ ...tiles[0] }, { ...tiles[0] }], ["power"]),
    null
  )
  const [clean] = validAnalysisTiles(
    [
      {
        ...tiles[0],
        height: 10000,
        channels: ["power", "not-a-signal"],
        name: "x".repeat(300),
      },
    ],
    ["power"]
  )
  assert.equal(clean.height, 900)
  assert.deepEqual(clean.channels, ["power"])
  assert.equal(clean.name.length, 128)
  assert.deepEqual(validAnalysisTiles([], []), [])
})
test("CSV preserves quotes and line breaks while neutralizing spreadsheet formulas", () => {
  assert.equal(
    analysisCsv([
      ["Workout", "Value"],
      ['Race "A"\nRide', '=WEBSERVICE("secret")'],
    ]),
    '"Workout","Value"\r\n"Race ""A""\nRide","\'=WEBSERVICE(""secret"")"'
  )
})
