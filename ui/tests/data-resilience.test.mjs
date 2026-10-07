// Every fetch is replaced with an in-memory fixture. No live API/database calls.
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
globalThis.fetch = () => {
  throw Error("Unexpected network request")
}
const { setApiAuthenticated } = await import("../src/lib/api-client.ts")
const training = await import("../src/lib/training-context.ts")
const nutrition = await import("../src/lib/nutrition.ts")
const { askCoach } = await import("../src/lib/coach-client.ts")
const { waitForSection11Export, syncSection11Export, section11ExportPending } =
  await import("../src/lib/section11-export.ts")
const { validatedTrainingContext, validatedTrainingWorkout } =
  await import("../src/lib/training-context-validation.ts")
const flush = () => new Promise((resolve) => setImmediate(resolve))
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  })
const workout = (id, date = "2026-10-06") => ({
  id,
  workout_date: date,
  date,
  day: "Today",
  sport: "Run",
  title: id,
  duration: "20m",
  goal: "Easy",
  status: "today",
})
const context = (version = "one", patch = {}) => ({
  athlete: { name: version, time_zone: "America/Chicago" },
  metrics: {},
  history: [],
  planned: [workout(version)],
  cache_scope: "fixture",
  version,
  ...patch,
})
const targets = {
  calories: 2000,
  protein: 150,
  carbs: 225,
  fat: 55,
  fiber: null,
}
const diary = (date = "2026-10-06", revision = 1) => ({
  date,
  day: { entries: [], revision },
  targets,
  targetsRevision: 1,
  week: [],
  aiAvailable: false,
  localPreview: false,
})

test.beforeEach(() => {
  storage.clear()
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true, true)
  globalThis.fetch = () => {
    throw Error("Unexpected network request")
  }
})

test("concurrent training views and repeated forced refreshes each share one database request", async () => {
  let finish,
    calls = 0
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const first = training.loadTrainingContext(),
    second = training.loadTrainingContext()
  await flush()
  assert.equal(calls, 1)
  finish(json(context()))
  assert.equal((await first).athlete.name, "one")
  assert.equal((await second).athlete.name, "one")
  await training.loadTrainingContext()
  assert.equal(calls, 1)
  const refresh = training.loadTrainingContext(true),
    duplicate = training.loadTrainingContext(true)
  await flush()
  assert.equal(calls, 2)
  finish(json(context("two")))
  assert.equal((await refresh).athlete.name, "two")
  assert.equal((await duplicate).athlete.name, "two")
})

test("a cache reset during initial load does not self-await or automatically repeat the database read", async () => {
  let finish,
    calls = 0
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const old = training.loadTrainingContext()
  await flush()
  window.dispatchEvent(new Event("training-cache-reset"))
  finish(json(context("stale")))
  assert.equal((await old).source, "local-preview")
  assert.equal(calls, 1)
  assert.equal(training.cachedTrainingContext().source, "local-preview")
  globalThis.fetch = async () => {
    calls++
    return json(context("fresh"))
  }
  assert.equal((await training.loadTrainingContext()).athlete.name, "fresh")
  assert.equal(calls, 2)
})

test("a fresh full context also satisfies startup week consumers without a second database request", async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return json(context("full", { context_scope: "full" }))
  }
  await training.loadFullTrainingContext()
  const week = await training.loadTrainingContext()
  assert.equal(week.athlete.name, "full")
  assert.equal(calls, 1)
  await training.revalidateTrainingContext()
  assert.equal(calls, 2)
})

test("live context supersedes an older response without replacing the visible data", async () => {
  let finish
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const old = training.loadTrainingContext()
  await flush()
  training.rememberLiveTrainingContext(context("live"))
  finish(json(context("old")))
  assert.equal((await old).athlete.name, "live")
  assert.equal(training.cachedTrainingContext().athlete.name, "live")
})

test("broken responses preserve the last display snapshot and cannot suppress the next retry", async () => {
  training.rememberTrainingContext(context("saved"))
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return json(
      calls === 1
        ? { athlete: {}, history: null, planned: [] }
        : context("recovered")
    )
  }
  assert.equal((await training.loadTrainingContext()).athlete.name, "saved")
  assert.equal((await training.loadTrainingContext()).athlete.name, "recovered")
  assert.equal(calls, 2)
})

