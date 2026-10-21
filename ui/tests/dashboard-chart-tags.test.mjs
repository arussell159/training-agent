import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import React from "../node_modules/react/index.js"
import { renderToStaticMarkup } from "../node_modules/react-dom/server.node.js"
import ts from "../node_modules/typescript/lib/typescript.js"
import {
  parseDashboardTagCatalog,
  parseDashboardTaggedCurve,
  createDashboardTagClient,
  validDashboardTags,
} from "../src/lib/dashboard-chart-tags.ts"
import {
  newDashboardChart,
  validDashboardLayout,
  dashboardChartDefinition,
  chartInstanceTitle,
} from "../src/lib/dashboard-charts.ts"
import {
  dashboardChartDatePresets,
  dashboardChartSports,
  resolveDashboardChartRange,
} from "../src/lib/dashboard-chart-settings.ts"
import { newDashboardPowerSettings } from "../src/lib/dashboard-power-curve.ts"
import { newMacronutrientSettings } from "../src/lib/dashboard-macronutrients.ts"
import {
  createDashboardHeartRateClient,
  recordedHeartRateRange,
} from "../src/lib/dashboard-heart-rate-curve.ts"
import { heartRateSportMatches } from "../../app-backend/lib/heart-rate-curve-model.mjs"
import { createDashboardCadenceClient } from "../src/lib/dashboard-cadence-curve.ts"
import { createDashboardVelocityClient } from "../src/lib/dashboard-velocity-curve.ts"
import { createDashboardPowerClient } from "../src/lib/dashboard-power-curve.ts"
import { createDesktopChartTagsFixtures } from "../../tools/desktop-chart-tags-fixtures.mjs"

const range = { start: "2026-10-01", end: "2026-10-20" },
  today = range.end
