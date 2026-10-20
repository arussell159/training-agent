import test from "node:test"
import assert from "node:assert/strict"
import { setApiAuthenticated } from "../src/lib/api-client.ts"
import {
  loadWorkoutPersonal,
  saveWorkoutPersonal,
  downloadWorkoutAttachment,
} from "../src/lib/workout-personal-client.ts"

const flush = () => new Promise((resolve) => setImmediate(resolve))
const value = { privateNotes: "Retain my notes", tags: [], equipment: "", autoCalculate: true }

test("a stalled personal-field load rejects instead of indefinitely blocking workout saving", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  setApiAuthenticated(true, true)
  let calls = 0, signal
  t.mock.method(globalThis, "fetch", (_url, options) => {
    calls++
    signal = options.signal
    return new Promise(() => {})
  })
  const request = loadWorkoutPersonal("event:123")
  const rejected = assert.rejects(request, { name: "TimeoutError", message: /draft is retained/ })
  await flush()
  t.mock.timers.tick(30_000)
  await rejected
  assert.equal(signal.aborted, true)
  assert.equal(calls, 1, "a deadline must not retry the request")
})

test("a personal-field write deadline includes stalled response bodies and preserves the submitted revision", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  setApiAuthenticated(true, true)
  let submitted
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    submitted = options
    return new Response(new ReadableStream({ start() {} }))
  })
  const request = saveWorkoutPersonal("event:123", value, 7, { migrateFrom: "draft:abc" })
  const rejected = assert.rejects(request, { name: "TimeoutError" })
  await flush()
  t.mock.timers.tick(30_000)
  await rejected
  assert.equal(submitted.signal.aborted, true)
  assert.deepEqual(JSON.parse(submitted.body), { value, revision: 7, migrateFrom: "draft:abc" })
})

test("closing a personal-field reader cancels the request without waiting for its deadline", async (t) => {
  setApiAuthenticated(true, true)
  let signal
  t.mock.method(globalThis, "fetch", (_url, options) => {
    signal = options.signal
    return new Promise(() => {})
  })
  const controller = new AbortController()
  const request = loadWorkoutPersonal("event:123", controller.signal)
  const rejected = assert.rejects(request, { name: "AbortError" })
  await flush()
  controller.abort()
  await rejected
  assert.equal(signal.aborted, true)
})

test("personal-field revision conflicts retain their status and code", async (t) => {
  setApiAuthenticated(true, true)
  t.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ error: "Reload newer notes", code: "PERSONAL_CONFLICT" }),
    { status: 409 }
  ))
  await assert.rejects(saveWorkoutPersonal("event:123", value, 7), {
    message: "Reload newer notes", status: 409, code: "PERSONAL_CONFLICT",
  })
})

test("an attachment with stalled content times out before creating a download", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  setApiAuthenticated(true, true)
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start() {} })))
  const rejected = assert.rejects(
    downloadWorkoutAttachment("event:123", { id: "file", name: "plan.txt" }),
    { name: "TimeoutError", message: /attachment took too long/ }
  )
  await flush()
  t.mock.timers.tick(30_000)
  await rejected
})
