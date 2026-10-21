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
const { aggregateMacronutrients } =
  await import("../src/lib/dashboard-macronutrients.ts")
const { aggregateDailyMetrics } =
  await import("../src/lib/aggregate-analysis.ts")
const { calendarMetricFields } =
  await import("../../app-backend/lib/calendar-metrics-model.mjs")
const {
  loadTrainingHistoryRange,
  loadWorkoutHistoryPage,
  loadHistoricalWorkout,
  prepareReportHistoryCache,
} = await import("../src/lib/training-history-range.ts")
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

test("actual month loader preserves conflicting nutrition evidence, deduplicates exact observations and retains one authoritative metric snapshot", async () => {
  reset()
  const metricEntries = (value) =>
      Object.fromEntries(
        calendarMetricFields.map((field) => [
          field.key,
          {
            value: field.key === "weight" ? value : null,
            time: null,
            source: "manual",
          },
        ])
      ),
    first = {
      date: "2001-02-28",
      id: "2001-02-28",
      carbohydrates: 10,
      protein: 20,
      fatTotal: 5,
      calendar_metrics: metricEntries(150),
      calendar_metrics_note: "old",
    },
    latest = {
      ...first,
      carbohydrates: 30,
      calendar_metrics: metricEntries(0),
      calendar_metrics_note: "authoritative",
    },
    march = {
      date: "2001-03-01",
      id: "2001-03-01",
      carbohydrates: 0,
      protein: 0,
      fatTotal: 0,
    },
    calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "https://test.invalid")
    calls.push(url)
    const february = url.searchParams.get("start") === "2001-02-01"
    return json({
      ...rangeContext(
        february ? "2001-02-01" : "2001-03-01",
        february ? "2001-02-28" : "2001-03-31"
      ),
      wellness_history: february
        ? [
            { date: "2001-02-26", carbohydrates: 9000 },
            first,
            structuredClone(first),
            { ...first, id: "2001-03-01", protein: 9999 },
            latest,
            { id: "2001-02-27", carbohydrates: 9999 },
          ]
        : [
            march,
            structuredClone(march),
            { date: "2001-03-03", carbohydrates: 9000 },
          ],
    })
  }
  const span = { start: "2001-02-27", end: "2001-03-02" },
    loaded = await loadTrainingHistoryRange(span.start, span.end)
  assert.equal(calls.length, 2)
  assert.deepEqual(
    loaded.wellness_history.map((row) => row.date),
    ["2001-02-28", "2001-03-01"]
  )
  const canonical = loaded.wellness_history[0]
  assert.equal(canonical.calendar_metrics_note, "authoritative")
  assert.equal(canonical.calendar_metrics.weight.value, 0)
  assert.equal(
    canonical.nutrition_sources.length,
    3,
    "Exact duplicate full snapshots merge without dropping distinct macro observations"
  )
  assert.equal(loaded.wellness_history[1].nutrition_sources.length, 1)
  assert.equal(
    aggregateDailyMetrics(loaded.wellness_history, span).find(
      (row) => row.date === first.date
    ).entries.weight.value,
    0
  )
  const nutrition = aggregateMacronutrients(
    loaded.wellness_history,
    span,
    "day"
  )
  assert.deepEqual(
    nutrition.map((row) => row.recordedDays),
    [0, 1, 1, 0]
  )
  assert.equal(
    nutrition[1].grams.carbohydrates,
    null,
    "Conflicting measured intake must reach the real chart aggregator as unknown"
  )
  assert.equal(
    nutrition[1].grams.protein,
    20,
    "Mismatched source identity must not contaminate this day's intake"
  )
  assert.equal(nutrition[1].grams.fatTotal, 5)
  assert.deepEqual(nutrition[1].sources[0].conflicts, ["carbohydrates"])
  assert.equal(
    nutrition[2].totalCalories,
    0,
    "Measured zero stays recorded after exact duplicate merging"
  )
  assert.equal(
    training.cachedTrainingContext().wellness_history,
    undefined,
    "Historical loading must not replace the current live authority"
  )
})

