import test from "node:test"
import assert from "node:assert/strict"
import { createSharedRequestCache } from "../src/lib/shared-request-cache.ts"

test("views share a download and closing one leaves the other request alive", async () => {
  let complete,
    calls = 0,
    networkSignal
  const cache = createSharedRequestCache((_, signal) => {
    calls++
    networkSignal = signal
    return new Promise((resolve) => {
      complete = resolve
    })
  })
  const a = new AbortController(),
    b = new AbortController()
  const first = cache.get("ride", a.signal),
    second = cache.get("ride", b.signal)
  await Promise.resolve()
  a.abort()
  await assert.rejects(first, { name: "AbortError" })
  assert.equal(networkSignal.aborted, false)
  complete({ points: [1, 2] })
  const value = await second
  assert.equal(await cache.get("ride"), value)
  assert.equal(calls, 1)
})

test("closing the last consumer aborts the download and a retry starts fresh", async () => {
  let calls = 0,
    networkSignal
  const cache = createSharedRequestCache((_, signal) => {
    networkSignal = signal
    return ++calls === 1 ? new Promise(() => {}) : Promise.resolve(42)
  })
  const controller = new AbortController()
  const request = cache.get("ride", controller.signal)
  await Promise.resolve()
  controller.abort()
  await assert.rejects(request, { name: "AbortError" })
  assert.equal(networkSignal.aborted, true)
  assert.equal(await cache.get("ride"), 42)
  assert.equal(calls, 2)
})

test("cache reset rejects in-flight requests and late responses cannot repopulate it", async () => {
  let complete
  const cache = createSharedRequestCache(
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  const request = cache.get("private")
  await Promise.resolve()
  cache.clear()
  await assert.rejects(request, { name: "AbortError" })
  complete(123)
  await Promise.resolve()
  assert.equal(cache.peek("private"), undefined)
})

test("timeouts reject stalled loaders and errors can be retried", async () => {
  let calls = 0
  const cache = createSharedRequestCache(
    () => (++calls === 1 ? new Promise(() => {}) : Promise.resolve("ready")),
    { timeoutMs: 10 }
  )
  await assert.rejects(cache.get("ride"), /too long/)
  assert.equal(await cache.get("ride"), "ready")
})

test("large recordings are bounded by weight with least recently used eviction", async () => {
  const cache = createSharedRequestCache(
    async (key) => new Array(Number(key)).fill(1),
    { maxWeight: 10, weight: (value) => value.length }
  )
  await cache.get("4")
  await cache.get("5")
  cache.peek("4")
  await cache.get("3")
  assert.equal(cache.peek("5"), undefined)
  assert.equal(cache.peek("4").length, 4)
  await cache.get("11")
  assert.equal(cache.peek("11"), undefined)
  cache.clear()
  assert.equal(cache.peek("4"), undefined)
})

test("cache keys isolate revisions and users, and already aborted requests never fetch", async () => {
  let calls = 0
  const cache = createSharedRequestCache(async (key) => {
    calls++
    return key
  })
  assert.notEqual(await cache.get("user1:v1"), await cache.get("user2:v1"))
  assert.notEqual(await cache.get("user1:v1"), await cache.get("user1:v2"))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(cache.get("user1:v1", controller.signal), {
    name: "AbortError",
  })
  assert.equal(calls, 3)
})
