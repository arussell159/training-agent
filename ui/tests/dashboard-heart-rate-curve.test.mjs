import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import React from "../node_modules/react/index.js"
import { renderToStaticMarkup } from "../node_modules/react-dom/server.node.js"
import ts from "../node_modules/typescript/lib/typescript.js"
import {
  parseDashboardHeartRateCurve,
  dashboardHeartRateSelection,
  dashboardHeartRateGridRows,
  dashboardHeartRatePlotRows,
  createDashboardHeartRateClient,
  recordedHeartRateRange,
} from "../src/lib/dashboard-heart-rate-curve.ts"
import {
  dashboardChartSports,
  dashboardChartDatePresets,
} from "../src/lib/dashboard-chart-settings.ts"
import { newMacronutrientSettings } from "../src/lib/dashboard-macronutrients.ts"
import { newDashboardPowerSettings } from "../src/lib/dashboard-power-curve.ts"
import {
  newDashboardChart,
  validDashboardLayout,
  chartInstanceTitle,
  dashboardChartDefinition,
} from "../src/lib/dashboard-charts.ts"
import { createDesktopHeartRateFixtures } from "../../tools/desktop-heart-rate-fixtures.mjs"
const range = { start: "2026-10-01", end: "2026-10-20" },
  today = range.end
const point = (seconds, value, extra = {}) => ({
  duration_seconds: seconds,
  value,
  activity_id: "i123",
  native_type: "Run",
  date: "2026-10-19",
  name: "Recorded source",
  estimated: false,
  ...extra,
})
const dto = (
  points = [point(5, 180), point(17, 181), point(60, null), point(600, 185)],
  sport = "all",
  span = range
) => ({
  version: 1,
  kind: "heartRate",
  unit: "bpm",
  source: "intervals-hr-curve",
  selection: { sport, nativeTypes: sport === "all" ? [] : sport.split(",") },
  window: { oldest: span.start, newest: span.end },
  points,
  coverage: {
    status: points.some((row) => row.value === null)
      ? "partial"
      : "native-aggregate",
    inventoryRecords: 1,
    verifiedPoints: points.filter((row) => row.value !== null).length,
    unknownPoints: points.filter((row) => row.value === null).length,
    failedSelections: [],
  },
  warning: "Native source coverage is limited.",
})
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

