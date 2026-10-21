import test from "node:test"
import assert from "node:assert/strict"
import {
  foodSuggestions,
  mergeFoodHistory,
} from "../src/lib/nutrition-recents.ts"

const now = Date.UTC(2026, 9, 21, 12)
const entry = (id, patch = {}) => ({
  id,
  source: "manual",
  name: "Oats",
  unit: "cup",
  quantity: 1,
  meal: "breakfast",
  ...patch,
})
test("actual diary entries seed recent/frequent foods without counting reloads as new uses", () => {
  let rows = mergeFoodHistory(
    [],
    [
      entry("one"),
      entry("two"),
      entry("three", { name: "Rice", meal: "lunch" }),
    ],
    now,
    now
  )
  rows = mergeFoodHistory(
    rows,
    [entry("one"), entry("two")],
    now + 100,
    now + 100
  )
  assert.equal(rows.length, 3)
  const frequent = foodSuggestions(rows, "lunch", true, now)
  assert.equal(frequent.length, 1)
  assert.equal(frequent[0].name, "Oats")
  assert.equal(frequent[0].entries[0].meal, "lunch")
  const recent = foodSuggestions(rows, "lunch", false, now)
  assert.equal(recent[0].name, "Rice")
  assert.equal(recent[1].name, "Oats")
})
test("suggestions preserve distinct products, servings and quantities with deterministic ties", () => {
  const rows = mergeFoodHistory(
    [],
    [
      entry("a", { foodId: "123", servingId: "1", source: "fatsecret" }),
      entry("b", { foodId: "124", servingId: "1", source: "fatsecret" }),
      entry("c", { foodId: "123", servingId: "2", source: "fatsecret" }),
      entry("d", { quantity: 0.5 }),
    ],
    now,
    now
  )
  assert.equal(foodSuggestions(rows, "breakfast", false, now).length, 4)
  assert.deepEqual(
    foodSuggestions(rows, "breakfast", false, now),
    foodSuggestions([...rows].reverse(), "breakfast", false, now)
  )
})
test("expired provider user-data snapshots are omitted while manual food history survives", () => {
  const rows = mergeFoodHistory(
    [],
    [
      entry("a", { source: "fatsecret", foodId: "123", servingId: "1" }),
      entry("b"),
    ],
    now - 25 * 60 * 60_000,
    now,
    now - 25 * 60 * 60_000
  )
  assert.deepEqual(
    foodSuggestions(rows, "breakfast", false, now).map(
      (item) => item.entries[0].id
    ),
    ["b"]
  )
})
test("freshly retrieved historical diary foods use retrieval time for provider expiry", () => {
  const rows = mergeFoodHistory(
    [],
    [entry("a", { source: "fatsecret", foodId: "123", servingId: "1" })],
    now - 30 * 24 * 60 * 60_000,
    now,
    now
  )
  assert.equal(foodSuggestions(rows, "breakfast", false, now).length, 1)
  assert.equal(
    foodSuggestions(rows, "breakfast", false, now + 25 * 60 * 60_000).length,
    0
  )
})
