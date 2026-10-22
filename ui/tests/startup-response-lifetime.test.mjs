import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8")
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((value) => value.includes("__trainingSessionRequest"))
assert.ok(source)
const flush = () => new Promise((resolve) => setImmediate(resolve))

function startup({
  pathname = "/calendar",
  response,
  metadata = null,
  storage = {},
  hang = false,
} = {}) {
  const requests = [],
    timers = new Map(),
    controllers = []
  let serial = 0
  const schedule = (callback, delay) => {
    const id = ++serial
    timers.set(id, { callback, delay })
    return id
  }
  class StartupController extends AbortController {
    constructor() {
      super()
      controllers.push(this)
    }
  }
  const timeoutSignal = {
    timeout(delay) {
      const controller = new StartupController()
      schedule(
        () =>
          controller.abort(
            new DOMException("signal timed out", "TimeoutError")
          ),
        delay
      )
      return controller.signal
    },
  }
  const window = { matchMedia: () => ({ matches: false }) }
  runInNewContext(source, {
    window,
    location: { pathname },
    localStorage: {
      getItem: (key) =>
        key in storage
          ? JSON.stringify(storage[key])
          : key === "training-agent-startup-metadata-v1" && metadata
            ? JSON.stringify(metadata)
            : null,
    },
    sessionStorage: { getItem: () => null },
    AbortController: StartupController,
    AbortSignal: timeoutSignal,
    Response,
    DOMException,
    setTimeout: schedule,
    clearTimeout: (id) => timers.delete(id),
    Intl,
    Date,
    encodeURIComponent,
    fetch: (url, options) => {
      requests.push({ url, options })
      if (hang) return new Promise(() => {})
      const value =
        response?.(url, options) ??
        new Response('{"authenticated":true}', {
          headers: { "Content-Type": "application/json" },
        })
      return Promise.resolve(value)
    },
  })
  return {
    window,
    requests,
    controllers,
    timers,
    expire() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id)
        timer.callback()
      }
    },
  }
}

function streamResponse(signal, status = 200) {
  let stream
  const body = new ReadableStream({
    start(controller) {
      stream = controller
      signal.addEventListener(
        "abort",
        () => {
          try {
            controller.error(signal.reason)
          } catch {}
        },
        { once: true }
      )
    },
  })
  return {
    response: new Response(body, {
      status,
      statusText: "Synthetic status",
      headers: {
        "Content-Type": "application/json",
        "X-Startup-Test": "original",
      },
    }),
    finish(value = '{"planned":[],"history":[]}') {
      stream.enqueue(new TextEncoder().encode(value))
      stream.close()
    },
  }
}

test("startup Response promises wait for the complete native body rather than publish header-only network streams", async () => {
  let body
  const app = startup({
    response: (url, { signal }) => {
      if (url.includes("training-context")) {
        body = streamResponse(signal)
        return body.response
      }
    },
  })
  let settled = false
  void app.window.__trainingContextRequest.then(() => {
    settled = true
  })
  await flush()
  assert.equal(
    settled,
    false,
    "A discarded startup Promise must not leave an unconsumed live response body"
  )
  body.finish()
  const response = await app.window.__trainingContextRequest
  assert.equal(response instanceof Response, true)
  assert.equal(response.status, 200)
  assert.equal(response.statusText, "Synthetic status")
  assert.equal(response.headers.get("X-Startup-Test"), "original")
  assert.deepEqual(await response.json(), { planned: [], history: [] })
  assert.equal(
    app.timers.size,
    0,
    "Completed startup requests retire their timeout timers"
  )
})

test("unused completed startup reads drain once, retire timers, and remain readable after the original transport is aborted", async () => {
  const app = startup(),
    response = await app.window.__trainingContextRequest
  await app.window.__trainingSessionRequest
  assert.equal(app.timers.size, 0)
  app.expire()
  assert.ok(app.requests.every(({ options }) => !options.signal.aborted))
  // Independently abort the old transport after completion: its detached bytes
  // cannot become the old header-only response's unread aborted stream.
  for (const controller of app.controllers)
    controller.abort(new DOMException("late original signal", "TimeoutError"))
  assert.deepEqual(await response.json(), { authenticated: true })
})

test("a body stalled after headers has the same bounded deadline and returns null without an unhandled rejection", async () => {
  const app = startup({
    response: (_, { signal }) => streamResponse(signal).response,
  })
  await flush()
  app.expire()
  assert.equal(await app.window.__trainingContextRequest, null)
  assert.equal(await app.window.__trainingSessionRequest, null)
  assert.ok(app.requests.every(({ options }) => options.signal.aborted))
  assert.equal(app.timers.size, 0)
})