test("a response body timeout settles training loading and retains the prior snapshot", async (t) => {
  training.rememberTrainingContext(context("saved"))
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let networkSignal
  globalThis.fetch = async (_, options) => {
    networkSignal = options.signal
    return new Response(new ReadableStream({ start() {} }))
  }
  const request = training.loadTrainingContext()
  await flush()
  t.mock.timers.tick(20_000)
  assert.equal((await request).athlete.name, "saved")
  assert.equal(networkSignal.aborted, true)
})

test("snapshot validation handles corrupt rows, unavailable storage, and invalid athlete time zones", async () => {
  storage.set(
    "training-agent-startup-v2",
    JSON.stringify(context("saved", { history: [null] }))
  )
  assert.equal(training.cachedTrainingContext().source, "local-preview")
  storage.set(
    "training-agent-startup-v2",
    JSON.stringify(
      context("saved", {
        athlete: { name: "timezone", time_zone: "Mars/Olympus" },
      })
    )
  )
  assert.equal(
    training.cachedTrainingContext().athlete.time_zone,
    "America/Chicago"
  )
  const original = localStorage.setItem
  localStorage.setItem = () => {
    throw new DOMException("Storage full", "QuotaExceededError")
  }
  try {
    training.rememberTrainingContext(context("memory"))
    assert.equal(training.cachedTrainingContext().athlete.name, "memory")
  } finally {
    localStorage.setItem = original
  }
})

test("component response validation rejects nested shapes that would crash the calendar or settings", () => {
  for (const patch of [
    { athlete: { name: { bad: true } } },
    { athlete: { zones: { run_threshold_pace: 720 } } },
    { athlete: { zone_history: "broken" } },
    {
      library: [
        {
          id: "library",
          sport: "Run",
          title: "Run",
          duration: "20m",
          purpose: "Easy",
          tags: { bad: true },
        },
      ],
    },
    { planned: [{ ...workout("bad"), details: { bad: true } }] },
    { cache_scope: { bad: true } },
    { display_range: { start: "2026-10-06", end: "2026-10-01" } },
  ])
    assert.throws(
      () => validatedTrainingContext(context("fixture", patch)),
      /incomplete/
    )
  assert.throws(() => validatedTrainingWorkout({ id: "saved" }), /incomplete/)
  assert.equal(validatedTrainingWorkout(workout("good")).id, "good")
  assert.equal(
    validatedTrainingContext(
      context("timezone", { athlete: { time_zone: "not-a-zone" } })
    ).athlete.time_zone,
    "America/Chicago"
  )
})

test("auth invalidation clears training memory and persisted startup data", () => {
  training.rememberTrainingContext(context("private"), "full")
  window.dispatchEvent(new Event("app-auth-required"))
  assert.equal(training.cachedTrainingContext().source, "local-preview")
  assert.equal(storage.has("training-agent-startup-v2"), false)
})

test("invalid calendar days and corrupt numeric summaries cannot reach charts; null measurements and legacy history remain valid", () => {
  for (const patch of [
    { planned: [workout("invalid-day", "2026-02-31")] },
    { history: [{ workout_date: "2026-13-01" }] },
    { metrics: { fitness: { bad: true } } },
    { metrics: { fatigue: NaN } },
    {
      history: [
        {
          workout_date: "2026-10-01",
          completed: { duration_minutes: { bad: true } },
        },
      ],
    },
    { athlete: { zones: { bike_ftp: Infinity } } },
    {
      planned: [
        {
          ...workout("bad-summary"),
          workout_summary: { planned: "broken", completed: null },
        },
      ],
    },
    {
      planned: [
        {
          ...workout("bad-summary"),
          workout_summary: { planned: null, completed: [] },
        },
      ],
    },
    {
      planned: [
        {
          ...workout("bad-summary"),
          workout_summary: { completed: { duration_seconds: { bad: true } } },
        },
      ],
    },
    {
      planned: [
        {
          ...workout("bad-summary"),
          workout_summary: { completed: { average_hr: NaN } },
        },
      ],
    },
    {
      planned: [
        {
          ...workout("bad-duration"),
          completed_data: { duration_minutes: [] },
        },
      ],
    },
  ])
    assert.throws(
      () => validatedTrainingContext(context("fixture", patch)),
      /incomplete/
    )
  const valid = context("measurements", {
    athlete: { zones: { bike_ftp: null, threshold_hr: null } },
    metrics: { fitness: null },
    history: [
      {
        workout_date: "2024-02-29",
        planned: { tss: null },
        completed: { duration_minutes: 30 },
        recovery: { hrv: null },
      },
    ],
    planned: [
      {
        ...workout("null-values"),
        workout_summary: {
          planned: null,
          completed: { duration_seconds: null, average_hr: 0 },
        },
      },
    ],
    display_range: { start: "0000-01-01", end: "9999-12-31" },
  })
  assert.equal(validatedTrainingContext(valid).history.length, 1)
  assert.equal(
    validatedTrainingWorkout(workout("leap", "2024-02-29")).workout_date,
    "2024-02-29"
  )
})