const catalog = () => ({
  version: 1,
  source: "intervals-activity-tags",
  accountScope: "a".repeat(64),
  revision: "b".repeat(64),
  checkedAt: "2026-10-20T12:00:00.000Z",
  tags: ["Élite, morning", "All", "Running", "Cycling"],
})
const policies = {
  heartRate: ["bpm", "native-bpm"],
  power: ["W", "native-watts"],
  cadence: ["rpm", "native-rpm"],
  velocity: ["m/s", "native-velocity-smooth"],
}
const dto = (
  kind = "velocity",
  tags = ["Élite, morning"],
  sport = "all",
  span = range
) => ({
  version: 2,
  kind,
  unit: policies[kind][0],
  source: "intervals-tagged-activity-curves",
  unitPolicy: policies[kind][1],
  valuePolicy: "native-reported",
  tagsSupported: true,
  accountScope: catalog().accountScope,
  catalogRevision: catalog().revision,
  selection: {
    sport,
    nativeTypes: sport === "all" ? [] : sport.split(","),
    tags: [...tags],
    tagMatch: "any",
  },
  window: { oldest: span.start, newest: span.end },
  points: [
    {
      duration_seconds: 5,
      value: 0,
      activity_id: "i123",
      native_type: "Run",
      date: "2026-10-19",
      name: "Native source",
      estimated: false,
      sourceTags: [...tags, "Another native tag"],
    },
    {
      duration_seconds: 17,
      value: null,
      activity_id: "i123",
      native_type: "Run",
      date: "2026-10-19",
      name: "Native source",
      estimated: false,
      sourceTags: [...tags, "Another native tag"],
    },
  ],
  coverage: {
    status: "partial",
    inventoryRecords: 4,
    matchedRecordings: 2,
    unmatchedRecordings: 1,
    unknownMembershipRecordings: 1,
    eligibleRecordings: 1,
    excludedWithoutStream: 0,
    excludedIgnoredRecordings: 1,
    fetchedRecordings: 1,
    failedRecordings: 0,
    missingRecordings: 0,
    skippedForCap: 0,
    unknownPoints: 1,
    invalidInventoryRecords: 0,
    conflictingRecordings: 0,
  },
  warning: "Some recording tag membership is unavailable.",
})
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status })
test("actual native catalog preserves exact Unicode, comma and literal All names and distinguishes verified empty from malformed data", () => {
  const result = parseDashboardTagCatalog(catalog())
  assert.deepEqual(result.tags, catalog().tags)
  result.tags.pop()
  assert.equal(catalog().tags.length, 4)
  assert.deepEqual(
    parseDashboardTagCatalog({ ...catalog(), tags: [] }).tags,
    []
  )
  for (const change of [
    { source: "private-tags" },
    { accountScope: "bad" },
    { revision: "bad" },
    { checkedAt: "not a date" },
    { tags: ["x", "x"] },
    { tags: [""] },
    { tags: ["\n"] },
  ])
    assert.throws(() => parseDashboardTagCatalog({ ...catalog(), ...change }))
})
test("filtered full axes retain real zero, unknown samples and absent anchors with exact selected tags and provenance for all four kinds", () => {
  for (const kind of Object.keys(policies)) {
    const result = parseDashboardTaggedCurve(
      dto(kind),
      kind,
      "all",
      range,
      today,
      ["Élite, morning"],
      catalog()
    )
    assert.equal(result.version, 2)
    assert.deepEqual(
      result.points.map((p) => [p.duration_seconds, p.value]),
      [
        [5, 0],
        [17, null],
      ]
    )
    assert.equal(
      result.points.some((p) => p.duration_seconds === 10),
      false
    )
    assert.deepEqual(result.points[0].sourceTags, [
      "Élite, morning",
      "Another native tag",
    ])
  }
})
test("wrong successful filtered responses reject account/revision, OR semantics, source membership, window, sport and noncanonical axes", () => {
  const corruptions = [
    (v) => (v.accountScope = "c".repeat(64)),
    (v) => (v.catalogRevision = "c".repeat(64)),
    (v) => (v.selection.tags = ["Running"]),
    (v) => (v.selection.tagMatch = "all"),
    (v) => (v.selection.nativeTypes = ["Run"]),
    (v) => (v.window.oldest = "2026-09-01"),
    (v) => (v.unit = "mph"),
    (v) => (v.points[0].sourceTags = ["Running"]),
    (v) => (v.points[1].activity_id = null),
    (v) => (v.points[0].date = "2026-09-01"),
    (v) => (v.points[0].native_type = "Brick"),
    (v) => (v.points[1].duration_seconds = 5),
    (v) => (v.points[0].value = -1),
    (v) => (v.points[0].estimated = true),
    (v) => (v.points[0].end_index = 5),
  ]
  for (const corrupt of corruptions) {
    const value = dto()
    corrupt(value)
    assert.throws(() =>
      parseDashboardTaggedCurve(
        value,
        "velocity",
        "all",
        range,
        today,
        ["Élite, morning"],
        catalog()
      )
    )
  }
})
test("filtered coverage cannot hide uncertain membership, source failures, cap exclusions or impossible identity partitions", () => {
  for (const change of [
    { status: "available-recordings" },
    { inventoryRecords: 3 },
    { eligibleRecordings: 2 },
    { fetchedRecordings: 129 },
    { unknownPoints: 0 },
    { failedRecordings: 2 },
    { invalidInventoryRecords: -1 },
  ]) {
    const value = dto()
    Object.assign(value.coverage, change)
    assert.throws(() =>
      parseDashboardTaggedCurve(
        value,
        "velocity",
        "all",
        range,
        today,
        ["Élite, morning"],
        catalog()
      )
    )
  }
})
test("actual production projection and native fixture reach all four strict clients with OR maxima and current full membership", async () => {
  const fixture = createDesktopChartTagsFixtures({ today }),
    nativeCatalog = parseDashboardTagCatalog(
      await fixture.catalog.load(fixture.config, { actor: fixture.actor })
    )
  for (const kind of Object.keys(policies)) {
    const input = {
      kind,
      sport: "all",
      start: range.start,
      end: range.end,
      tags: JSON.stringify(["Running", "Cycling"]),
      tagScope: nativeCatalog.accountScope,
      tagRevision: nativeCatalog.revision,
    }
    const raw = await fixture.service.load(fixture.config, input, {
        actor: fixture.actor,
      }),
      result = parseDashboardTaggedCurve(
        raw,
        kind,
        "all",
        range,
        today,
        ["Running", "Cycling"],
        nativeCatalog
      )
    assert.equal(result.coverage.status, "partial")
    assert.ok(result.coverage.unknownMembershipRecordings > 0)
    assert.ok(
      result.points.every(
        (point) =>
          point.sourceTags.includes("Running") ||
          point.sourceTags.includes("Cycling")
      )
    )
    assert.equal(
      result.points.find((point) => point.duration_seconds === 17).value,
      null
    )
  }
})
test("exact OR selection is transported as JSON with catalog scope/revision and one native tag named All is not the sentinel", async () => {
  const calls = [],
    client = createDashboardTagClient(async (path) => {
      calls.push(path)
      if (path === "/api/chart-tags") return response(catalog())
      const q = new URL(path, "http://localhost").searchParams
      return response(
        dto(q.get("kind"), JSON.parse(q.get("tags")), q.get("sport"), {
          start: q.get("start"),
          end: q.get("end"),
        })
      )
    })
  await client.load("connection", "velocity", "all", range, today, [
    "Running",
    "Cycling",
  ])
  await client.load("connection", "velocity", "all", range, today, ["All"])
  const queries = calls
    .filter((path) => path !== "/api/chart-tags")
    .map((path) => new URL(path, "http://localhost").searchParams)
  assert.deepEqual(JSON.parse(queries[0].get("tags")), ["Running", "Cycling"])
  assert.equal(queries[0].get("tagScope"), catalog().accountScope)
  assert.equal(queries[0].get("tagRevision"), catalog().revision)
  assert.deepEqual(JSON.parse(queries[1].get("tags")), ["All"])
  client.clear()
})
test("missing native tags and changed account/revision fail without a broad unfiltered request, and explicit reload permits a real retry", async () => {
  let catalogReads = 0,
    curveReads = 0,
    reject = true
  const client = createDashboardTagClient(async (path) => {
    if (path === "/api/chart-tags") {
      catalogReads++
      return response(catalog())
    }
    curveReads++
    return reject
      ? response({ error: "Native recording tags changed" }, 409)
      : response(dto())
  })
  await assert.rejects(
    client.load("scope", "velocity", "all", range, today, ["Deleted"]),
    /no longer available/
  )
  assert.equal(curveReads, 0)
  await assert.rejects(
    client.load("scope", "velocity", "all", range, today, ["Élite, morning"]),
    /changed/
  )
  assert.equal(curveReads, 1)
  reject = false
  await client.load(
    "scope",
    "velocity",
    "all",
    range,
    today,
    ["Élite, morning"],
    { revision: 1 }
  )
  assert.equal(catalogReads, 2)
  assert.equal(curveReads, 2)
  client.clear()
})
test("each explicit catalog reload makes a fresh verified read after reopen and filtered caches bind the returned catalog revision", async () => {
  let reads = 0,
    curveReads = 0,
    revision = "b".repeat(64)
  const client = createDashboardTagClient(async (path) => {
    if (path === "/api/chart-tags") {
      reads++
      return response({ ...catalog(), revision })
    }
    curveReads++
    const value = dto()
    value.catalogRevision = revision
    return response(value)
  })
  await client.catalog("A", { force: true })
  await client.load("A", "velocity", "all", range, today, ["Élite, morning"])
  revision = "c".repeat(64)
  const reopened = await client.catalog("A", { force: true })
  assert.equal(reopened.revision, revision)
  const result = await client.load("A", "velocity", "all", range, today, [
    "Élite, morning",
  ])
  assert.equal(result.catalogRevision, revision)
  assert.equal(reads, 2)
  assert.equal(curveReads, 2)
  client.clear()
})
test("filtered requests share only equal account, kind, exact selection and range, clone snapshots and isolate canceled readers", async () => {
  let reads = 0,
    release
  const held = new Promise((resolve) => (release = resolve)),
    client = createDashboardTagClient(async (path) => {
      if (path === "/api/chart-tags") return response(catalog())
      reads++
      await held
      const q = new URL(path, "http://localhost").searchParams
      return response(
        dto(q.get("kind"), JSON.parse(q.get("tags")), q.get("sport"))
      )
    })
  const abort = new AbortController(),
    first = client.load("A", "velocity", "all", range, today, ["Running"], {
      signal: abort.signal,
    }),
    second = client.load("A", "velocity", "all", range, today, ["Running"])
  const rejected = assert.rejects(first, /abort/i)
  await new Promise((resolve) => setTimeout(resolve, 0))
  abort.abort()
  release()
  await rejected
  const result = await second
  assert.equal(reads, 1)
  result.points[0].value = 999
  assert.equal(
    (await client.load("A", "velocity", "all", range, today, ["Running"]))
      .points[0].value,
    0
  )
  await client.load("B", "velocity", "all", range, today, ["Running"])
  await client.load("A", "cadence", "all", range, today, ["Running"])
  assert.equal(reads, 3)
  client.clear()
})
test("eight distinct filtered windows are limited to four active reads and a canceled queued window never reaches HTTP", async () => {
  let active = 0,
    maximum = 0
  const calls = [],
    releases = [],
    client = createDashboardTagClient(async (path) => {
      if (path === "/api/chart-tags") return response(catalog())
      const q = new URL(path, "http://localhost").searchParams
      calls.push(q.get("start"))
      active++
      maximum = Math.max(maximum, active)
      try {
        await new Promise((done) => releases.push(done))
        return response(
          dto("velocity", ["Running"], "all", {
            start: q.get("start"),
            end: q.get("end"),
          })
        )
      } finally {
        active--
      }
    })
  const abort = new AbortController(),
    reads = Array.from({ length: 9 }, (_, index) =>
      client.load(
        "A",
        "velocity",
        "all",
        { start: `2026-10-0${index + 1}`, end: today },
        today,
        ["Running"],
        { signal: index === 4 ? abort.signal : undefined }
      )
    )
  const outcomes = Promise.allSettled(reads)
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(calls.length, 4)
  abort.abort()
  releases.splice(0).forEach((done) => done())
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(calls.length, 8)
  assert.equal(calls.includes("2026-10-05"), false)
  releases.splice(0).forEach((done) => done())
  const result = await outcomes
  assert.equal(result.filter((row) => row.status === "fulfilled").length, 8)
  assert.equal(maximum, 4)
  client.clear()
})
test("queued windows receive their full independent network deadline after admission", async () => {
  let active = 0,
    maximum = 0,
    requests = 0
  const client = createDashboardTagClient(
    async (path) => {
      if (path === "/api/chart-tags") return response(catalog())
      const q = new URL(path, "http://localhost").searchParams
      active++
      requests++
      maximum = Math.max(maximum, active)
      try {
        await new Promise((done) => setTimeout(done, 20))
        return response(
          dto("velocity", ["Running"], "all", {
            start: q.get("start"),
            end: today,
          })
        )
      } finally {
        active--
      }
    },
    { readTimeoutMs: 50 }
  )
  const started = Date.now(),
    results = await Promise.all(
      Array.from({ length: 9 }, (_, index) =>
        client.load(
          "A",
          "velocity",
          "all",
          { start: `2026-10-0${index + 1}`, end: today },
          today,
          ["Running"]
        )
      )
    )
  assert.equal(results.length, 9)
  assert.equal(requests, 9)
  assert.equal(maximum, 4)
  assert.ok(
    Date.now() - started >= 50,
    "The complete queue must exceed one request's50ms deadline without losing waiting reads"
  )
  client.clear()
})
test("client clear aborts admitted and waiting readers so old queued work cannot dispatch after auth/reset", async () => {
  const calls = []
  let held = true
  const client = createDashboardTagClient(async (path, options) => {
    if (path === "/api/chart-tags") return response(catalog())
    const q = new URL(path, "http://localhost").searchParams
    calls.push(q.get("start"))
    if (held)
      await new Promise((resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true }
        )
      })
    return response(
      dto("velocity", ["Running"], "all", { start: q.get("start"), end: today })
    )
  })
  const settled = Promise.allSettled(
    Array.from({ length: 9 }, (_, index) =>
      client.load(
        "A",
        "velocity",
        "all",
        { start: `2026-10-0${index + 1}`, end: today },
        today,
        ["Running"]
      )
    )
  )
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(calls.length, 4)
  client.clear()
  const results = await settled
  assert.equal(results.filter((row) => row.status === "rejected").length, 9)
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(calls.length, 4)
  held = false
  await client.load("B", "velocity", "all", range, today, ["Running"])
  assert.equal(calls.length, 5)
  client.clear()
})
test("all four real chart clients route nonempty tags through v2 while future-only requests avoid catalog and source I/O", async () => {
  const calls = [],
    request = async (path) => {
      calls.push(path)
      if (path === "/api/chart-tags") return response(catalog())
      const q = new URL(path, "http://localhost").searchParams
      assert.equal(q.get("end"), today)
      return response(
        dto(q.get("kind"), JSON.parse(q.get("tags")), q.get("sport"))
      )
    }
  const clients = [
    createDashboardHeartRateClient(request),
    createDashboardCadenceClient(request),
    createDashboardVelocityClient(request),
  ]
  for (const client of clients) {
    const result = await client.load(
      "A",
      "all",
      { ...range, end: "2026-10-22" },
      today,
      { tags: ["Running"] }
    )
    assert.equal(result.version, 2)
    assert.equal(result.effectiveRange.end, today)
  }
  const power = createDashboardPowerClient(request),
    result = await power.load("A", range, today, {
      tags: ["Running"],
      sport: "all",
    })
  assert.equal(result.points[0].value, 0)
  assert.equal(result.points[0].native_type, "Run")
  assert.deepEqual(result.samples, [
    { seconds: 5, watts: 0 },
    { seconds: 17, watts: null },
  ])
  const previous = calls.length
  for (const client of clients)
    await client.load(
      "A",
      "all",
      { start: "2026-10-21", end: "2026-10-22" },
      today,
      { tags: ["Running"] }
    )
  await power.load("A", { start: "2026-10-21", end: "2026-10-22" }, today, {
    tags: ["Running"],
  })
  assert.equal(calls.length, previous)
  for (const client of [...clients, power]) client.clear()
})
test("tag preferences are independent, preserve exact values on roundtrip and reject ambiguous stale or unsupported layouts", () => {
  const first = newDashboardChart("peak-hr", range, "a"),
    second = newDashboardChart("peak-hr", range, "b")
  first.tags = ["Élite, morning"]
  second.tags = ["All"]
  const layout = { version: 2, instances: [first, second] }
  assert.ok(validDashboardLayout(JSON.parse(JSON.stringify(layout))))
  second.tags = []
  assert.deepEqual(first.tags, ["Élite, morning"])
  for (const tags of [
    ["x", "x"],
    [""],
    Array.from({ length: 21 }, (_, i) => String(i)),
    "Running,Cycling",
  ]) {
    first.tags = tags
    assert.equal(validDashboardLayout(layout), false)
  }
  first.tags = ["Running"]
  first.type = "peak-pace-distance"
  assert.equal(validDashboardLayout(layout), false)
  assert.equal(validDashboardTags([" All "]), true)
})
function compileFunction(path, name, scope) {
  scope = { exports: {}, ...scope }
  const text = fs.readFileSync(new URL(path, import.meta.url), "utf8"),
    file = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    ),
    node = file.statements.find(
      (item) => ts.isFunctionDeclaration(item) && item.name?.text === name
    )
  assert.ok(node)
  const js = ts.transpileModule(node.getText(file), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return new Function(
    "require",
    ...Object.keys(scope),
    js + `;return ${name};`
  )(
    createRequire(new URL("../package.json", import.meta.url)),
    ...Object.values(scope)
  )
}
test("actual tag controls distinguish All from a recording tag named All and retain missing selections until an explicit decision", () => {
  let selected,
    states = [catalog(), "", false, 0],
    index = 0
  const Component = compileFunction(
    "../src/components/dashboard-chart-tag-settings.tsx",
    "DashboardChartTagSettings",
    {
      useState: () => [states[index++], () => {}],
      useEffect: () => {},
      trainingCacheScope: () => "A",
    }
  )
  const tree = Component({
    tags: ["Deleted", "All"],
    onChange: (value) => (selected = value),
    onCatalog() {},
    disabled: false,
  })
  const inputs = []
  function visit(value) {
    if (!value || typeof value !== "object") return
    if (value.type === "input") inputs.push(value.props)
    for (const child of React.Children.toArray(value.props?.children))
      visit(child)
  }
  visit(tree)
  assert.equal(inputs[0].checked, false)
  inputs[0].onChange()
  assert.deepEqual(selected, [])
  const literal = inputs.find(
    (input) => input["aria-label"] === "Recording tag: All"
  )
  assert.equal(literal.checked, true)
  literal.onChange({ target: { checked: false } })
  assert.deepEqual(selected, ["Deleted"])
  const html = renderToStaticMarkup(tree)
  assert.match(html, /Selected tags are unavailable: Deleted/)
  assert.match(html, /Reload recording tags/)
  assert.match(html, /Clear recording tags/)
})
test("actual chart settings expose real tag controls only on the four supported native sensor kinds", () => {
  const TagComponent = compileFunction(
    "../src/components/dashboard-chart-tag-settings.tsx",
    "DashboardChartTagSettings",
    { ...React, trainingCacheScope: () => "A" }
  )
  const Component = compileFunction(
    "../src/components/desktop-dashboard-charts.tsx",
    "ChartSettings",
    {
      ...React,
      dashboardChartDefinition,
      chartInstanceTitle,
      newMacronutrientSettings,
      newDashboardPowerSettings,
      dashboardChartDatePresets,
      dashboardChartSports,
      DashboardChartTagSettings: TagComponent,
      X: () => null,
    }
  )
  for (const type of [
    "peak-power",
    "peak-hr",
    "peak-cadence",
    "peak-speed",
    "peak-pace",
  ]) {
    const html = renderToStaticMarkup(
      React.createElement(Component, {
        instance: newDashboardChart(type, range, "a"),
        today,
        dashboardRange: range,
        onClose() {},
        onApply: async () => true,
      })
    )
    assert.match(html, /<legend>Select Tags<\/legend>/)
    assert.match(html, /Loading recording tags/)
    assert.doesNotMatch(html, /Tag filtering is unavailable/)
  }
  const html = renderToStaticMarkup(
    React.createElement(Component, {
      instance: newDashboardChart("peak-pace-distance", range, "a"),
      today,
      dashboardRange: range,
      onClose() {},
      onApply: async () => true,
    })
  )
  assert.doesNotMatch(html, /Select Tags/)
})

