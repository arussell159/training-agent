import { test } from "node:test"
import assert from "node:assert/strict"
import {
  gradeWorkoutCompletion as grade,
  workoutCompletionGrade,
} from "../src/lib/workout-completion.ts"

// Official Workout Card Overview, checked2026-10-20. The inspected athlete's
// priority is Duration, TSS, Distance. Prior unregistered tests assumed sensor
// targets and unrelated thresholds; their failures/original file are preserved.
test("compliance includes the documented twenty/fifty percent boundaries", () => {
  for (const actual of [48, 60, 72])
    assert.equal(
      grade(
        "completed",
        { duration_minutes: 60 },
        { duration_minutes: actual }
      ),
      "good"
    )
  for (const actual of [30, 40, 47.99, 72.01, 90])
    assert.equal(
      grade(
        "completed",
        { duration_minutes: 60 },
        { duration_minutes: actual }
      ),
      "medium"
    )
  for (const actual of [0, 29.99, 90.01])
    assert.equal(
      grade(
        "completed",
        { duration_minutes: 60 },
        { duration_minutes: actual }
      ),
      "failed"
    )
})
test("the first available priority pair wins, with TSS and distance fallback", () => {
  assert.equal(
    grade(
      "completed",
      { duration_minutes: 60, tss: 100 },
      { duration_minutes: 60, tss: 200 }
    ),
    "good"
  )
  assert.equal(
    grade("completed", { duration_minutes: 60, tss: 100 }, { tss: 150 }),
    "medium"
  )
  assert.equal(
    grade(
      "completed",
      { tss: 100, distance_meters: 1000 },
      { tss: 100, distance_meters: 100 }
    ),
    "good"
  )
  assert.equal(
    grade("completed", { distance_meters: 1000 }, { distance_meters: 1200 }),
    "good"
  )
  assert.equal(
    grade("completed", { distance_meters: 1000 }, { distance_meters: 1600 }),
    "failed"
  )
})
test("missing, invalid and unplanned values cannot masquerade as comparable targets", () => {
  assert.equal(
    grade("completed", { duration_minutes: null, tss: 0 }, {}),
    "unknown"
  )
  assert.equal(
    grade("completed", { duration_minutes: 60 }, { duration_minutes: NaN }),
    "unknown"
  )
  assert.equal(
    grade("completed", { duration_minutes: 60 }, { duration_minutes: -1 }),
    "unknown"
  )
  assert.equal(grade("upcoming", { duration_minutes: 60 }, {}), "planned")
})
test("authoritative summaries suppress stale legacy values and keep unplanned recordings grey", () => {
  const stale = {
    status: "completed",
    plannedDurationMinutes: 60,
    actualDurationMinutes: 60,
    planned: { duration_minutes: 60, tss: 100 },
    completed_data: { duration_minutes: 60, tss: 100 },
  }
  assert.equal(
    workoutCompletionGrade({
      ...stale,
      workout_summary: { planned: null, completed: { duration_seconds: 3600 } },
    }),
    "unknown"
  )
  assert.equal(
    workoutCompletionGrade({
      ...stale,
      workout_summary: {
        planned: { duration_seconds: 3600 },
        completed: { duration_seconds: 900 },
      },
    }),
    "failed"
  )
  assert.equal(
    workoutCompletionGrade({
      ...stale,
      workout_summary: {
        planned: { duration_seconds: null, tss: 100 },
        completed: { duration_seconds: null, tss: 125 },
      },
    }),
    "medium"
  )
  assert.equal(
    workoutCompletionGrade({
      ...stale,
      workout_summary: {
        planned: { distance_meters: 2000 },
        completed: { distance_meters: 2000 },
      },
    }),
    "good"
  )
  assert.equal(workoutCompletionGrade(stale), "good")
})
