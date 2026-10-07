import test from "node:test"
import assert from "node:assert/strict"

// A small IDB protocol fixture with controllable open/read/transaction failures.
// It has no connection to a browser profile or any network/database service.
let instance = 0
const flush = () => new Promise((resolve) => setImmediate(resolve))
async function fixture(options = {}) {
  const rows = new Map(),
    reads = [],
    opens = []
  let closed = 0
  const controls = {
    openFailure: false,
    holdOpen: false,
    holdReads: false,
    holdTransactions: false,
    throwTransactions: false,
    throwWrites: false,
    ...options,
  }
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {
      throw Error("Already exists")
    },
    close() {
      closed++
    },
    transaction() {
      if (controls.throwTransactions) throw Error("Device database unavailable")
      const transaction = { oncomplete: null, onerror: null, onabort: null }
      if (!controls.holdTransactions)
        setImmediate(() => transaction.oncomplete?.())
      const store = {
        get(key) {
          const request = { result: undefined, onsuccess: null, onerror: null }
          const complete = () => {
            request.result = rows.get(key)
            request.onsuccess?.()
          }
          reads.push({ request, complete })
          if (!controls.holdReads) queueMicrotask(complete)
          return request
        },
        put(value, key) {
          if (controls.throwWrites)
            throw new DOMException("Quota exceeded", "QuotaExceededError")
          rows.set(key, value)
        },
        delete: (key) => rows.delete(key),
        clear: () => rows.clear(),
        openCursor() {
          const request = { result: null, onsuccess: null }
          const entries = [...rows],
            advance = () =>
              queueMicrotask(() => {
                const row = entries.shift()
                request.result = row
                  ? {
                      key: row[0],
                      value: row[1],
                      delete: () => rows.delete(row[0]),
                      continue: advance,
                    }
                  : null
                request.onsuccess?.()
              })
          advance()
          return request
        },
      }
      transaction.objectStore = () => store
      return transaction
    },
  }
  globalThis.window = new EventTarget()
  let startup = null
  globalThis.localStorage = {
    getItem: () => startup,
    setItem: (_, value) => {
      startup = value
    },
  }
  globalThis.indexedDB = {
    open() {
      const request = {
        result: db,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      }
      opens.push(request)
      if (!controls.holdOpen)
        queueMicrotask(() =>
          controls.openFailure ? request.onerror?.() : request.onsuccess?.()
        )
      return request
    },
  }
  const cache = await import(`../src/lib/device-cache.ts?fixture=${instance++}`)
  return { cache, rows, reads, opens, db, controls, closed: () => closed }
}

test("device scopes ignore malformed values and update when the startup snapshot changes", async () => {
  const { cache } = await fixture()
  assert.equal(cache.deviceCacheScope(), "initial")
  localStorage.setItem("startup", JSON.stringify({ cache_scope: "one" }))
  assert.equal(cache.deviceCacheScope(), "one")
  localStorage.setItem(
    "startup",
    JSON.stringify({ cache_scope: { bad: true } })
  )
  assert.equal(cache.deviceCacheScope(), "initial")
  localStorage.setItem("startup", "{broken")
  assert.equal(cache.deviceCacheScope(), "initial")
  localStorage.setItem("startup", JSON.stringify({ cache_scope: "two" }))
  assert.equal(cache.deviceCacheScope(), "two")
})

test("cache clear prevents pending writes and late reads from reviving private data", async () => {
  const { cache, rows, reads, opens, controls } = await fixture({
    holdOpen: true,
    holdReads: true,
  })
  const oldWrite = cache.writeDeviceCache("private", "old")
  const clearing = cache.clearDeviceCache()
  opens[0].onsuccess()
  await Promise.all([oldWrite, clearing])
  assert.equal(rows.has("private"), false)
  rows.set("private", { value: "sensitive", savedAt: Date.now() })
  const oldRead = cache.readDeviceCache("private")
  await flush()
  const late = reads.at(-1)
  late.request.result = { value: "sensitive", savedAt: Date.now() }
  await cache.clearDeviceCache()
  late.request.onsuccess()
  assert.equal(await oldRead, null)
  controls.holdReads = false
  await cache.writeDeviceCache("current", 42)
  assert.equal(await cache.readDeviceCache("current"), 42)
})

