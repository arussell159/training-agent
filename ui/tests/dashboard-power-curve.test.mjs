import test from "node:test"
import assert from "node:assert/strict"
import {
  createDashboardPowerClient,
  parseDashboardPowerCurve,
  recordedPowerRange,
  dashboardPowerAnchors,
  dashboardPowerGridDurations,
  dashboardPowerPlotRows,
  dashboardPowerSelection,
  dashboardPowerTitle,
  parseDashboardNativePowerCurve,
} from "../src/lib/dashboard-power-curve.ts"
import { dashboardChartSports } from "../src/lib/dashboard-chart-settings.ts"
import {
  newDashboardChart,
  chartInstanceTitle,
  validDashboardLayout,
} from "../src/lib/dashboard-charts.ts"
import { createDesktopNativePowerFixtures } from "../../tools/desktop-native-power-fixtures.mjs"
const range = { start: "2026-10-01", end: "2026-10-20" },
  today = "2026-10-20"
test("Power supports genuine native All and supported sport selections without interpreting private variants as Other", () => {
  assert.equal(dashboardPowerSelection(dashboardChartSports), "all")
  assert.equal(dashboardPowerSelection(dashboardChartSports, "run"), "Run")
  assert.equal(dashboardPowerSelection(["Bike"]), "Ride")
  assert.equal(
    dashboardPowerSelection(["Run", "Mtn Bike", "Strength"]),
    "MountainBikeRide,Run,WeightTraining"
  )
  assert.equal(dashboardPowerSelection(["Swim"]), "Swim")
  assert.equal(dashboardPowerSelection(["Other"]), "Other")
  for (const sports of [
    [],
    ["Run", "Run"],
    ["Brick"],
    ["Day off"],
    ["Custom"],
    ["Race"],
    ["Run", "Custom"],
    ["Bike", "Fake"],
  ])
    assert.throws(() => dashboardPowerSelection(sports))
  assert.throws(() => dashboardPowerSelection(["Run"], "bike"), /No selected/)
})
test("Power default title follows the actual selected sports and explicit custom titles survive persisted native settings", () => {
  const instance = newDashboardChart("peak-power", range, "native-power")
  assert.equal(chartInstanceTitle(instance), "Peaks - Power: All Workout Types")
  instance.settings.sports = ["Run"]
  assert.equal(chartInstanceTitle(instance), "Peaks - Power: Run")
  instance.settings.title = "My exact title"
  assert.equal(chartInstanceTitle(instance), "My exact title")
  const copy = JSON.parse(JSON.stringify({ version: 2, instances: [instance] }))
  assert.equal(validDashboardLayout(copy), true)
  assert.equal(chartInstanceTitle(copy.instances[0]), "My exact title")
  assert.equal(dashboardPowerTitle(["Swim"]), "Peaks - Power: Swim")
})
const nativeBody = (sport = "all", span = range) => ({
  version: 1,
  kind: "power",
  unit: "W",
  source: "intervals-activity-power-curves",
  unitPolicy: "native-watts",
  valuePolicy: "native-reported",
  tagsSupported: false,
  selection: { sport, nativeTypes: sport === "all" ? [] : sport.split(",") },
  window: { oldest: span.start, newest: span.end },
  points: [
    {
      duration_seconds: 5,
      value: 400,
      activity_id: "i123",
      native_type: sport === "all" ? "Run" : sport.split(",")[0],
      date: "2026-10-12",
      name: "Recorded native power",
      estimated: false,
    },
    {
      duration_seconds: 17,
      value: null,
      activity_id: "i123",
      native_type: sport === "all" ? "Run" : sport.split(",")[0],
      date: "2026-10-12",
      name: "Recorded native power",
      estimated: false,
    },
    {
      duration_seconds: 60,
      value: 0,
      activity_id: "i456",
      native_type: sport === "all" ? "Ride" : sport.split(",")[0],
      date: "2026-10-13",
      name: "Recorded zero",
      estimated: false,
    },
  ],
  coverage: {
    status: "partial",
    inventoryRecords: 4,
    eligibleRecordings: 2,
    fetchedRecordings: 2,
    failedRecordings: 0,
    missingRecordings: 0,
    skippedForCap: 0,
    excludedWithoutPower: 1,
    excludedIgnoredRecordings: 1,
    unknownLengthRecordings: 0,
    unknownStreamRecordings: 0,
    invalidInventoryRecords: 0,
    conflictingRecordings: 0,
    unknownPoints: 1,
  },
  warning: "Some recorded samples are unavailable.",
})
test("native All power retains actual cross-sport provenance, full non-grid axis, measured zero and unknown breaks without interpolation", () => {
  const curve = parseDashboardNativePowerCurve(
    nativeBody(),
    "all",
    range,
    today
  )
  assert.equal(curve.native.source, "intervals-activity-power-curves")
  assert.deepEqual(curve.samples, [
    { seconds: 5, watts: 400 },
    { seconds: 17, watts: null },
    { seconds: 60, watts: 0 },
  ])
  assert.deepEqual(
    curve.points.map((point) => [point.native_type, point.value]),
    [
      ["Run", 400],
      ["Ride", 0],
    ]
  )
  assert.equal(
    curve.samples.some((point) => point.seconds === 20),
    false
  )
  const run = parseDashboardNativePowerCurve(
    nativeBody("Run"),
    "Run",
    range,
    today
  )
  assert.ok(run.points.every((point) => point.native_type === "Run"))
  assert.deepEqual(
    dashboardPowerPlotRows(curve, run).map((row) => row.seconds),
    [5, 17, 60]
  )
})
test("successful native Power responses must independently match sensor/window/selection, source identity, exact axis and coverage", () => {
  const mutations = [
    (value) => (value.source = "intervals-power-curve"),
    (value) => (value.unit = "watts"),
    (value) => (value.kind = "cadence"),
    (value) => (value.unitPolicy = "native-rpm"),
    (value) => (value.valuePolicy = "estimated"),
    (value) => (value.tagsSupported = true),
    (value) => (value.selection.sport = "Run"),
    (value) => (value.selection.nativeTypes = ["Run"]),
    (value) => (value.window.oldest = "2026-09-01"),
    (value) => (value.points[0].native_type = "Brick"),
    (value) => (value.points[1].date = "2026-10-14"),
    (value) => (value.points[1].activity_id = null),
    (value) => (value.points[0].date = "2026-09-01"),
    (value) => (value.points[0].value = -1),
    (value) => (value.points[0].estimated = true),
    (value) => (value.points[1].duration_seconds = 5),
    (value) => (value.points[0].start_index = 0),
    (value) => (value.coverage.inventoryRecords = 5),
    (value) => (value.coverage.fetchedRecordings = 129),
    (value) => (value.coverage.unknownPoints = 0),
    (value) => (value.coverage.unknownLengthRecordings = 3),
    (value) => (value.coverage.status = "available-recordings"),
  ]
  for (const mutate of mutations) {
    const value = nativeBody()
    mutate(value)
    assert.throws(() =>
      parseDashboardNativePowerCurve(value, "all", range, today)
    )
  }
  assert.throws(() =>
    parseDashboardNativePowerCurve(nativeBody(), "Run", range, today)
  )
})
test("native unknown length/stream inventory remains an explicit partial source and cannot become a complete claim", () => {
  const value = nativeBody()
  value.coverage.unknownLengthRecordings = 1
  value.coverage.unknownStreamRecordings = 1
  assert.equal(
    parseDashboardNativePowerCurve(value, "all", range, today).points[0].value,
    400
  )
  value.points = value.points.filter((point) => point.value !== null)
  value.coverage.unknownPoints = 0
  value.coverage.status = "available-recordings"
  assert.throws(() =>
    parseDashboardNativePowerCurve(value, "all", range, today)
  )
})
test("actual native per-record projection supplies cross-sport winning Power and explicit incomplete coverage without using tags or Bike-only statistics", async () => {
  const fixture = createDesktopNativePowerFixtures({ today })
  const all = parseDashboardNativePowerCurve(
    await fixture.service.load(
      fixture.config,
      { kind: "power", sport: "all", start: range.start, end: range.end },
      { actor: fixture.actor }
    ),
    "all",
    range,
    today
  )
  assert.deepEqual(
    [5, 60, 120, 600, 5400].map((seconds) => {
      const point = all.points.find(
        (point) => point.duration_seconds === seconds
      )
      return [seconds, point.value, point.activity_id, point.native_type]
    }),
    [
      [5, 500, "i780000007", "Run"],
      [60, 450, "i780000003", "TrailRun"],
      [120, 450, "i780000003", "TrailRun"],
      [600, 400, "i780000002", "Run"],
      [5400, 300, "i780000001", "Ride"],
    ]
  )
  assert.equal(all.native.coverage.inventoryRecords, 12)
  assert.equal(all.native.coverage.unknownLengthRecordings, 1)
  assert.equal(all.native.coverage.unknownStreamRecordings, 1)
  assert.equal(all.native.coverage.status, "partial")
  assert.equal(all.samples.find((point) => point.seconds === 17).watts, null)
  const run = parseDashboardNativePowerCurve(
    await fixture.service.load(
      fixture.config,
      { kind: "power", sport: "Run", start: range.start, end: range.end },
      { actor: fixture.actor }
    ),
    "Run",
    range,
    today
  )
  assert.ok(
    run.points.every((point) => ["Run", "TrailRun"].includes(point.native_type))
  )
})
test("explicit native All/Run Power reads use dedicated demand transport while omitted sport keeps the old cycling/personal path", async () => {
  const calls = [],
    client = createDashboardPowerClient(async (path) => {
      calls.push(path)
      const q = new URL(path, "http://localhost").searchParams
      return new Response(
        JSON.stringify(
          path.startsWith("/api/personal-statistics")
            ? body()
            : nativeBody(q.get("sport"), {
                start: q.get("start"),
                end: q.get("end"),
              })
        )
      )
    })
  const all = await client.load("A", range, today, { sport: "all" }),
    run = await client.load("A", range, today, { sport: "Run" })
  assert.equal(all.points[0].native_type, "Run")
  assert.equal(run.native.selection.sport, "Run")
  assert.equal(
    new URL(calls[0], "http://localhost").pathname,
    "/api/performance-curves"
  )
  assert.equal(
    new URL(calls[0], "http://localhost").searchParams.get("kind"),
    "power"
  )
  assert.ok(
    calls.every((path) => !path.includes("tags") && !path.includes("tagScope"))
  )
  await client.load("A", range, today)
  assert.match(calls[2], /^\/api\/personal-statistics\?/)
  client.clear()
})
test("native Power readers share identical windows, isolate sports/accounts, clone snapshots and clip future dates before HTTP", async () => {
  const calls = []
  let release
  const gate = new Promise((done) => (release = done)),
    client = createDashboardPowerClient(async (path) => {
      calls.push(path)
      await gate
      const q = new URL(path, "http://localhost").searchParams
      return new Response(
        JSON.stringify(
          nativeBody(q.get("sport"), {
            start: q.get("start"),
            end: q.get("end"),
          })
        )
      )
    })
  const abort = new AbortController(),
    first = client.load("A", range, today, {
      sport: "Run",
      signal: abort.signal,
    }),
    second = client.load("A", range, today, { sport: "Run" }),
    rejected = assert.rejects(first, /abort/i)
  await new Promise((done) => setTimeout(done, 0))
  abort.abort()
  release()
  await rejected
  const result = await second
  assert.equal(calls.length, 1)
  result.native.points[0].value = 999
  assert.equal(
    (await client.load("A", range, today, { sport: "Run" })).native.points[0]
      .value,
    400
  )
  await client.load("B", range, today, { sport: "Run" })
  await client.load("A", range, today, { sport: "all" })
  assert.equal(calls.length, 3)
  await client.load("A", { ...range, end: "2026-10-25" }, today, {
    sport: "Run",
  })
  assert.equal(
    new URL(calls.at(-1), "http://localhost").searchParams.get("end"),
    today
  )
  const previous = calls.length
  assert.equal(
    (
      await client.load(
        "A",
        { start: "2026-10-21", end: "2026-10-25" },
        today,
        { sport: "Run" }
      )
    ).effectiveRange,
    null
  )
  assert.equal(calls.length, previous)
  client.clear()
})
test("native Power failures and wrong successful windows stay retryable instead of falling back to cycling or prior winning sources", async () => {
  let wrong = true,
    failed = false,
    calls = 0
  const client = createDashboardPowerClient(async (path) => {
    calls++
    assert.match(path, /performance-curves/)
    if (failed)
      return new Response(
        JSON.stringify({ error: "Native Power unavailable" }),
        { status: 503 }
      )
    const value = nativeBody("Run")
    if (wrong) value.window.newest = "2026-10-19"
    return new Response(JSON.stringify(value))
  })
  await assert.rejects(
    client.load("A", range, today, { sport: "Run" }),
    /invalid/
  )
  wrong = false
  failed = true
  await assert.rejects(
    client.load("A", range, today, { sport: "Run" }),
    /unavailable/
  )
  failed = false
  assert.equal(
    (await client.load("A", range, today, { sport: "Run" })).points[0].value,
    400
  )
  assert.equal(calls, 3)
  client.clear()
})
const effort = (seconds, value = 300, extra = {}) => ({
  sport: "Bike",
  kind: "power",
  unit: "watts",
  estimated: false,
  duration_seconds: seconds,
  distance_meters: null,
  value,
  activity_id: "i123",
  date: "2026-10-12",
  name: "Recorded interval ride",
  watts_per_kg: 4,
  ...extra,
})
const body = (
  window = range,
  points = [effort(5, 900), effort(60, 450), effort(3600, 220)]
) => ({
  source: "intervals",
  today,
  records: [],
  bestEffortsWindow: { oldest: window.start, newest: window.end },
  bestEfforts: points,
})
const reply = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
const fullBody = (points, extra = {}) => ({
  ...body(),
  powerCurve: {
    version: 1,
    sport: "Bike",
    kind: "power",
    unit: "watts",
    source: "intervals-power-curve",
    window: { oldest: range.start, newest: range.end },
    points,
    warning: null,
    ...extra,
  },
})
const fullPoint = (seconds, value = 400, extra = {}) => ({
  duration_seconds: seconds,
  value,
  activity_id: "i123",
  date: "2026-10-12",
  name: "Measured duration effort",
  estimated: false,
  ...extra,
})

