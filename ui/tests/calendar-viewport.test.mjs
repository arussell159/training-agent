import assert from "node:assert/strict"
import { test } from "node:test"
import {
  adjacentCalendarWeek,
  calendarAnchorAdjustment,
  calendarRange,
  calendarWeekKey,
  extendCalendarRange,
  indexCalendarWorkouts,
} from "../src/lib/calendar-viewport.ts"
import { calendarDisplayWorkouts } from "../src/lib/calendar-workout-display.ts"
import { calendarDurationSummary, desktopCalendarRecordedTotal } from "../src/lib/desktop-calendar-summary.ts"

const recorded = (overrides = {}) => ({
  id: "activity:i1001", activity_id: "i1001", workout_date: "2026-10-22",
  sport: "Run", status: "completed", title: "Morning run",
  workout_summary: { planned: null, completed: { duration_seconds: 1620, distance_meters: 4400, tss: 37, elevation_gain: 10, work_kj: 200 } },
  ...overrides,
})
const linked = (overrides = {}) => recorded({
  id: "event:1001", category: "WORKOUT", completion_grade: "good",
  planned_workout_date: "2026-10-21",
  workout_summary: { planned: { duration_seconds: 1800 }, completed: recorded().workout_summary.completed },
  ...overrides,
})

test("same-day linked calendar aliases show the completed plan once regardless of source order", () => {
  const event = Object.freeze(linked()), activity = Object.freeze(recorded())
  for (const rows of [Object.freeze([event, activity]), Object.freeze([activity, event])]) {
    const cards = calendarDisplayWorkouts(rows)
    assert.deepEqual(cards, [event])
    assert.equal(cards[0], event)
    assert.equal(rows.length, 2, "The authoritative source and its planned contribution remain intact")
    assert.deepEqual(indexCalendarWorkouts(cards).get("2026-10-19"), [event])
  }
})

test("standalone activities and similar recordings are never deduplicated by title, sport or metrics", () => {
  const unplanned = recorded({ id: "activity:i2", activity_id: "i2" })
  assert.deepEqual(calendarDisplayWorkouts([recorded(), unplanned]), [recorded(), unplanned])
  assert.deepEqual(calendarDisplayWorkouts([linked(), unplanned]), [linked(), unplanned])
  const conflictingAlias = recorded({ id: "activity:i2", activity_id: "i1001" })
  assert.deepEqual(calendarDisplayWorkouts([linked(), conflictingAlias]), [linked(), conflictingAlias])
})

test("different calendar dates and separate planned targets keep their own cards", () => {
  const raw = recorded({ workout_date: "2026-10-23" }), event = linked()
  assert.deepEqual(calendarDisplayWorkouts([event, raw]), [event, raw])
  const secondPlan = linked({ id: "event:2" })
  assert.deepEqual(calendarDisplayWorkouts([event, recorded(), secondPlan]), [event, secondPlan])
  const scheduled = linked({ status: "upcoming" })
  assert.deepEqual(calendarDisplayWorkouts([scheduled, recorded()]), [scheduled, recorded()])
})

test("missing links/dates and annotations cannot hide a completed recording", () => {
  for (const patch of [{ activity_id: null }, { workout_date: undefined }, { category: "NOTE" }, { calendar_annotation_key: "availability:1" }]) {
    const event = linked(patch), raw = recorded()
    assert.deepEqual(calendarDisplayWorkouts([event, raw]), [event, raw])
  }
  const raw = recorded({ workout_date: undefined })
  assert.deepEqual(calendarDisplayWorkouts([linked(), raw]), [linked(), raw])
})

test("explicit linked identity stays sufficient when metrics are unavailable and supports accepted app plans", () => {
  const event = linked({ id: "app:995fb014-baa8-4b92-8c4b-9f430e540323", workout_summary: { planned: { duration_seconds: 1800 }, completed: null } })
  assert.deepEqual(calendarDisplayWorkouts([recorded(), event]), [event])
  assert.equal(event.workout_summary.completed, null, "Do not synthesize actual metrics from either plan or raw alias")
})

