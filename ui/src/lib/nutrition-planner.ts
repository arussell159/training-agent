import type { FoodEntry, Meal } from "./nutrition"

function validateEntry(entry: FoodEntry): FoodEntry {
  if (
    !entry ||
    !/^[a-zA-Z0-9_-]{8,80}$/.test(entry.id) ||
    typeof entry.name !== "string" ||
    !entry.name.trim() ||
    entry.name.length > 180 ||
    !["breakfast", "lunch", "dinner", "snacks"].includes(entry.meal) ||
    !["manual", "ai", "openfoodfacts", "fatsecret"].includes(entry.source) ||
    typeof entry.unit !== "string" ||
    entry.unit.length > 40 ||
    !Number.isFinite(entry.quantity) ||
    entry.quantity <= 0 ||
    entry.quantity > 100000 ||
    ["calories", "protein", "fat", "carbs"].some(
      (key) =>
        !Number.isFinite(entry[key as "calories"]) ||
        entry[key as "calories"] < 0
    ) ||
    (entry.fiber !== null && (!Number.isFinite(entry.fiber) || entry.fiber < 0))
  )
    throw Error("Reload this food before copying its serving.")
  return JSON.parse(JSON.stringify(entry)) as FoodEntry
}

export type NutritionClipboard = {
  version: 1
  scope: string
  date: string
  name: string
  entries: FoodEntry[]
  expires: number
}
const copied = new Map<string, NutritionClipboard>()
export function readNutritionClipboard(
  scope: string,
  now = Date.now()
): NutritionClipboard | null {
  const value = copied.get(scope)
  if (!value) return null
  if (value.expires <= now) {
    copied.delete(scope)
    return null
  }
  return { ...value, entries: value.entries.map(validateEntry) }
}
export function copyNutritionFoods(
  scope: string,
  date: string,
  entries: FoodEntry[],
  name: string,
  now = Date.now()
): NutritionClipboard {
  if (!scope || scope === "initial")
    throw Error("Wait for your account food log to load before copying.")
  if (!entries.length || entries.length > 30)
    throw Error("Copy between 1 and 30 foods at a time.")
  const expires = Math.min(
    now + 86400000,
    ...entries.map((entry) => entry.catalogExpiresAt || now + 86400000)
  )
  if (expires <= now)
    throw Error("Reload this food before copying its serving.")
  const value: NutritionClipboard = {
    version: 1,
    scope,
    date,
    name: name.slice(0, 180),
    entries: entries.map(validateEntry),
    expires,
  }
  copied.clear()
  copied.set(scope, value)
  return value
}
export function clearNutritionClipboard(scope?: string) {
  if (scope) copied.delete(scope)
  else copied.clear()
}
export function pastedNutritionFoods(
  clipboard: NutritionClipboard,
  scope: string,
  meal: Meal,
  createId: () => string,
  now = Date.now()
): FoodEntry[] {
  if (clipboard.scope !== scope || clipboard.expires <= now)
    throw Error("Copy the food again before pasting.")
  return clipboard.entries.map((entry) => ({
    ...validateEntry(entry),
    id: createId(),
    meal,
  }))
}
