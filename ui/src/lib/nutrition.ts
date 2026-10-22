import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch } from "./api-client"
import {
  deviceCacheScope,
  readDeviceCache,
  writeDeviceCache,
  deleteDeviceCachePrefix,
} from "./device-cache"
import { cachedTrainingContext } from "./training-context"
import { dashboardToday } from "./dashboard-metrics"
import { completedWorkoutCalories } from "./nutrition-math"
import { randomId } from "./random-id"
import { withRequestDeadline } from "./request-deadline"
import type {
  NutritionWrite,
  NutritionWriteResult,
} from "./pending-nutrition-write"
import {
  foodSuggestions,
  mergeFoodHistory,
  type RecentFood,
} from "./nutrition-recents"

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
  catalogReceipt?: string
  catalogExpiresAt?: number
  notes: string
  barcode: string | null
  imageUrl: string | null
  missingValues?: Nutrient[]
}
export type FatSecretServing = {
  id: string
  catalogReceipt?: string
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
  catalogExpiresAt?: number
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
  catalogReadAt?: number
  date: string
  day: NutritionDay
  targets: Targets
  targetsRevision: number
  aiAvailable: boolean
  localPreview: boolean
  recentDays?: { date: string; entries: FoodEntry[] }[]
  week: {
    date: string
    logged: boolean
    totals: Record<Nutrient, number> | null
    unavailable?: boolean
    error?: string
    providerCode?: number
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

const recentFoodsKey = () => `nutrition-search-recents:${deviceCacheScope()}`
export function recentFoodsForMeal(meal: Meal, frequent = false): SavedFood[] {
  try {
    let rows = JSON.parse(
      localStorage.getItem(recentFoodsKey()) || "[]"
    ) as RecentFood[]
    // Bootstrap suggestions from diary days already loaded by this account.
    // Entry IDs stop reloads and cache refreshes from inflating frequency.
    for (const [key, { view, time }] of cache) {
      if (!key.startsWith(`${deviceCacheScope()}:`)) continue
      for (const day of [
        { date: view.date, entries: view.day.entries },
        ...(view.recentDays || []),
      ]) {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
          !Array.isArray(day.entries)
        )
          continue
        rows = mergeFoodHistory(
          rows,
          day.entries,
          Math.min(Date.now(), Date.parse(`${day.date}T12:00:00Z`)),
          Date.now(),
          time
        )
      }
    }
    return foodSuggestions(rows, meal, frequent)
  } catch {
    return []
  }
}
export function recordRecentFoods(entries: FoodEntry[]) {
  try {
    const rows = JSON.parse(
      localStorage.getItem(recentFoodsKey()) || "[]"
    ) as RecentFood[]
    localStorage.setItem(
      recentFoodsKey(),
      JSON.stringify(mergeFoodHistory(rows, entries, Date.now()))
    )
  } catch {
    // Suggestions are best-effort; only confirmed saves call this helper.
  }
}
export const displayNutrient = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n).toLocaleString()
export function blankFood(meal: Meal): FoodEntry {
  return {
    id: randomId(),
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
      catalogReceipt: serving?.catalogReceipt,
      catalogExpiresAt: product.catalogExpiresAt,
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
      calories: serving?.calories ?? product.nutrients.calories ?? 0,
      protein: serving?.protein ?? product.nutrients.protein ?? 0,
      carbs: serving?.carbs ?? product.nutrients.carbs ?? 0,
      fat: serving?.fat ?? product.nutrients.fat ?? 0,
      fiber: serving?.fiber ?? product.nutrients.fiber,
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
  return withRequestDeadline(
    async (requestSignal) => {
      const response = await apiFetch(`/api/nutrition${path}`, {
        signal: requestSignal,
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
        throw Object.assign(
          Error(
            typeof data?.error === "string"
              ? data.error
              : "Nutrition couldn’t complete this request."
          ),
          { status: response.status }
        )
      if (payload !== undefined && path.startsWith("/library"))
        window.dispatchEvent(new Event("food-library-updated"))
      return data as T
    },
    path === "/estimate" ? 65000 : 22000,
    signal,
    "Nutrition took too long to respond. Please retry."
  )
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const nutrientValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
const validTargets = (value: unknown) =>
  object(value) &&
  nutrientKeys.every((key) => value[key] === null || nutrientValue(value[key]))
export function validatedNutritionView(
  value: unknown,
  date: string
): NutritionView {
  if (
    !object(value) ||
    value.date !== date ||
    !object(value.day) ||
    !Number.isSafeInteger(value.day.revision) ||
    !Array.isArray(value.day.entries) ||
    !value.day.entries.every(
      (entry) =>
        object(entry) &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        typeof entry.unit === "string" &&
        meals.includes(entry.meal as Meal) &&
        nutrientValue(entry.quantity) &&
        Number(entry.quantity) > 0 &&
        nutrientKeys.every(
          (key) =>
            (key === "fiber" && entry[key] === null) ||
            nutrientValue(entry[key])
        )
    ) ||
    !validTargets(value.targets) ||
    !Number.isSafeInteger(value.targetsRevision) ||
    !Array.isArray(value.week) ||
    !value.week.every(
      (row) =>
        object(row) &&
        typeof row.date === "string" &&
        validTargets(row.targets) &&
        ((row.unavailable === true &&
          row.totals === null &&
          typeof row.error === "string") ||
          (object(row.totals) &&
            nutrientKeys.every((key) =>
              nutrientValue((row.totals as Record<string, unknown>)[key])
            )))
    )
  )
    throw Error("Your food log is incomplete. Please retry.")
  return value as NutritionView
}
const cache = new Map<string, { time: number; view: NutritionView }>(),
  pending = new Map<string, Promise<NutritionView>>()
let generation = 0
const SNAPSHOT_KEY = "training-agent-nutrition-startup-v1"
// FatSecret non-identifier content must be refreshed within 24 hours. Keep a
// short margin and never extend the original retrieval time on cache reads.
const SNAPSHOT_TTL = 23 * 60 * 60_000
const snapshotKey = (scope: string, date: string) =>
  `nutrition-view-v2:${scope}:${date}`
function retainNutritionView(
  view: NutritionView,
  scope: string,
  time = Date.now()
) {
  time = Math.min(view.catalogReadAt ?? time, time)
  for (const entry of [
    ...view.day.entries,
    ...(view.recentDays || []).flatMap((day) => day.entries),
  ]) {
    if (entry.source === "fatsecret" && Number.isFinite(entry.catalogExpiresAt))
      time = Math.min(time, entry.catalogExpiresAt! - SNAPSHOT_TTL)
  }
  view = { ...view, catalogReadAt: time }
  const key = `${scope}:${view.date}`
  const previous = cache.get(key)
  if (previous && previous.view.day.revision > view.day.revision)
    return previous.view
  cache.set(key, { time, view })
  if (cache.size > 14) cache.delete(cache.keys().next().value!)
  void writeDeviceCache(`nutrition:${key}`, view)
  try {
    const encoded = JSON.stringify({ scope, time, view })
    localStorage.setItem(SNAPSHOT_KEY, encoded)
    localStorage.setItem(snapshotKey(scope, view.date), encoded)
    const retained: { key: string; time: number }[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i)
      if (!name?.startsWith("nutrition-view-v2:")) continue
      try {
        const row = JSON.parse(localStorage.getItem(name) || "null")
        if (
          !Number.isFinite(row?.time) ||
          Date.now() - row.time >= SNAPSHOT_TTL
        )
          localStorage.removeItem(name)
        else retained.push({ key: name, time: row.time })
      } catch {
        localStorage.removeItem(name)
      }
    }
    retained
      .sort((a, b) => b.time - a.time)
      .slice(14)
      .forEach((row) => localStorage.removeItem(row.key))
  } catch {
    /* Cache failure must not change a confirmed save. */
  }
  return view
}
export function cachedNutrition(date: string): NutritionView | null {
  const key = `${deviceCacheScope()}:${date}`,
    saved = cache.get(key)
  if (saved && Date.now() - saved.time < SNAPSHOT_TTL) {
    cache.delete(key)
    cache.set(key, saved)
    return saved.view
  }
  try {
    const scope = deviceCacheScope()
    const snapshot = JSON.parse(
      localStorage.getItem(snapshotKey(scope, date)) ||
        localStorage.getItem(SNAPSHOT_KEY) ||
        "null"
    )
    if (
      snapshot?.scope === deviceCacheScope() &&
      Date.now() - snapshot.time >= 0 &&
      Date.now() - snapshot.time < SNAPSHOT_TTL
    ) {
      const view = {
        ...validatedNutritionView(snapshot.view, date),
        catalogReadAt: snapshot.time,
      }
      cache.set(key, { time: snapshot.time, view })
      return view
    }
    if (snapshot && Date.now() - snapshot.time >= SNAPSHOT_TTL)
      localStorage.removeItem(SNAPSHOT_KEY)
  } catch {
    /* Storage is optional. */
  }
  return null
}
export function prefetchNutrition(date = nutritionToday()) {
  return load(date)
}
function load(date: string, refresh = false) {
  const scope = deviceCacheScope(),
    key = `${scope}:${date}`
  const available = refresh ? null : cachedNutrition(date)
  if (available) return Promise.resolve(available)
  const underway = pending.get(key)
  if (underway) return underway
  const version = generation
  const startupTarget = window as Window & {
    __nutritionStartupRequest?: {
      date: string
      response: Promise<Response | null>
    }
  }
  const startup =
    !refresh && startupTarget.__nutritionStartupRequest?.date === date
      ? startupTarget.__nutritionStartupRequest
      : undefined
  if (startup) delete startupTarget.__nutritionStartupRequest
  const request = (async () => {
    const response = startup ? await startup.response : null
    return response?.ok
      ? ((await response.json()) as NutritionView)
      : await nutritionRequest<NutritionView>(
          `?date=${encodeURIComponent(date)}`
        )
  })()
    .then((value) => {
      if (generation !== version || scope !== deviceCacheScope())
        throw new DOMException("Aborted", "AbortError")
      const view = validatedNutritionView(value, date)
      if (generation === version) {
        return retainNutritionView(view, scope)
      }
      return view
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key)
    })
  pending.set(key, request)
  return request
}
if (typeof window !== "undefined")
  for (const event of [
    "training-cache-reset",
    "device-cache-cleared",
    "app-auth-required",
  ])
    window.addEventListener(event, () => {
      delete (window as Window & { __nutritionStartupRequest?: unknown })
        .__nutritionStartupRequest
      generation++
      cache.clear()
      pending.clear()
      try {
        localStorage.removeItem(SNAPSHOT_KEY)
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const name = localStorage.key(i)
          if (name?.startsWith("nutrition-view-v2:"))
            localStorage.removeItem(name)
        }
      } catch {
        /* Storage is optional. */
      }
    })
export function nutritionChanged(broadcast = true) {
  generation++
  cache.clear()
  pending.clear()
  void deleteDeviceCachePrefix("nutrition:")
  try {
    localStorage.removeItem(SNAPSHOT_KEY)
    const prefix = `nutrition-view-v2:${deviceCacheScope()}:`
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const name = localStorage.key(i)
      if (name?.startsWith(prefix)) localStorage.removeItem(name)
    }
    if (broadcast)
      localStorage.setItem(`nutrition-change:${deviceCacheScope()}`, randomId())
  } catch {
    /* Storage is optional. */
  }
  window.dispatchEvent(new Event("nutrition-updated"))
}
/** Publish the confirmed diary directly instead of rehydrating its entire history. */
export function commitNutritionView(value: NutritionView, broadcast = true) {
  const view = validatedNutritionView(value, value.date),
    scope = deviceCacheScope()
  const current = cachedNutrition(view.date)
  if (current && current.day.revision > view.day.revision) return current
  const factsTime = Math.min(
    view.catalogReadAt ?? Date.now(),
    ...view.day.entries
      .filter(
        (entry) =>
          entry.source === "fatsecret" &&
          Number.isFinite(entry.catalogExpiresAt)
      )
      .map((entry) => entry.catalogExpiresAt! - SNAPSHOT_TTL)
  )
  generation++
  pending.clear()
  for (const [key, row] of cache) {
    if (!key.startsWith(`${scope}:`) || row.view.date === view.date) continue
    const week = row.view.week.map((day) =>
      day.date === view.date
        ? {
            ...day,
            logged: view.day.entries.length > 0,
            totals: foodTotals(view.day.entries),
            unavailable: false,
          }
        : day
    )
    const recentDays = row.view.recentDays?.map((day) =>
      day.date === view.date ? { ...day, entries: view.day.entries } : day
    )
    retainNutritionView(
      { ...row.view, week, recentDays },
      scope,
      Math.min(row.time, factsTime)
    )
  }
  const confirmed = retainNutritionView(
    {
      ...view,
      recentDays: view.recentDays?.map((day) =>
        day.date === view.date ? { ...day, entries: view.day.entries } : day
      ),
    },
    scope
  )
  try {
    if (broadcast)
      localStorage.setItem(
        `nutrition-change:${scope}`,
        JSON.stringify({
          date: view.date,
          revision: view.day.revision,
          nonce: randomId(),
        })
      )
  } catch {
    /* Optional broadcast. */
  }
  window.dispatchEvent(
    new CustomEvent("nutrition-updated", { detail: { confirmed: true } })
  )
  return confirmed
}
/** Reuse verified base state and signed facts after a lost response. An ambiguous
 * revision or unsigned legacy catalog entry still needs one authoritative read. */
