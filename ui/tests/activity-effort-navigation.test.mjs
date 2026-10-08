import assert from "node:assert/strict"
import test from "node:test"
import {
  normalizeActivityEffortTarget,
  activityEffortRoute,
  readActivityEffortTarget,
  clearActivityEffortParams,
  verifiedActivityEffort,
  activityEffortPlotRange,
  openActivityEffort,
  ACTIVITY_EFFORT_OPEN_EVENT,
} from "../src/lib/activity-effort-navigation.ts"
import {
  rememberOpenWorkout,
  forgetOpenWorkout,
} from "../src/lib/workout-navigation.ts"

const target = {
  activityId: "i123",
  sport: "Ride",
  kind: "power",
  durationSeconds: 60,
  distanceMeters: null,
  value: 250,
}
const response = (extra = {}) => ({
  available: true,
  activity_id: "i123",
  type: "Ride",
  duration_seconds: 60,
  distance_meters: null,
  value: 250,
  start_index: 450,
  end_index: 510,
  start_seconds: 1200,
  end_seconds: 1260,
  chart_start_seconds: 300,
  chart_end_seconds: 360,
  ...extra,
})

test("only canonical recorded activities and finite measured anchors can be opened", () => {
  assert.deepEqual(normalizeActivityEffortTarget(target), target)
  assert.equal(
    normalizeActivityEffortTarget({ ...target, activityId: "123", value: 0 })
      .value,
    0
  )
  for (const change of [
    { activityId: "event:1" },
    { activityId: "i0123" },
    { activityId: "../123" },
    { sport: "Other" },
    { kind: "pace" },
    { durationSeconds: 0 },
    { durationSeconds: 1.5 },
    { durationSeconds: 86401 },
    { value: NaN },
    { value: Infinity },
    { value: "250" },
    { distanceMeters: 100 },
    { startSeconds: 10 },
    { startSeconds: 20, endSeconds: 10 },
  ])
    assert.equal(normalizeActivityEffortTarget({ ...target, ...change }), null)
  assert.equal(
    normalizeActivityEffortTarget({
      ...target,
      sport: "Run",
      kind: "pace",
      durationSeconds: null,
      distanceMeters: 400,
      value: 0,
    }),
    null
  )
  assert.equal(
    normalizeActivityEffortTarget({
      ...target,
      sport: "Run",
      kind: "pace",
      durationSeconds: null,
      distanceMeters: 100001,
      value: 5,
    }),
    null
  )
})

test("effort URL round trips outside loaded history while preserving route/hash and guarding identity", () => {
  const route = activityEffortRoute(
    target,
    "https://mock.invalid/?view=graph#fitness"
  )
  const url = new URL(route, "https://mock.invalid")
  assert.equal(activityEffortRoute(target, url.href), route)
  assert.equal(url.searchParams.get("workout"), "activity:i123")
  assert.equal(url.searchParams.get("view"), "graph")
  assert.equal(url.hash, "#fitness")
  assert.deepEqual(readActivityEffortTarget(url.search, "i123"), target)
  assert.equal(readActivityEffortTarget(url.search, "i124"), null)
  url.searchParams.set("workout", "activity:i124")
  assert.equal(readActivityEffortTarget(url.search), null)
  assert.equal(readActivityEffortTarget("?effort=%7Bbroken"), null)
  assert.equal(readActivityEffortTarget("?effort=" + "x".repeat(2049)), null)
  clearActivityEffortParams(url)
  assert.equal(url.searchParams.has("effort"), false)
})

test("normal workout open and close remove a previous selected effort even when optional storage is blocked", () => {
  globalThis.window = new EventTarget()
  let url = new URL(
    activityEffortRoute(target, "https://mock.invalid/"),
    "https://mock.invalid"
  )
  window.location = {
    get href() {
      return url.href
    },
  }
  window.history = {
    pushState: (_, __, value) => {
      url = new URL(value, url)
    },
    replaceState: (_, __, value) => {
      url = new URL(value, url)
    },
  }
  globalThis.sessionStorage = {
    setItem() {
      throw Error("Blocked")
    },
    removeItem() {
      throw Error("Blocked")
    },
  }
  rememberOpenWorkout({ id: "activity:i124" })
  assert.equal(url.searchParams.has("effort"), false)
  assert.equal(url.searchParams.get("workout"), "activity:i124")
  forgetOpenWorkout()
  assert.equal(url.searchParams.has("workout"), false)
})

