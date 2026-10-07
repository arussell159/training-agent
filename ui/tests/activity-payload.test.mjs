import assert from "node:assert/strict"
import test from "node:test"
import { registerHooks } from "node:module"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { normalizeAnalysis } from "../../app-backend/lib/activity-analysis.mjs"
import {
  validActivityAnalysis,
  validActivityPayload,
  validActivityRoute,
  validActivitySummary,
} from "../src/lib/activity-payload.ts"

const lap = () => ({ id: "lap-1", label: "Lap 1", start: 0, end: 60, kind: "lap", power: null, heartRate: 130, distance: 200 })
const recording = (patch = {}) => ({
  duration: 60,
  points: [{ time: 0 }, { time: 30, power: 0, latitude: null, elevation: -15 }, { time: 60, heartRate: null }],
  laps: [lap()],
  intervals: [],
  ...patch,
})

test("manual empty recordings, missing measurements, recorded zeroes and optional statistics remain valid", () => {
  assert.equal(validActivityAnalysis(recording()), true)
  assert.equal(validActivityAnalysis(recording({ duration: 0, points: [], laps: [], dfa: null })), true)
  assert.equal(validActivityAnalysis(recording({
    version: 8,
    swimLengths: [{ start: 0, end: 30, seconds: 27, distance: 22.86 }],
    dfa: { average: null, minimum: null, maximum: null, averageArtifacts: null, artifactCoveragePercent: null, validPercent: null, validSeconds: 0 },
  })), true)
  assert.equal(validActivityAnalysis(recording({ points: [{ time: 0 }, { time: 0 }, { time: 60 }] })), true)
  assert.equal(validActivitySummary({}), true)
  assert.equal(validActivitySummary({ average_hr: null, average_power: 0, temperature_c: -4, extra_future_field: { safe: true } }), true)
})

test("the actual backend recording schema remains valid for GPS, swimming and manual activities", () => {
  for (const type of ["Run", "Swim", "Ride"]) {
    const activity = { id: "fixture", type, moving_time: 60, start_date: "2026-10-06T12:00:00Z", icu_intervals: [{ start_time: 0, end_time: 60, type: "WORK" }] }
    assert.equal(validActivityAnalysis(normalizeAnalysis(activity, [])), true)
    assert.equal(validActivityAnalysis(normalizeAnalysis(activity, [
      { type: "time", data: [0, 30, 60] },
      { type: "heartrate", data: [130, null, 135] },
      { type: "dfa_a1", data: [1.1, null, 1.2] },
      { type: "latlng", data: [[41, -87], [41.1, -87], [41.2, -87]] },
    ])), true)
  }
})

test("corrupt recording samples cannot reach chart calculations or persistent caches", () => {
  for (const point of [null, [], "broken", {}, { time: null }, { time: "1" }, { time: NaN }, { time: Infinity }, { time: -1 }, { time: 0, speed: {} }, { time: 0, heartRate: "130" }, { time: 0, dfaA1: Infinity }])
    assert.equal(validActivityAnalysis(recording({ points: [point] })), false, JSON.stringify(point))
  assert.equal(validActivityAnalysis(recording({ points: [{ time: 30 }, { time: 15 }] })), false)
  for (const value of [null, [], {}, recording({ points: null }), recording({ duration: null }), recording({ duration: -1 }), recording({ duration: Infinity })])
    assert.equal(validActivityAnalysis(value), false)
})

test("nested laps, intervals, swim lengths and DFA statistics reject shapes that would crash charts", () => {
  for (const patch of [
    { laps: null }, { laps: [null] }, { laps: [{ ...lap(), label: {} }] },
    { laps: [{ ...lap(), start: "0" }] }, { laps: [{ ...lap(), speed: {} }] },
    { intervals: {} }, { intervals: [{ ...lap(), end: NaN }] },
    { swimLengths: null }, { swimLengths: [null] }, { swimLengths: [{ start: 0, end: 20, seconds: "20" }] },
    { dfa: [] }, { dfa: { validSeconds: 0, validPercent: {} } }, { dfa: { validSeconds: null } },
  ]) assert.equal(validActivityAnalysis(recording(patch)), false, JSON.stringify(patch))
})

test("summary validation keeps missing values and rejects corrupt known measurements", () => {
  for (const value of [null, [], "broken", { error: "Incomplete recording" }, { average_hr: {} }, { duration_seconds: "60" }, { normalized_power: NaN }, { latitude: Infinity }])
    assert.equal(validActivitySummary(value), false)
})

test("cache validation recognizes original and rewritten activity paths without affecting unrelated APIs", () => {
  for (const path of ["/api/activities/123/analysis?schema=8&v=a", "/api/handler?__api_route=activities%2F123%2Fanalysis&schema=8"])
    assert.equal(validActivityPayload(path, recording({ points: [null] })), false)
  assert.equal(validActivityPayload("/api/activities/i123/summary?schema=2", { average_hr: null }), true)
  assert.equal(validActivityPayload("/api/activities/i123/summary?schema=2", []), false)
  assert.equal(validActivityPayload("/api/activities/i123/route?schema=2", null), false)
  assert.equal(validActivityPayload("/api/config", null), true)
})

test("route envelopes preserve usable GPS alongside malformed coordinates", () => {
  assert.equal(validActivityRoute({ points: [null, [41, -87], ["bad"], [0, 0]] }), true)
  for (const value of [null, [], { points: null }, { points: {} }]) assert.equal(validActivityRoute(value), false)
})

// The loader checks below use memory fixtures only; any unexpected fetch fails.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL && !/\.[a-z]+$/.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
globalThis.window = new EventTarget()
globalThis.localStorage = { getItem: () => null }
const { setApiAuthenticated } = await import("../src/lib/api-client.ts")
const activity = await import("../src/lib/activity-analysis.ts")
const json = (value) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })
test.beforeEach(() => {
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true, true)
  globalThis.fetch = () => { throw Error("Unexpected live request") }
})

test("shared recording loads reject corrupt successes together and retry without retaining poisoned data", async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return json(calls === 1 ? recording({ laps: [null] }) : recording()) }
  const first = activity.loadActivityAnalysis("fixture"), second = activity.loadActivityAnalysis("fixture")
  await Promise.all([assert.rejects(first, /incomplete/), assert.rejects(second, /incomplete/)])
  assert.equal(calls, 1)
  assert.equal(activity.cachedActivityAnalysis("fixture"), undefined)
  assert.deepEqual(await activity.loadActivityAnalysis("fixture"), recording())
  assert.deepEqual(await activity.loadActivityAnalysis("fixture"), recording())
  assert.equal(calls, 2)
})

test("summary failures are not cached and a legitimate empty manual summary is reusable", async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return json(calls === 1 ? { average_hr: {} } : {}) }
  await assert.rejects(activity.loadActivitySummary("fixture"), /incomplete/)
  assert.equal(activity.cachedActivitySummary("fixture"), undefined)
  assert.deepEqual(await activity.loadActivitySummary("fixture"), {})
  assert.deepEqual(await activity.loadActivitySummary("fixture"), {})
  assert.equal(calls, 2)
})

test("route loaders retry a bad envelope and retain only valid GPS coordinates", async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return json(calls === 1 ? null : { points: [null, [41, -87], [Infinity, 10], [91, 0], [0, 181], [0, 0], [1, 2, 3], ["1", 2]] }) }
  await assert.rejects(activity.loadActivityRoute("fixture"), /incomplete/)
  assert.deepEqual(await activity.loadActivityRoute("fixture"), [[41, -87], [0, 0]])
  assert.equal(calls, 2)
})
