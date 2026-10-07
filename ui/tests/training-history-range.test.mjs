import test from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/"))
      return {
        url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true,
      }
    if (
      specifier.startsWith(".") &&
      context.parentURL &&
      !/\.[a-z]+$/.test(specifier)
    ) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(url)))
        return { url: url.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}
globalThis.window = new EventTarget()
const { setApiAuthenticated } = await import("../src/lib/api-client.ts")
const training = await import("../src/lib/training-context.ts")
const { loadTrainingHistoryRange, loadWorkoutHistoryPage } =
  await import("../src/lib/training-history-range.ts")
const context = (version = "one") => ({
  athlete: { name: "Test", time_zone: "America/Chicago" },
  metrics: {},
  planned: [],
  history: [],
  version,
  cache_scope: "fixture",
  context_scope: "full",
})
const rangeContext = (start, end) => ({
  ...context(),
  context_scope: "range",
  display_range: { start, end },
})
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  })
const flush = () => new Promise((resolve) => setImmediate(resolve))
function reset() {
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context())
}

test("overlapping historical weeks share one month request and cached revisit", async () => {
  reset()
  let calls = 0,
    finish
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const first = loadTrainingHistoryRange("2001-02-01", "2001-02-07")
  const second = loadTrainingHistoryRange("2001-02-05", "2001-02-11")
  await flush()
  assert.equal(calls, 1)
  finish(json(rangeContext("2001-02-01", "2001-02-28")))
  const results = await Promise.all([first, second])
  assert.deepEqual(results[0].display_range, {
    start: "2001-02-01",
    end: "2001-02-07",
  })
  await loadTrainingHistoryRange("2001-02-12", "2001-02-18")
  assert.equal(calls, 1)
  assert.equal(training.cachedTrainingContext().version, "one")
})

test("already aborted range readers do not fetch, cancelling one shared reader preserves another", async () => {
  reset()
  let calls = 0,
    finish
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(
    loadTrainingHistoryRange("2001-02-01", "2001-02-07", {
      signal: cancelled.signal,
    }),
    { name: "AbortError" }
  )
  assert.equal(calls, 0)
  const one = new AbortController()
  const first = loadTrainingHistoryRange("2001-02-01", "2001-02-07", {
    signal: one.signal,
  })
  const second = loadTrainingHistoryRange("2001-02-01", "2001-02-07")
  await flush()
  one.abort()
  await assert.rejects(first, { name: "AbortError" })
  finish(json(rangeContext("2001-02-01", "2001-02-28")))
  assert.equal((await second).context_scope, "range")
  assert.equal(calls, 1)
})

test("live versions invalidate old months and partition the server provider cache", async () => {
  reset()
  const urls = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    return json(rangeContext("2001-02-01", "2001-02-28"))
  }
  await loadTrainingHistoryRange("2001-02-01", "2001-02-07")
  training.rememberLiveTrainingContext(context("two"))
  await loadTrainingHistoryRange("2001-02-01", "2001-02-07")
  assert.equal(urls.length, 2)
  assert.match(urls[0], /version=one/)
  assert.match(urls[1], /version=two/)
})

test("invalid historical responses are not retained as empty successful pages", async () => {
  reset()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return json({ workouts: [], complete: "no" })
  }
  await assert.rejects(
    loadWorkoutHistoryPage({ start: "2001-01-01", end: "2001-12-31" }),
    /incomplete/
  )
  globalThis.fetch = async () => {
    calls++
    return json({ workouts: [], complete: true, next_before: null })
  }
  assert.equal(
    (await loadWorkoutHistoryPage({ start: "2001-01-01", end: "2001-12-31" }))
      .complete,
    true
  )
  assert.equal(calls, 2)
})
