import {
  createNutritionAddOutbox,
  queuedFoodAdds,
} from "./nutrition-add-outbox"
import { deviceCacheScope } from "./device-cache"
import { apiSessionRevision } from "./api-client"
import {
  cachedNutrition,
  prefetchNutrition,
  commitNutritionView,
  foodFromProduct,
  nutritionRequest,
  recordRecentFoods,
  validatedNutritionView,
  type FoodEntry,
  type NutritionView,
} from "./nutrition"
import { projectNutritionChange } from "./nutrition-optimistic"
import { loadFoodProduct, forgetFoodProduct } from "./nutrition-read-cache"
import { scaleFood } from "./nutrition-math"
import type { NutritionWriteResult } from "./pending-nutrition-write"
import { randomId } from "./random-id"
import { preferredFoodServing } from "./food-serving-choice"

const engines = new Map<string, ReturnType<typeof createNutritionAddOutbox>>(),
  deliveries = new Map<string, Promise<void>>()
const owner = randomId()
export type NutritionAddStatus = {
  pending: number
  failed: number
  error?: string
}
function changed(state: NutritionAddStatus) {
  window.dispatchEvent(
    new CustomEvent("nutrition-add-status", { detail: state })
  )
}
function engine(scope: string) {
  let value = engines.get(scope)
  if (value) return value
  value = createNutritionAddOutbox({
    storage: localStorage,
    scope,
    current: () =>
      scope === deviceCacheScope() && apiSessionRevision() !== null,
    readView: async (date, fresh) => {
      const cached = !fresh && cachedNutrition(date)
      return (
        cached ||
        (!fresh
          ? prefetchNutrition(date)
          : validatedNutritionView(
              await nutritionRequest<NutritionView>(`?date=${date}`),
              date
            ))
      )
    },
    resolveEntries: (entries) =>
      Promise.all(
        entries.map(async (entry) => {
          if (
            entry.source !== "fatsecret" ||
            (entry.servingId &&
              entry.catalogReceipt &&
              entry.catalogExpiresAt! > Date.now() + 2000)
          )
            return entry
          if (!entry.foodId)
            throw Object.assign(
              Error("Choose this food again before adding it."),
              { status: 422 }
            )
          const { product } = await loadFoodProduct(entry.foodId)
          const servingId = entry.servingId || preferredFoodServing(product).servingId
          if (
            !product.complete ||
            !servingId ||
            !product.servings?.some((serving) => serving.id === servingId)
          )
            throw Object.assign(
              Error("This serving is unavailable. Choose the food again."),
              { status: 422 }
            )
          return {
            ...scaleFood(
              foodFromProduct({ ...product, servingId }, entry.meal),
              entry.quantity
            ),
            id: entry.id,
            meal: entry.meal,
            notes: entry.notes,
          }
        })
      ),
    send: async (input) => {
      if (!navigator.locks) {
        const lease = JSON.parse(
          localStorage.getItem(`nutrition-add-lease:${scope}`) || "null"
        )
        if (lease?.owner !== owner)
          throw Error("The other app window is finishing your food saves.")
      }
      const result = await nutritionRequest<NutritionWriteResult>(
        "/entries",
        input
      )
      return result
    },
    project: (view, entries) => projectNutritionChange(view, "add", entries),
    publish: (view, pending) => commitNutritionView(view, !pending, pending),
    confirmed: (input, result) => {
      recordRecentFoods(result.changedEntries || input.entries || [])
      window.dispatchEvent(new CustomEvent("nutrition-add-confirmed", { detail: { operationId: input.operationId } }))
    },
    changed,
  })
  engines.set(scope, value)
  return value
}
export function enqueueNutritionAdd(
  view: NutritionView | string,
  entries: FoodEntry[],
  operationId: string
) {
  const scope = deviceCacheScope()
  engine(scope).enqueue(view, entries, operationId)
  // Retain the one-food detail read across editor teardown and Home navigation.
  // The delivery worker joins this shared request instead of starting it again.
  if (
    entries.length === 1 &&
    entries[0].source === "fatsecret" &&
    entries[0].foodId &&
    !entries[0].catalogReceipt
  )
    void loadFoodProduct(entries[0].foodId).catch(() => {})
  queueMicrotask(() => {
    void drainNutritionAdds().catch(() => {})
  })
}
export function drainNutritionAdds(retry = false) {
  const scope = deviceCacheScope(),
    active = deliveries.get(scope)
  if (active) return active
  const work = async () => {
    const queue = engine(scope)
    if (retry)
      for (const row of queue.rows())
        if (row.failed)
          for (const entry of row.entries)
            if (entry.foodId) forgetFoodProduct(entry.foodId)
    await (retry ? queue.retry() : queue.drain())
  }
  const request = (async () => {
    if (scope === "initial" || apiSessionRevision() === null) return
    if (navigator.onLine === false) {
      changed({
        ...nutritionAddStatus(),
        error: "Offline — your foods are retained on this device.",
      })
      return
    }
    if (navigator.locks) {
      await navigator.locks.request(
        `nutrition-add-delivery:${scope}`,
        { ifAvailable: true },
        async (lock) => {
          if (lock) await work()
        }
      )
      return
    }
    const key = `nutrition-add-lease:${scope}`,
      previous = JSON.parse(localStorage.getItem(key) || "null")
    if (previous?.owner !== owner && previous?.expires > Date.now()) return
    const renew = () =>
      localStorage.setItem(
        key,
        JSON.stringify({ owner, expires: Date.now() + 30000 })
      )
    renew()
    if (JSON.parse(localStorage.getItem(key) || "null")?.owner !== owner) return
    const timer = setInterval(renew, 10000)
    try {
      await work()
    } finally {
      clearInterval(timer)
      if (JSON.parse(localStorage.getItem(key) || "null")?.owner === owner)
        localStorage.removeItem(key)
    }
  })().finally(() => {
    if (deliveries.get(scope) === request) deliveries.delete(scope)
  })
  deliveries.set(scope, request)
  return request
}
export function nutritionAddStatus(): NutritionAddStatus {
  const scope = deviceCacheScope()
  if (scope === "initial") return { pending: 0, failed: 0 }
  const rows = queuedFoodAdds(localStorage, scope)
  return {
    pending: rows.filter((row) => !row.failed).length,
    failed: rows.filter((row) => row.failed).length,
  }
}