test("full additive provider curve supplies all fifteen exact observed anchors, including the seven extra durations and real source dates", () => {
  const points = dashboardPowerGridDurations.map((seconds, index) =>
    fullPoint(seconds, 700 - index * 23, {
      activity_id: `i${100 + index}`,
      date: `2026-10-${String(1 + index).padStart(2, "0")}`,
      start_index: index * 10,
      end_index: index * 10 + seconds,
      watts_per_kg: (700 - index * 23) / 70,
    })
  )
  const payload = fullBody([
      ...points,
      fullPoint(172800, 120, { date: "2026-10-20" }),
    ]),
    before = structuredClone(payload),
    result = parseDashboardPowerCurve(payload, range, today)
  assert.deepEqual(
    result.points.map((point) => point.duration_seconds),
    [
      5, 10, 12, 20, 30, 60, 120, 300, 360, 600, 720, 1200, 1800, 3600, 5400,
      172800,
    ]
  )
  for (const seconds of [12, 20, 120, 360, 720, 1800, 5400]) {
    const actual = result.points.find(
        (point) => point.duration_seconds === seconds
      ),
      expected = points.find((point) => point.duration_seconds === seconds)
    assert.equal(actual.value, expected.value)
    assert.equal(actual.date, expected.date)
    assert.equal(actual.activity_id, expected.activity_id)
    assert.equal(actual.name, expected.name)
    assert.equal(actual.start_index, expected.start_index)
    assert.equal(actual.end_index, expected.end_index)
  }
  assert.deepEqual(payload, before)
  assert.equal(
    payload.bestEfforts.length,
    3,
    "Legacy Home best-effort payload remains unchanged"
  )
})