test("actual HR settings render fourteen sports plus All, independent disabled comparison, exact25date presets and Chart/Grid without ineffective period/average controls", () => {
  const source = fs.readFileSync(
      new URL(
        "../src/components/desktop-dashboard-charts.tsx",
        import.meta.url
      ),
      "utf8"
    ),
    file = ts.createSourceFile(
      "dashboard.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    ),
    node = file.statements.find(
      (row) =>
        ts.isFunctionDeclaration(row) && row.name?.text === "ChartSettings"
    )
  assert.ok(node)
  const compiled = ts.transpileModule(node.getText(file), {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    scope = {
      exports: {},
      ...React,
      dashboardChartDefinition,
      chartInstanceTitle,
      newDashboardPowerSettings,
      newMacronutrientSettings,
      dashboardChartDatePresets,
      dashboardChartSports,
      DashboardChartTagSettings: () => null,
      X: () => null,
    },
    Component = new Function(
      "require",
      ...Object.keys(scope),
      compiled + "; return ChartSettings;"
    )(
      createRequire(new URL("../package.json", import.meta.url)),
      ...Object.values(scope)
    ),
    instance = newDashboardChart("peak-hr", range, "hr-settings"),
    html = renderToStaticMarkup(
      React.createElement(Component, {
        instance,
        today,
        dashboardRange: range,
        onClose() {},
        onApply: async () => true,
      })
    )
  assert.equal((html.match(/<option /g) || []).length, 50)
  assert.equal((html.match(/type="checkbox"/g) || []).length, 16)
  assert.equal((html.match(/type="radio"/g) || []).length, 2)
  assert.equal((html.match(/type="checkbox" checked=""/g) || []).length, 15)
  assert.match(html, /<fieldset class="ddc-power-comparison" disabled=""/)
  assert.match(html, /<legend>Display as<\/legend>/)
  assert.match(html, /Custom Title:/)
  assert.match(html, /aria-label="Custom Title"/)
  assert.match(html, /checked=""\/>Chart/)
  assert.doesNotMatch(
    html,
    /Show Average|<legend>By<\/legend>|Peak Type|Select Report Type/
  )
  assert.match(html, /Brick, Custom, Day off and Race cannot be separated/)
})

test("actual HR source action waits for a validated plain recording, guards duplicate clicks and retains errors instead of opening mismatched data", async () => {
  const source = fs.readFileSync(
      new URL(
        "../src/components/dashboard-heart-rate-curve.tsx",
        import.meta.url
      ),
      "utf8"
    ),
    file = ts.createSourceFile(
      "hr.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
  let initializer
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "open")
      initializer = node.initializer?.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(initializer)
  const js = ts.transpileModule(`const callback = ${initializer}`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText
  const state = { opening: null, error: "" },
    controller = { current: null },
    opened = [],
    calls = []
  let finish,
    fail = false,
    wrong = false
  const action = new Function(
    "sourceController",
    "setOpening",
    "setOpenError",
    "loadHistoricalWorkout",
    "onWorkoutOpen",
    "message",
    js + ";return callback;"
  )(
    controller,
    (value) => (state.opening = value),
    (value) => (state.error = value),
    async (id, options) => {
      calls.push({ id, options })
      await new Promise((resolve) => (finish = resolve))
      if (fail) throw Error("Source read failed")
      return {
        id: wrong ? "activity:i999" : "activity:i123",
        activity_id: wrong ? "i999" : "i123",
        workout_date: "2026-10-19",
        activity_type: "Run",
      }
    },
    (workout) => opened.push(workout),
    (reason) => reason.message
  )
  const target = point(5, 180),
    first = action(target)
  await action(target)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, "activity:i123")
  assert.ok(calls[0].options.signal instanceof AbortSignal)
  assert.equal(opened.length, 0)
  finish()
  await first
  assert.equal(opened.length, 1)
  assert.equal(controller.current, null)
  wrong = true
  const mismatch = action(target)
  finish()
  await mismatch
  assert.equal(opened.length, 1)
  assert.match(state.error, /different identity/)
  wrong = false
  fail = true
  const failed = action(target)
  finish()
  await failed
  assert.equal(opened.length, 1)
  assert.match(state.error, /Source read failed/)
  fail = false
  const aborted = action(target)
  controller.current.abort()
  finish()
  await aborted
  assert.equal(
    opened.length,
    1,
    "Unmounted/cancelled source reads cannot navigate"
  )
  assert.doesNotMatch(
    initializer,
    /performance-effort|openActivityEffort|fitnessPeakEffortTarget/,
    "HR source opening must never ask for power/pace selection or fabricate highlight bounds"
  )
})

test("observed All maps to native aggregate while supported families/multisport preserve exact canonical identities and private groups cannot impersonate Other", () => {
  assert.equal(dashboardHeartRateSelection(dashboardChartSports), "all")
  assert.equal(
    dashboardHeartRateSelection(["Run", "Bike", "Mtn Bike"]),
    "MountainBikeRide,Ride,Run"
  )
  assert.equal(
    dashboardHeartRateSelection([
      "Strength",
      "Crosstrain",
      "XC-Ski",
      "Rowing",
      "Walk",
      "Other",
    ]),
    "NordicSki,Other,Rowing,Walk,WeightTraining,Workout"
  )
  assert.equal(dashboardHeartRateSelection(dashboardChartSports, "run"), "Run")
  assert.equal(
    dashboardHeartRateSelection(dashboardChartSports, "bike"),
    "MountainBikeRide,Ride"
  )
  for (const sport of ["Brick", "Custom", "Day off", "Race"])
    assert.throws(
      () => dashboardHeartRateSelection(["Run", sport]),
      /cannot identify/
    )
  assert.throws(() => dashboardHeartRateSelection([]), /at least one/)
  assert.throws(
    () => dashboardHeartRateSelection(["Bike"], "swim"),
    /No selected/
  )
  assert.throws(
    () => dashboardHeartRateSelection(["Run", "Run"]),
    /valid workout/
  )
})

test("actual backend source projection reaches the HR client with cross-sport winners, ignored/short nulls and recorded zero bound to raw recordings", async () => {
  const fixture = createDesktopHeartRateFixtures({ today }),
    input = { kind: "heartRate", sport: "all", ...range },
    raw = await fixture.service.load(fixture.config, input, {
      actor: fixture.actor,
    }),
    curve = parseDashboardHeartRateCurve(raw, "all", range, today)
  assert.deepEqual(
    curve.points.map((row) => row.value),
    [240, 210, null, null, 210, 180]
  )
  assert.deepEqual(
    curve.points
      .filter((row) => row.value !== null)
      .map((row) => row.native_type),
    ["WeightTraining", "Other", "Other", "Run"]
  )
  for (const winner of curve.points.filter((row) => row.value !== null)) {
    const source = fixture
      .snapshot()
      .sources.find((row) => row.activity.id === winner.activity_id)
    assert.ok(source)
    assert.equal(source.activity.icu_ignore_hr, false)
    assert.ok(source.activity.elapsed_time >= winner.duration_seconds)
    assert.equal(
      source.streams.find((row) => row.type === "heartrate").data[0],
      winner.value
    )
    assert.equal(source.activity.start_date_local.slice(0, 10), winner.date)
  }
  const zeroRaw = await fixture.service.load(
      fixture.config,
      { ...input, sport: "Walk" },
      { actor: fixture.actor }
    ),
    zero = parseDashboardHeartRateCurve(zeroRaw, "Walk", range, today)
  assert.equal(zero.points[0].value, 0)
  assert.equal(zero.points[0].native_type, "Walk")
})

test("full exact nonmonotonic HR axes remain intact and comparison/grid use exact15lookups with null gaps, never interpolated values", () => {
  const raw = dto(),
    primary = parseDashboardHeartRateCurve(raw, "all", range, today),
    comparison = parseDashboardHeartRateCurve(
      dto([point(5, 0), point(20, 190)], "all", {
        start: "2026-09-01",
        end: today,
      }),
      "all",
      { start: "2026-09-01", end: today },
      today
    )
  assert.deepEqual(
    primary.points.map((row) => [row.duration_seconds, row.value]),
    [
      [5, 180],
      [17, 181],
      [60, null],
      [600, 185],
    ]
  )
  const grid = dashboardHeartRateGridRows(primary, comparison),
    plot = dashboardHeartRatePlotRows(primary, comparison)
  assert.equal(grid.length, 15)
  assert.equal(grid.find((row) => row.seconds === 10).primary, undefined)
  assert.equal(grid.find((row) => row.seconds === 5).comparison.value, 0)
  assert.deepEqual(
    plot.find((row) => row.seconds === 17),
    { seconds: 17, primary: 181, comparison: null }
  )
  assert.deepEqual(
    plot.find((row) => row.seconds === 60),
    { seconds: 60, primary: null, comparison: null }
  )
  primary.points[0].value = 999
  assert.equal(
    raw.points[0].value,
    180,
    "The accepted snapshot must not mutate the transport payload"
  )
})

test("wrong successful DTOs reject selection/window/sensor/provenance/coverage corruption without silently showing a different curve", () => {
  const changes = [
    (body) => (body.unit = "watts"),
    (body) => (body.kind = "power"),
    (body) => (body.source = "intervals-power-curve"),
    (body) => (body.window.oldest = "2026-09-01"),
    (body) => (body.selection.sport = "Ride"),
    (body) => (body.selection.nativeTypes = ["Run"]),
    (body) => (body.points[0].value = -1),
    (body) => (body.points[0].value = 180.5),
    (body) => (body.points[0].activity_id = null),
    (body) => (body.points[0].native_type = null),
    (body) => (body.points[0].date = "2026-09-30"),
    (body) => (body.points[0].estimated = true),
    (body) => (body.points[1].duration_seconds = 5),
    (body) => (body.points[0].end_index = 1),
    (body) => (body.coverage.verifiedPoints = 4),
    (body) => (body.coverage.status = "native-aggregate"),
    (body) => (body.coverage.failedSelections = ["Run"]),
    (body) => (body.warning = { raw: "private" }),
    (body) => (body.points[0].name = "x".repeat(513)),
  ]
  for (const mutate of changes) {
    const malformed = dto()
    mutate(malformed)
    assert.throws(
      () => parseDashboardHeartRateCurve(malformed, "all", range, today),
      /invalid or mismatched/
    )
  }
  assert.throws(
    () =>
      parseDashboardHeartRateCurve(
        dto([point(5, 180, { native_type: "Ride" })], "Run"),
        "Run",
        range,
        today
      ),
    /invalid or mismatched/
  )
  assert.doesNotThrow(
    () =>
      parseDashboardHeartRateCurve(
        dto([point(5, 180, { native_type: "VirtualRide" })], "Ride"),
        "Ride",
        range,
        today
      ),
    "Ride's documented native family remains valid"
  )
})

test("HR demand-driven cache shares consumers, clones snapshots, binds account/selection/window and canceled callers cannot publish late data", async () => {
  let finish,
    calls = 0
  const client = createDashboardHeartRateClient(async () => {
      calls++
      await new Promise((resolve) => (finish = resolve))
      return reply(dto())
    }),
    abort = new AbortController(),
    first = client.load("accountA", "all", range, today, {
      signal: abort.signal,
    }),
    second = client.load("accountA", "all", range, today)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1)
  abort.abort()
  await assert.rejects(first, { name: "AbortError" })
  finish()
  const snapshot = await second
  snapshot.points[0].value = 999
  assert.equal(
    (await client.load("accountA", "all", range, today)).points[0].value,
    180
  )
  let direct = 0
  const isolated = createDashboardHeartRateClient(async (path) => {
    direct++
    const url = new URL(path, "https://test.invalid"),
      span = {
        start: url.searchParams.get("start"),
        end: url.searchParams.get("end"),
      }
    return reply(dto([point(5, 180)], url.searchParams.get("sport"), span))
  })
  await isolated.load("A", "Run", range, today)
  await isolated.load("B", "Run", range, today)
  await isolated.load("A", "all", range, today)
  await isolated.load("A", "Run", { ...range, start: "2026-10-02" }, today)
  assert.equal(direct, 4)
  isolated.clear()
  await isolated.load("A", "Run", range, today)
  assert.equal(direct, 5)
})

test("failed and malformed HR200 reads can retry and future-only requests never fetch while future-ended windows bind clipped recorded dates", async () => {
  let calls = 0,
    paths = []
  const client = createDashboardHeartRateClient(async (path) => {
    calls++
    paths.push(path)
    if (calls === 1) return reply({ error: "Synthetic HR failure" }, 503)
    if (calls === 2) return reply({ ...dto(), unit: "watts" })
    return reply(dto())
  })
  await assert.rejects(
    client.load("A", "all", range, today),
    /Synthetic HR failure/
  )
  await assert.rejects(
    client.load("A", "all", range, today),
    /invalid or mismatched/
  )
  assert.equal(
    (await client.load("A", "all", range, today)).points[0].value,
    180
  )
  const future = await client.load(
    "A",
    "all",
    { start: "2026-10-21", end: "2026-10-25" },
    today
  )
  assert.equal(future.effectiveRange, null)
  assert.equal(calls, 3)
  await client.load("A", "all", { ...range, end: "2026-10-25" }, today)
  assert.equal(
    new URL(paths.at(-1), "https://test.invalid").searchParams.get("end"),
    today
  )
  assert.equal(
    recordedHeartRateRange({ start: "2026-10-21", end: "2026-10-25" }, today),
    null
  )
})

test("HR instance preferences retain observed default title, independent comparison/display and strict transport validation without changing Power/Pace", () => {
  const first = newDashboardChart("peak-hr", range, "hr-a"),
    second = newDashboardChart("peak-hr", range, "hr-b"),
    power = newDashboardChart("peak-power", range, "power"),
    pace = newDashboardChart("peak-pace-distance", range, "pace")
  assert.equal(
    chartInstanceTitle(first),
    "Peaks - Heart Rate: All Workout Types"
  )
  assert.equal(first.hr.comparison, false)
  assert.equal(first.hr.display, "chart")
  first.hr.comparison = true
  first.hr.display = "grid"
  first.hr.comparisonRange = {
    start: "2026-09-01",
    end: "2026-09-30",
    preset: "custom",
  }
  first.settings.sports = ["Run"]
  assert.equal(chartInstanceTitle(first), "Peaks - Heart Rate: Run")
  assert.equal(second.hr.comparison, false)
  assert.equal(power.power.display, "chart")
  assert.equal(pace.pace.display, "chart")
  assert.equal(
    validDashboardLayout(
      JSON.parse(
        JSON.stringify({ version: 2, instances: [first, second, power, pace] })
      )
    ),
    true
  )
  assert.equal(
    validDashboardLayout({
      version: 2,
      instances: [{ ...first, hr: { ...first.hr, display: "fake" } }],
    }),
    false
  )
  first.settings.title = "My HR review"
  assert.equal(chartInstanceTitle(first), "My HR review")
})

test("bounded full HR curves keep all10000 exact native samples and reject oversized or unsorted successful axes", () => {
  const points = Array.from({ length: 10000 }, (_, i) =>
      point(i + 1, i % 2 ? 150 : 151)
    ),
    payload = dto(points),
    curve = parseDashboardHeartRateCurve(payload, "all", range, today)
  assert.equal(curve.points.length, 10000)
  assert.equal(dashboardHeartRatePlotRows(curve).length, 10000)
  assert.equal(dashboardHeartRateGridRows(curve).length, 15)
  assert.throws(
    () =>
      parseDashboardHeartRateCurve(
        dto([...points, point(10001, 150)]),
        "all",
        range,
        today
      ),
    /invalid or mismatched/
  )
})