test("calendar merges retain separate unidentified historical records and deduplicate identified workouts", () => {
  const previous = context("old", {
    history: [
      { workout_date: "2026-08-01", planned: { tss: 10 } },
      { workout_date: "2026-08-02", planned: { tss: 20 } },
      workout("same", "2026-10-01"),
    ],
  })
  const incoming = context("new", {
    history: [workout("same", "2026-10-01")],
    display_range: { start: "2026-09-01", end: "2026-10-08" },
  })
  const merged = training.mergeCalendarContext(previous, incoming)
  assert.equal(merged.history.length, 3)
  assert.deepEqual(merged.history.slice(0, 2), previous.history.slice(0, 2))
})

test("a refreshed calendar range removes deleted sessions while retaining other weeks", () => {
  const previous = context("old", {
    history: [
      workout("outside", "2026-08-01"),
      workout("deleted", "2026-10-01"),
    ],
    planned: [
      workout("moved-away", "2026-10-08"),
      workout("future", "2026-11-01"),
    ],
  })
  const incoming = context("new", {
    history: [],
    planned: [],
    display_range: { start: "2026-10-01", end: "2026-10-08" },
  })
  const merged = training.mergeCalendarContext(previous, incoming)
  assert.deepEqual(
    merged.history.map((row) => row.id),
    ["outside"]
  )
  assert.deepEqual(
    merged.planned.map((row) => row.id),
    ["future"]
  )
})

test("overlapping workout mutations cannot let an older response overwrite newer accepted context", async () => {
  training.rememberTrainingContext(context("saved"), "full")
  const finish = []
  globalThis.fetch = () => new Promise((resolve) => finish.push(resolve))
  const first = training.changeWorkout("first", "delete"),
    second = training.changeWorkout("second", "delete")
  await flush()
  finish[1](json({ verified: true, context: context("newer") }))
  await second
  finish[0](json({ verified: true, context: context("older") }))
  assert.equal((await first).context.athlete.name, "newer")
  assert.equal(training.cachedTrainingContext().athlete.name, "newer")
  assert.equal(training.trainingMutationState().busy, false)
})

test("a verified mutation without a context never clears the visible calendar", async () => {
  training.rememberTrainingContext(context("saved"), "full")
  globalThis.fetch = async () => json({ verified: true })
  await training.changeWorkout("one", "delete")
  assert.equal(training.cachedTrainingContext().athlete.name, "saved")
})

test("stalled edit, workout, and day-action bodies settle without replaying writes or clearing the calendar", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  for (const [start, timeout] of [
    [
      () =>
        training.queueWorkoutMutation({
          type: "description",
          id: "event:1",
          description: "saved",
        }),
      65_000,
    ],
    [() => training.changeWorkout("event:1", "copy"), 180_000],
    [() => training.changeWorkoutDay("2026-10-06", "delete"), 240_000],
  ]) {
    training.rememberTrainingContext(context("saved"), "full")
    let calls = 0,
      signal
    globalThis.fetch = async (_, options) => {
      calls++
      signal = options.signal
      return new Response(new ReadableStream({ start() {} }))
    }
    const request = start()
    const rejected = assert.rejects(
      request,
      (error) =>
        error.name === "TimeoutError" &&
        /check the result before repeating/.test(error.message)
    )
    await flush()
    assert.equal(training.trainingMutationState().busy, true)
    t.mock.timers.tick(timeout)
    await rejected
    assert.equal(signal.aborted, true)
    assert.equal(training.trainingMutationState().busy, false)
    assert.equal(training.cachedTrainingContext().athlete.name, "saved")
    assert.equal(calls, 1)
  }
})

