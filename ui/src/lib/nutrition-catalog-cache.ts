type CatalogStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>
const PREFIX = "nutrition-catalog-v1:"
// Keep a margin inside FatSecret's 24-hour removal/re-request requirement and
// the 23-hour signed serving receipt. Reading never extends retrieval age.
export const CATALOG_CACHE_TTL = 22 * 60 * 60_000
export function createNutritionCatalogCache(
  storage: CatalogStorage,
  now = Date.now
) {
  const name = (scope: string, path: string) =>
    `${PREFIX}${JSON.stringify([scope, "US", "en", path])}`
  const removeExpired = () => {
    const retained: { name: string; savedAt: number }[] = []
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index)
      if (!key?.startsWith(PREFIX)) continue
      try {
        const row = JSON.parse(storage.getItem(key) || "null")
        if (
          !Number.isFinite(row?.expiresAt) ||
          row.expiresAt <= now() ||
          row.savedAt > now() + 60_000
        )
          storage.removeItem(key)
        else retained.push({ name: key, savedAt: row.savedAt })
      } catch {
        storage.removeItem(key)
      }
    }
    retained
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(80)
      .forEach((row) => storage.removeItem(row.name))
  }
  return {
    get<T>(scope: string, path: string): T | null {
      if (!scope || scope === "initial") return null
      try {
        removeExpired()
        const key = name(scope, path),
          row = JSON.parse(storage.getItem(key) || "null")
        if (
          !row ||
          !Number.isFinite(row.savedAt) ||
          row.savedAt > now() + 60_000 ||
          row.expiresAt <= now() ||
          now() - row.savedAt >= CATALOG_CACHE_TTL
        ) {
          if (row) storage.removeItem(key)
          return null
        }
        return row.value as T
      } catch {
        return null
      }
    },
    set(scope: string, path: string, value: unknown, expiresAt = Infinity) {
      if (!scope || scope === "initial") return
      try {
        const savedAt = now(),
          expiry = Math.min(savedAt + CATALOG_CACHE_TTL, expiresAt)
        if (expiry <= savedAt) return
        storage.setItem(
          name(scope, path),
          JSON.stringify({ savedAt, expiresAt: expiry, value })
        )
        removeExpired()
      } catch {
        /* Device caching is optional, never persistence acknowledgement. */
      }
    },
    delete(scope: string, path: string) {
      try {
        storage.removeItem(name(scope, path))
      } catch {
        /* Optional cache. */
      }
    },
    clear() {
      try {
        for (let i = storage.length - 1; i >= 0; i--) {
          const key = storage.key(i)
          if (key?.startsWith(PREFIX)) storage.removeItem(key)
        }
      } catch {
        /* Optional cleanup. */
      }
    },
  }
}
