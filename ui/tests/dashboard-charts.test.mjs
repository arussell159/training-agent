import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import React from "../node_modules/react/index.js"
import { renderToStaticMarkup } from "../node_modules/react-dom/server.node.js"
import ts from "../node_modules/typescript/lib/typescript.js"
import {
  dashboardChartCatalog,
  dashboardChartDefinition,
  dashboardWorkoutSport,
  filterDashboardWorkouts,
  migratedDashboardLayout,
  newDashboardChart,
  insertDashboardChart,
  moveDashboardChart,
  validDashboardLayout,
  dashboardLayoutNamespace,
  chartInstanceTitle,
} from "../src/lib/dashboard-charts.ts"
import { createDashboardLayoutClient } from "../src/lib/dashboard-layout-client.ts"
import {
  dashboardChartSeries,
  dashboardChartFormat,
  dashboardClock,
  dashboardPerformanceSeries,
} from "../src/lib/dashboard-chart-series.ts"
import { aggregateActivityHistory } from "../src/lib/aggregate-analysis.ts"
import { calendarMetricFields } from "../../app-backend/lib/calendar-metrics-model.mjs"
import { newMacronutrientSettings } from "../src/lib/dashboard-macronutrients.ts"
import {
  dashboardChartDatePresets,
  dashboardChartSports,
} from "../src/lib/dashboard-chart-settings.ts"

const range = { start: "2026-09-23", end: "2026-10-20" }

test("actual nutrition settings render the observed title, 25 dates and five radios without ineffective sports or average controls", () => {
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
  assert.ok(node, "The real settings component must exist")
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
      newMacronutrientSettings,
      newDashboardPowerSettings: () => ({}),
      dashboardChartDatePresets,
      dashboardChartSports,
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
    render = (instance) =>
      renderToStaticMarkup(
        React.createElement(Component, {
          instance,
          today: range.end,
          dashboardRange: range,
          onClose() {},
          onApply: async () => true,
        })
      ),
    current = newDashboardChart("macronutrients", range, "nutrition-controls"),
    html = render(current)
  assert.match(html, /Custom Title:/)
  assert.match(html, /aria-label="Custom Title"/)
  assert.equal((html.match(/<option /g) || []).length, 25)
  assert.equal((html.match(/type="radio"/g) || []).length, 5)
  assert.equal((html.match(/<select/g) || []).length, 1)
  assert.doesNotMatch(
    html,
    /type="checkbox"|Workout Types|Show Average|Comparison/
  )
  assert.match(html, /<legend>Group by<\/legend>/)
  assert.match(html, /<legend>Display by<\/legend>/)
  assert.match(html, /checked=""\/>Week/)
  assert.match(html, /checked=""\/>Display by Calories/)
  delete current.macronutrients
  assert.equal(
    render(current),
    html,
    "An old saved instance without new settings must render the same real defaults"
  )
  for (const type of ["duration", "longest-distance"]) {
    const generic = render(
      newDashboardChart(type, range, "observed-title-label")
    )
    assert.match(generic, /Custom Title:/)
    assert.match(generic, /aria-label="Custom Title"/)
    assert.doesNotMatch(generic, /aria-label="Title"/)
  }
})

test("provider performance has explicit null calendar days, no invented TSB and preserves genuine zero or negative form", () => {
  const result = dashboardPerformanceSeries(
    [
      { date: "2026-10-21", ctl: 0, atl: 0, tsb: -2 },
      { date: "2026-10-19", ctl: 30, atl: 40 },
      { date: "2026-10-18", ctl: 99, atl: 99, tsb: 99 },
      { date: "invalid", ctl: 80 },
    ],
    { start: "2026-10-19", end: "2026-10-22" }
  )
  assert.deepEqual(result, [
    { date: "2026-10-19", fitness: 30, fatigue: 40, form: null },
    { date: "2026-10-20", fitness: null, fatigue: null, form: null },
    { date: "2026-10-21", fitness: 0, fatigue: 0, form: -2 },
    { date: "2026-10-22", fitness: null, fatigue: null, form: null },
  ])
  assert.throws(
    () =>
      dashboardPerformanceSeries([], {
        start: "2026-10-22",
        end: "2026-10-19",
      }),
    /start date/
  )
})