test("session reset aborts old workout writes while a new session's response remains independent", async () => {
  const finishes = [],
    signals = []
  globalThis.fetch = (_, options) => {
    signals.push(options.signal)
    return new Promise((resolve) => finishes.push(resolve))
  }
  const old = training.changeWorkout("event:1", "delete")
  const rejected = assert.rejects(old, { name: "AbortError" })
  await flush()
  window.dispatchEvent(new Event("app-auth-required"))
  const current = training.changeWorkout("event:2", "delete")
  await rejected
  await flush()
  assert.equal(signals[0].aborted, true)
  assert.equal(signals[1].aborted, false)
  assert.equal(training.trainingMutationState().busy, true)
  finishes[1](json({ verified: true, context: context("new-session") }))
  await current
  finishes[0](json({ verified: true, context: context("old-session") }))
  await flush()
  assert.equal(training.cachedTrainingContext().athlete.name, "new-session")
  assert.equal(training.trainingMutationState().busy, false)
})

test("concurrent manual refreshes share one write and expose unresolved queue outcomes without waiting on progress", async () => {
  let finish,
    calls = 0
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const statuses = []
  const first = training.refreshRecentIntervals((progress) =>
    statuses.push(progress.phase)
  )
  const second = training.refreshRecentIntervals(() => {
    throw Error("View unmounted")
  })
  await flush()
  assert.equal(calls, 1)
  finish(
    json({
      context: context("refreshed"),
      queue: { synced: 2, failed: 1, pending: 1, unknown: 1 },
      section11Sync: { status: "complete", revision: 1 },
    })
  )
  const result = await first
  assert.equal(await second, result)
  assert.equal(result.queue.unknown, 1)
  assert.equal(result.context.athlete.name, "refreshed")
  await result.githubSync
  assert.deepEqual(statuses, ["starting", "complete"])
  assert.equal(training.trainingMutationState().busy, false)
  assert.equal(calls, 1)
})

test("completed manual refresh cancels a stalled progress body immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let finish, progressSignal
  globalThis.fetch = async (path, options) => {
    const route = new URL(path, "http://fixture").searchParams.get(
      "__api_route"
    )
    if (route === "sync/progress") {
      progressSignal = options.signal
      return new Response(new ReadableStream({ start() {} }))
    }
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const request = training.refreshRecentIntervals()
  await flush()
  t.mock.timers.tick(1500)
  await flush()
  assert.equal(progressSignal.aborted, false)
  finish(
    json({
      context: context("refreshed"),
      section11Sync: { status: "complete" },
    })
  )
  const result = await request
  await result.githubSync
  assert.equal(progressSignal.aborted, true)
  assert.equal(result.context.athlete.name, "refreshed")
})

test("manual refresh body deadlines retain the calendar and permit a clean retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  training.rememberTrainingContext(context("saved"), "full")
  let signal
  globalThis.fetch = async (_, options) => {
    signal = options.signal
    return new Response(new ReadableStream({ start() {} }))
  }
  const request = training.refreshRecentIntervals()
  await flush()
  t.mock.timers.tick(240_000)
  await assert.rejects(request, { name: "TimeoutError" })
  assert.equal(signal.aborted, true)
  assert.equal(training.cachedTrainingContext().athlete.name, "saved")
  assert.equal(training.trainingMutationState().busy, false)
  globalThis.fetch = async () =>
    json({
      context: context("recovered"),
      section11Sync: { status: "complete" },
    })
  const recovered = await training.refreshRecentIntervals()
  await recovered.githubSync
  assert.equal(recovered.context.athlete.name, "recovered")
})

test("session reset during completed refresh cleanup prevents old export polling from starting", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let finish
  globalThis.fetch = async (path, options) => {
    const route = new URL(path, "http://fixture").searchParams.get(
      "__api_route"
    )
    if (route === "sync/progress") {
      options.signal.addEventListener(
        "abort",
        () => window.dispatchEvent(new Event("app-auth-required")),
        { once: true }
      )
      return new Response(new ReadableStream({ start() {} }))
    }
    assert.equal(route, "sync")
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const request = training.refreshRecentIntervals()
  const rejected = assert.rejects(request, { name: "AbortError" })
  await flush()
  t.mock.timers.tick(1500)
  await flush()
  finish(
    json({
      context: context("old-session"),
      section11Sync: { status: "running" },
    })
  )
  await rejected
  assert.equal(section11ExportPending(), false)
  assert.equal(training.cachedTrainingContext().source, "local-preview")
  assert.equal(training.trainingMutationState().busy, false)
})