test("weekly secondary metrics count same-day aliases once while original planned-duration inputs are preserved", () => {
  const rows = [linked(), recorded(), recorded({ id: "activity:i2", activity_id: "i2", workout_date: "2026-10-23" })]
  const cards = calendarDisplayWorkouts(rows)
  for (const [field, value] of [["distance_meters", 8800], ["elevation_gain", 20], ["work_kj", 400]])
    assert.deepEqual(desktopCalendarRecordedTotal(cards, field), { value, known: 2, expected: 2 })
  const summary = calendarDurationSummary(rows, { start: "2026-10-19", end: "2026-10-25" })
  assert.equal(summary.planned.value, 1800)
  assert.equal(summary.completed.value, 3240)
  assert.equal(rows.length, 3)
})

test("initial calendar range is small and independent of years of cached history", () => {
  assert.deepEqual(calendarRange(new Date(2026, 9, 7)), {
    start: "2026-09-07",
    end: "2026-12-28",
  })
  assert.deepEqual(calendarRange(new Date(2026, 9, 7), new Date(2019, 3, 2)), {
    start: "2019-04-01",
    end: "2026-12-28",
  })
})

test("calendar can extend to any earlier or later date without losing current weeks", () => {
  const range = { start: "2026-09-07", end: "2026-12-28" }
  assert.deepEqual(extendCalendarRange(range, new Date(2020, 1, 29)), {
    start: "2020-02-24",
    end: "2026-12-28",
  })
  assert.deepEqual(extendCalendarRange(range, new Date(2028, 0, 3)), {
    start: "2026-09-07",
    end: "2028-01-03",
  })
  assert.deepEqual(extendCalendarRange(range, new Date(2026, 9, 7)), range)
})

test("calendar week grouping handles year boundaries and leap days", () => {
  assert.equal(calendarWeekKey(new Date(2026, 0, 1)), "2025-12-29")
  const workouts = [
    { workout_date: "2024-02-29", id: "a" },
    { workout_date: "2024-03-03", id: "b" },
    { workout_date: "2024-03-04", id: "c" },
  ]
  const indexed = indexCalendarWorkouts(workouts)
  assert.deepEqual(indexed.get("2024-02-26"), workouts.slice(0, 2))
  assert.deepEqual(indexed.get("2024-03-04"), workouts.slice(2))
})

test("hydration preserves the visible date when earlier rows grow", () => {
  assert.equal(
    calendarAnchorAdjustment({ top: 84, scrollY: 900 }, 284, 900),
    200
  )
  assert.equal(calendarAnchorAdjustment({ top: 84, scrollY: 900 }, 84, 900), 0)
})

test("hydration compensation preserves user scroll instead of snapping back", () => {
  // 200px layout growth and a 75px user scroll between capture and commit.
  assert.equal(
    calendarAnchorAdjustment({ top: 84, scrollY: 900 }, 209, 975),
    200
  )
  // Scroll alone must never trigger a compensation.
  assert.equal(calendarAnchorAdjustment({ top: 84, scrollY: 900 }, 9, 975), 0)
})

test("week arrows advance from an aligned boundary in either direction", () => {
  const weeks = [
    { key: "2026-10-05", top: -217 },
    { key: "2026-10-12", top: 83 },
    { key: "2026-10-19", top: 483 },
  ]
  assert.equal(adjacentCalendarWeek(weeks, 83, -1), "2026-10-05")
  assert.equal(adjacentCalendarWeek(weeks, 83, 1), "2026-10-19")
})

test("partially scrolled weeks snap to the nearest start on the requested side", () => {
  const weeks = [
    { key: "2026-10-19", top: 333 },
    { key: "2026-10-05", top: -367 },
    { key: "2026-10-12", top: -67 },
    { key: "invalid", top: NaN },
  ]
  assert.equal(adjacentCalendarWeek(weeks, 83, -1), "2026-10-12")
  assert.equal(adjacentCalendarWeek(weeks, 83, 1), "2026-10-19")
})

test("week arrows tolerate fractional layout pixels and request more range at its edge", () => {
  const weeks = [{ key: "2026-10-12", top: 82.6 }]
  assert.equal(adjacentCalendarWeek(weeks, 83, -1), null)
  assert.equal(adjacentCalendarWeek(weeks, 83, 1), null)
  assert.equal(adjacentCalendarWeek([], 83, 1), null)
})
