import test from "node:test"
import assert from "node:assert/strict"
import {
  editorStartTime,
  withStrengthTimeAssignment,
} from "../src/lib/strength-start-time.ts"

const strength = (assigned) => ({
  name: "Time semantics",
  strength: {
    version: 1,
    blocks: [],
    ...(assigned === undefined ? {} : { startTimeAssigned: assigned }),
  },
})

test("explicit midnight, unset, cleared and legacy native times have distinct presentation", () => {
  assert.equal(editorStartTime(strength(), "00:00:00"), "")
  assert.equal(editorStartTime(strength(false), "00:00:00"), "")
  assert.equal(editorStartTime(strength(true), "00:00:00"), "00:00")
  assert.equal(editorStartTime(strength(), "07:15:00"), "07:15")
  assert.equal(
    editorStartTime(strength(false), "07:15:00"),
    "07:15",
    "A native nonzero time remains visible"
  )
  assert.equal(editorStartTime(strength(true), ""), "")
  assert.equal(editorStartTime({ name: "Ordinary ride" }, "00:00:00"), "00:00")
})

test("prescription history cannot undo a separately edited time assignment or mutate its snapshots", () => {
  const original = strength(),
    explicit = withStrengthTimeAssignment(original, true)
  assert.equal(original.strength.startTimeAssigned, undefined)
  assert.equal(explicit.strength.startTimeAssigned, true)
  const cleared = withStrengthTimeAssignment(explicit, false)
  assert.equal(cleared.strength.startTimeAssigned, false)
  assert.equal(explicit.strength.startTimeAssigned, true)
  assert.equal(
    withStrengthTimeAssignment(original, false).strength.startTimeAssigned,
    false
  )
  assert.equal(
    withStrengthTimeAssignment(explicit, undefined).strength.startTimeAssigned,
    undefined
  )
  assert.equal(
    Object.hasOwn(
      withStrengthTimeAssignment(explicit, undefined).strength,
      "startTimeAssigned"
    ),
    false
  )
  assert.equal(withStrengthTimeAssignment(explicit, true), explicit)
})