test("a queued old-connection write never dispatches after the first held write crosses a connection change", async () => {
  const key = dashboardLayoutNamespace("A"),
    gate = defer()
  let active = "A",
    requests = 0
  const client = createDashboardLayoutClient(
    key,
    async (_path, options) => {
      requests++
      const snapshot = JSON.parse(options.body).training_preferences[key]
      await gate.promise
      return response(key, snapshot)
    },
    1000,
    () => active === "A"
  )
  const first = client.save(layout()),
    second = client.save(layout()),
    firstRejected = assert.rejects(first, /Connection changed/),
    secondRejected = assert.rejects(second, /Connection changed/)
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(requests, 1)
  active = "B"
  gate.resolve()
  await Promise.all([firstRejected, secondRejected])
  assert.equal(requests, 1)
  await assert.rejects(client.load(), /Connection changed/)
  assert.equal(requests, 1)
})

test("plotted real measurements preserve unknown vs zero and actual longest-duration maxima without fabricating duration curves", () => {
  const span = { start: "2026-10-19", end: "2026-10-21" },
    record = (id, date, values) => ({
      id: `activity:${id}`,
      activity_id: id,
      status: "completed",
      workout_date: date,
      sport: "Run",
      title: id,
      workout_summary: { completed: values, planned: null },
    })
  const data = aggregateActivityHistory(
    [
      record("one", span.start, { tss: 0, duration_seconds: 60, max_speed: 4 }),
      record("two", span.start, {
        tss: null,
        duration_seconds: null,
        max_speed: 5,
      }),
      record("three", "2026-10-20", { tss: null, max_speed: 10 }),
    ],
    { ...span, period: "day" }
  )
  const tss = newDashboardChart("tss", span, "tss-1"),
    series = dashboardChartSeries(tss, data, [], span)
  assert.deepEqual(
    series.rows.map((row) => row.value),
    [0, null, 0]
  )
  assert.equal(series.rows[0].missing, 1)
  assert.equal(series.mean, 0)
  const longest = newDashboardChart("longest-duration", span, "longest-1"),
    peaks = dashboardChartSeries(longest, data, [], span)
  assert.deepEqual(peaks.values, [60])
  assert.equal(peaks.mean, 60)
  assert.equal(dashboardChartFormat(longest, peaks.values[0]), "0:01:00")
  assert.equal(dashboardChartDefinition("peak-power").kind, "power-curve")
  assert.equal(dashboardChartDefinition("peak-hr").kind, "heart-rate-curve")
  assert.match(
    dashboardChartDefinition("power-profile").unavailable,
    /maximum does not establish/
  )
  assert.equal(dashboardClock(59.8), "0:01:00")
  const swim = newDashboardChart("distance", span, "swim-distance")
  swim.settings.sports = ["Swim"]
  assert.equal(dashboardChartFormat(swim, 914.4), "1,000 yd")
  swim.settings.sports = ["Swim", "Run"]
  assert.equal(dashboardChartFormat(swim, 1609.344), "1 mi")
})
test("weekly wellness keeps the last recorded snapshot including clear and measured zero without adding athlete measurements", () => {
  const span = { start: "2026-10-19", end: "2026-10-28" },
    instance = newDashboardChart("metrics", span, "metrics-1"),
    entries = (value) =>
      Object.fromEntries(
        calendarMetricFields.map((field) => [
          field.key,
          {
            value: field.key === "weight" ? value : null,
            time: null,
            source: "manual",
          },
        ])
      )
  const data = aggregateActivityHistory([], span),
    series = dashboardChartSeries(
      instance,
      data,
      [
        { date: "2026-10-19", calendar_metrics: entries(150) },
        { date: "2026-10-20", calendar_metrics: entries(0) },
        { date: "2026-10-26", calendar_metrics: entries(155) },
        { date: "2026-10-28", calendar_metrics: entries(null) },
      ],
      span
    )
  assert.deepEqual(
    series.rows.map((row) => [row.date, row.value]),
    [
      ["2026-10-20", 0],
      ["2026-10-28", null],
    ]
  )
  assert.equal(series.mean, 0)
  assert.equal(dashboardChartFormat(instance, 0), "0 lbs")
})
const layout = () => migratedDashboardLayout(undefined, range)
const response = (key, value, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { training_preferences: { [key]: value } }
        : { error: "Rejected preference write" }
    ),
    { status, headers: { "Content-Type": "application/json" } }
  )