test("opening sends a validated request without changing workouts or initiating any transport", () => {
  globalThis.window = new EventTarget()
  const received = []
  window.addEventListener(ACTIVITY_EFFORT_OPEN_EVENT, (event) =>
    received.push(event.detail)
  )
  assert.equal(openActivityEffort({ ...target, unsupported: "discard" }), true)
  assert.deepEqual(received, [target])
  assert.equal(openActivityEffort({ ...target, activityId: "event:1" }), false)
  assert.equal(received.length, 1)
})

test("chart selection uses verified normalized timestamps, never raw indices/seconds or URL bounds", () => {
  const selected = { ...target, startSeconds: 9999, endSeconds: 10059 }
  assert.deepEqual(
    verifiedActivityEffort(response(), selected).range,
    [300, 360]
  )
  assert.equal(activityEffortPlotRange([300, 360], 359), null)
  assert.deepEqual(activityEffortPlotRange([300, 360], 360), [300, 360])
  assert.equal(activityEffortPlotRange([0, Infinity], 500), null)
  assert.equal(activityEffortPlotRange([10, 10], 500), null)
  assert.equal(activityEffortPlotRange(null, 500), null)
})

test("mismatched or malformed bounds cannot highlight an approximate effort", () => {
  for (const change of [
    { activity_id: "i124" },
    { type: "Run" },
    { duration_seconds: 61 },
    { value: 249 },
    { chart_start_seconds: -1 },
    { chart_end_seconds: NaN },
    { chart_end_seconds: 300 },
    { chart_start_seconds: undefined },
    { available: "true" },
  ])
    assert.throws(() => verifiedActivityEffort(response(change), target))
  assert.deepEqual(
    verifiedActivityEffort(
      response({ available: false, reason: "No native indices." }),
      target
    ),
    { range: null, reason: "No native indices." }
  )
  assert.equal(
    verifiedActivityEffort(response({ value: 0 }), { ...target, value: 0 })
      .range[0],
    300
  )
})

test("native pace distance is retained; metric Run does not accept a nearby invented anchor", () => {
  const swim = {
    ...target,
    sport: "Swim",
    kind: "pace",
    durationSeconds: null,
    distanceMeters: 91.44,
    value: 91 / 30,
  }
  const source = response({
    type: "Swim",
    duration_seconds: null,
    distance_meters: 91,
    value: 91 / 30,
  })
  assert.deepEqual(verifiedActivityEffort(source, swim).range, [300, 360])
  const run = { ...swim, sport: "Run", distanceMeters: 400, value: 399.6 / 60 }
  assert.throws(() =>
    verifiedActivityEffort(
      { ...source, type: "Run", distance_meters: 399.6, value: run.value },
      run
    )
  )
})

test("real backend resolver DTO selects the same compressed pause bounds as the existing activity chart", async () => {
  const { createPerformanceHistory } =
    await import("../../app-backend/lib/performance-curves.mjs")
  const { normalizeAnalysis } =
    await import("../../app-backend/lib/activity-analysis.mjs")
  const activity = {
    id: "i123",
    type: "Ride",
    moving_time: 5,
    elapsed_time: 14,
  }
  const streams = [
    { type: "time", data: [0, 1, 2, 12, 13, 14] },
    { type: "watts", data: [100, 200, 250, 250, 200, 100] },
  ]
  let calls = 0
  const service = createPerformanceHistory({
    request: () => async () => {
      calls++
      return { secs: [10], values: [250], start_index: [1], end_index: [3] }
    },
  })
  const selected = { ...target, durationSeconds: 10 }
  const body = await service.effort(
    { INTERVALS_API_KEY: "mock-key", SETTINGS_SCOPE: "mock-effort" },
    "i123",
    {
      type: "Ride",
      duration_seconds: 10,
      loadBundle: async () => ({ activity, streams }),
    }
  )
  assert.equal(body.start_seconds, 1)
  assert.equal(body.end_seconds, 12)
  assert.deepEqual(verifiedActivityEffort(body, selected).range, [1, 3])
  assert.equal(normalizeAnalysis(activity, streams).duration, 5)
  assert.deepEqual(
    activityEffortPlotRange(verifiedActivityEffort(body, selected).range, 5),
    [1, 3]
  )
  assert.equal(calls, 1)
})