function compileCallback(path, name, scope) {
  const text = fs.readFileSync(new URL(path, import.meta.url), "utf8"),
    file = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
  let expression
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name)
      expression = node.initializer?.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(expression)
  const js = ts.transpileModule(`const callback=${expression}`, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return new Function(...Object.keys(scope), js + ";return callback;")(
    ...Object.values(scope)
  )
}
test("actual settings Apply retains invalid selections and rejected drafts, sends an independent exact tag snapshot and closes only on verified success", async () => {
  const instance = newDashboardChart("peak-hr", range, "settings"),
    tags = ["Élite, morning"],
    calls = [],
    state = { error: "", busy: false, closed: 0 }
  let accepted = false,
    reject = false
  const make = (tagCatalog) =>
    compileCallback("../src/components/desktop-dashboard-charts.tsx", "apply", {
      busy: false,
      tagAvailable: true,
      tags,
      tagCatalog,
      draft: instance.settings,
      today,
      dashboardRange: range,
      instance,
      fixedHistory: false,
      power: instance.hr,
      resolveDashboardChartRange,
      recordedHeartRateRange,
      setError: (value) => (state.error = value),
      setBusy: (value) => (state.busy = value),
      message: (reason) => reason.message,
      onClose: () => state.closed++,
      onApply: async (...args) => {
        calls.push(args)
        if (reject) throw Error("Preference acknowledgement lost")
        return accepted
      },
    })
  await make(null)(true)
  assert.equal(calls.length, 0)
  assert.match(state.error, /must be verified/)
  const apply = make(catalog())
  await apply(true)
  assert.equal(state.closed, 0)
  assert.match(state.error, /Retry Apply/)
  assert.deepEqual(calls[0][6], tags)
  assert.notEqual(calls[0][6], tags)
  reject = true
  await apply(true)
  assert.equal(state.closed, 0)
  assert.equal(state.error, "Preference acknowledgement lost")
  assert.equal(state.busy, false)
  reject = false
  accepted = true
  await apply(true)
  assert.equal(state.closed, 1)
})
test("actual Power source callback now opens an awaited ordinary Summary for both curve paths and retains guarded source failures", async () => {
  const ref = { current: null },
    state = { opening: null, error: "" },
    opened = [],
    requests = []
  let release,
    fail = false,
    wrong = false
  const open = compileCallback(
    "../src/components/dashboard-power-curve.tsx",
    "open",
    {
      sourceController: ref,
      setOpening: (value) => (state.opening = value),
      setOpenError: (value) => (state.error = value),
      heartRateSportMatches,
      onWorkoutOpen: (value) => opened.push(value),
      loadHistoricalWorkout: async (id, options) => {
        requests.push({ id, options })
        await new Promise((done) => (release = done))
        if (fail) throw Error("Source read rejected")
        return {
          id: wrong ? "activity:i999" : "activity:i123",
          activity_id: wrong ? "i999" : "i123",
          workout_date: "2026-10-19",
          activity_type: "Ride",
        }
      },
    }
  )
  const effort = {
      activity_id: "i123",
      date: "2026-10-19",
      native_type: "Ride",
    },
    first = open(effort)
  await open(effort)
  assert.equal(requests.length, 1)
  assert.equal(opened.length, 0)
  assert.equal(requests[0].id, "activity:i123")
  release()
  await first
  assert.equal(opened.length, 1)
  assert.equal(ref.current, null)
  fail = true
  const failed = open(effort)
  release()
  await failed
  assert.equal(opened.length, 1)
  assert.equal(state.error, "Source read rejected")
  assert.equal(state.opening, null)
  fail = false
  wrong = true
  const mismatched = open({ ...effort, native_type: undefined })
  release()
  await mismatched
  assert.equal(opened.length, 1)
  assert.match(state.error, /different identity/)
  const source = fs.readFileSync(
    new URL("../src/components/dashboard-power-curve.tsx", import.meta.url),
    "utf8"
  )
  assert.doesNotMatch(source, /openActivityEffort|fitnessPeakEffortTarget/)
  assert.match(source, /<td>\{dateLabel\(row\.primary\?\.date\)\}<\/td>/)
})
