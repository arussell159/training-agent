import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"

globalThis.window = new EventTarget()
globalThis.localStorage = { getItem: () => null }
globalThis.fetch = () => {
  throw Error("Unexpected network request in activity effort tests")
}
const { setApiAuthenticated } = await import("../src/lib/api-client.ts")
const { loadActivityEffort } = await import("../src/lib/activity-effort.ts")
const target = {
  activityId: "i123",
  sport: "Ride",
  kind: "power",
  durationSeconds: 60,
  distanceMeters: null,
  value: 250,
}
const payload = (extra = {}) => ({
  available: true,
  activity_id: "i123",
  type: "Ride",
  duration_seconds: 60,
  value: 250,
  chart_start_seconds: 300,
  chart_end_seconds: 360,
  ...extra,
})
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  })
const flush = () => new Promise((resolve) => setImmediate(resolve))
beforeEach(() => {
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true, true)
  globalThis.fetch = () => {
    throw Error("Unexpected network request in activity effort tests")
  }
})

test("overlapping exact effort reads share one request and cancellation preserves a remaining reader", async () => {
  let calls = 0,
    finish,
    transportSignal,
    requested
  globalThis.fetch = (url, options) => {
    calls++
    requested = url
    transportSignal = options.signal
    assert.equal(options.cache, "no-store")
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const controller = new AbortController()
  const first = loadActivityEffort(target, "recording-v1", controller.signal)
  const firstSettled = first.catch((error) => error)
  const second = loadActivityEffort(target, "recording-v1")
  await flush()
  assert.equal(calls, 1)
  assert.match(String(requested), /performance-effort/)
  assert.match(String(requested), /type=Ride/)
  assert.match(String(requested), /duration=60/)
  controller.abort()
  assert.equal((await firstSettled).name, "AbortError")
  assert.equal(transportSignal.aborted, false)
  finish(json(payload()))
  assert.deepEqual((await second).range, [300, 360])
  assert.deepEqual(
    (await loadActivityEffort(target, "recording-v1")).range,
    [300, 360]
  )
  assert.equal(calls, 1)
})

test("auth/cache reset rejects old effort reads and an old result cannot replace the new recording selection", async () => {
  const finishes = []
  let calls = 0
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => finishes.push(resolve))
  }
  const old = loadActivityEffort(target)
  const oldSettled = old.catch((error) => error)
  await flush()
  window.dispatchEvent(new Event("app-auth-required"))
  setApiAuthenticated(true, true)
  const current = loadActivityEffort(target)
  await flush()
  assert.equal(calls, 2)
  assert.equal((await oldSettled).name, "AbortError")
  finishes[0](json(payload({ chart_start_seconds: 10, chart_end_seconds: 70 })))
  finishes[1](json(payload()))
  assert.deepEqual((await current).range, [300, 360])
  assert.deepEqual((await loadActivityEffort(target)).range, [300, 360])
  assert.equal(calls, 2)
})

test("mismatched source response is not cached as an exact effort and later retry recovers", async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return json(payload(calls === 1 ? { value: 249 } : {}))
  }
  await assert.rejects(loadActivityEffort(target), /could not be verified/)
  assert.deepEqual((await loadActivityEffort(target)).range, [300, 360])
  assert.equal(calls, 2)
})

test("unavailable effort keeps an honest full-chart state and only explicit retry fetches again", async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return json(
      payload(
        calls === 1 ? { available: false, reason: "No native timestamps." } : {}
      )
    )
  }
  assert.deepEqual(await loadActivityEffort(target), {
    range: null,
    reason: "No native timestamps.",
  })
  assert.equal((await loadActivityEffort(target)).range, null)
  assert.equal(calls, 1)
  assert.deepEqual(
    (await loadActivityEffort(target, "", undefined, 1)).range,
    [300, 360]
  )
  assert.equal(calls, 2)
})

test("pace reads use native metre distance and invalid input cannot initiate transport", async () => {
  const swim = {
    ...target,
    sport: "Swim",
    kind: "pace",
    durationSeconds: null,
    distanceMeters: 91,
    value: 91 / 30,
  }
  let calls = 0,
    requested
  globalThis.fetch = async (url) => {
    calls++
    requested = url
    return json(
      payload({
        type: "Swim",
        duration_seconds: null,
        distance_meters: 91,
        value: 91 / 30,
      })
    )
  }
  await assert.rejects(
    loadActivityEffort({ ...target, activityId: "../123" }),
    /Choose/
  )
  assert.equal(calls, 0)
  await loadActivityEffort(swim)
  assert.match(String(requested), /type=Swim/)
  assert.match(String(requested), /distance=91(?:&|$)/)
  assert.doesNotMatch(String(requested), /duration=/)
  assert.equal(calls, 1)
})

test("a stalled response body hits the shared deadline and does not poison a later read", async (t) => {
  const realSetTimeout = globalThis.setTimeout
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) =>
    realSetTimeout(callback, delay === 65000 ? 5 : delay, ...args)
  )
  let calls = 0,
    streamController
  globalThis.fetch = async () => {
    calls++
    return calls === 1
      ? new Response(
          new ReadableStream({
            start(controller) {
              streamController = controller
            },
          })
        )
      : json(payload())
  }
  await assert.rejects(loadActivityEffort(target), /took too long/)
  streamController.close()
  assert.deepEqual((await loadActivityEffort(target)).range, [300, 360])
  assert.equal(calls, 2)
})
