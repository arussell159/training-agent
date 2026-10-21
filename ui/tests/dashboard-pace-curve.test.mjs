import test from "node:test"
import assert from "node:assert/strict"
import {
  parseDashboardPaceCurve,
  createDashboardPaceClient,
  dashboardPaceGridRows,
  dashboardPacePlotRows,
  dashboardPaceSeconds,
  dashboardPaceTime,
  dashboardPaceEffort,
  recordedPaceRange,
} from "../src/lib/dashboard-pace-curve.ts"
import {
  newDashboardChart,
  validDashboardLayout,
} from "../src/lib/dashboard-charts.ts"
import { projectPaceCurve } from "../../app-backend/lib/pace-curve-projection.mjs"
const range = { start: "2026-10-01", end: "2026-10-20" },
  today = range.end
const point = (distance, elapsed, extra = {}) => ({
  distance_meters: distance,
  elapsed_seconds: elapsed,
  value: elapsed === null ? null : distance / elapsed,
  activity_id: "i123",
  date: "2026-10-12",
  name: "Recorded source",
  estimated: false,
  ...extra,
})
const dto = (sport, points, window = range) => ({
  version: 1,
  sport,
  kind: "pace",
  unit: "m/s",
  source: "intervals-pace-curve",
  window: { oldest: window.start, newest: window.end },
  points,
  warning: null,
})
const body = (
  sport = "Run",
  points = [point(800, 200), point(1600, 430), point(1609.344, 440)],
  window = range
) => ({
  source: "intervals",
  today,
  paceCurves: { [sport]: dto(sport, points, window) },
})
const reply = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })

test("full measured pace axis preserves physical1600/1609.344 distinction, non-grid samples and exact source elapsed/provenance", () => {
  const payload = body("Run", [
      point(800, 200),
      point(1234, 321),
      point(1600, 430, { start_index: 10, end_index: 440 }),
      point(1609.344, 440, { activity_id: "i456", date: "2026-10-19" }),
    ]),
    before = structuredClone(payload),
    curve = parseDashboardPaceCurve(payload, "Run", range, today)
  assert.deepEqual(
    curve.points.map((row) => row.distance_meters),
    [800, 1234, 1600, 1609.344]
  )
  assert.equal(curve.points[2].elapsed_seconds, 430)
  assert.equal(curve.points[3].activity_id, "i456")
  assert.equal(curve.points[3].date, "2026-10-19")
  assert.equal(curve.points[2].start_index, 10)
  assert.deepEqual(
    dashboardPaceGridRows(curve).map((row) => row.label),
    ["800 m", "1600 m", "1 mi"]
  )
  assert.equal(
    dashboardPacePlotRows(curve)[1].meters,
    1234,
    "Measured non-grid samples remain on the full chart"
  )
  const noMile = parseDashboardPaceCurve(
    body("Run", [point(1609, 420)]),
    "Run",
    range,
    today
  )
  assert.equal(
    dashboardPaceGridRows(noMile).length,
    0,
    "A rounded native1609m source cannot impersonate1mile"
  )
  assert.equal(
    dashboardPaceEffort(curve, curve.points[2]).distance_meters,
    1600
  )
  assert.deepEqual(payload, before)
})

test("Run and Swim use actual sport units; null/zero elapsed never becomes infinite/zero pace or a phantom grid row", () => {
  const swim = parseDashboardPaceCurve(
    body("Swim", [
      point(91.44, 100),
      point(100, null, { date: null, name: null, activity_id: null }),
      point(914.4, 1000),
    ]),
    "Swim",
    range,
    today
  )
  assert.equal(
    dashboardPaceTime(dashboardPaceSeconds("Swim", swim.points[0].value)),
    "01:40"
  )
  assert.equal(dashboardPaceTime(dashboardPaceSeconds("Run", 4)), "06:42")
  assert.equal(dashboardPacePlotRows(swim)[1].primary, null)
  assert.deepEqual(
    dashboardPaceGridRows(swim).map((row) => row.meters),
    [91.44, 914.4]
  )
  assert.equal(dashboardPaceEffort(swim, swim.points[1]), null)
  assert.deepEqual(
    parseDashboardPaceCurve(body("Swim", []), "Swim", range, today).points,
    []
  )
  for (const invalid of [
    point(100, 0),
    point(100, 90, { value: 0 }),
    point(100, null, { elapsed_seconds: 90 }),
  ])
    assert.throws(
      () =>
        parseDashboardPaceCurve(body("Swim", [invalid]), "Swim", range, today),
      /could not be verified/
    )
})