test("failed open attempts retry after backoff without repeatedly touching storage", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 })
  const { cache, controls, opens, rows } = await fixture({ openFailure: true })
  assert.equal(await cache.readDeviceCache("ready"), null)
  controls.openFailure = false
  for (let index = 0; index < 20; index++)
    assert.equal(await cache.readDeviceCache("ready"), null)
  assert.equal(opens.length, 1)
  rows.set("ready", { value: 42, savedAt: Date.now() + 30_001 })
  t.mock.timers.tick(30_001)
  assert.equal(await cache.readDeviceCache("ready"), 42)
  assert.equal(opens.length, 2)
})

test("slow database opening settles at its deadline and closes any late connection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const { cache, opens, closed } = await fixture({ holdOpen: true })
  const read = cache.readDeviceCache("late")
  t.mock.timers.tick(1000)
  assert.equal(await read, null)
  opens[0].onsuccess()
  assert.equal(closed(), 1)
})

test("stalled writes and reads settle, while transaction and quota errors remain best effort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const { cache, controls } = await fixture({
    holdTransactions: true,
    holdReads: true,
  })
  const writing = cache.writeDeviceCache("stalled", 42)
  await flush()
  t.mock.timers.tick(1000)
  await writing
  const reading = cache.readDeviceCache("stalled")
  await flush()
  t.mock.timers.tick(1000)
  assert.equal(await reading, null)
  controls.throwWrites = true
  await cache.writeDeviceCache("quota", 42)
  controls.throwTransactions = true
  assert.equal(await cache.readDeviceCache("unavailable"), null)
  await cache.clearDeviceCache()
})

test("invalid or expired envelopes are ignored even if best-effort expiry deletion fails", async () => {
  const { cache, rows, controls, reads } = await fixture({ holdReads: true })
  for (const row of [
    { value: 1 },
    { value: 2, savedAt: Date.now() - 5000 },
    { value: 3, savedAt: Date.now() + 120_000 },
  ]) {
    rows.set("invalid", row)
    const reading = cache.readDeviceCache("invalid", 1000)
    await flush()
    controls.throwTransactions = true
    reads.at(-1).complete()
    assert.equal(await reading, null)
    controls.throwTransactions = false
  }
})

test("a timed-out read cannot later delete a newer cached value during expiry cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const { cache, rows, reads, controls } = await fixture({ holdReads: true })
  rows.set("record", { value: "expired", savedAt: Date.now() - 5000 })
  const request = cache.readDeviceCache("record", 1000)
  await flush()
  const late = reads.at(-1)
  late.request.result = { value: "expired", savedAt: Date.now() - 5000 }
  t.mock.timers.tick(1000)
  assert.equal(await request, null)
  await cache.writeDeviceCache("record", "new")
  late.request.onsuccess()
  controls.holdReads = false
  assert.equal(await cache.readDeviceCache("record"), "new")
})

test("chart snapshots stay bounded and nutrition invalidation preserves unrelated recordings", async () => {
  const { cache, rows } = await fixture()
  for (let index = 0; index < 45; index++)
    rows.set(`activity:fixture:${index}`, {
      savedAt: Date.now() - index - 1,
      value: index,
    })
  await cache.writeDeviceCache("activity:fixture:new", 42)
  assert.equal(
    [...rows.keys()].filter((key) => key.startsWith("activity:")).length,
    40
  )
  for (let index = 0; index < 20; index++)
    rows.set(`nutrition:fixture:${index}`, {
      savedAt: Date.now() - index - 1,
      value: index,
    })
  rows.set("nutrition:expired", {
    savedAt: Date.now() - 16 * 60_000,
    value: "old",
  })
  await cache.writeDeviceCache("nutrition:fixture:new", 43)
  assert.equal(
    [...rows.keys()].filter((key) => key.startsWith("nutrition:")).length,
    14
  )
  assert.equal(rows.has("nutrition:expired"), false)
  await cache.deleteDeviceCachePrefix("nutrition:")
  assert.equal(
    [...rows.keys()].filter((key) => key.startsWith("nutrition:")).length,
    0
  )
  assert.equal(
    [...rows.keys()].filter((key) => key.startsWith("activity:")).length,
    40
  )
})

test("a device database version change closes and reopens the connection on the next read", async () => {
  const { cache, db, opens, closed } = await fixture()
  await cache.readDeviceCache("one")
  db.onversionchange()
  assert.equal(closed(), 1)
  await cache.readDeviceCache("two")
  assert.equal(opens.length, 2)
})