test("logout invalidates a shared manual refresh without letting its finalizer cancel a new session's refresh", async () => {
  const finishes = [],
    signals = []
  globalThis.fetch = (_, options) => {
    signals.push(options.signal)
    return new Promise((resolve) => finishes.push(resolve))
  }
  const first = training.refreshRecentIntervals()
  const aborted = assert.rejects(first, { name: "AbortError" })
  await flush()
  window.dispatchEvent(new Event("app-auth-required"))
  const progress = []
  const second = training.refreshRecentIntervals((value) =>
    progress.push(value.phase)
  )
  await aborted
  await flush()
  assert.equal(signals[0].aborted, true)
  assert.equal(signals[1].aborted, false)
  assert.equal(training.trainingMutationState().busy, true)
  const shared = training.refreshRecentIntervals()
  assert.equal(shared, second)
  finishes[1](
    json({
      context: context("new-session"),
      section11Sync: { status: "complete" },
    })
  )
  const result = await second
  await result.githubSync
  finishes[0](
    json({
      context: context("old-session"),
      section11Sync: { status: "running" },
    })
  )
  await flush()
  assert.deepEqual(progress, ["starting", "complete"])
  assert.equal(training.cachedTrainingContext().athlete.name, "new-session")
  assert.equal(training.trainingMutationState().busy, false)
  assert.equal(section11ExportPending(), false)
})

test("export status and start requests include response bodies in their deadlines", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  globalThis.fetch = async () =>
    new Response(new ReadableStream({ start() {} }))
  const waiting = waitForSection11Export({ status: "queued", revision: 2 })
  await flush()
  t.mock.timers.tick(2000)
  await flush()
  t.mock.timers.tick(15_000)
  await assert.rejects(waiting, { name: "TimeoutError" })
  const starting = syncSection11Export()
  await flush()
  t.mock.timers.tick(20_000)
  await assert.rejects(starting, { name: "TimeoutError" })
})

test("session reset cancels old export polling and cannot clear a newer export's pending flag", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let finish, signal
  globalThis.fetch = (_, options) => {
    signal = options.signal
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const old = waitForSection11Export({ status: "queued", revision: 1 })
  const rejected = assert.rejects(old, { name: "AbortError" })
  await flush()
  t.mock.timers.tick(2000)
  await flush()
  window.dispatchEvent(new Event("training-cache-reset"))
  const current = waitForSection11Export({ status: "queued", revision: 2 })
  assert.equal(section11ExportPending(), true)
  await rejected
  assert.equal(signal.aborted, true)
  finish(json({ status: "complete", revision: 1 }))
  await flush()
  assert.equal(section11ExportPending(), true)
  const currentRejected = assert.rejects(current, { name: "AbortError" })
  window.dispatchEvent(new Event("app-auth-required"))
  await currentRejected
  assert.equal(section11ExportPending(), false)
})

test("an older export completing after a new export starts cannot clear the newer pending flag", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const requests = []
  globalThis.fetch = (path) =>
    new Promise((resolve) => requests.push({ path, resolve }))
  const old = syncSection11Export("older")
  await flush()
  const current = waitForSection11Export({ status: "queued", revision: 2 })
  // The old start response arrives after a newer export began tracking.
  requests[0].resolve(
    json({ section11Sync: { status: "queued", revision: 1 } })
  )
  await flush()
  t.mock.timers.tick(2000)
  await flush()
  const olderStatus = requests.find(
    (request) =>
      new URL(request.path, "http://fixture").searchParams.get("revision") ===
      "1"
  )
  const currentStatus = requests.find(
    (request) =>
      new URL(request.path, "http://fixture").searchParams.get("revision") ===
      "2"
  )
  assert.ok(olderStatus)
  assert.ok(currentStatus)
  olderStatus.resolve(json({ status: "complete", revision: 1 }))
  await old
  assert.equal(section11ExportPending(), true)
  currentStatus.resolve(json({ status: "complete", revision: 2 }))
  await current
  assert.equal(section11ExportPending(), false)
})

