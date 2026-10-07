import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calendarAnchorAdjustment,
  calendarRange,
  calendarWeekKey,
  extendCalendarRange,
  indexCalendarWorkouts,
} from '../src/lib/calendar-viewport.ts'

test('initial calendar range is small and independent of years of cached history', () => {
  assert.deepEqual(calendarRange(new Date(2026, 9, 7)), { start: '2026-09-07', end: '2026-12-28' })
  assert.deepEqual(calendarRange(new Date(2026, 9, 7), new Date(2019, 3, 2)), { start: '2019-04-01', end: '2026-12-28' })
})

test('calendar can extend to any earlier or later date without losing current weeks', () => {
  const range = { start: '2026-09-07', end: '2026-12-28' }
  assert.deepEqual(extendCalendarRange(range, new Date(2020, 1, 29)), { start: '2020-02-24', end: '2026-12-28' })
  assert.deepEqual(extendCalendarRange(range, new Date(2028, 0, 3)), { start: '2026-09-07', end: '2028-01-03' })
  assert.deepEqual(extendCalendarRange(range, new Date(2026, 9, 7)), range)
})

test('calendar week grouping handles year boundaries and leap days', () => {
  assert.equal(calendarWeekKey(new Date(2026, 0, 1)), '2025-12-29')
  const workouts = [{ workout_date: '2024-02-29', id: 'a' }, { workout_date: '2024-03-03', id: 'b' }, { workout_date: '2024-03-04', id: 'c' }]
  const indexed = indexCalendarWorkouts(workouts)
  assert.deepEqual(indexed.get('2024-02-26'), workouts.slice(0, 2))
  assert.deepEqual(indexed.get('2024-03-04'), workouts.slice(2))
})

test('hydration preserves the visible date when earlier rows grow', () => {
  assert.equal(calendarAnchorAdjustment({ top: 84, scrollY: 900 }, 284, 900), 200)
  assert.equal(calendarAnchorAdjustment({ top: 84, scrollY: 900 }, 84, 900), 0)
})

test('hydration compensation preserves user scroll instead of snapping back', () => {
  // 200px layout growth and a 75px user scroll between capture and commit.
  assert.equal(calendarAnchorAdjustment({ top: 84, scrollY: 900 }, 209, 975), 200)
  // Scroll alone must never trigger a compensation.
  assert.equal(calendarAnchorAdjustment({ top: 84, scrollY: 900 }, 9, 975), 0)
})
