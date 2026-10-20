import { apiFetch } from "./api-client"
import { deviceCacheScope } from "./device-cache"
import { createSharedRequestCache } from "./shared-request-cache"
import type { FoodLibrary, FoodProduct } from "./nutrition"

const reads = createSharedRequestCache<FoodLibrary | { products: FoodProduct[] }>(async (key, signal) => {
  const [, path] = JSON.parse(key) as string[]
  const response = await apiFetch(`/api/nutrition${path}`, { signal })
  const data = await response.json()
  if (!response.ok) throw Error(data.error || "Food search could not load. Please retry.")
  if (path === "/library" ? !Number.isFinite(data.revision) || !Array.isArray(data.items) : !Array.isArray(data.products)) throw Error("Food results are incomplete. Please retry.")
  return data
}, { maxEntries: 20, ttlMs: 30_000, timeoutMs: 22_000 })
const key = (path: string) => JSON.stringify([deviceCacheScope(), path])
export const loadFoodLibrary = (signal?: AbortSignal) => reads.get(key("/library"), signal) as Promise<FoodLibrary>
export const searchFoods = (query: string, signal?: AbortSignal, retry = 0) => reads.get(JSON.stringify([deviceCacheScope(), `/search?q=${encodeURIComponent(query.trim())}`, retry]), signal) as Promise<{ products: FoodProduct[] }>
export const clearFoodReads = () => reads.clear()
if (typeof window !== "undefined") for (const event of ["app-auth-required", "training-cache-reset", "device-cache-cleared", "food-library-updated"]) window.addEventListener(event, clearFoodReads)