test("an unresponsive transport that ignores AbortSignal cannot keep the startup promise pending past its deadline", async () => {
  const app = startup({ hang: true })
  app.expire()
  const outcome = await Promise.race([
    app.window.__trainingContextRequest.then((value) => ({ value })),
    flush().then(() => ({ stillPending: true })),
  ])
  assert.deepEqual(outcome, { value: null })
  assert.equal(await app.window.__trainingSessionRequest, null)
})

test("401 and malformed JSON remain actual Response results for normal auth/error validation", async () => {
  const app = startup({
    pathname: "/library",
    response: (url) =>
      url.includes("auth%2Fsession")
        ? new Response('{"error":"Sign in"}', {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        : new Response("{malformed", { status: 200 }),
  })
  const session = await app.window.__trainingSessionRequest
  assert.equal(session.ok, false)
  assert.equal(session.status, 401)
  assert.deepEqual(await session.json(), { error: "Sign in" })
  const workspace =
    await app.window.__workspaceStartupRequests["/api/workout-library"]
  await assert.rejects(workspace.json(), SyntaxError)
  assert.equal(app.timers.size, 0)
})

for (const status of [204, 205, 304])
  test(`null-body status ${status} is preserved without constructing an invalid Response`, async () => {
    const app = startup({
      response: () =>
        new Response(null, { status, headers: { "X-Empty": "preserved" } }),
    })
    const response = await app.window.__trainingContextRequest
    assert.equal(response.status, status)
    assert.equal(response.body, null)
    assert.equal(response.headers.get("X-Empty"), "preserved")
    assert.equal(app.timers.size, 0)
  })

test("versioned, workspace and nutrition startup shapes preserve paths, credentials and priorities without extra reads", async () => {
  for (const pathname of ["/settings", "/nutrition", "/workout-reports"]) {
    const app = startup({ pathname, metadata: { version: "saved v1" } })
    assert.equal(
      app.window.__trainingContextVersion,
      pathname === "/workout-reports" ? undefined : "saved v1"
    )
    const values = [
      app.window.__trainingSessionRequest,
      app.window.__trainingContextRequest,
      ...Object.values(app.window.__workspaceStartupRequests || {}),
      app.window.__nutritionStartupRequest?.response,
    ].filter(Boolean)
    for (const response of await Promise.all(values))
      assert.equal(response instanceof Response, true)
    assert.ok(
      app.requests.every(
        ({ options }) =>
          options.credentials === "same-origin" &&
          options.cache === "no-store" &&
          !options.method
      )
    )
    assert.equal(app.requests[0].options.priority, "high")
    assert.ok(
      app.requests.slice(1).every(({ options }) => options.priority === "low")
    )
    if (pathname !== "/workout-reports")
      assert.match(app.requests[1].url, /training-updates&version=saved%20v1/)
    if (pathname === "/nutrition")
      assert.equal(typeof app.window.__nutritionStartupRequest.date, "string")
    assert.equal(app.timers.size, 0)
  }
})

test("fresh account-bound nutrition snapshot prevents speculative provider hydration on reload", async () => {
  const date = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  })
  const storage = {
    "training-agent-startup-v2": { cache_scope: "account-a" },
    [`nutrition-view-v2:account-a:${date}`]: {
      scope: "account-a",
      time: Date.now(),
      view: { date },
    },
  }
  const app = startup({ pathname: "/nutrition", storage })
  await flush()
  assert.equal(
    app.requests.filter((row) => row.url.includes("__api_route=nutrition&"))
      .length,
    0
  )
  assert.equal(
    app.requests.filter((row) => row.url.includes("auth%2Fsession")).length,
    1,
    "Authentication must still run before using private cached data"
  )
  for (const snapshot of [
    { ...storage[`nutrition-view-v2:account-a:${date}`], scope: "account-b" },
    {
      ...storage[`nutrition-view-v2:account-a:${date}`],
      time: Date.now() - 24 * 60 * 60_000,
    },
    {
      ...storage[`nutrition-view-v2:account-a:${date}`],
      time: Date.now() + 60_000,
    },
    {
      ...storage[`nutrition-view-v2:account-a:${date}`],
      view: { date: "2000-01-01" },
    },
  ]) {
    const app = startup({
      pathname: "/nutrition",
      storage: {
        ...storage,
        [`nutrition-view-v2:account-a:${date}`]: snapshot,
      },
    })
    await flush()
    assert.equal(
      app.requests.filter((row) => row.url.includes("__api_route=nutrition&"))
        .length,
      1
    )
  }
})
