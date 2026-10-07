import test from "node:test"
import assert from "node:assert/strict"
import { withRequestDeadline } from "../src/lib/request-deadline.ts"

test("a caller abort cancels a request without waiting for an uncooperative loader", async () => {
  const controller = new AbortController()
  let networkSignal
  const request = withRequestDeadline(
    (signal) => {
      networkSignal = signal
      return new Promise(() => {})
    },
    1000,
    controller.signal
  )
  await Promise.resolve()
  controller.abort()
  await assert.rejects(request, { name: "AbortError" })
  assert.equal(networkSignal.aborted, true)
})

test("the deadline covers a response body that stalls after the headers arrive", async () => {
  let networkSignal
  await assert.rejects(
    withRequestDeadline(async (signal) => {
      networkSignal = signal
      const response = new Response(new ReadableStream({ start() {} }))
      return response.json()
    }, 10),
    { name: "TimeoutError" }
  )
  assert.equal(networkSignal.aborted, true)
})

test("already aborted callers never start work, and successful requests remove their listeners", async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  await assert.rejects(
    withRequestDeadline(async () => ++calls, 1000, controller.signal),
    { name: "AbortError" }
  )
  assert.equal(calls, 0)
  const active = new AbortController()
  let networkSignal
  assert.equal(
    await withRequestDeadline(
      async (signal) => {
        networkSignal = signal
        return 42
      },
      1000,
      active.signal
    ),
    42
  )
  active.abort()
  assert.equal(networkSignal.aborted, false)
})