test("range loader derives bounded same-date nutrition evidence and never accepts nested provider evidence as source", async () => {
  reset()
  globalThis.fetch = async () =>
    json({
      ...rangeContext("2002-01-01", "2002-01-31"),
      wellness_history: [
        {
          date: "2002-01-04",
          carbohydrates: 2,
          protein: -1,
          fatTotal: "4",
          nutrition_sources: [{ date: "2002-01-04", carbohydrates: 999 }],
        },
        {
          date: "2002-01-05",
          nutrition_sources: [{ date: "2002-01-05", carbohydrates: 999 }],
        },
      ],
    })
  const span = { start: "2002-01-04", end: "2002-01-05" },
    loaded = await loadTrainingHistoryRange(span.start, span.end),
    rows = aggregateMacronutrients(loaded.wellness_history, span, "day")
  assert.deepEqual(loaded.wellness_history[0].nutrition_sources, [
    { date: "2002-01-04", carbohydrates: 2, protein: -1, fatTotal: "4" },
  ])
  assert.equal(loaded.wellness_history[1].nutrition_sources, undefined)
  assert.deepEqual(rows[0].grams, {
    carbohydrates: 2,
    protein: null,
    fatTotal: null,
  })
  assert.equal(rows[1].recordedDays, 0)
  reset()
  globalThis.fetch = async () =>
    json({
      ...rangeContext("2002-01-01", "2002-01-31"),
      wellness_history: Array.from({ length: 100001 }, () => ({
        date: "2002-01-04",
        carbohydrates: 1,
      })),
    })
  await assert.rejects(
    loadTrainingHistoryRange(span.start, span.end),
    /Too many wellness records/
  )
})

test("a malformed last daily identity cannot hide a valid earlier nutrition source or replace authoritative nonnutrition fields", async () => {
  reset()
  const day = "2003-03-04",
    good = {
      date: day,
      id: day,
      carbohydrates: 10,
      protein: 20,
      fatTotal: 5,
      sleepSecs: 100,
    },
    bad = {
      date: day,
      id: "2003-03-05",
      carbohydrates: 999,
      protein: 999,
      fatTotal: 999,
      sleepSecs: 0,
    }
  globalThis.fetch = async () =>
    json({
      ...rangeContext("2003-03-01", "2003-03-31"),
      wellness_history: [good, bad],
    })
  const loaded = await loadTrainingHistoryRange(day, day),
    canonical = loaded.wellness_history[0],
    nutrition = aggregateMacronutrients(
      loaded.wellness_history,
      { start: day, end: day },
      "day"
    )[0]
  assert.equal(loaded.wellness_history.length, 1)
  assert.equal(canonical.date, day)
  assert.equal(
    canonical.id,
    undefined,
    "A conflicting native identity must not be fabricated or attached to the merged day"
  )
  assert.equal(
    canonical.sleepSecs,
    0,
    "The existing last-snapshot authority for other metrics remains intact"
  )
  assert.deepEqual(
    canonical.nutrition_sources.map((row) => row.id),
    [day, bad.id],
    "Original source identities remain available for validation"
  )
  assert.deepEqual(nutrition.grams, {
    carbohydrates: 10,
    protein: 20,
    fatTotal: 5,
  })
  assert.deepEqual(nutrition.sources[0].conflicts, [])
  assert.equal(nutrition.totalCalories, 165)
})

test("wrong-window and undeclared-window200 responses reject before caching and a fresh valid retry binds the requested month", async () => {
  reset()
  const day = "2004-05-04",
    month = { start: "2004-05-01", end: "2004-05-31" }
  let calls = 0,
    mode = "wrong"
  globalThis.fetch = async () => {
    calls++
    const body = {
      ...rangeContext(month.start, month.end),
      wellness_history: [
        { date: day, carbohydrates: 10, protein: 20, fatTotal: 5 },
      ],
    }
    if (mode === "wrong")
      body.display_range = { start: "2004-04-01", end: "2004-04-30" }
    if (mode === "missing") delete body.display_range
    return json(body)
  }
  await assert.rejects(loadTrainingHistoryRange(day, day), /did not match/)
  mode = "missing"
  await assert.rejects(loadTrainingHistoryRange(day, day), /did not match/)
  assert.equal(
    calls,
    2,
    "Neither invalid200 can be reused as a successful cached month"
  )
  mode = "valid"
  const result = await loadTrainingHistoryRange(day, day)
  assert.equal(calls, 3)
  assert.deepEqual(result.display_range, { start: day, end: day })
  assert.equal(result.wellness_history[0].carbohydrates, 10)
  await loadTrainingHistoryRange(day, day)
  assert.equal(
    calls,
    3,
    "Only the independently verified month becomes reusable"
  )
})
const flush = () => new Promise((resolve) => setImmediate(resolve))
function reset() {
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true)
  training.rememberLiveTrainingContext(context())
}
test("preparing the report archive before sign-in never starts a server request", async () => {
  reset()
  setApiAuthenticated(false)
  let calls = 0
  globalThis.fetch = () => {
    calls++
    throw Error("Pre-auth server request")
  }
  prepareReportHistoryCache()
  await flush()
  assert.equal(calls, 0)
})

