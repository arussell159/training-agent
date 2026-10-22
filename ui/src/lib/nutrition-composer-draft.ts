import type { FoodEntry, FoodProduct, Meal } from "./nutrition"

export function getNutritionComposerStorage(
  access = () => localStorage
): Storage {
  try {
    const storage = access()
    storage.getItem("nutrition-storage-check")
    return storage
  } catch {
    throw Error(
      "Food save storage is unavailable in this browser. Allow site storage or reopen the app in a regular browser window, then retry. No food save was sent."
    )
  }
}

export type NutritionComposerDraft = {
  date: string
  meal: Meal
  savedAt: number
  query: string
  text: string
  draft: FoodEntry[]
  pane: "browse" | "detail" | "custom"
  product: FoodProduct | null
  customId: string | null
  customName: string
  ingredients: FoodEntry[] | null
  operationId: string
}
const key = (scope: string, date: string, meal: Meal) =>
  `nutrition-composer-draft:${scope}:${date}:${meal}`
const validEntries = (value: unknown): value is FoodEntry[] =>
  Array.isArray(value) &&
  value.length <= 30 &&
  value.every(
    (entry) =>
      entry &&
      typeof entry.id === "string" &&
      typeof entry.name === "string" &&
      typeof entry.unit === "string" &&
      Number.isFinite(entry.quantity) &&
      ["calories", "protein", "carbs", "fat"].every((nutrient) =>
        Number.isFinite(entry[nutrient])
      )
  )
export function readNutritionComposerDraft(
  storage: Pick<Storage, "getItem" | "removeItem">,
  scope: string,
  date: string,
  meal: Meal,
  now = Date.now()
): NutritionComposerDraft | null {
  if (scope === "initial") return null
  try {
    const value = JSON.parse(storage.getItem(key(scope, date, meal)) || "null")
    if (!value) return null
    if (
      value.date !== date ||
      value.meal !== meal ||
      !Number.isFinite(value.savedAt) ||
      now - value.savedAt > 24 * 60 * 60_000 ||
      !validEntries(value.draft) ||
      (value.ingredients !== null && !validEntries(value.ingredients)) ||
      !["browse", "detail", "custom"].includes(value.pane) ||
      typeof value.operationId !== "string" ||
      typeof value.query !== "string" ||
      typeof value.text !== "string"
    ) {
      storage.removeItem(key(scope, date, meal))
      return null
    }
    // Keep user-entered quantity/meal/identifiers after provider content expiry,
    // then resolve current serving facts when the retained entry is reviewed.
    const freshEntry = (entry: FoodEntry): FoodEntry =>
      entry.source === "fatsecret" &&
      entry.catalogExpiresAt &&
      entry.catalogExpiresAt <= now
        ? {
            id: entry.id,
            source: entry.source,
            foodId: entry.foodId,
            servingId: entry.servingId,
            quantity: entry.quantity,
            meal: entry.meal,
            name: "Food",
            unit: "serving",
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            fiber: null,
            notes: entry.notes,
            barcode: null,
            imageUrl: null,
          }
        : entry
    return {
      ...value,
      draft: value.draft.map(freshEntry),
      ingredients: value.ingredients?.map(freshEntry) ?? null,
      product:
        value.product?.catalogExpiresAt && value.product.catalogExpiresAt <= now
          ? null
          : value.product,
    }
  } catch {
    return null
  }
}
export function writeNutritionComposerDraft(
  storage: Pick<Storage, "setItem" | "removeItem">,
  scope: string,
  value: NutritionComposerDraft
) {
  if (scope === "initial") return
  try {
    if (
      !value.query &&
      !value.text &&
      !value.draft.length &&
      !value.ingredients?.length
    )
      storage.removeItem(key(scope, value.date, value.meal))
    else
      storage.setItem(key(scope, value.date, value.meal), JSON.stringify(value))
  } catch {
    /* Draft storage cannot prevent editing or the durable save path. */
  }
}
export function clearNutritionComposerDraft(
  storage: Pick<Storage, "removeItem">,
  scope: string,
  date: string,
  meal: Meal
) {
  try {
    storage.removeItem(key(scope, date, meal))
  } catch {
    /* Optional draft cache. */
  }
}
