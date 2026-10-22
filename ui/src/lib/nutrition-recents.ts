import type { FoodEntry, Meal, SavedFood } from "./nutrition"

export type RecentFood = {
  entry: FoodEntry
  loggedAt: number
  cachedAt?: number
}
export const foodSuggestionKey = (entry: FoodEntry) =>
  JSON.stringify([
    entry.source,
    entry.foodId || entry.barcode || entry.name.trim().toLowerCase(),
    entry.servingId || entry.unit,
    entry.quantity,
  ])

export function mergeFoodHistory(
  rows: RecentFood[],
  entries: FoodEntry[],
  loggedAt: number,
  now = Date.now(),
  cachedAt = now
) {
  const items = new Map(
    rows.filter((row) => row?.entry?.id).map((row) => [row.entry.id, row])
  )
  for (const entry of entries) {
    const previous = items.get(entry.id)
    if (!previous || cachedAt > (previous.cachedAt ?? previous.loggedAt))
      items.set(entry.id, {
        entry,
        loggedAt: previous?.loggedAt ?? loggedAt,
        cachedAt,
      })
  }
  return [...items.values()]
    .filter(
      (row) =>
        Number.isFinite(row.loggedAt) &&
        now - row.loggedAt <= 90 * 24 * 60 * 60_000 &&
        (row.entry.source !== "fatsecret" ||
          (now - (row.cachedAt ?? row.loggedAt) <= 24 * 60 * 60_000 &&
            (!row.entry.catalogExpiresAt || row.entry.catalogExpiresAt > now)))
    )
    .sort(
      (a, b) => b.loggedAt - a.loggedAt || a.entry.id.localeCompare(b.entry.id)
    )
    .slice(0, 600)
}

export function foodSuggestions(
  rows: RecentFood[],
  meal: Meal,
  frequent = false,
  now = Date.now()
): SavedFood[] {
  const groups = new Map<
    string,
    { entry: FoodEntry; count: number; latest: number; sameMeal: boolean }
  >()
  for (const row of rows) {
    // FatSecret permits device user-data caching for at most 24h. Keep our
    // own manual foods for 90 days; provider references remain in the diary.
    if (
      !row?.entry?.name ||
      !Number.isFinite(row.loggedAt) ||
      now - row.loggedAt > 90 * 24 * 60 * 60_000 ||
      (row.entry.source === "fatsecret" &&
        (now - (row.cachedAt ?? row.loggedAt) > 24 * 60 * 60_000 ||
          Boolean(
            row.entry.catalogExpiresAt && row.entry.catalogExpiresAt <= now
          )))
    )
      continue
    const key = foodSuggestionKey(row.entry)
    const old = groups.get(key)
    if (!old)
      groups.set(key, {
        entry: row.entry,
        count: 1,
        latest: row.loggedAt,
        sameMeal: row.entry.meal === meal,
      })
    else {
      old.count++
      old.sameMeal ||= row.entry.meal === meal
      if (row.loggedAt > old.latest) {
        old.entry = row.entry
        old.latest = row.loggedAt
      }
    }
  }
  return [...groups.entries()]
    .filter(([, item]) => !frequent || item.count >= 2)
    .sort(
      ([a, x], [b, y]) =>
        (frequent ? y.count - x.count : 0) ||
        Number(y.sameMeal) - Number(x.sameMeal) ||
        y.latest - x.latest ||
        a.localeCompare(b)
    )
    .slice(0, frequent ? 6 : 12)
    .map(([key, { entry }]) => ({
      id: `recent-${key}`,
      name: entry.name,
      entries: [{ ...entry, meal }],
      favorite: false,
      custom: false,
    }))
}