test("default report startup consumes its protected response once and missing device storage never claims a fresh archive", async () => {
  reset()
  const path = "/api/workout-history?&version=one"
  window.__workspaceStartupRequests = {
    [path]: Promise.resolve(
      json({ workouts: [], next_before: null, complete: true })
    ),
  }
  let calls = 0
  globalThis.fetch = () => {
    calls++
    throw Error("Duplicate archive read")
  }
  assert.equal((await loadWorkoutHistoryPage({})).complete, true)
  assert.equal((await loadWorkoutHistoryPage({})).complete, true)
  assert.equal(calls, 0)
  await flush()
  assert.equal(storage.has("training-agent-reports-startup-v1"), false)
  window.dispatchEvent(new Event("app-auth-required"))
  assert.equal(storage.has("training-agent-reports-startup-v1"), false)
})

test("explicit report refresh discards an older startup response and uses a new transport", async () => {
  reset()
  const path = "/api/workout-history?&version=one"
  window.__workspaceStartupRequests = {
    [path]: Promise.resolve(
      json({ workouts: [], next_before: null, complete: true, marker: "old" })
    ),
  }
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return json({
      workouts: [],
      next_before: null,
      complete: true,
      marker: "fresh",
    })
  }
  const result = await loadWorkoutHistoryPage({}, { force: true })
  assert.equal(result.marker, "fresh")
  assert.equal(calls, 1)
  assert.equal(window.__workspaceStartupRequests[path], undefined)
})

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

test("a clicked old numeric activity loads by ID without replacing the live context or reading month pages", async () => {
  reset()
  const old = {
    id: "activity:123",
    activity_id: "123",
    sport: "Bike",
    title: "Historic recorded ride",
    duration: "1h",
    status: "completed",
    workout_date: "2001-04-07",
  }
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return json({ workout: old })
  }
  assert.deepEqual(await loadHistoricalWorkout("activity:123"), old)
  assert.deepEqual(await loadHistoricalWorkout("activity:123"), old)
  assert.equal(calls.length, 1)
  assert.match(calls[0], /workout-history/)
  assert.doesNotMatch(calls[0], /history-range/)
  assert.equal(training.cachedTrainingContext().version, "one")
})

test("calendar edits invalidate historical pages even when the live context version is unchanged", async () => {
  reset()
  let calls = 0,
    headers = []
  globalThis.fetch = async (_url, options) => {
    calls++
    headers.push(new Headers(options.headers).get("X-App-Read-Revision"))
    return json(rangeContext("2001-02-01", "2001-02-28"))
  }
  await loadTrainingHistoryRange("2001-02-01", "2001-02-07")
  window.dispatchEvent(new Event("training-mutation-started"))
  await loadTrainingHistoryRange("2001-02-01", "2001-02-07")
  window.dispatchEvent(new Event("training-mutation-settled"))
  await loadTrainingHistoryRange("2001-02-01", "2001-02-07")
  assert.equal(calls, 3)
  assert.notEqual(headers[1], headers[2])
  assert.equal(training.cachedTrainingContext().version, "one")
})

test("an in-flight historical page from before an edit cannot restore a deleted missed workout", async () => {
  reset()
  let finish
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const stale = loadTrainingHistoryRange("2001-02-01", "2001-02-07")
  await flush()
  const rejected = assert.rejects(stale, { name: "AbortError" })
  window.dispatchEvent(new Event("training-mutation-started"))
  finish(
    json({
      ...rangeContext("2001-02-01", "2001-02-28"),
      history: [
        {
          id: "event:12",
          workout_date: "2001-02-02",
          title: "Missed",
          sport: "Run",
          status: "upcoming",
          duration: "20m",
        },
      ],
    })
  )
  await rejected
  globalThis.fetch = async () => json(rangeContext("2001-02-01", "2001-02-28"))
  assert.equal(
    (await loadTrainingHistoryRange("2001-02-01", "2001-02-07")).history.length,
    0
  )
})