const defer = () => {
  let resolve
  return { promise: new Promise((done) => (resolve = done)), resolve }
}

test("Longest Distance uses the observed sport-qualified default, keeps custom titles through reload, and rejects invalid stale sport preferences", async () => {
  const instance = newDashboardChart(
    "longest-distance",
    range,
    "longest-observed"
  )
  assert.equal(
    chartInstanceTitle(instance),
    "Longest Workout (Distance): All Workout Types"
  )
  assert.equal(instance.settings.period, "week")
  assert.equal(instance.settings.showAverage, true)
  instance.settings.sports = ["Run"]
  assert.equal(chartInstanceTitle(instance), "Longest Workout (Distance): Run")
  instance.settings.sports = ["Bike", "Mtn Bike"]
  assert.equal(
    chartInstanceTitle(instance),
    "Longest Workout (Distance): Bike, Mtn Bike"
  )
  assert.equal(
    chartInstanceTitle(
      newDashboardChart("longest-duration", range, "duration-unobserved")
    ),
    "Longest Workout (Duration)",
    "Do not invent a title formula for an unobserved chart"
  )
  instance.settings.title = "Longest day on the bike"
  const expected = { version: 2, instances: [instance] },
    key = dashboardLayoutNamespace("longest-title-account"),
    stale = structuredClone(expected)
  stale.instances[0].settings.sports = ["Ride"]
  assert.equal(
    validDashboardLayout(stale),
    false,
    "UI settings contain reference labels, not unvalidated provider enum names"
  )
  let reads = 0
  const client = createDashboardLayoutClient(key, async () =>
    response(key, ++reads === 1 ? stale : expected)
  )
  await assert.rejects(client.load(), /invalid/)
  const loaded = await client.load()
  assert.equal(
    chartInstanceTitle(loaded.instances[0]),
    "Longest day on the bike"
  )
  assert.deepEqual(loaded.instances[0].settings.sports, ["Bike", "Mtn Bike"])
  assert.equal(
    instance.settings.title,
    "Longest day on the bike",
    "A rejected stale server response cannot rewrite the local custom title"
  )
  loaded.instances[0].settings.title = "  "
  assert.equal(
    chartInstanceTitle(loaded.instances[0]),
    "Longest Workout (Distance): Bike, Mtn Bike"
  )
})

test("nutrition instances migrate to real Week/Calories and preserve independent strict grouping/display preferences and custom titles", async () => {
  const first = newDashboardChart("macronutrients", range, "nutrition-one"),
    second = newDashboardChart("macronutrients", range, "nutrition-two")
  assert.equal(
    dashboardChartDefinition("macronutrients").kind,
    "macronutrients"
  )
  assert.deepEqual(first.macronutrients, {
    period: "week",
    display: "calories",
  })
  assert.equal(chartInstanceTitle(first), "Macronutrients by Week")
  const old = { ...first }
  delete old.macronutrients
  assert.equal(validDashboardLayout({ version: 2, instances: [old] }), true)
  assert.equal(chartInstanceTitle(old), "Macronutrients by Week")
  assert.deepEqual(
    migratedDashboardLayout(["macronutrients"], range).instances[0]
      .macronutrients,
    first.macronutrients
  )
  first.macronutrients.period = "month"
  first.macronutrients.display = "percentage"
  assert.equal(chartInstanceTitle(first), "Macronutrients by Month")
  assert.deepEqual(second.macronutrients, {
    period: "week",
    display: "calories",
  })
  second.macronutrients.period = "day"
  assert.equal(chartInstanceTitle(second), "Macronutrients by Day")
  first.settings.title = "Daily fuel review"
  assert.equal(chartInstanceTitle(first), "Daily fuel review")
  const key = dashboardLayoutNamespace("nutrition-account"),
    snapshot = { version: 2, instances: [first, second] },
    requests = []
  const client = createDashboardLayoutClient(key, async (_path, options) => {
    const sent = JSON.parse(options.body).training_preferences[key]
    requests.push(sent)
    return response(key, sent)
  })
  assert.deepEqual(await client.save(snapshot), snapshot)
  assert.deepEqual(
    requests[0].instances.map((row) => row.macronutrients),
    [
      { period: "month", display: "percentage" },
      { period: "day", display: "calories" },
    ]
  )
  for (const invalid of [
    null,
    [],
    {},
    { period: "year", display: "calories" },
    { period: "day", display: "grams" },
    { period: "week", display: "calories", sports: ["Run"] },
  ]) {
    const malformed = {
      version: 2,
      instances: [{ ...first, macronutrients: invalid }],
    }
    assert.equal(validDashboardLayout(malformed), false)
    await assert.rejects(client.save(malformed), /invalid/)
  }
  assert.equal(
    requests.length,
    1,
    "Invalid nutrition preferences must never reach transport"
  )
  await assert.rejects(
    createDashboardLayoutClient(key, async (_path, options) => {
      const altered = JSON.parse(options.body).training_preferences[key]
      altered.instances[0].macronutrients.display = "calories"
      return response(key, altered)
    }).save(snapshot),
    /did not confirm/,
    "A success status with wrong nutrition settings is not a saved layout"
  )
})

