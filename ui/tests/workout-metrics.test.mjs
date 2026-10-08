import test from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return {
      url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href,
      shortCircuit: true,
    }
    if (specifier.startsWith(".") && context.parentURL && !/\.[a-z]+$/.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
globalThis.fetch = () => { throw Error("Unexpected network request in workout metric tests") }
const { workoutTss, formatWorkoutTss, workoutTssTotal, workoutTime, workoutPlannedMinutes } =
  await import("../src/lib/workout-metrics.ts")
const { completedMinutes } = await import("../src/lib/training-context.ts")

const workout = (overrides = {}) => ({
  id: "event:1", status: "upcoming", sport: "Bike", title: "Synthetic session",
  day: "Mon", date: "Oct 5", duration: "1h", goal: "Easy",
  plannedDurationMinutes: 60,
  ...overrides,
})
const summary = (values, completed = false) => ({
  planned: completed ? null : values,
  completed: completed ? values : null,
})

test("authoritative explicit zero is known TSS for both completed and planned sessions", () => {
  for (const completed of [false, true]) {
    const item = workout({
      status: completed ? "completed" : "upcoming",
      load: 99, planned: { tss: 99 }, completed_data: { tss: 99 },
      workout_summary: summary({ tss: 0, duration_seconds: 3600, intensity_factor: 0.8 }, completed),
    })
    assert.deepEqual(workoutTss(item), { value: 0, estimated: !completed })
    assert.equal(formatWorkoutTss(item), completed ? "0 TSS" : "~0 TSS")
  }
})

test("missing authoritative TSS cannot become known from legacy placeholder or stale values", () => {
  for (const completed of [false, true]) for (const legacy of [0, 80]) {
    const item = workout({
      status: completed ? "completed" : "upcoming",
      load: legacy, planned: { tss: legacy }, completed_data: { tss: legacy },
      workout_summary: summary({ tss: null, intensity_factor: null, duration_seconds: 3600 }, completed),
    })
    assert.equal(workoutTss(item), null)
    assert.equal(formatWorkoutTss(item), "—")
  }
  assert.equal(workoutTss(workout({
    load: 75, planned: { tss: 0 }, workout_summary: summary({ duration_seconds: 3600 }),
  })), null)
})

test("unpaired recordings have no planned TSS despite normalized planned zero and recorded load", () => {
  const item = workout({
    id: "activity:fixture", status: "completed", load: 65,
    planned: { tss: 0, duration_minutes: 0 },
    workout_summary: { planned: null, completed: { tss: 65, duration_seconds: 3600 } },
  })
  assert.equal(workoutTss({ ...item, status: "upcoming" }), null)
  assert.equal(workoutTssTotal([item], "planned").label, "—")
  assert.equal(workoutTssTotal([item], "planned").expected, 0)
  assert.equal(workoutTssTotal([item], "completed").label, "65")
})

test("planned duration excludes unpaired recordings while retaining paired plans and recorded time", () => {
  const unpaired = workout({
    id: "activity:fixture", status: "completed", actualDurationMinutes: 60,
    plannedDurationMinutes: 0, planned: { duration_minutes: 0 },
    workout_summary: { planned: null, completed: { duration_seconds: 3600 } },
  })
  assert.equal(workoutPlannedMinutes(unpaired), 0)
  assert.equal(completedMinutes(unpaired), 60)
  const paired = workout({
    status: "completed", actualDurationMinutes: 30, plannedDurationMinutes: 60,
    workout_summary: { planned: { duration_seconds: 3600 }, completed: { duration_seconds: 1800 } },
  })
  assert.equal(workoutPlannedMinutes(paired), 60)
  assert.equal(completedMinutes(paired), 30)
  assert.equal(workoutPlannedMinutes(workout({
    status: "completed", plannedDurationMinutes: undefined, actualDurationMinutes: 60,
  })), 60)
})

test("modern paired plans with missing duration cannot borrow actual time", () => {
  const item = workout({
    status: "completed", actualDurationMinutes: 30,
    plannedDurationMinutes: 0, planned: { duration_minutes: 0 },
    workout_summary: { planned: { duration_seconds: null }, completed: { duration_seconds: 1800 } },
  })
  assert.equal(workoutPlannedMinutes(item), 0)
  assert.equal(completedMinutes(item), 30)
  assert.equal(workoutPlannedMinutes({ ...item, plannedDurationMinutes: 45 }), 45)
  assert.equal(workoutPlannedMinutes({ ...item, planned: { duration_minutes: 50 } }), 50)
  assert.equal(workoutPlannedMinutes({
    ...item, plannedDurationMinutes: 45,
    workout_summary: { ...item.workout_summary, planned: { duration_seconds: 1200 } },
  }), 20)
  assert.equal(workoutPlannedMinutes({
    ...item, plannedDurationMinutes: 45,
    workout_summary: { ...item.workout_summary, planned: { duration_seconds: 0 } },
  }), 0)
})

test("missing authoritative TSS still permits an estimate from finite measured duration and IF", () => {
  for (const completed of [false, true]) {
    const item = workout({
      status: completed ? "completed" : "upcoming",
      load: 0, planned: { tss: 0 }, completed_data: { tss: 0 },
      workout_summary: summary({ tss: null, duration_seconds: 3600, intensity_factor: 0.8 }, completed),
    })
    assert.ok(Math.abs(workoutTss(item).value - 64) < 1e-10)
    assert.equal(workoutTss(item).estimated, true)
    assert.equal(formatWorkoutTss(item), "~64 TSS")
  }
})

test("missing or invalid authoritative estimation inputs cannot borrow legacy duration or produce Infinity", () => {
  const item = workout({ planned: { tss: 0, duration_minutes: 60 }, load: 0 })
  for (const values of [
    { duration_seconds: null, intensity_factor: 0.8 },
    { duration_seconds: 3600, intensity_factor: Infinity },
    { duration_seconds: 3600, intensity_factor: NaN },
    { duration_seconds: 3600, intensity_factor: 1e200 },
    { duration_seconds: Infinity, intensity_factor: 0.8 },
  ]) assert.equal(workoutTss({ ...item, workout_summary: summary({ tss: null, ...values }) }), null)
})

test("legacy records without authoritative summaries retain their recorded and planned TSS", () => {
  assert.deepEqual(workoutTss(workout({ planned: { tss: 52 }, load: 80 })), { value: 52, estimated: true })
  assert.deepEqual(workoutTss(workout({ load: 35 })), { value: 35, estimated: true })
  assert.deepEqual(workoutTss(workout({ status: "completed", completed_data: { tss: 45 } })), { value: 45, estimated: false })
  assert.deepEqual(workoutTss(workout({ status: "completed", completed_data: { tss: 0 } })), { value: 0, estimated: false })
})

test("weekly planned totals distinguish known zero, missing values, and activities with no plan", () => {
  const zero = workout({ workout_summary: summary({ tss: 0 }) })
  const missing = workout({ workout_summary: summary({ tss: null }), planned: { tss: 0 }, load: 0 })
  const recording = workout({ status: "completed", workout_summary: { planned: null, completed: { tss: 65 } } })
  assert.deepEqual(workoutTssTotal([zero, missing, recording], "planned"), {
    value: 0, label: "~0+", available: 1, expected: 2, estimated: true, partial: true,
  })
  assert.equal(workoutTssTotal([zero], "planned").label, "~0")
})

test("weekly completed totals mark partial known TSS and ignore future planned sessions", () => {
  const known = workout({ status: "completed", workout_summary: summary({ tss: 65 }, true) })
  const missing = workout({ status: "completed", workout_summary: summary({ tss: null }, true), completed_data: { tss: 0 } })
  const future = workout({ workout_summary: summary({ tss: 100 }), completed_data: { tss: 100 } })
  assert.deepEqual(workoutTssTotal([known, missing, future], "completed"), {
    value: 65, label: "65+", available: 1, expected: 2, estimated: false, partial: true,
  })
})

test("empty and wholly unavailable weekly totals stay unavailable", () => {
  const missing = workout({ workout_summary: summary({ tss: null }), planned: { tss: 0 } })
  for (const items of [[], [missing]]) {
    const total = workoutTssTotal(items, "planned")
    assert.equal(total.value, null)
    assert.equal(total.label, "—")
    assert.equal(total.available, 0)
    assert.equal(total.partial, false)
  }
  assert.equal(workoutTssTotal([workout({ load: 1e308 }), workout({ load: 1e308 })], "planned").label, "—")
})

test("completed sessions without recorded time preserve the estimate label", () => {
  const item = workout({ status: "completed", actualDurationMinutes: 0, plannedDurationMinutes: 60 })
  assert.deepEqual(workoutTime(item), { label: "Est. time", value: "01h 00m" })
})
