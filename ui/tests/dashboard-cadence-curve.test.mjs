import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import React from "../node_modules/react/index.js"
import { renderToStaticMarkup } from "../node_modules/react-dom/server.node.js"
import ts from "../node_modules/typescript/lib/typescript.js"
import {
  parseDashboardCadenceCurve,
  dashboardCadenceSelection,
  dashboardCadenceGridRows,
  dashboardCadencePlotRows,
  createDashboardCadenceClient,
  recordedCadenceRange,
} from "../src/lib/dashboard-cadence-curve.ts"
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
import { createCadenceCurveService } from "../../app-backend/lib/cadence-curve.mjs"
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
  kind: "cadence",
  unit: "rpm",
  source: "intervals-activity-cadence-curves",
  unitPolicy: "native-rpm",
  tagsSupported: false,
  selection: { sport, nativeTypes: sport === "all" ? [] : sport.split(",") },
  window: { oldest: span.start, newest: span.end },
  points,
  coverage: {
    status: points.some((row) => row.value === null)
      ? "partial"
      : "available-recordings",
    inventoryRecords: 1,
    eligibleRecordings: 1,
    fetchedRecordings: 1,
    failedRecordings: 0,
    missingRecordings: 0,
    skippedForCap: 0,
    excludedWithoutCadence: 0,
    unknownPoints: points.filter((row) => row.value === null).length,
  },
  warning: "Native source coverage is limited.",
})
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