test("full chart retains non-grid measured seconds, explicit unknown breaks and exact independent comparison values while grid remains fifteen rows", () => {
  const primary = parseDashboardPowerCurve(
    fullBody([
      fullPoint(12, 710),
      fullPoint(17, 653, { date: "2026-10-17", activity_id: "i717" }),
      fullPoint(18, null, { date: null, activity_id: null, name: null }),
      fullPoint(20, 620),
    ]),
    range,
    today
  )
  const comparison = parseDashboardPowerCurve(
    fullBody([fullPoint(12, 699), fullPoint(17, 612), fullPoint(20, 600)]),
    range,
    today
  )
  assert.equal(primary.full, true)
  const extra = primary.points.find((point) => point.duration_seconds === 17)
  assert.equal(extra.value, 653)
  assert.equal(extra.date, "2026-10-17")
  assert.equal(extra.activity_id, "i717")
  assert.deepEqual(dashboardPowerPlotRows(primary, comparison), [
    { seconds: 12, primary: 710, comparison: 699 },
    { seconds: 17, primary: 653, comparison: 612 },
    { seconds: 18, primary: null, comparison: null },
    { seconds: 20, primary: 620, comparison: 600 },
  ])
  assert.equal(dashboardPowerGridDurations.length, 15)
  assert.equal(dashboardPowerGridDurations.includes(17), false)
  assert.equal(dashboardPowerGridDurations.includes(18), false)
  const legacy = parseDashboardPowerCurve(body(), range, today)
  assert.equal(
    legacy.full,
    false,
    "Legacy sparse samples must remain disconnected"
  )
})

