import { apiFetch } from "./api-client"
import { deviceCacheScope } from "./device-cache"
import { createSharedRequestCache } from "./shared-request-cache"
import type { FoodLibrary, FoodProduct } from "./nutrition"
import { createNutritionCatalogCache } from "./nutrition-catalog-cache"

const reads = createSharedRequestCache<
  FoodLibrary | { products: FoodProduct[] } | { product: FoodProduct }
>(
  async (key, signal) => {
    const [scope, path, retry] = JSON.parse(key) as [string, string, number?]
    let device: ReturnType<typeof createNutritionCatalogCache> | null = null
    try {
      if (typeof localStorage !== "undefined")
        device = createNutritionCatalogCache(localStorage)
    } catch {
      // Optional catalog caching must not prevent search when storage is denied.
    }
    const saved = !retry ? device?.get(scope, path) : null
    if (saved)
      return saved as { products: FoodProduct[] } | { product: FoodProduct }
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw Error(
        "You’re offline. Reconnect to search; recent foods remain available."
      )
    const response = await apiFetch(`/api/nutrition${path}`, { signal }).catch(
      (error) => {
        if (signal.aborted) throw Error("Food search timed out. Please retry.")
        throw error
      }
    )
    let data
    try {
      data = await response.json()
    } catch {
      throw Error("Food search returned an unreadable response. Please retry.")
    }
    if (!response.ok)
      throw Error(data.error || "Food search could not load. Please retry.")
    if (
      path === "/library"
        ? !Number.isFinite(data.revision) || !Array.isArray(data.items)
        : path.startsWith("/product?")
          ? !data.product ||
            typeof data.product.code !== "string" ||
            !Array.isArray(data.product.servings)
          : !Array.isArray(data.products)
    )
      throw Error("Food results are incomplete. Please retry.")
    if (scope !== deviceCacheScope())
      throw new DOMException("Aborted", "AbortError")
    device?.set(scope, path, data, data.product?.catalogExpiresAt)
    return data
  },
  { maxEntries: 20, ttlMs: 30_000, timeoutMs: 15_000 }
)
const key = (path: string) => JSON.stringify([deviceCacheScope(), path])
export const loadFoodLibrary = (signal?: AbortSignal) =>
  reads.get(key("/library"), signal) as Promise<FoodLibrary>
export const searchFoods = (query: string, signal?: AbortSignal, retry = 0) =>
  reads
    .get(
      JSON.stringify([
        deviceCacheScope(),
        `/search?q=${encodeURIComponent(query.trim().replace(/\s+/g, " "))}`,
        retry,
      ]),
      signal
    )
    .catch((error) => {
      if (signal?.aborted) throw error
      if (
        error instanceof Error &&
        error.message.includes("recording took too long")
      )
        throw Error("Food search timed out. Please retry.")
      throw error
    }) as Promise<{ products: FoodProduct[] }>
export const loadFoodProduct = (id: string, signal?: AbortSignal, retry = 0) =>
  reads.get(
    JSON.stringify([
      deviceCacheScope(),
      `/product?id=${encodeURIComponent(id)}`,
      retry,
    ]),
    signal
  ) as Promise<{ product: FoodProduct }>
export const forgetFoodProduct = (id: string) => {
  reads.clear()
  try {
    createNutritionCatalogCache(localStorage).delete(
      deviceCacheScope(),
      `/product?id=${encodeURIComponent(id)}`
    )
  } catch {
    /* Optional cache. */
  }
}
export const clearFoodReads = () => reads.clear()
if (typeof window !== "undefined")
  for (const event of [
    "app-auth-required",
    "training-cache-reset",
    "device-cache-cleared",
    "food-library-updated",
  ])
    window.addEventListener(event, () => {
      clearFoodReads()
      try {
        const device = createNutritionCatalogCache(localStorage)
        if (event === "food-library-updated")
          device.delete(deviceCacheScope(), "/library")
        else device.clear()
      } catch {
        /* Storage optional. */
      }
    })