test("wrong period, typed identity, axis, physical ratio and provenance in successful200 bodies cannot replace a recorded curve", () => {
  const changes = [
    { version: 2 },
    { sport: "Swim" },
    { unit: "min/mi" },
    { kind: "speed" },
    { source: "invented" },
    { window: { oldest: "2026-09-01", newest: range.end } },
    { points: [point(1000, 300), point(800, 200)] },
    { points: [point(800, 200), point(800, 210)] },
    { points: [point(800, 200, { estimated: true })] },
    { points: [point(800, 200, { value: 4.1 })] },
    { points: [point(800, 200, { activity_id: null })] },
    { points: [point(800, 200, { date: "2026-09-30" })] },
    { points: [point(800, 200, { start_index: 20, end_index: 10 })] },
  ]
  for (const change of changes) {
    const value = body()
    Object.assign(value.paceCurves.Run, change)
    assert.throws(
      () => parseDashboardPaceCurve(value, "Run", range, today),
      /could not be verified/
    )
  }
  assert.throws(
    () =>
      parseDashboardPaceCurve(
        { source: "intervals", today, bestEfforts: [] },
        "Run",
        range,
        today
      ),
    /could not be verified/,
    "Legacy peaks do not prove this full source contract"
  )
})

test("ignored, mismatched, out-of-window and known-too-short source recordings stay unknown through the real backend projection and UI parser", () => {
  const bundle = {
    curve: {
      id: `r.${range.start}.${range.end}`,
      type: "PACE",
      distance: [800],
      values: [200],
      activity_id: ["i123"],
    },
    activities: {
      i123: {
        id: "i123",
        type: "Run",
        start_date_local: "2026-10-12T08:00:00",
        distance: 5000,
        elapsed_time: 1500,
        name: "Source",
      },
    },
  }
  for (const change of [
    { ignore_pace: true },
    { type: "Ride" },
    { start_date_local: "2026-09-30T08:00:00" },
    { distance: 799 },
    { elapsed_time: 199 },
  ]) {
    const input = structuredClone(bundle)
    Object.assign(input.activities.i123, change)
    const projected = projectPaceCurve(input, "Run", {
        oldest: range.start,
        newest: range.end,
      }),
      parsed = parseDashboardPaceCurve(
        { source: "intervals", today, paceCurves: { Run: projected } },
        "Run",
        range,
        today
      )
    assert.equal(parsed.points[0].value, null)
    assert.equal(parsed.points[0].elapsed_seconds, null)
    assert.equal(dashboardPacePlotRows(parsed)[0].primary, null)
    assert.ok(parsed.warning)
  }
})

test("comparison keeps independent actual distances and values, with explicit unknown rows instead of interpolation", () => {
  const primary = parseDashboardPaceCurve(
      body("Run", [
        point(800, 200),
        point(1000, null, { activity_id: null, date: null, name: null }),
        point(1600, 420),
      ]),
      "Run",
      range,
      today
    ),
    other = { start: "2026-09-01", end: "2026-09-30" },
    comparison = parseDashboardPaceCurve(
      body(
        "Run",
        [
          point(800, 220, { date: "2026-09-12" }),
          point(1000, 300, { date: "2026-09-13" }),
        ],
        other
      ),
      "Run",
      other,
      today
    )
  const plotted = dashboardPacePlotRows(primary, comparison)
  assert.equal(plotted[1].primary, null)
  assert.equal(plotted[1].comparison, 1609.344 / (1000 / 300))
  assert.equal(plotted[2].comparison, null)
  assert.equal(
    dashboardPaceGridRows(primary, comparison)[1].comparison.date,
    "2026-09-13"
  )
})

test("selected healthy sport remains usable when another sport fails; failedselectedsource requires retry and retains no fabricated fallback", () => {
  const value = body()
  value.paceCurveErrors = { Swim: "Swim source unavailable" }
  value.paceCurves.Swim = null
  assert.equal(
    parseDashboardPaceCurve(value, "Run", range, today).points.length,
    3
  )
  assert.throws(
    () => parseDashboardPaceCurve(value, "Swim", range, today),
    /Swim source unavailable/
  )
  value.paceCurveErrors.Run = "Run source unavailable"
  value.paceCurves.Run = null
  assert.throws(
    () => parseDashboardPaceCurve(value, "Run", range, today),
    /Run source unavailable/
  )
})