test("catalog contains all 27 observed distinct charts and migration preserves selected old charts without duplicate instance IDs", () => {
  assert.equal(dashboardChartCatalog.length, 27)
  assert.equal(new Set(dashboardChartCatalog.map((row) => row.id)).size, 27)
  const migrated = migratedDashboardLayout(
    ["run", "run", "duration", "zones", "fitness", "unknown"],
    range
  )
  assert.equal(validDashboardLayout(migrated), true)
  assert.deepEqual(
    migrated.instances.map((row) => row.type),
    ["distance", "duration", "hr-zones", "fitness-history"]
  )
  assert.deepEqual(migrated.instances[0].settings.sports, ["Run"])
  assert.equal(migrated.instances[0].settings.title, "Run Distance")
  assert.deepEqual(
    layout().instances.map((row) => row.id),
    [
      "legacy-duration",
      "legacy-tss",
      "legacy-performance",
      "legacy-run",
      "legacy-bike",
      "legacy-swim",
      "legacy-zones",
      "legacy-fitness",
    ]
  )
})
test("duplicate chart instances have independent settings and move/remove preserve every remaining stable identity", () => {
  const initial = layout(),
    copy = structuredClone(initial.instances[0])
  copy.id = "duplicate-duration"
  copy.settings.title = "Run time"
  copy.settings.sports = ["Run"]
  const duplicated = insertDashboardChart(initial, copy, 1),
    moved = moveDashboardChart(duplicated, copy.id, 8)
  assert.equal(initial.instances.length, 8)
  assert.equal(initial.instances[0].settings.title, "Total Duration")
  assert.equal(moved.instances.at(-1).id, copy.id)
  assert.equal(new Set(moved.instances.map((row) => row.id)).size, 9)
  assert.equal(validDashboardLayout(moved), true)
  assert.throws(
    () => insertDashboardChart(initial, initial.instances[0]),
    /already/
  )
  const invalid = structuredClone(initial)
  invalid.instances[0].settings.preset = "undefined-range"
  assert.equal(validDashboardLayout(invalid), false)
  assert.equal(
    validDashboardLayout({
      ...initial,
      instances: [...initial.instances, initial.instances[0]],
    }),
    false
  )
})
test("sport controls preserve Mountain Bike and explicit private variants without inferring presentation from titles", () => {
  const row = (id, sport, extra = {}) => ({
    id,
    sport,
    title: "Brick Day off Custom",
    ...extra,
  })
  const records = [
    row("road", "Bike"),
    row("mountain", "Bike", { activity_type: "MountainBikeRide" }),
    row("brick", "Other", { display_variant: "brick" }),
    row("other", "Other"),
    row("run", "Run"),
    row("race", "Run", { category: "RACE_A" }),
  ]
  assert.deepEqual(records.map(dashboardWorkoutSport), [
    "Bike",
    "Mtn Bike",
    "Brick",
    "Other",
    "Run",
    "Race",
  ])
  assert.deepEqual(
    filterDashboardWorkouts(records, ["Bike"]).map((row) => row.id),
    ["road"]
  )
  assert.deepEqual(
    filterDashboardWorkouts(records, ["Bike", "Mtn Bike"], "bike").map(
      (row) => row.id
    ),
    ["road", "mountain"]
  )
  assert.deepEqual(
    filterDashboardWorkouts(records, ["Brick", "Run"], "all").map(
      (row) => row.id
    ),
    ["brick", "run"]
  )
})
test("preferences write queue sends complete immutable snapshots serially, scoped to one connection and only confirms exact readback", async () => {
  const key = dashboardLayoutNamespace("connection-A"),
    hold = defer(),
    calls = [],
    first = layout(),
    second = insertDashboardChart(
      first,
      newDashboardChart("calories", range, "calories-1")
    )
  const client = createDashboardLayoutClient(key, async (path, options) => {
    const sent = JSON.parse(options.body)
    calls.push({ path, sent })
    if (calls.length === 1) await hold.promise
    return response(key, sent.training_preferences[key])
  })
  const saving = client.save(first),
    later = client.save(second)
  first.instances[0].settings.title = "Local mutation after enqueue"
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].sent.training_preferences[key].instances[0].settings.title,
    "Total Duration"
  )
  hold.resolve()
  await Promise.all([saving, later])
  assert.equal(calls.length, 2)
  assert.equal(calls[1].sent.training_preferences[key].instances.length, 9)
  assert.deepEqual(Object.keys(calls[0].sent), ["training_preferences"])
  assert.deepEqual(Object.keys(calls[0].sent.training_preferences), [key])
})
test("rejected, incomplete and incorrect 200 preference readbacks fail without hiding the next queued retry", async () => {
  const key = dashboardLayoutNamespace("connection-A")
  let calls = 0
  const client = createDashboardLayoutClient(key, async (_path, options) => {
    calls++
    const sent = JSON.parse(options.body).training_preferences[key]
    if (calls === 1) return response(key, null, 503)
    if (calls === 2) {
      sent.instances[0].settings.sports = ["Swim"]
      return response(key, sent)
    }
    return response(key, sent)
  })
  await assert.rejects(client.save(layout()), /Rejected/)
  await assert.rejects(client.save(layout()), /did not confirm/)
  assert.deepEqual(await client.save(layout()), layout())
  assert.equal(calls, 3)
  await assert.rejects(
    createDashboardLayoutClient(key, async () => new Response("{}")).load(),
    /incomplete/
  )
  assert.equal(
    await createDashboardLayoutClient(key, async () =>
      response("different-connection", layout())
    ).load(),
    null
  )
})
test("two connection clients do not overwrite another namespace and invalid drafts do not reach the transport", async () => {
  const store = { unrelated: { keep: true } },
    writes = []
  const request = async (_path, options) => {
    if (options.method === "POST") {
      const patch = JSON.parse(options.body).training_preferences
      writes.push(patch)
      Object.assign(store, patch)
    }
    return new Response(JSON.stringify({ training_preferences: store }))
  }
  const a = createDashboardLayoutClient(dashboardLayoutNamespace("A"), request),
    b = createDashboardLayoutClient(dashboardLayoutNamespace("B"), request)
  await a.save(layout())
  await b.save(migratedDashboardLayout(["tss"], range))
  assert.equal((await a.load()).instances.length, 8)
  assert.equal((await b.load()).instances.length, 1)
  assert.deepEqual(store.unrelated, { keep: true })
  await assert.rejects(
    a.save({ version: 2, instances: [{ id: "bad" }] }),
    /invalid/
  )
  assert.equal(writes.length, 2)
})
test("hanging preference body and explicit aborted loads settle without a fabricated server acknowledgement", async () => {
  const key = dashboardLayoutNamespace("A"),
    client = createDashboardLayoutClient(
      key,
      async () => ({ ok: true, json: () => new Promise(() => {}) }),
      20
    )
  await assert.rejects(client.save(layout()), /too long/)
  const controller = new AbortController(),
    pending = createDashboardLayoutClient(
      key,
      async () => new Promise(() => {}),
      1000
    ).load(controller.signal)
  controller.abort(new Error("Closed dashboard"))
  await assert.rejects(pending, /Closed dashboard/)
})
