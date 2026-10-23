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
const values = new Map()
globalThis.localStorage = {
  get length() {
    return values.size
  },
  key: (i) => [...values.keys()][i] ?? null,
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
}
globalThis.window = new EventTarget()
const { setApiAuthenticated } = await import("../src/lib/api-client.ts")
const nutrition = await import("../src/lib/nutrition.ts")
const { projectNutritionChange } =
  await import("../src/lib/nutrition-optimistic.ts")
const { loadFoodProduct, searchFoods } =
  await import("../src/lib/nutrition-read-cache.ts")
const food = (i) => ({
  id: `test-food-${i}`,
  name: `Food ${i}`,
  meal: "lunch",
  quantity: 1,
  unit: "serving",
  source: "fatsecret",
  foodId: String(i),
  servingId: "1",
  catalogReceipt: `signed-${i}`,
  calories: 100,
  protein: 10,
  carbs: 10,
  fat: 2,
  fiber: null,
  notes: "",
  barcode: null,
  imageUrl: null,
})
const targets = {
  calories: 2000,
  protein: 100,
  carbs: 200,
  fat: 60,
  fiber: null,
}
const initial = {
  date: "2026-10-22",
  day: { revision: 1, entries: Array.from({ length: 6 }, (_, i) => food(i)) },
  targets,
  targetsRevision: 0,
  week: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-10-${16 + i}`,
    logged: true,
    totals: { calories: 600, protein: 60, carbs: 60, fat: 12, fiber: 0 },
    targets,
  })),
  recentDays: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-10-${16 + i}`,
    entries: Array.from({ length: 6 }, (_, j) => food(i * 6 + j)),
  })),
  aiAvailable: false,
  localPreview: false,
}
test("six-food meal publishes confirmed days without any diary GET after each add, including reload cache reuse", async () => {
  values.clear()
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true)
  localStorage.setItem(
    "training-agent-startup-v2",
    JSON.stringify({ cache_scope: "meal-account" })
  )
  let reads = 0
  globalThis.fetch = async () => {
    reads++
    return Response.json(initial)
  }
  let view = await nutrition.prefetchNutrition(initial.date)
  for (let index = 50; index < 56; index++) {
    nutrition.beginNutritionWrite()
    const projected = projectNutritionChange(view, "add", [food(index)])
    view = nutrition.commitNutritionView({
      ...projected,
      day: { ...projected.day, revision: view.day.revision + 1 },
    })
    assert.equal(
      (await nutrition.prefetchNutrition(initial.date)).day.revision,
      index - 48
    )
  }
  assert.equal(reads, 1)
  assert.equal(nutrition.cachedNutrition(initial.date).day.entries.length, 12)
  const snapshot = JSON.parse(
    localStorage.getItem("nutrition-view-v2:meal-account:2026-10-22")
  )
  assert.equal(snapshot.view.day.entries.length, 12)
  assert.equal(snapshot.view.day.revision, 7)
  assert.ok(snapshot.view.catalogReadAt <= snapshot.time)
})
test("product details and repeated searches reuse device content; explicit retry forces a fresh request", async () => {
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true)
  localStorage.setItem(
    "training-agent-startup-v2",
    JSON.stringify({ cache_scope: "product-account" })
  )
  let calls = 0
  globalThis.fetch = async (url) => {
    calls++
    return Response.json(
      decodeURIComponent(String(url)).includes("/product")
        ? {
            product: {
              code: "42",
              servings: [{ id: "1", catalogReceipt: "signed" }],
              catalogExpiresAt: Date.now() + 3600000,
            },
          }
        : { products: [] }
    )
  }
  await loadFoodProduct("42")
  await loadFoodProduct("42")
  await searchFoods("rice")
  await searchFoods("rice")
  assert.equal(calls, 2)
  await loadFoodProduct("42", undefined, 1)
  assert.equal(calls, 3)
  await loadFoodProduct("42", undefined, 2)
  assert.equal(calls, 4)
})

test("denied optional browser storage does not prevent a catalog search", async () => {
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true)
  const storage = globalThis.localStorage
  let requests = 0
  globalThis.fetch = async () => {
    requests++
    return Response.json({ products: [] })
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("Storage unavailable", "SecurityError")
    },
  })
  try {
    assert.deepEqual(await searchFoods("storage denied"), { products: [] })
    assert.equal(requests, 1)
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: storage,
    })
  }
})
test("lost-response receipt reconciles signed facts without a full diary read and cannot duplicate or overwrite a newer day", async () => {
  values.clear()
  window.dispatchEvent(new Event("training-cache-reset"))
  setApiAuthenticated(true)
  localStorage.setItem(
    "training-agent-startup-v2",
    JSON.stringify({ cache_scope: "recovery-account" })
  )
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json(initial)
  }
  await nutrition.prefetchNutrition(initial.date)
  const entry = { ...food(99), catalogExpiresAt: Date.now() + 3600000 }
  const input = {
    date: initial.date,
    action: "add",
    entries: [entry],
    operationId: "recovered-food-operation",
    revision: 1,
  }
  const receipt = {
    day: null,
    committed: true,
    revision: 2,
    changedEntries: null,
  }
  assert.equal(nutrition.reconcileNutritionWrite(input, receipt), true)
  assert.equal(nutrition.reconcileNutritionWrite(input, receipt), true)
  const view = await nutrition.prefetchNutrition(initial.date)
  assert.equal(calls, 1)
  assert.equal(view.day.revision, 2)
  assert.equal(view.day.entries.filter((row) => row.id === entry.id).length, 1)
  assert.equal(
    nutrition.reconcileNutritionWrite(
      { ...input, revision: 0 },
      { ...receipt, revision: 4 }
    ),
    false
  )
  assert.equal(nutrition.cachedNutrition(initial.date).day.revision, 2)
  const unsigned = {
    ...entry,
    id: "unsigned-food-99",
    catalogReceipt: undefined,
  }
  assert.equal(
    nutrition.reconcileNutritionWrite(
      { ...input, revision: 2, entries: [unsigned] },
      { ...receipt, revision: 3 }
    ),
    false
  )
})
test("confirmed edits retain original catalog retrieval age rather than extending provider content indefinitely", () => {
  const time = Date.now() - 3600000
  let view = nutrition.commitNutritionView({
    ...initial,
    date: "2026-10-21",
    catalogReadAt: time,
  })
  view = nutrition.commitNutritionView({
    ...view,
    day: { ...view.day, revision: 2 },
  })
  const snapshot = JSON.parse(
    localStorage.getItem("nutrition-view-v2:recovery-account:2026-10-21")
  )
  assert.equal(view.catalogReadAt, time)
  assert.equal(snapshot.time, time)
})
test("adding an older still-valid cached product does not extend its remaining provider-content lifetime", () => {
  const expiry = Date.now() + 3600000
  const entry = { ...food(101), catalogExpiresAt: expiry }
  const view = nutrition.commitNutritionView({
    ...initial,
    date: "2026-10-20",
    day: { revision: 1, entries: [entry] },
  })
  const snapshot = JSON.parse(
    localStorage.getItem("nutrition-view-v2:recovery-account:2026-10-20")
  )
  assert.equal(view.catalogReadAt + 23 * 3600000, expiry)
  assert.equal(snapshot.time + 23 * 3600000, expiry)
})