test("exact primary/comparison GETs are isolated by sport/window/account/revision; canceled readers cannot publish a stale shared result", async () => {
  const calls = []
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const client = createDashboardPaceClient(async (path, options) => {
      calls.push({ path, options })
      await gate
      const url = new URL(path, "http://localhost"),
        window = {
          start: url.searchParams.get("oldest"),
          end: url.searchParams.get("newest"),
        }
      return reply({
        ...body("Run", [point(800, 200, { date: window.start })], window),
        paceCurves: {
          Run: dto("Run", [point(800, 200, { date: window.start })], window),
          Swim: dto("Swim", [point(100, 100, { date: window.start })], window),
        },
      })
    }),
    controller = new AbortController()
  const canceled = client.load("A", "Run", range, today, {
      signal: controller.signal,
    }),
    active = client.load("A", "Run", range, today),
    other = client.load(
      "A",
      "Run",
      { start: "2026-09-01", end: "2026-09-30" },
      today
    )
  controller.abort()
  await assert.rejects(canceled, /Aborted/)
  release()
  assert.equal((await active).points[0].value, 4)
  assert.equal((await other).points[0].date, "2026-09-01")
  assert.equal(calls.length, 2)
  await client.load("A", "Run", range, today)
  assert.equal(calls.length, 2)
  await client.load("B", "Run", range, today)
  await client.load("A", "Swim", range, today)
  await client.load("A", "Run", range, today, { revision: 1 })
  assert.equal(calls.length, 5)
  assert.ok(calls.every((call) => !call.options.method && !call.options.body))
})

test("HTTP failures/malformedsuccess remain retryable and future-only windows issue no request", async () => {
  let calls = 0
  const client = createDashboardPaceClient(async () => {
    calls++
    return calls === 1
      ? reply({ error: "Unavailable" }, 503)
      : calls === 2
        ? reply({})
        : reply(body())
  })
  await assert.rejects(client.load("A", "Run", range, today), /Unavailable/)
  await assert.rejects(
    client.load("A", "Run", range, today),
    /could not be verified/
  )
  assert.equal((await client.load("A", "Run", range, today)).points.length, 3)
  assert.deepEqual(
    (
      await client.load(
        "A",
        "Run",
        { start: "2026-10-21", end: "2026-11-01" },
        today
      )
    ).points,
    []
  )
  assert.equal(calls, 3)
  assert.deepEqual(
    recordedPaceRange({ ...range, end: "2026-11-01" }, today),
    range
  )
})

test("Pace instances default to Run and persist separate independent comparison/display settings without altering Power or another copy", () => {
  const pace = newDashboardChart("peak-pace-distance", range, "pace-A"),
    power = newDashboardChart("peak-power", range, "power-A"),
    copy = structuredClone({ ...pace, id: "pace-B" })
  assert.deepEqual(pace.settings.sports, ["Run"])
  assert.equal(pace.pace.comparison, false)
  pace.pace.comparison = true
  pace.pace.comparisonRange = {
    preset: "custom",
    start: "2026-09-01",
    end: "2026-09-30",
  }
  pace.pace.display = "grid"
  assert.equal(copy.pace.comparison, false)
  assert.equal(power.power.display, "chart")
  assert.equal(
    validDashboardLayout(
      JSON.parse(JSON.stringify({ version: 2, instances: [pace, power, copy] }))
    ),
    true
  )
  assert.equal(
    validDashboardLayout({
      version: 2,
      instances: [{ ...pace, pace: { ...pace.pace, display: "fake" } }],
    }),
    false
  )
})

test("full bounded native axes preserve all exact Swim samples while oversized curves reject rather than silently truncate", () => {
  const points = Array.from({ length: 10000 }, (_, index) =>
      point(index + 1, (index + 1) / 1.25)
    ),
    curve = parseDashboardPaceCurve(body("Swim", points), "Swim", range, today),
    grid = dashboardPaceGridRows(curve)
  assert.equal(curve.points.length, 10000)
  assert.equal(grid.length, 10000)
  assert.equal(grid[0].meters, 1)
  assert.equal(grid.at(-1).meters, 10000)
  assert.equal(grid.at(-1).primary.elapsed_seconds, 8000)
  assert.throws(
    () =>
      parseDashboardPaceCurve(
        body("Swim", [...points, point(10001, 9000)]),
        "Swim",
        range,
        today
      ),
    /could not be verified/
  )
})