test("full curve missing/null anchors remain unknown and measured zero wins a conflicting stale legacy value", () => {
  const payload = fullBody(
      [
        fullPoint(5, 0),
        fullPoint(10, null, { activity_id: null, date: null, name: null }),
        fullPoint(20, 600),
        fullPoint(120, null, { activity_id: null, date: null, name: null }),
      ],
      { warning: "Some provider efforts have no verified source." }
    ),
    result = parseDashboardPowerCurve(payload, range, today)
  assert.deepEqual(
    result.points.map((point) => [point.duration_seconds, point.value]),
    [
      [5, 0],
      [20, 600],
    ]
  )
  assert.equal(result.warning, payload.powerCurve.warning)
  assert.equal(
    result.points.some((point) => point.duration_seconds === 12),
    false
  )
  assert.equal(
    result.points.some((point) => point.duration_seconds === 60),
    false,
    "An absent full-curve anchor must not be filled from stale legacy bestEfforts"
  )
})

test("full curve window, typed identity, sorted unique axis, provenance and source bounds independently reject corrupted200 data", () => {
  const invalid = [
    { version: 2 },
    { unit: "bpm" },
    { source: "invented" },
    { window: { oldest: "2026-09-01", newest: range.end } },
    { points: [fullPoint(20), fullPoint(12)] },
    { points: [fullPoint(12), fullPoint(12)] },
    { points: [fullPoint(0)] },
    { points: [fullPoint(12, NaN)] },
    { points: [fullPoint(12, 100, { activity_id: null })] },
    { points: [fullPoint(12, 100, { date: "2026-09-30" })] },
    { points: [fullPoint(12, 100, { estimated: true })] },
    { points: [fullPoint(12, 100, { start_index: 50, end_index: 20 })] },
    { points: [fullPoint(12, 100, { name: "x".repeat(513) })] },
  ]
  for (const change of invalid)
    assert.throws(
      () =>
        parseDashboardPowerCurve(
          fullBody([fullPoint(12)], change),
          range,
          today
        ),
      /invalid full duration curve/
    )
  assert.throws(
    () =>
      parseDashboardPowerCurve(
        {
          ...body(),
          powerCurve: null,
          powerCurveError: "Recorded power curve source is unavailable.",
        },
        range,
        today
      ),
    /source is unavailable/
  )
  assert.throws(
    () =>
      parseDashboardPowerCurve(
        { ...fullBody([fullPoint(12)]), bestEffortsWindow: null },
        range,
        today
      ),
    /different date range/
  )
})
test("power duration curve retains only exact supported measured anchors and real zero with source provenance, without interpolated 20s/120s points", () => {
  const result = parseDashboardPowerCurve(
    body(range, [
      effort(3600, 220),
      effort(5, 900),
      effort(10, 0),
      effort(20, 800),
      effort(120, 400),
    ]),
    range,
    today
  )
  assert.deepEqual(dashboardPowerAnchors, [5, 10, 30, 60, 300, 600, 1200, 3600])
  assert.deepEqual(
    dashboardPowerGridDurations,
    [5, 10, 12, 20, 30, 60, 120, 300, 360, 600, 720, 1200, 1800, 3600, 5400]
  )
  assert.deepEqual(
    result.points.map((row) => [row.duration_seconds, row.value]),
    [
      [5, 900],
      [10, 0],
      [3600, 220],
    ]
  )
  assert.equal(result.points[0].activity_id, "i123")
  assert.equal(result.points[0].name, "Recorded interval ride")
  assert.equal(result.points[0].watts_per_kg, 4)
  assert.deepEqual(result.effectiveRange, range)
})
test("wrong-window or malformed successful bodies and estimated/nonfinite/wrong-unit/outside-window anchors cannot replace a measured curve", () => {
  for (const value of [
    {},
    body({ ...range, start: "2026-09-01" }),
    body(range, [effort(5, 300, { estimated: true })]),
    body(range, [effort(5, Infinity)]),
    body(range, [effort(5, 300, { unit: "bpm" })]),
    body(range, [effort(5, 300, { date: "2026-09-30" })]),
    body(range, [null]),
    body(range, [{}]),
    body(range, [effort("5", 300)]),
  ])
    assert.throws(
      () => parseDashboardPowerCurve(value, range, today),
      /incomplete|different date|invalid measured/
    )
  assert.throws(
    () => recordedPowerRange({ ...range, start: "2026-10-21" }, today),
    /start date/
  )
  assert.throws(
    () => recordedPowerRange({ start: "1899-01-01", end: "1900-01-01" }, today),
    /1900/
  )
})
test("partial source warnings preserve genuine available points while future windows cannot fabricate provider data", () => {
  const partial = body()
  partial.bestEffortsError =
    "Some pace curves failed; available recorded power remains."
  assert.equal(parseDashboardPowerCurve(partial, range, today).points.length, 3)
  assert.equal(
    parseDashboardPowerCurve(partial, range, today).warning,
    partial.bestEffortsError
  )
  assert.deepEqual(
    recordedPowerRange({ ...range, end: "2026-11-01" }, today),
    range
  )
  assert.equal(
    recordedPowerRange({ start: "2026-10-21", end: "2026-11-01" }, today),
    null
  )
})
test("primary and comparison ranges use independent exact GETs, match authoritative windows and never mutate calendars", async () => {
  const requests = [],
    client = createDashboardPowerClient(async (path, options) => {
      requests.push({ path, options })
      const url = new URL(path, "http://localhost"),
        window = {
          start: url.searchParams.get("oldest"),
          end: url.searchParams.get("newest"),
        }
      return reply(
        body(window, [
          effort(60, window.start === range.start ? 350 : 320, {
            date: window.start,
          }),
        ])
      )
    }),
    other = { start: "2026-09-01", end: "2026-09-30" }
  const [first, second] = await Promise.all([
    client.load("connection-A", range, today),
    client.load("connection-A", other, today),
  ])
  assert.equal(requests.length, 2)
  assert.equal(first.points[0].value, 350)
  assert.equal(second.points[0].value, 320)
  assert.ok(
    requests.every(
      (row) =>
        row.path.startsWith("/api/personal-statistics?") &&
        !row.options.method &&
        !row.options.body
    )
  )
  assert.deepEqual(first.range, range)
  assert.deepEqual(second.range, other)
})
test("duplicate instance readers share a pending range while one canceled chart does not abort another or permit stale scope reuse", async () => {
  let release,
    requests = 0
  const gate = new Promise((resolve) => (release = resolve)),
    client = createDashboardPowerClient(async () => {
      requests++
      await gate
      return reply(body())
    }),
    controller = new AbortController()
  const canceled = client.load("A", range, today, {
      signal: controller.signal,
    }),
    active = client.load("A", range, today)
  controller.abort()
  await assert.rejects(canceled, /Aborted/)
  release()
  assert.equal((await active).points.length, 3)
  assert.equal(requests, 1)
  await client.load("A", range, today)
  assert.equal(requests, 1)
  await client.load("B", range, today)
  assert.equal(requests, 2)
})
test("failed reads and malformed200 remain retryable, and future-only windows do not make any API request", async () => {
  let requests = 0
  const client = createDashboardPowerClient(async () => {
    requests++
    return requests === 1
      ? reply({ error: "Curve source unavailable" }, 503)
      : requests === 2
        ? reply({})
        : reply(body())
  })
  await assert.rejects(client.load("A", range, today), /source unavailable/)
  await assert.rejects(client.load("A", range, today), /incomplete/)
  assert.equal((await client.load("A", range, today)).points.length, 3)
  assert.equal(
    (await client.load("A", { start: "2026-10-21", end: "2026-10-28" }, today))
      .points.length,
    0
  )
  assert.equal(requests, 3)
})