test("actual cadence settings render fourteen sports plus All, independent disabled comparison, exact25date presets and Chart/Grid without ineffective period/average controls", () => {
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
    instance = newDashboardChart("peak-cadence", range, "hr-settings"),
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

test("actual cadence source action waits for a validated plain recording, guards duplicate clicks and retains errors instead of opening mismatched data", async () => {
  const source = fs.readFileSync(
      new URL("../src/components/dashboard-cadence-curve.tsx", import.meta.url),
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
  assert.equal(dashboardCadenceSelection(dashboardChartSports), "all")
  assert.equal(
    dashboardCadenceSelection(["Run", "Bike", "Mtn Bike"]),
    "MountainBikeRide,Ride,Run"
  )
  assert.equal(
    dashboardCadenceSelection([
      "Strength",
      "Crosstrain",
      "XC-Ski",
      "Rowing",
      "Walk",
      "Other",
    ]),
    "NordicSki,Other,Rowing,Walk,WeightTraining,Workout"
  )
  assert.equal(dashboardCadenceSelection(dashboardChartSports, "run"), "Run")
  assert.equal(
    dashboardCadenceSelection(dashboardChartSports, "bike"),
    "MountainBikeRide,Ride"
  )
  for (const sport of ["Brick", "Custom", "Day off", "Race"])
    assert.throws(
      () => dashboardCadenceSelection(["Run", sport]),
      /cannot identify/
    )
  assert.throws(() => dashboardCadenceSelection([]), /at least one/)
  assert.throws(
    () => dashboardCadenceSelection(["Bike"], "swim"),
    /No selected/
  )
  assert.throws(
    () => dashboardCadenceSelection(["Run", "Run"]),
    /valid workout/
  )
})

test("actual native cadence projector and service preserve decimal RPM/zero, all recording types, source identity and known-short uncertainty", async () => {
  const inventory = [
      {
        id: "i11",
        type: "Run",
        start_date_local: "2026-10-19T07:00:00",
        elapsed_time: 600,
        stream_types: ["cadence"],
      },
      {
        id: "i12",
        type: "Ride",
        start_date_local: "2026-10-19T08:00:00",
        elapsed_time: 60,
        stream_types: ["cadence"],
      },
      {
        id: "i13",
        type: "Swim",
        start_date_local: "2026-10-19T09:00:00",
        elapsed_time: 600,
        stream_types: ["heartrate"],
      },
    ],
    calls = []
  const service = createCadenceCurveService({
      now: () => Date.parse(today + "T12:00:00Z"),
      request: () => async (path) => {
        calls.push(path)
        if (path.includes("/activities?")) return inventory
        assert.match(path, /power-curves\.json\?types=cadence&fatigue=normal$/)
        return [
          {
            stream_type: "cadence",
            after_kj: 0,
            secs: [5, 17, 60, 120, 700],
            values: path.includes("/i11/")
              ? [42.5, 43.25, 0, 45, 999]
              : [100.5, 99.75, null, 200, 999],
          },
        ]
      },
    }),
    config = { INTERVALS_API_KEY: "synthetic", SETTINGS_SCOPE: "test" },
    actor = { id: "test-user", origin: "http://localhost" },
    input = { kind: "cadence", sport: "all", ...range },
    raw = await service.load(config, input, { actor }),
    curve = parseDashboardCadenceCurve(raw, "all", range, today)
  assert.deepEqual(
    curve.points.map((row) => row.value),
    [100.5, 99.75, 0, 45, null]
  )
  assert.deepEqual(
    curve.points
      .filter((row) => row.value !== null)
      .map((row) => row.native_type),
    ["Ride", "Ride", "Run", "Run"]
  )
  assert.equal(
    curve.points[4].activity_id,
    "i11",
    "Unknown duration remains an actual source sample, never a phantom identity"
  )
  assert.equal(raw.coverage.excludedWithoutCadence, 1)
  assert.equal(raw.coverage.fetchedRecordings, 2)
  assert.ok(
    !calls.some((path) => path.includes("/i13/")),
    "Recordings explicitly lacking cadence must not fabricate a curve"
  )
  const runRaw = await service.load(
      config,
      { ...input, sport: "Run" },
      { actor }
    ),
    run = parseDashboardCadenceCurve(runRaw, "Run", range, today)
  assert.equal(
    run.points[0].value,
    42.5,
    "Native running RPM must not double to85"
  )
  assert.equal(run.points[2].value, 0)
  const before = calls.length
  await assert.rejects(
    service.load(config, { ...input, tags: "any" }, { actor }),
    { code: "CADENCE_FILTER_UNSUPPORTED" }
  )
  assert.equal(
    calls.length,
    before,
    "Unsupported tag filtering must not silently fetch an unfiltered substitute"
  )
})
test("full exact nonmonotonic cadence axes remain intact and comparison/grid use exact15lookups with null gaps, never interpolated values", () => {
  const raw = dto(),
    primary = parseDashboardCadenceCurve(raw, "all", range, today),
    comparison = parseDashboardCadenceCurve(
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
  const grid = dashboardCadenceGridRows(primary, comparison),
    plot = dashboardCadencePlotRows(primary, comparison)
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
    (body) => (body.points[0].value = Infinity),
    (body) => (body.points[0].activity_id = null),
    (body) => (body.points[0].native_type = null),
    (body) => (body.points[0].date = "2026-09-30"),
    (body) => (body.points[0].estimated = true),
    (body) => (body.points[1].duration_seconds = 5),
    (body) => (body.points[0].end_index = 1),
    (body) => (body.coverage.fetchedRecordings = 4),
    (body) => (body.coverage.status = "available-recordings"),
    (body) => (body.coverage.failedRecordings = 2),
    (body) => (body.tagsSupported = true),
    (body) => (body.unitPolicy = "running-doubled"),
    (body) => (body.points[2].activity_id = null),
    (body) => (body.warning = { raw: "private" }),
    (body) => (body.points[0].name = "x".repeat(513)),
  ]
  for (const mutate of changes) {
    const malformed = dto()
    mutate(malformed)
    assert.throws(
      () => parseDashboardCadenceCurve(malformed, "all", range, today),
      /invalid or mismatched/
    )
  }
  assert.throws(
    () =>
      parseDashboardCadenceCurve(
        dto([point(5, 180, { native_type: "Ride" })], "Run"),
        "Run",
        range,
        today
      ),
    /invalid or mismatched/
  )
  assert.doesNotThrow(
    () =>
      parseDashboardCadenceCurve(
        dto([point(5, 180, { native_type: "VirtualRide" })], "Ride"),
        "Ride",
        range,
        today
      ),
    "Ride's documented native family remains valid"
  )
})

test("Cadence demand-driven cache shares consumers, clones snapshots, binds account/selection/window and canceled callers cannot publish late data", async () => {
  let finish,
    calls = 0
  const client = createDashboardCadenceClient(async () => {
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
  const isolated = createDashboardCadenceClient(async (path) => {
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

test("failed and malformed cadence200 reads can retry and future-only requests never fetch while future-ended windows bind clipped recorded dates", async () => {
  let calls = 0,
    paths = []
  const client = createDashboardCadenceClient(async (path) => {
    calls++
    paths.push(path)
    if (calls === 1) return reply({ error: "Synthetic cadence failure" }, 503)
    if (calls === 2) return reply({ ...dto(), unit: "watts" })
    return reply(dto())
  })
  await assert.rejects(
    client.load("A", "all", range, today),
    /Synthetic cadence failure/
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
    recordedCadenceRange({ start: "2026-10-21", end: "2026-10-25" }, today),
    null
  )
})

test("Cadence instance preferences retain observed default title, independent comparison/display and strict transport validation without changing Power/Pace", () => {
  const first = newDashboardChart("peak-cadence", range, "hr-a"),
    second = newDashboardChart("peak-cadence", range, "hr-b"),
    power = newDashboardChart("peak-power", range, "power"),
    pace = newDashboardChart("peak-pace-distance", range, "pace")
  assert.equal(chartInstanceTitle(first), "Peaks - Cadence: All Workout Types")
  assert.equal(first.cadence.comparison, false)
  assert.equal(first.cadence.display, "chart")
  first.cadence.comparison = true
  first.cadence.display = "grid"
  first.cadence.comparisonRange = {
    start: "2026-09-01",
    end: "2026-09-30",
    preset: "custom",
  }
  first.settings.sports = ["Run"]
  assert.equal(chartInstanceTitle(first), "Peaks - Cadence: Run")
  assert.equal(second.cadence.comparison, false)
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
      instances: [{ ...first, cadence: { ...first.cadence, display: "fake" } }],
    }),
    false
  )
  first.settings.title = "My cadence review"
  assert.equal(chartInstanceTitle(first), "My cadence review")
})

test("bounded full cadence curves keep all10000 exact native samples and reject oversized or unsorted successful axes", () => {
  const points = Array.from({ length: 10000 }, (_, i) =>
      point(i + 1, i % 2 ? 150 : 151)
    ),
    payload = dto(points),
    curve = parseDashboardCadenceCurve(payload, "all", range, today)
  assert.equal(curve.points.length, 10000)
  assert.equal(dashboardCadencePlotRows(curve).length, 10000)
  assert.equal(dashboardCadenceGridRows(curve).length, 15)
  assert.throws(
    () =>
      parseDashboardCadenceCurve(
        dto([...points, point(10001, 150)]),
        "all",
        range,
        today
      ),
    /invalid or mismatched/
  )
})

test("cadence coverage caps and failed/missing recording counts remain explicit and impossible complete claims reject", () => {
  const limited = dto([point(5, 42.5)])
  limited.coverage = {
    status: "partial",
    inventoryRecords: 133,
    eligibleRecordings: 130,
    fetchedRecordings: 128,
    failedRecordings: 2,
    missingRecordings: 1,
    skippedForCap: 2,
    excludedWithoutCadence: 3,
    unknownPoints: 0,
  }
  limited.warning =
    "Native RPM; coverage is partial: 2 recordings skipped by the128recording limit,2 failed,1 missing."
  const result = parseDashboardCadenceCurve(limited, "all", range, today)
  assert.equal(result.points[0].value, 42.5)
  assert.equal(result.coverage.skippedForCap, 2)
  assert.match(result.warning, /partial/)
  for (const mutate of [
    (body) => (body.coverage.status = "available-recordings"),
    (body) => (body.coverage.fetchedRecordings = 129),
    (body) => (body.coverage.eligibleRecordings = 500),
    (body) => (body.coverage.missingRecordings = 200),
  ]) {
    const invalid = structuredClone(limited)
    mutate(invalid)
    assert.throws(
      () => parseDashboardCadenceCurve(invalid, "all", range, today),
      /invalid or mismatched/
    )
  }
})
