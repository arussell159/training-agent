import test from "node:test"
import assert from "node:assert/strict"
import { calendarAddTypes, notesFirst } from "../src/lib/calendar-events.ts"
import { canEditWorkout } from "../src/lib/workout-permissions.ts"

test("edit controls require a provider event and preserve recorded activity protections", () => {
  assert.equal(canEditWorkout({ id: "event:123", status: "upcoming" }), true)
  for (const id of ["event:0", "event:-1", "event:preview-2026", "event:", "activity:123"]) {
    assert.equal(canEditWorkout({ id, status: "upcoming" }), false)
  }
  assert.equal(canEditWorkout({ id: "event:123", status: "completed", activity_id: "i456" }), false)
  assert.equal(canEditWorkout({ id: "event:123", status: "upcoming", activity_id: "i456" }), false)
})

test("desktop add choices map exactly to supported provider types", () => {
  assert.deepEqual(
    calendarAddTypes.map((type) => type.label),
    ["Swim", "Bike", "Run", "Sauna", "Strength", "Note"]
  )
  assert.equal(
    calendarAddTypes.find((type) => type.label === "Sauna").sport,
    "Other"
  )
  assert.equal(
    calendarAddTypes.find((type) => type.label === "Strength").sport,
    "WeightTraining"
  )
})
test("notes always precede the day's events while retaining workout and note order", () => {
  const events = [
    { id: 1, category: "WORKOUT" },
    { id: 2, category: "NOTE" },
    { id: 3, category: "RACE_A" },
    { id: 4, category: "NOTE" },
  ]
  assert.deepEqual(
    notesFirst(events).map((event) => event.id),
    [2, 4, 1, 3]
  )
  assert.equal(events[0].id, 1)
})