export function reconcileNutritionWrite(
  input: NutritionWrite,
  result: NutritionWriteResult
) {
  const view = cachedNutrition(input.date)
  if (!view) return false
  const revision = result.day?.revision ?? result.revision
  if (!Number.isSafeInteger(revision)) return false
  if (view.day.revision >= revision!) return true
  let day = result.day
  if (!day) {
    if (view.day.revision !== input.revision || revision !== input.revision + 1)
      return false
    const entries = result.changedEntries ?? input.entries ?? []
    if (
      !result.changedEntries &&
      entries.some(
        (entry) =>
          entry.source === "fatsecret" &&
          (!entry.catalogReceipt ||
            !entry.catalogExpiresAt ||
            entry.catalogExpiresAt <= Date.now())
      )
    )
      return false
    const current = new Map(view.day.entries.map((entry) => [entry.id, entry]))
    if (input.action === "delete") current.delete(input.id || "")
    else for (const entry of entries) current.set(entry.id, entry)
    day = { revision: revision!, entries: [...current.values()] }
  }
  const savedDay = day
  commitNutritionView({
    ...view,
    day: savedDay,
    week: view.week.map((row) =>
      row.date === input.date
        ? {
            ...row,
            logged: savedDay.entries.length > 0,
            totals: foodTotals(savedDay.entries),
            unavailable: false,
          }
        : row
    ),
  })
  return true
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key === `nutrition-change:${deviceCacheScope()}`) {
      try {
        const change = JSON.parse(event.newValue || "null")
        if (change?.date) {
          const saved = JSON.parse(
            localStorage.getItem(
              snapshotKey(deviceCacheScope(), change.date)
            ) || "null"
          )
          if (
            saved?.scope === deviceCacheScope() &&
            Date.now() - saved.time < SNAPSHOT_TTL &&
            saved.view.day.revision >= change.revision
          ) {
            commitNutritionView(
              {
                ...validatedNutritionView(saved.view, change.date),
                catalogReadAt: saved.time,
              },
              false
            )
            return
          }
        }
      } catch {
        /* Legacy broadcasts revalidate normally. */
      }
      nutritionChanged(false)
    }
  })