test("nutrition requests share loads, reject malformed responses, and permit a clean retry", async () => {
  let calls = 0,
    finish
  globalThis.fetch = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const first = nutrition.prefetchNutrition("2026-10-06"),
    second = nutrition.prefetchNutrition("2026-10-06")
  await flush()
  assert.equal(calls, 1)
  finish(json({ date: "2026-10-06", day: { entries: null } }))
  await Promise.all([
    assert.rejects(first, /incomplete/),
    assert.rejects(second, /incomplete/),
  ])
  globalThis.fetch = async () => {
    calls++
    return json(diary())
  }
  assert.equal(
    (await nutrition.prefetchNutrition("2026-10-06")).day.revision,
    1
  )
  assert.equal(calls, 2)
  assert.equal(nutrition.cachedNutrition("2026-10-06").day.revision, 1)
})

test("late nutrition results after logout cannot repopulate any startup or memory cache", async () => {
  let finish
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const old = nutrition.prefetchNutrition("2026-10-06")
  await flush()
  window.dispatchEvent(new Event("app-auth-required"))
  finish(json(diary()))
  await assert.rejects(old, { name: "AbortError" })
  assert.equal(nutrition.cachedNutrition("2026-10-06"), null)
  assert.equal(storage.has("training-agent-nutrition-startup-v1"), false)
})

test("caller-supplied nutrition cancellation still has a whole-body timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const caller = new AbortController()
  let networkSignal
  globalThis.fetch = async (_, options) => {
    networkSignal = options.signal
    return new Response(new ReadableStream({ start() {} }))
  }
  const request = nutrition.nutritionRequest(
    "?date=2026-10-06",
    undefined,
    caller.signal
  )
  await flush()
  t.mock.timers.tick(22_000)
  await assert.rejects(request, { name: "TimeoutError" })
  assert.equal(networkSignal.aborted, true)
  assert.equal(caller.signal.aborted, false)
})

const answer = {
  text: "Ready café 🚲",
  model: "fixture",
  source: {
    dataRevision: "a",
    protocolRevision: "b",
    lastSynced: null,
    checkedAt: "now",
    freshness: "recent",
  },
}
const event = (name, data) =>
  `event:${name}\r\ndata:${JSON.stringify(data)}\r\n\r\n`
function streamResponse(text, { close = true } = {}) {
  const bytes = new TextEncoder().encode(text)
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        if (close) controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream" } }
  )
}

test("coach streaming handles CRLF, one-byte UTF-8 chunks, and completion before the socket closes", async () => {
  globalThis.fetch = async () =>
    streamResponse(
      event("status", { text: "Thinking" }) +
        event("token", { text: "café 🚲" }) +
        event("answer", answer),
      { close: false }
    )
  const statuses = [],
    tokens = []
  assert.deepEqual(
    await askCoach(
      [],
      new AbortController().signal,
      (text) => statuses.push(text),
      (text) => tokens.push(text)
    ),
    answer
  )
  assert.deepEqual(statuses, ["Thinking"])
  assert.deepEqual(tokens, ["café 🚲"])
})

test("coach streaming accepts a complete final answer at EOF and ignores unknown heartbeat payloads", async () => {
  globalThis.fetch = async () =>
    streamResponse(
      `event: heartbeat\ndata: ping\n\n` +
        `event: answer\ndata: ${JSON.stringify(answer)}`
    )
  assert.deepEqual(
    await askCoach([], new AbortController().signal, () => {}),
    answer
  )
})

test("malformed coach events and interrupted streams leave a clear retry error", async () => {
  globalThis.fetch = async () =>
    streamResponse("event: answer\ndata: {broken}\n\n")
  await assert.rejects(
    askCoach([], new AbortController().signal, () => {}),
    /incomplete response/
  )
  globalThis.fetch = async () =>
    streamResponse(event("status", { text: "Thinking" }))
  await assert.rejects(
    askCoach([], new AbortController().signal, () => {}),
    /ready to retry/
  )
})

test("aborting a stalled coach stream cancels its reader and settles promptly", async () => {
  let canceled = false
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start() {},
        cancel() {
          canceled = true
        },
      }),
      { headers: { "content-type": "text/event-stream" } }
    )
  const controller = new AbortController()
  const request = askCoach([], controller.signal, () => {})
  await flush()
  controller.abort()
  await assert.rejects(request, { name: "AbortError" })
  assert.equal(canceled, true)
})
