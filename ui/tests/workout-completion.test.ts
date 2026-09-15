import { test } from "node:test"
import assert from "node:assert/strict"
import { gradeWorkoutCompletion as grade } from "../src/lib/workout-completion.ts"

test("time and power thresholds include their boundaries", () => {
  assert.equal(grade("completed", { duration_minutes: 60, power_watts: 200 }, { duration_minutes: 66, power_watts: 210 }), "good")
  assert.equal(grade("completed", { duration_minutes: 60, power_watts: 200 }, { duration_minutes: 75, power_watts: 230 }), "medium")
})
test("the worst available goal determines the grade, including overshooting", () => {
  assert.equal(grade("completed", { duration_minutes: 60, power_watts: 200 }, { duration_minutes: 60, power_watts: 240 }), "failed")
  assert.equal(grade("completed", { duration_minutes: 60 }, { duration_minutes: 40 }), "failed")
})
test("pace goals distinguish green, orange, and red", () => {
  for (const [pace, expected] of [[300, "good"], [330, "medium"], [360, "failed"]] as const) {
    assert.equal(grade("completed", { pace_seconds_per_unit: 300 }, { pace_seconds_per_unit: pace }), expected)
  }
})
test("a completion flag without comparable data cannot pass", () => {
  assert.equal(grade("completed", {}, { duration_minutes: 60 }), "unknown")
  assert.equal(grade("completed", { power_watts: 200 }, {}), "unknown")
  assert.equal(grade("upcoming", { duration_minutes: 60 }, {}), "planned")
})
