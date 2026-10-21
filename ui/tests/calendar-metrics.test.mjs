import test from "node:test"
import assert from "node:assert/strict"
import {
  calendarMetricFields,
  metricInputValue,
  metricInputs,
  metricChanges,
  createMetricsWrite,
  applyMetricChanges,
  currentMetricTime,
  createCalendarMetricsClient,
  readPendingMetrics,
  rememberPendingMetrics,
  clearPendingMetrics,
  calendarMetricSummary,
} from "../src/lib/calendar-metrics.ts"

const date = "2026-10-20"
const operationId = "4384b2d9-e802-4252-9d2b-0891c09e0516"
const row = (overrides = {}) => ({
  date,
  revision: "v1",
  note: "",
  locked: false,
  recordExists: false,
  providerUpdated: null,
  source: "intervals",
  entries: Object.fromEntries(
    calendarMetricFields.map(({ key }) => [
      key,
      {
        value: null,
        time: null,
        source: "unavailable",
      },
    ])
  ),
  ...overrides,
})
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })

test("zero, blank, exact subjective labels, decimals and time remain distinct", () => {
  assert.deepEqual(metricInputValue("weight", { value: "0", time: "" }), {
    value: 0,
    time: null,
  })
  assert.equal(metricInputValue("weight", { value: " ", time: "" }), null)
  assert.deepEqual(
    metricInputValue("sleepHours", { value: "7.25", time: "06:30" }),
    { value: 7.25, time: "06:30" }
  )
  assert.deepEqual(
    metricInputValue("stress", { value: "Extreme", time: "23:59" }),
    { value: "Extreme", time: "23:59" }
  )
  for (const invalid of ["1", "VeryHigh", "Select..."])
    assert.throws(() =>
      metricInputValue("stress", { value: invalid, time: "" })
    )
  for (const invalid of ["NaN", "1e2", "-1", "1001"])
    assert.throws(() =>
      metricInputValue("weight", { value: invalid, time: "" })
    )
  assert.throws(() =>
    metricInputValue("weight", { value: "155", time: "24:00" })
  )
  assert.throws(
    () => metricInputValue("restingHR", { value: "60.5", time: "" }),
    /whole number/
  )
})

test("unchanged imported values are omitted, zero survives, and clearing is explicit", () => {
  const original = row()
  original.entries.weight = { value: 0, time: null, source: "intervals" }
  original.entries.restingHR = { value: 9, time: null, source: "intervals" }
  const inputs = metricInputs(original)
  assert.deepEqual(inputs.weight, { value: "0", time: "" })
  assert.deepEqual(metricChanges(original, inputs), {})
  inputs.sleepHours = { value: "8.5", time: "07:00" }
  assert.deepEqual(metricChanges(original, inputs), {
    sleepHours: { value: 8.5, time: "07:00" },
  })
  inputs.weight.value = ""
  assert.deepEqual(metricChanges(original, inputs), {
    weight: null,
    sleepHours: { value: 8.5, time: "07:00" },
  })
  inputs.restingHR.value = "8"
  assert.throws(() => metricChanges(original, inputs), /10 to 200/)
})

test("write payload preserves revision, native omissions, unchanged long note and explicit blank note", () => {
  const original = row({ note: "x".repeat(8001) })
  const inputs = metricInputs(original)
  inputs.hrv = { value: "0", time: "" }
  assert.deepEqual(
    createMetricsWrite(original, inputs, original.note, operationId),
    {
      date,
      revision: "v1",
      operationId,
      changes: { hrv: { value: 0, time: null } },
    }
  )
  assert.equal(createMetricsWrite(original, inputs, "", operationId).note, "")
  assert.throws(
    () => createMetricsWrite(original, inputs, "y".repeat(8001)),
    /8000/
  )
  assert.throws(
    () => createMetricsWrite(row(), metricInputs(row()), ""),
    /no changes/
  )
})

test("recovery overlays only intended values and respects athlete timezone including midnight", () => {
  const original = row()
  original.entries.weight = { value: 170, time: null, source: "intervals" }
  const recovered = applyMetricChanges(
    original,
    { stress: { value: "Low", time: "16:00" }, weight: null },
    "note"
  )
  assert.equal(recovered.entries.weight.value, null)
  assert.deepEqual(recovered.entries.stress, {
    value: "Low",
    time: "16:00",
    source: "manual",
  })
  assert.equal(recovered.note, "note")
  assert.equal(original.entries.weight.value, 170)
  assert.equal(
    currentMetricTime("America/Chicago", new Date("2026-10-20T05:36:00Z")),
    "00:00"
  )
  assert.equal(
    currentMetricTime("Pacific/Auckland", new Date("2026-10-20T05:36:00Z")),
    "18:00"
  )
})

