import test from "node:test"
import assert from "node:assert/strict"
import {
  rememberPendingWorkoutCreation,
  readPendingWorkoutCreation,
} from "../src/lib/pending-workout-creation.ts"
import { simpleWorkoutModel } from "../../app-backend/lib/simple-workout.mjs"

function fixture() {
  const records = new Map(),
    storage = {
      getItem: (key) => records.get(key) ?? null,
      setItem: (key, value) => records.set(key, value),
      removeItem: (key) => records.delete(key),
    }
  const input = {
    model: simpleWorkoutModel({
      name: "Immutable create",
      sport: "Run",
      date: "2026-10-21",
      description: "Human notes",
      values: { duration_seconds: 1200, tss: 20 },
    }),
    values: { duration_seconds: 1200, tss: 20 },
    time: "06:30",
    comment: "Retain original comment",
    descriptionMode: "manual",
    description: "Human notes",
    creationId: "bb85482d-5953-458b-9f48-8a0e7356b17b",
    editorSnapshot: { personal: { notes: "Original private notes" } },
  }
  assert.equal(
    rememberPendingWorkoutCreation(storage, "athlete-A", input),
    true
  )
  return { records, storage, input, bytes: () => [...records.values()][0] }
}

test("same create identity cannot overwrite any attempted native payload field", () => {
  const mutations = [
    (input) => {
      input.model.date = "2026-10-22"
    },
    (input) => {
      input.model.name = "Changed title"
    },
    (input) => {
      input.model.notes = "Changed model notes"
    },
    (input) => {
      input.values.tss = 21
    },
    (input) => {
      input.time = "07:30"
    },
    (input) => {
      input.comment = "Changed comment"
    },
    (input) => {
      input.description = "Changed human description"
    },
    (input) => {
      delete input.descriptionMode
    },
  ]
  for (const mutate of mutations) {
    const f = fixture(),
      original = f.bytes(),
      changed = structuredClone(f.input)
    mutate(changed)
    assert.throws(
      () => rememberPendingWorkoutCreation(f.storage, "athlete-A", changed),
      (error) => error.status === 409 && error.code === "CREATION_PENDING"
    )
    assert.equal(f.bytes(), original)
    assert.deepEqual(
      readPendingWorkoutCreation(f.storage, "athlete-A"),
      f.input
    )
  }
})

test("equivalent key order and reconciliation flag reuse the exact original bytes and recovery snapshot", () => {
  const f = fixture(),
    original = f.bytes()
  const reorder = (value) =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, value]) => [key, reorder(value)])
          )
        : value
  const input = {
    ...reorder(f.input),
    reconcileOnly: true,
    editorSnapshot: { personal: { notes: "Must not replace original" } },
  }
  assert.equal(
    rememberPendingWorkoutCreation(f.storage, "athlete-A", input),
    true
  )
  assert.equal(f.bytes(), original)
})

test("another account keeps its own independent immutable creation", () => {
  const f = fixture(),
    other = { ...structuredClone(f.input), description: "Another account" }
  assert.equal(
    rememberPendingWorkoutCreation(f.storage, "athlete-B", other),
    true
  )
  assert.deepEqual(readPendingWorkoutCreation(f.storage, "athlete-A"), f.input)
  assert.deepEqual(readPendingWorkoutCreation(f.storage, "athlete-B"), other)
})

test("an unchanged durable intent still requires writable recovery before a provider recheck", () => {
  const f = fixture(),
    original = f.bytes()
  f.storage.setItem = () => {
    throw Error("Quota exceeded")
  }
  assert.equal(
    rememberPendingWorkoutCreation(f.storage, "athlete-A", {
      ...f.input,
      reconcileOnly: true,
    }),
    false
  )
  assert.equal(f.bytes(), original)
})