export function beginNutritionWrite() {
  // A pre-save GET must never paint over the local change or its confirmation.
  generation++
  pending.clear()
}
export function useNutrition(date: string) {
  const [data, setData] = useState<NutritionView | null>(() =>
      cachedNutrition(date)
    ),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(() => !cachedNutrition(date)),
    [retry, setRetry] = useState(0)
  const displayed = useRef(data)
  displayed.current = data
  useEffect(() => {
    let active = true
    let sequence = 0
    const read = (refresh = false) => {
      const version = ++sequence,
        cacheGeneration = generation,
        scope = deviceCacheScope()
      const current = () =>
        active &&
        version === sequence &&
        generation === cacheGeneration &&
        scope === deviceCacheScope()
      setError("")
      const cached = refresh ? null : cachedNutrition(date)
      if (cached) setData(cached)
      setLoading(!cached && displayed.current?.date !== date)
      if (!refresh)
        void readDeviceCache<NutritionView>(
          `nutrition:${scope}:${date}`,
          SNAPSHOT_TTL
        ).then((saved) => {
          if (
            saved &&
            Date.now() - (saved.catalogReadAt ?? Date.now()) < SNAPSHOT_TTL &&
            current() &&
            !cache.has(`${scope}:${date}`)
          )
            try {
              setData(validatedNutritionView(saved, date))
              setLoading(false)
            } catch {
              /* Ignore malformed device snapshots. */
            }
        })
      void load(date, refresh)
        .then((value) => {
          if (current()) setData(value)
        })
        .catch((problem) => {
          if (current() && problem?.name !== "AbortError")
            setError(problem?.message || "Your food log could not load.")
        })
        .finally(() => {
          if (current()) setLoading(false)
        })
    }
    read()
    const update = (event: Event) => {
      const saved = (event as CustomEvent<{ confirmed?: boolean }>).detail
        ?.confirmed
        ? cachedNutrition(date)
        : null
      if (saved) {
        sequence++
        setData((current) =>
          !current ||
          current.date !== date ||
          current.day.revision <= saved.day.revision
            ? saved
            : current
        )
        setError("")
        setLoading(false)
      } else read(true)
    }
    const reset = () => {
      sequence++
      displayed.current = null
      setData(null)
      setError("")
      setLoading(false)
    }
    const connectionChanged = () => {
      reset()
      const version = sequence
      // Connection updates can clear both cache layers in the same tick.
      // Only the final reset needs a request.
      queueMicrotask(() => {
        if (active && version === sequence) read(true)
      })
    }
    window.addEventListener("nutrition-updated", update)
    window.addEventListener("app-auth-required", reset)
    window.addEventListener("device-cache-cleared", connectionChanged)
    window.addEventListener("training-cache-reset", connectionChanged)
    return () => {
      active = false
      window.removeEventListener("nutrition-updated", update)
      window.removeEventListener("app-auth-required", reset)
      window.removeEventListener("device-cache-cleared", connectionChanged)
      window.removeEventListener("training-cache-reset", connectionChanged)
    }
  }, [date, retry])
  return {
    data: data?.date === date ? data : null,
    error,
    loading,
    setData,
    reload: useCallback(() => {
      cache.delete(`${deviceCacheScope()}:${date}`)
      setRetry((v) => v + 1)
    }, [date]),
  }
}
