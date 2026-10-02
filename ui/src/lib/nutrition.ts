import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "./api-client"
import { deviceCacheScope } from "./device-cache"
import { cachedTrainingContext } from "./training-context"
import { dashboardToday } from "./dashboard-metrics"
import { completedWorkoutCalories } from "./nutrition-math"

export const meals = ["breakfast", "lunch", "dinner", "snacks"] as const
export type Meal = (typeof meals)[number]
export const nutrientKeys = [
  "calories",
  "protein",
  "carbs",
  "fat",
  "fiber",
] as const
export type Nutrient = (typeof nutrientKeys)[number]
export type Macro = "protein" | "carbs" | "fat"
export type Targets = Record<Nutrient, number | null> & {
  macroMode?: "grams" | "percent"
  percentages?: Record<Macro, number | null>
}
export type FoodEntry = {
  id: string
  name: string
  meal: Meal
  quantity: number
  unit: string
  gramsPerUnit?: number | null
  millilitersPerUnit?: number | null
  servingQuantity?: number | null
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number | null
  source: "manual" | "ai" | "openfoodfacts" | "fatsecret"
  foodId?: string
  servingId?: string
  notes: string
  barcode: string | null
  imageUrl: string | null
  missingValues?: Nutrient[]
}
export type FatSecretServing = {
  id: string
  label: string
  unit: string
  units: number
  metricAmount: number | null
  metricUnit: string | null
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number | null
}
export type FoodProduct = {
  source?: "fatsecret"
  servingId?: string
  servings?: FatSecretServing[]
  code: string
  name: string
  brand: string
  imageUrl: string | null
  unit: string
  nutrients: Targets
  servingSize: string
  servingQuantity: number | null
  complete: boolean
  url: string
}
export type NutritionDay = { entries: FoodEntry[]; revision: number }
export type SavedFood = {
  id: string
  name: string
  entries: FoodEntry[]
  favorite: boolean
  custom: boolean
}
export type FoodLibrary = { revision: number; items: SavedFood[] }
export type NutritionView = {
  date: string
  day: NutritionDay
  targets: Targets
  targetsRevision: number
  aiAvailable: boolean
  localPreview: boolean
  week: {
    date: string
    logged: boolean
    totals: Record<Nutrient, number>
    targets: Targets
  }[]
}
export const titleCase = (value: string) =>
  value.replace(
    /(^|[\s(/-])([a-z])/g,
    (_, prefix, c: string) => prefix + c.toUpperCase()
  )
export const nutritionToday = () => dashboardToday(cachedTrainingContext())
export function useExerciseCalories(date: string) {
  return useExerciseCaloriesForDates([date])[0]
}
export function useExerciseCaloriesForDates(dates: string[]) {
  const [context, setContext] = useState(cachedTrainingContext)
  useEffect(() => {
    const update = () => setContext(cachedTrainingContext())
    window.addEventListener("training-context-updated", update)
    window.addEventListener("training-cache-reset", update)
    return () => {
      window.removeEventListener("training-context-updated", update)
      window.removeEventListener("training-cache-reset", update)
    }
  }, [])
  return dates.map((date) => completedWorkoutCalories(context, date))
}
export function suggestedMeal(now = new Date()): Meal {
  const timeZone =
    cachedTrainingContext()?.athlete.time_zone || "America/Chicago"
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).format(now)
  )
  return hour >= 5 && hour < 11
    ? "breakfast"
    : hour >= 11 && hour < 15
      ? "lunch"
      : hour >= 17 && hour < 22
        ? "dinner"
        : "snacks"
}
export const dateShift = (date: string, offset: number) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
export const foodTotals = (entries: FoodEntry[]) =>
  entries.reduce(
    (sum, entry) => {
      for (const key of nutrientKeys) {
        const value = Number(entry[key])
        if (Number.isFinite(value)) sum[key] += value
      }
      return sum
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  )

type RecentFood = { entry: FoodEntry; loggedAt: number }
const recentFoodsKey = () => `nutrition-search-recents:${deviceCacheScope()}`
export function recentFoodsForMeal(meal: Meal): SavedFood[] {
  try {
    const rows = JSON.parse(localStorage.getItem(recentFoodsKey()) || "[]") as RecentFood[]
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
    const seen = new Set<string>()
    return rows
      .filter((row) => row?.entry?.meal === meal && row.loggedAt >= cutoff)
      .sort((a, b) => b.loggedAt - a.loggedAt)
      .filter(({ entry }) => {
        const key = `${entry.source}:${entry.foodId || entry.name.toLowerCase()}:${entry.servingId || entry.unit}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 12)
      .map(({ entry }) => ({
        id: `recent-${entry.id}`,
        name: entry.name,
        entries: [entry],
        favorite: false,
        custom: false,
      }))
  } catch {
    return []
  }
}
export function recordRecentFoods(entries: FoodEntry[]) {
  try {
    const rows = JSON.parse(localStorage.getItem(recentFoodsKey()) || "[]") as RecentFood[]
    const loggedAt = Date.now()
    const added = entries.map((entry) => ({ entry, loggedAt }))
    const keys = new Set(
      added.map(({ entry }) => `${entry.source}:${entry.foodId || entry.name.toLowerCase()}:${entry.servingId || entry.unit}`)
    )
    const retained = rows.filter(({ entry }) =>
      !keys.has(`${entry.source}:${entry.foodId || entry.name.toLowerCase()}:${entry.servingId || entry.unit}`)
    )
    localStorage.setItem(recentFoodsKey(), JSON.stringify([...added, ...retained].slice(0, 60)))
  } catch {
    // Search suggestions are best-effort and never block saving food.
  }
}
export const displayNutrient = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n).toLocaleString()
export function blankFood(meal: Meal): FoodEntry {
  return {
    id: crypto.randomUUID(),
    name: "",
    meal,
    quantity: 1,
    unit: "serving",
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: null,
    source: "manual",
    notes: "",
    barcode: null,
    imageUrl: null,
  }
}
export function foodFromProduct(product: FoodProduct, meal: Meal): FoodEntry {
  if (product.source === "fatsecret") {
    const serving = product.servings?.find((s) => s.id === product.servingId)
    return {
      ...blankFood(meal),
      name: [product.name, product.brand]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 180),
      source: "fatsecret",
      foodId: product.code,
      servingId: product.servingId,
      quantity: 1,
      unit: serving?.label.slice(0, 40) || product.servingSize.slice(0, 40),
      servingQuantity: 1,
      millilitersPerUnit:
        serving?.metricUnit === "ml" ? serving.metricAmount : null,
      gramsPerUnit:
        serving?.metricUnit === "g"
          ? serving.metricAmount
          : serving?.metricUnit === "oz" && serving.metricAmount
            ? serving.metricAmount * 28.349523125
            : null,
      calories: product.nutrients.calories || 0,
      protein: product.nutrients.protein || 0,
      carbs: product.nutrients.carbs || 0,
      fat: product.nutrients.fat || 0,
      fiber: product.nutrients.fiber,
    }
  }
  const portion =
    product.servingQuantity && product.servingQuantity > 0
      ? product.servingQuantity
      : 100
  return {
    ...blankFood(meal),
    name: [product.name, product.brand]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 180),
    quantity: portion,
    unit: product.unit,
    gramsPerUnit: product.unit === "g" ? 1 : null,
    servingQuantity: portion,
    ...Object.fromEntries(
      nutrientKeys.map((key) => [
        key,
        product.nutrients[key] == null
          ? key === "fiber"
            ? null
            : 0
          : Math.round(product.nutrients[key]! * portion) / 100,
      ])
    ),
    source: "openfoodfacts",
    barcode: product.code,
    imageUrl: product.imageUrl,
    missingValues: nutrientKeys.filter(
      (key) => key !== "fiber" && product.nutrients[key] === null
    ),
    notes: `Nutrition per 100 ${product.unit} from Open Food Facts. ${!product.complete ? "Some label values are missing; enter them before saving. " : ""}${product.servingSize ? `Label serving: ${product.servingSize}.` : ""}`,
  }
}
export async function nutritionRequest<T>(
  path: string,
  payload?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const response = await apiFetch(`/api/nutrition${path}`, {
    signal: signal || AbortSignal.timeout(path === "/estimate" ? 65000 : 22000),
    ...(payload === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Coach-Request": "1",
          },
          body: JSON.stringify(payload),
        }),
  })
  let data
  try {
    data = await response.json()
  } catch {
    throw Error("Nutrition is unavailable. Please try again.")
  }
  if (!response.ok)
    throw Error(data.error || "Nutrition couldn’t complete this request.")
  return data as T
}
const cache = new Map<string, { time: number; view: NutritionView }>(),
  pending = new Map<string, Promise<NutritionView>>()
let generation = 0
function load(date: string, refresh = false) {
  const key = `${deviceCacheScope()}:${date}`,
    saved = cache.get(key)
  if (!refresh && saved && Date.now() - saved.time < 30000)
    return Promise.resolve(saved.view)
  const underway = pending.get(key)
  if (underway) return underway
  const version = generation
  const request = nutritionRequest<NutritionView>(`?date=${date}`)
    .then((view) => {
      if (generation === version) {
        cache.set(key, { time: Date.now(), view })
        if (cache.size > 14) cache.delete(cache.keys().next().value!)
      }
      return view
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key)
    })
  pending.set(key, request)
  return request
}
for (const event of [
  "training-cache-reset",
  "device-cache-cleared",
  "app-auth-required",
])
  window.addEventListener(event, () => {
    generation++
    cache.clear()
    pending.clear()
  })
export function nutritionChanged() {
  generation++
  cache.clear()
  pending.clear()
  window.dispatchEvent(new Event("nutrition-updated"))
}
export function useNutrition(date: string) {
  const [data, setData] = useState<NutritionView | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    let sequence = 0
    const read = (refresh = false) => {
      const version = ++sequence
      setError("")
      setLoading(true)
      void load(date, refresh)
        .then((value) => {
          if (active && version === sequence) setData(value)
        })
        .catch((problem) => {
          if (active && version === sequence)
            setError(problem.message || "Your food log could not load.")
        })
        .finally(() => {
          if (active && version === sequence) setLoading(false)
        })
    }
    read()
    const update = () => read(true)
    window.addEventListener("nutrition-updated", update)
    return () => {
      active = false
      window.removeEventListener("nutrition-updated", update)
    }
  }, [date, retry])
  return {
    data: data?.date === date ? data : null,
    error,
    loading,
    setData,
    reload: useCallback(() => {
      cache.clear()
      setRetry((v) => v + 1)
    }, []),
  }
}