test("read validates full shape and dates without performing writes", async () => {
  const calls = []
  const client = createCalendarMetricsClient(async (...args) => {
    calls.push(args)
    return response(row())
  })
  assert.equal((await client.read(date)).entries.weight.value, null)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1].method, undefined)
  assert.equal(calls[0][1].cache, "no-store")
  await assert.rejects(client.read("2026-02-30"), /valid metrics date/)
  assert.equal(calls.length, 1)
  const incomplete = row()
  delete incomplete.entries.stress
  await assert.rejects(
    createCalendarMetricsClient(async () => response(incomplete)).read(date),
    /Stress response/
  )
  await assert.rejects(
    createCalendarMetricsClient(async () =>
      response({ ...row(), date: "2026-10-21" })
    ).read(date),
    /incomplete/
  )
})

test("write sends one exact request and accepts only confirmed complete readback", async () => {
  const input = {
    date,
    revision: "v1",
    operationId,
    changes: { weight: { value: 155, time: null } },
  }
  const calls = []
  const client = createCalendarMetricsClient(async (url, options) => {
    calls.push({ url, options })
    return response({ ...row(), verified: true })
  })
  await client.write(input)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.method, "POST")
  assert.deepEqual(JSON.parse(calls[0].options.body), input)
  await assert.rejects(
    createCalendarMetricsClient(async () => response(row())).write(input),
    (error) => error.uncertain === true
  )
  await assert.rejects(
    createCalendarMetricsClient(async () => response({ verified: true })).write(
      input
    ),
    (error) => error.uncertain === true
  )
})

test("conflicts and validation are definite failures, ambiguous transport/server failures retain recovery", async () => {
  const input = { date, revision: "v1", operationId, changes: { weight: null } }
  for (const [status, code, uncertain] of [
    [400, "INVALID_METRICS", false],
    [409, "METRICS_CONFLICT", false],
    [502, "METRICS_WRITE_UNCONFIRMED", true],
  ]) {
    let calls = 0
    const client = createCalendarMetricsClient(async () => {
      calls++
      return response({ error: "fixture failure", code }, status)
    })
    await assert.rejects(
      client.write(input),
      (error) =>
        error.status === status &&
        error.code === code &&
        error.uncertain === uncertain
    )
    assert.equal(calls, 1, "the client must never blindly retry a write")
  }
  await assert.rejects(
    createCalendarMetricsClient(async () => {
      throw new TypeError("lost connection")
    }).write(input),
    (error) => error.uncertain === true
  )
})

test("immutable attempt survives blocked storage and clear suppresses stale retained payload", () => {
  const blocked = {
    getItem() {
      throw Error("denied")
    },
    setItem() {
      throw Error("denied")
    },
    removeItem() {
      throw Error("denied")
    },
  }
  const input = {
    date,
    revision: "v1",
    operationId,
    changes: { weight: { value: 0, time: null } },
  }
  rememberPendingMetrics(blocked, "blocked-test", input)
  input.changes.weight.value = 99
  assert.equal(
    readPendingMetrics(blocked, "blocked-test", date).changes.weight.value,
    0
  )
  assert.equal(readPendingMetrics(blocked, "other-connection", date), null)
  clearPendingMetrics(blocked, "blocked-test", date)
  assert.equal(readPendingMetrics(blocked, "blocked-test", date), null)
})

test("malformed or foreign recovery payload is ignored rather than applied", () => {
  const input = {
    date,
    revision: "v1",
    operationId,
    changes: { stress: { value: "Extreme", time: null } },
  }
  for (const [index, bad] of [
    { ...input, date: "2026-10-21" },
    { ...input, operationId: "not-a-uuid" },
    { ...input, changes: { stress: { value: "1", time: null } } },
    { ...input, changes: { unexpected: null } },
    { ...input, changes: { hrv: { value: 3, time: "24:01" } } },
  ].entries()) {
    assert.equal(
      readPendingMetrics(
        { getItem: () => JSON.stringify(bad) },
        `invalid-${index}`,
        date
      ),
      null
    )
  }
})

test("calendar includes metadata-only days and preserves provider scale identity without numeric coercion", () => {
  const entries = row().entries
  entries.stress = { value: "Extreme", time: "16:00", source: "manual" }
  entries.hrv = { value: 0, time: null, source: "manual" }
  assert.deepEqual(
    calendarMetricSummary({ calendar_metrics: entries, stress: 2, hrv: 0 }),
    [
      { label: "Stress", value: "Extreme", unit: "" },
      { label: "HRV", value: "0", unit: "" },
      { label: "Stress (Intervals.icu)", value: "2", unit: "" },
    ]
  )
  assert.deepEqual(
    calendarMetricSummary({
      calendar_metrics: { broken: true },
      sleepSecs: 1800,
    }),
    [{ label: "Sleep Hours", value: "0.5", unit: "hrs" }]
  )
  assert.deepEqual(
    calendarMetricSummary({
      calendar_metrics: entries,
      calendar_metrics_note: "saved note",
    }).map((value) => value.label),
    ["Stress", "HRV"]
  )
  assert.deepEqual(
    calendarMetricSummary({
      calendar_metrics: row().entries,
      calendar_metrics_note: "saved note",
    }),
    [{ label: "Note", value: "saved note", unit: "" }]
  )
})
