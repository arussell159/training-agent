import "@/lib/framework7-searchbar"
import { ListSkeleton } from "@/components/loading-layouts"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { flushSync } from "react-dom"
import { Searchbar } from "framework7-react"
import {
  Search,
  Star,
  Plus,
  LoaderCircle,
  X,
  Utensils,
  ArrowUp,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MobileFilterTabs } from "@/components/ui/mobile-filter-tabs"
import { FoodEditor } from "./nutrition-food-editor"
import { FoodThumbnail } from "./food-thumbnail"
import { portionLabel, scaleFood } from "@/lib/nutrition-math"
import { randomId } from "@/lib/random-id"
import { NutritionScreen, nutritionSaveClass } from "./nutrition-screen"
import { useToastManager } from "@/components/ui/toast"
import {
  loadFoodLibrary,
  searchFoods,
  loadFoodProduct,
  forgetFoodProduct,
} from "@/lib/nutrition-read-cache"
import { deviceCacheScope } from "@/lib/device-cache"
import {
  readNutritionComposerDraft,
  writeNutritionComposerDraft,
  clearNutritionComposerDraft,
  getNutritionComposerStorage,
} from "@/lib/nutrition-composer-draft"
import {
  blankFood,
  displayNutrient,
  foodFromProduct,
  foodTotals,
  recentFoodsForMeal,
  recordRecentFoods,
  nutritionRequest,
  titleCase,
  meals,
  type FoodEntry,
  type FoodProduct,
  type Meal,
  type SavedFood,
  type FoodLibrary,
} from "@/lib/nutrition"

export type EntryMode = "write" | "search" | "manual"
type Tab = "all" | "favorites" | "mine" | "type"
type Pane = "browse" | "detail" | "custom"
const tabs: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "favorites", label: "Favorites" },
  { value: "mine", label: "My foods" },
  { value: "type", label: "Type" },
]
export function NutritionComposer({
  meal,
  mode,
  existing,
  date,
  aiAvailable,
  onClose,
  onSave,
  onMoveExisting,
  onDeleteExisting,
}: {
  meal: Meal
  mode: EntryMode
  existing?: FoodEntry
  date: string
  aiAvailable?: boolean
  onClose: () => void
  onSave: (entries: FoodEntry[], operationId: string) => Promise<void>
  onMoveExisting?: (meal: Meal) => Promise<void>
  onDeleteExisting?: () => Promise<void>
}) {
  const toast = useToastManager()
  const saveLock = useRef(false)
  const productAddLock = useRef(false)
  const [draftScope] = useState(deviceCacheScope)
  const [restoredDraft] = useState(() => {
    try {
      return existing
        ? null
        : readNutritionComposerDraft(
            getNutritionComposerStorage(),
            draftScope,
            date,
            meal
          )
    } catch {
      return null
    }
  })
  const [searchRetry, setSearchRetry] = useState(0)
  const [detailRetry, setDetailRetry] = useState(0)
  const [tab, setTab] = useState<Tab>("all")
  const [searching, setSearching] = useState(false)
  const [composing, setComposing] = useState(false)
  const [pane, setPane] = useState<Pane>(
    existing ? "detail" : mode === "manual" ? "custom" : "browse"
  )
  const [query, setQuery] = useState(restoredDraft?.query || ""),
    [text, setText] = useState(restoredDraft?.text || "")

  const [products, setProducts] = useState<FoodProduct[] | null>(null),
    [library, setLibrary] = useState<FoodLibrary | null>(null)
  const [draft, setDraft] = useState<FoodEntry[]>(
    existing
      ? [existing]
      : restoredDraft?.draft || (mode === "manual" ? [blankFood(meal)] : [])
  )
  const [product, setProduct] = useState<FoodProduct | null>(
      restoredDraft?.product || null
    ),
    [customId, setCustomId] = useState<string | null>(
      restoredDraft?.customId || null
    ),
    [customName, setCustomName] = useState(restoredDraft?.customName || "")
  const [ingredients, setIngredients] = useState<FoodEntry[] | null>(
    restoredDraft?.ingredients || null
  )
  const [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false)
  const alive = useRef(true),
    request = useRef<AbortController | null>(null),
    operation = useRef<string>(restoredDraft?.operationId || randomId())
  useEffect(() => {
    if (existing || draftScope !== deviceCacheScope()) return
    try {
      writeNutritionComposerDraft(getNutritionComposerStorage(), draftScope, {
        date,
        meal,
        savedAt: Date.now(),
        query,
        text,
        draft,
        pane,
        product,
        customId,
        customName,
        ingredients,
        operationId: operation.current,
      })
    } catch {
      /* Optional draft storage must not prevent opening the editor. */
    }
  }, [
    date,
    meal,
    existing,
    draftScope,
    query,
    text,
    draft,
    pane,
    product,
    customId,
    customName,
    ingredients,
  ])
  const searchHost = useRef<HTMLDivElement>(null)
  const focusSearchOnOpen = useCallback((host: HTMLDivElement | null) => {
    searchHost.current = host
    if (window.matchMedia("(max-width: 767px), (pointer: coarse)").matches)
      host
        ?.querySelector<HTMLInputElement>('input[type="search"]')
        ?.focus({ preventScroll: true })
  }, [])
  const clearSearch = () => {
    setQuery("")
    // Refocus during the original tap so iOS keeps/reopens the keyboard.
    searchHost.current
      ?.querySelector<HTMLInputElement>('input[type="search"]')
      ?.focus({ preventScroll: true })
  }
  const browseScroll = useRef(0)
  const searchResults = useRef<{
    query: string
    retry: number
    products: FoodProduct[]
  } | null>(null)
  useLayoutEffect(() => {
    if (pane === "browse") {
      const scroll = searchHost.current?.closest(".nutrition-screen-scroll")
      if (scroll) scroll.scrollTop = browseScroll.current
    }
  }, [pane])
  const typeInput = useRef<HTMLTextAreaElement>(null)
  const detailFatSecretFoodId =
    pane === "detail"
      ? draft.find((entry) => entry.source === "fatsecret")?.foodId
      : undefined
  const focusTypeInput = useCallback((input: HTMLTextAreaElement | null) => {
    typeInput.current = input
    input?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const input = searchHost.current?.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )
    if (!input) return
    input.enterKeyHint = "search"
    input.maxLength = 100
    const startComposition = () => setComposing(true)
    const endComposition = () => {
      setComposing(false)
      setQuery(input.value)
    }
    const submit = (event: KeyboardEvent) => {
      if (
        event.key !== "Enter" ||
        event.isComposing ||
        composing ||
        !query.trim()
      )
        return
      event.preventDefault()
      setSearchRetry((value) => value + 1)
      input.blur()
    }
    input.addEventListener("keydown", submit)
    input.addEventListener("compositionstart", startComposition)
    input.addEventListener("compositionend", endComposition)
    return () => {
      input.removeEventListener("keydown", submit)
      input.removeEventListener("compositionstart", startComposition)
      input.removeEventListener("compositionend", endComposition)
    }
  }, [pane, tab, query, composing])
  const quickOperations = useRef(
    new Map<string, { entries: FoodEntry[]; id: string }>()
  )
  useEffect(() => {
    alive.current = true
    void loadFoodLibrary()
      .then((value) => {
        if (alive.current) setLibrary(value)
      })
      .catch((e) => {
        if (alive.current) setError(e.message)
      })
    return () => {
      alive.current = false
      request.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (!detailFatSecretFoodId || product?.code === detailFatSecretFoodId)
      return
    const controller = new AbortController()
    void loadFoodProduct(detailFatSecretFoodId, controller.signal, detailRetry)
      .then((result) => {
        if (!controller.signal.aborted) {
          setProduct(result.product)
          setDraft((current) =>
            current.map((entry) => {
              if (entry.foodId !== result.product.code) return entry
              const serving = result.product.servings?.find(
                (row) => row.id === entry.servingId
              )
              if (!serving?.catalogReceipt) return entry
              return {
                ...entry,
                ...scaleFood(
                  foodFromProduct(
                    { ...result.product, servingId: entry.servingId },
                    entry.meal
                  ),
                  entry.quantity
                ),
                id: entry.id,
                notes: entry.notes,
              }
            })
          )
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted && alive.current)
          setError(e instanceof Error ? e.message : "Could not load servings.")
      })
    return () => controller.abort()
  }, [detailFatSecretFoodId, product?.code, detailRetry])
  function refreshRejectedServing(problem: unknown, entries: FoodEntry[]) {
    if (
      !(problem instanceof Error) ||
      !problem.message.includes("could not be verified")
    )
      return
    for (const entry of entries)
      if (entry.foodId) forgetFoodProduct(entry.foodId)
    setDraft(entries)
    setProduct(null)
    setPane("detail")
    setDetailRetry((value) => value + 1)
  }
  const changeDraft = (next: FoodEntry[]) => {
    operation.current = randomId()
    setDraft(next)
  }
  const cancel = () => {
    request.current?.abort()
    request.current = null
    setBusy(false)
    setError("")
    setNotice("")
  }
  async function run<T>(
    action: (signal: AbortSignal) => Promise<T>,
    done: (value: T) => void
  ) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError("")
    const timer = setTimeout(() => controller.abort(), 65000)
    try {
      const value = await action(controller.signal)
      if (
        alive.current &&
        request.current === controller &&
        !controller.signal.aborted
      )
        done(value)
    } catch (e) {
      if (alive.current && request.current === controller)
        setError(
          e instanceof Error && e.name !== "AbortError"
            ? e.message
            : "Request timed out. Please retry."
        )
    } finally {
      clearTimeout(timer)
      if (alive.current && request.current === controller) setBusy(false)
    }
  }
  useEffect(() => {
    if (pane !== "browse") return
    if (tab !== "all" || query.trim().length < 2 || composing) {
      setProducts(null)
      setSearching(false)
      setError("")
      return
    }
    const cached = searchResults.current
    if (cached?.query === query.trim() && cached.retry === searchRetry) {
      setProducts(cached.products)
      return
    }
    setSearching(true)
    setError("")
    const controller = new AbortController(),
      timer = setTimeout(() => {
        void searchFoods(query, controller.signal, searchRetry)
          .then((result) => {
            if (!controller.signal.aborted) {
              const complete = result.products.filter((p) => p.complete)
              searchResults.current = {
                query: query.trim(),
                retry: searchRetry,
                products: complete,
              }
              setProducts(complete)
            }
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message)
          })
          .finally(() => {
            if (!controller.signal.aborted) setSearching(false)
          })
      }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
      setSearching(false)
    }
  }, [query, tab, pane, searchRetry, composing])
  function selectTab(next: Tab) {
    cancel()
    if (next === "type") {
      flushSync(() => {
        setTab(next)
        setPane("browse")
      })
      typeInput.current?.focus({ preventScroll: true })
    } else {
      setTab(next)
      setPane("browse")
    }
  }
  function review(entries: FoodEntry[], p: FoodProduct | null = null) {
    browseScroll.current =
      searchHost.current?.closest(".nutrition-screen-scroll")?.scrollTop || 0
    cancel()
    changeDraft(entries)
    setProduct(p)
    if (!ingredients) setCustomId(null)
    setNotes("")
    setPane("detail")
  }
  const estimate = () =>
    run(
      (signal) =>
        nutritionRequest<{ entries: FoodEntry[]; notes: string }>(
          "/estimate",
          {
            text,
            meal,
          },
          signal
        ),
      (result) => {
        if (!result.entries.length) {
          setError(result.notes || "No food found. Add more detail.")
          return
        }
        review(result.entries)
        setNotes(result.notes)
      }
    )
  const valid = () =>
    !draft.some(
      (e) =>
        !e.name.trim() ||
        !e.unit.trim() ||
        e.quantity <= 0 ||
        e.missingValues?.length
    )
  async function save() {
    if (saveLock.current) return
    if (draftScope !== deviceCacheScope()) {
      setError("Your account changed. Reopen Add food in the intended account.")
      return
    }
    if (!valid()) {
      setError("Check the food names, portions and macros.")
      return
    }
    if (ingredients) {
      addIngredients(draft)
      return
    }
    saveLock.current = true
    const notification = toast.add({
      id: "nutrition-save",
      title: existing ? "Saving changes…" : `Adding to ${titleCase(meal)}…`,
      description: null,
      actionProps: undefined,
      type: "loading",
      timeout: 0,
    })
    setSaving(true)
    setError("")
    try {
      const storage = getNutritionComposerStorage()
      await onSave(draft, operation.current)
      clearNutritionComposerDraft(storage, draftScope, date, meal)
      toast.update(notification, {
        title: existing
          ? "Changes saved"
          : `Added ${draft.map((entry) => entry.name).join(", ")} to ${draft.some((entry) => entry.meal !== meal) ? "your food log" : titleCase(meal)}.`,
        type: "success",
        description: null,
        actionProps: undefined,
        timeout: 5500,
      })
      if (!existing) recordRecentFoods(draft)
      if (!existing && mode !== "manual" && tab !== "type") {
        setNotice("")
        setQuery("")
        setText("")
        changeDraft([])
        setProduct(null)
        setCustomId(null)
        setCustomName("")
        setNotes("")
        setPane("browse")
      } else {
        onClose()
      }
    } catch (e) {
      refreshRejectedServing(e, draft)
      toast.update(notification, {
        title: "Food wasn’t confirmed",
        description: (e as Error).message,
        type: "error",
        timeout: 8000,
      })
      setError((e as Error).message)
    } finally {
      saveLock.current = false
      if (alive.current) setSaving(false)
    }
  }
  async function quickAdd(
    key: string,
    entries: FoodEntry[],
    name: string,
    activeNotification?: string
  ) {
    if (saveLock.current) return
    if (ingredients) {
      addIngredients(entries)
      if (activeNotification)
        toast.update(activeNotification, {
          title: "Ingredient added",
          description: null,
          actionProps: undefined,
          type: "success",
          timeout: 3500,
        })
      return
    }
    saveLock.current = true
    const notification =
      activeNotification ||
      toast.add({
        id: "nutrition-save",
        title: `Adding ${name}…`,
        description: titleCase(meal),
        actionProps: undefined,
        type: "loading",
        timeout: 0,
      })
    setSaving(true)
    setError("")
    let pending = quickOperations.current.get(key)
    if (!pending) {
      pending = {
        id: randomId(),
        entries: entries.map((e) => ({ ...e, id: randomId(), meal })),
      }
      quickOperations.current.set(key, pending)
    }
    try {
      getNutritionComposerStorage()
      await onSave(pending.entries, pending.id)
      toast.update(notification, {
        title: `Added ${name} to ${titleCase(meal)}.`,
        description: null,
        actionProps: undefined,
        type: "success",
        timeout: 5500,
      })
      recordRecentFoods(pending.entries)
      quickOperations.current.delete(key)
      setNotice("")
    } catch (e) {
      if (e instanceof Error && e.message.includes("could not be verified"))
        quickOperations.current.delete(key)
      refreshRejectedServing(e, pending.entries)
      toast.update(notification, {
        title: "Food wasn’t confirmed",
        description: (e as Error).message,
        type: "error",
        timeout: 8000,
      })
      setError((e as Error).message)
    } finally {
      saveLock.current = false
      if (alive.current) setSaving(false)
    }
  }
  async function saveLibrary(item: SavedFood) {
    if (saveLock.current) return
    if (!library) {
      setError("Your food library is still loading.")
      return
    }
    saveLock.current = true
    const notification = toast.add({
      title: "Saving food…",
      type: "loading",
      timeout: 0,
    })
    setSaving(true)
    setError("")
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 0))
      )
      const result = await nutritionRequest<FoodLibrary>("/library", {
        action: "save",
        item,
        revision: library.revision,
      })
      setLibrary(result)
      toast.update(notification, {
        title: "Food saved",
        description: null,
        actionProps: undefined,
        type: "success",
        timeout: 3500,
      })
      return true
    } catch (e) {
      toast.update(notification, {
        title: "Food wasn’t saved",
        description: (e as Error).message,
        type: "error",
        timeout: 8000,
      })
      setError((e as Error).message)
      void nutritionRequest<FoodLibrary>("/library")
        .then(setLibrary)
        .catch(() => {})
    } finally {
      saveLock.current = false
      if (alive.current) setSaving(false)
    }
  }
  async function saveCustom() {
    const entries = draft.map((entry) => ({
      ...entry,
      name: entry.name.trim() || (draft.length === 1 ? customName.trim() : ""),
    }))
    if (
      !entries.length ||
      entries.some(
        (entry) =>
          !entry.name ||
          !entry.unit.trim() ||
          entry.quantity <= 0 ||
          entry.missingValues?.length
      ) ||
      !customName.trim()
    ) {
      setError("Name your food or meal and enter its macros.")
      return
    }
    const saved = await saveLibrary({
      id: customId || randomId(),
      name: customName,
      entries,
      custom: true,
      favorite:
        library?.items.find((i) => i.id === customId)?.favorite || false,
    })
    if (saved) {
      setPane("browse")
      setTab("mine")
      setQuery("")
      setNotice("")
    }
  }
  function addIngredients(entries: FoodEntry[]) {
    changeDraft([
      ...(ingredients || []),
      ...entries.map((entry) => ({ ...entry, id: randomId(), meal })),
    ])
    setIngredients(null)
    setProduct(null)
    setPane("custom")
    setQuery("")
    setNotes("")
    cancel()
  }
  async function loadProduct(p: FoodProduct, addNow: boolean) {
    if (addNow) {
      if (saveLock.current || productAddLock.current) return
      productAddLock.current = true
      const notification = toast.add({
        id: "nutrition-save",
        title: `Adding ${p.name}…`,
        description: titleCase(meal),
        type: "loading",
        timeout: 0,
      })
      const controller = new AbortController()
      request.current = controller
      setBusy(true)
      setError("")
      try {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => setTimeout(resolve, 0))
        )
        const product =
          p.complete &&
          p.servingId &&
          (p.source !== "fatsecret" ||
            Boolean(
              p.servings?.find((s) => s.id === p.servingId)?.catalogReceipt
            ))
            ? p
            : (await loadFoodProduct(p.code, controller.signal)).product
        if (!alive.current || controller.signal.aborted)
          throw new Error("Food entry cancelled.")
        if (!product.complete || !product.servingId)
          throw new Error(
            "This food has no complete serving. Try another match."
          )
        await quickAdd(
          `product-${p.code}`,
          [foodFromProduct(product, meal)],
          p.name,
          notification
        )
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "This food could not be added."
        toast.update(notification, {
          title: "Food wasn’t confirmed",
          description: message,
          type: "error",
          timeout: 8000,
        })
        if (alive.current) setError(message)
      } finally {
        productAddLock.current = false
        if (alive.current) setBusy(false)
      }
      return
    }
    await run(
      (signal) => loadFoodProduct(p.code, signal),
      (result) => {
        if (!result.product.complete || !result.product.servingId)
          throw Error("This food has no complete serving. Try another match.")
        const entry = foodFromProduct(result.product, meal)
        review([entry], result.product)
      }
    )
  }
  const productItem = (p: FoodProduct): SavedFood => ({
    id: `product-${
      p.code ||
      p.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 60)
    }`,
    name: p.name,
    entries: [foodFromProduct(p, meal)],
    favorite: true,
    custom: false,
  })
  const back = () => {
    if (saving) return
    if (pane === "browse" && ingredients) {
      changeDraft(ingredients)
      setIngredients(null)
      setProduct(null)
      setPane("custom")
      cancel()
      return
    }
    if (pane === "detail" && existing) {
      onClose()
      return
    }
    if (pane !== "browse") {
      cancel()
      setPane("browse")
      return
    }
    onClose()
  }
  const filteredLibrary = (library?.items || []).filter(
    (item) =>
      (tab === "favorites" ? item.favorite : item.custom) &&
      item.name.toLowerCase().includes(query.toLowerCase())
  )
  const existingFavorite = existing
    ? library?.items.find((item) => {
        if (item.entries.length !== 1) return false
        const savedEntry = item.entries[0]
        return existing.foodId
          ? savedEntry.foodId === existing.foodId
          : savedEntry.name.trim().toLowerCase() ===
              existing.name.trim().toLowerCase() &&
              savedEntry.unit === existing.unit
      })
    : undefined
  async function moveExistingFood(nextMeal: Meal) {
    if (!onMoveExisting || nextMeal === existing?.meal) return
    setSaving(true)
    setError("")
    try {
      await onMoveExisting(nextMeal)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (alive.current) setSaving(false)
    }
  }
  async function deleteExistingFood() {
    if (!onDeleteExisting) return
    setSaving(true)
    setError("")
    try {
      await onDeleteExisting()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (alive.current) setSaving(false)
    }
  }
  async function toggleExistingFavorite() {
    if (!existing) return
    await saveLibrary(
      existingFavorite
        ? { ...existingFavorite, favorite: !existingFavorite.favorite }
        : {
            id: `diary-${
              existing.foodId ||
              existing.name
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "")
                .slice(0, 60)
            }`,
            name: existing.name,
            entries: [existing],
            favorite: true,
            custom: false,
          }
    )
  }
  const recentItems = recentFoodsForMeal(meal)
  const frequentItems = recentFoodsForMeal(meal, true)
  function resultRow(item: SavedFood, p?: FoodProduct) {
    const saved = library?.items.find((i) => i.id === item.id),
      totals = foodTotals(item.entries)
    return (
      <div key={item.id} className="nutrition-result">
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          disabled={saving || busy}
          onClick={() => {
            if (p) {
              void loadProduct(p, false)
              return
            }
            if (item.custom) {
              review(
                item.entries.map((e) => ({
                  ...e,
                  id: randomId(),
                  meal,
                }))
              )
              setCustomId(item.id)
              setCustomName(item.name)
            } else
              review(
                item.entries.map((e) => ({
                  ...e,
                  id: randomId(),
                  meal,
                })),
                p || null
              )
          }}
          aria-label={`Details for ${item.name}`}
        >
          <FoodThumbnail
            name={item.name}
            imageUrl={p?.imageUrl || item.entries[0]?.imageUrl}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {titleCase(item.name)}
            </span>
            <span className="mt-1 block text-[13px] text-muted-foreground">
              {p?.brand ? `${p.brand} · ` : ""}
              {p
                ? p.servingSize || "1 serving"
                : item.entries.length > 1
                  ? `${item.entries.length} foods`
                  : portionLabel(item.entries[0])}
            </span>
            <span className="nutrition-search-macros mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
              <span>{displayNutrient(totals.calories)} kcal</span>
              <span>{displayNutrient(totals.protein)} P</span>
              <span>{displayNutrient(totals.fat)} F</span>
              <span>{displayNutrient(totals.carbs)} C</span>
            </span>
          </span>
        </button>
        <button
          className="nutrition-row-action"
          aria-label={`${saved?.favorite ? "Unstar" : "Star"} ${item.name}`}
          aria-pressed={Boolean(saved?.favorite)}
          disabled={saving || busy || !library}
          onClick={() =>
            void (p && !saved
              ? run(
                  (signal) => loadFoodProduct(p.code, signal),
                  (result) => {
                    void saveLibrary(productItem(result.product))
                  }
                )
              : saveLibrary({ ...(saved || item), favorite: !saved?.favorite }))
          }
        >
          <Star
            className={`size-4 ${saved?.favorite ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`}
          />
        </button>
        <button
          className="nutrition-row-action bg-muted/70"
          aria-label={`Add one serving of ${item.name}`}
          disabled={saving || busy}
          onMouseDown={(event) => {
            if (document.activeElement?.matches('input[type="search"]'))
              event.preventDefault()
          }}
          onClick={() =>
            void (p
              ? loadProduct(p, true)
              : quickAdd(item.id, item.entries, item.name))
          }
        >
          <Plus className="size-5" />
        </button>
      </div>
    )
  }
  return (
    <NutritionScreen
      title={
        pane === "detail"
          ? "Food details"
          : pane === "custom"
            ? "My food"
            : ingredients
              ? "Add ingredient"
              : "Add food"
      }
      onBack={back}
      onExit={onClose}
    >
      {pane === "browse" && (
        <>
          <div className="nutrition-search-controls">
            <div ref={focusSearchOnOpen} className="nutrition-search-host">
              <Searchbar
                className="nutrition-searchbar"
                form={false}
                customSearch
                backdrop={false}
                disableButton={false}
                clearButton={false}
                value={query}
                placeholder="Search foods or brands"
                onInput={(e) => {
                  if (tab === "type") selectTab("all")
                  setQuery(e.target.value)
                }}
                onSearchbarClear={clearSearch}
              >
                <Search
                  slot="input-wrap-start"
                  className="nutrition-search-icon"
                />
                {query && (
                  <button
                    slot="input-wrap-end"
                    className="nutrition-search-clear"
                    aria-label="Clear food search"
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={clearSearch}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </Searchbar>
            </div>

            <MobileFilterTabs
              label="Food library"
              items={
                ingredients
                  ? tabs.filter(
                      (item) =>
                        item.value === "all" || item.value === "favorites"
                    )
                  : tabs
              }
              value={tab}
              onChange={selectTab}
              inline
            />
          </div>

          {tab === "type" ? (
            <div className="nutrition-type-entry space-y-4 pt-6">
              <div>
                <label
                  htmlFor="nutrition-meal-description"
                  className="block text-sm font-medium"
                >
                  What did you eat?
                </label>
                <div className="relative mt-3">
                  <textarea
                    ref={focusTypeInput}
                    id="nutrition-meal-description"
                    className="nutrition-textarea nutrition-textarea-with-submit"
                    enterKeyHint="send"
                    onPointerDown={(event) => {
                      const input = event.currentTarget
                      if (document.activeElement === input) return
                      // iOS normally scrolls the page when a blurred textarea is
                      // tapped to reopen the keyboard. Focus it during the tap,
                      // before the browser's default scroll-into-view behavior.
                      input.focus({ preventScroll: true })
                      event.preventDefault()
                    }}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "Enter" ||
                        event.shiftKey ||
                        event.nativeEvent.isComposing
                      )
                        return
                      event.preventDefault()
                      if (!busy && aiAvailable && text.trim()) void estimate()
                    }}
                    placeholder="Lunch was 200g white rice, 2 eggs and 3 scoops Tailwind. Dinner was 3 slices of Pizza Hut pizza."
                  />
                  <button
                    type="button"
                    className="nutrition-type-submit"
                    aria-label={busy ? "Searching foods" : "Search foods"}
                    title={busy ? "Searching…" : "Search"}
                    disabled={busy || !text.trim() || !aiAvailable}
                    onClick={() => void estimate()}
                  >
                    {busy ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <ArrowUp className="size-5" strokeWidth={2.25} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="pt-5">
              {draft.length > 0 && !existing && !ingredients && (
                <Button
                  variant="outline"
                  className="mb-4 w-full"
                  onClick={() =>
                    setPane(
                      customName || mode === "manual" ? "custom" : "detail"
                    )
                  }
                >
                  Review unfinished food for {titleCase(meal)} · {date}
                </Button>
              )}
              {!!text && tab === "all" && (
                <Button
                  variant="outline"
                  className="mb-4 w-full"
                  onClick={() => selectTab("type")}
                >
                  Resume typed food entry
                </Button>
              )}
              {tab === "mine" && (
                <Button
                  className={`${nutritionSaveClass} mb-4`}
                  onClick={() => {
                    changeDraft([blankFood(meal)])
                    setProduct(null)
                    setCustomId(null)
                    setCustomName("")
                    setNotes("")
                    setError("")
                    setPane("custom")
                  }}
                >
                  <Plus className="size-4" />
                  Create food or meal
                </Button>
              )}
              {tab === "all" ? (
                <>
                  {searching && (
                    <p
                      role="status"
                      className="mb-3 text-sm text-muted-foreground"
                    >
                      Searching…
                      {products?.length
                        ? " Previous results remain available below."
                        : ""}
                    </p>
                  )}
                  {products?.length &&
                  searchResults.current?.query !== query.trim() ? (
                    <p
                      className="mb-3 text-sm text-muted-foreground"
                      role="status"
                    >
                      Previous results for “{searchResults.current?.query}”
                    </p>
                  ) : null}
                  {error && query.trim().length >= 2 && (
                    <div className="mb-4 space-y-2" role="status">
                      <p className="text-sm">
                        {navigator.onLine === false
                          ? "You’re offline. Your recent foods are still available."
                          : "Search couldn’t finish. Your food log is unchanged."}
                      </p>
                      <Button variant="ghost" onClick={clearSearch}>
                        Show recent foods
                      </Button>
                    </div>
                  )}
                  {query.trim().length < 2 && recentItems.length ? (
                    <>
                      {frequentItems.length > 0 && (
                        <section
                          aria-label="Frequently used foods"
                          className="mb-5"
                        >
                          <h2 className="mb-3 text-sm font-semibold">
                            Frequently used
                          </h2>
                          <div className="nutrition-result-list">
                            {frequentItems.map((item) => resultRow(item))}
                          </div>
                        </section>
                      )}
                      <section aria-label={`Recent ${meal} foods`}>
                        <h2 className="mb-3 text-sm font-semibold">
                          Recent foods · {meal} first
                        </h2>
                        <div className="nutrition-result-list">
                          {recentItems.map((item) => resultRow(item))}
                        </div>
                      </section>
                    </>
                  ) : searching && !products?.length ? (
                    <ListSkeleton food />
                  ) : products?.length ? (
                    <div className="nutrition-result-list">
                      {products.map((p) => resultRow(productItem(p), p))}
                    </div>
                  ) : !error ? (
                    <div className="nutrition-empty">
                      <Search className="mx-auto mb-3 size-7 opacity-40" />
                      {query.trim().length < 2
                        ? "Search for a food or brand."
                        : "No complete matches found. Try a more specific food or brand."}
                    </div>
                  ) : null}
                </>
              ) : filteredLibrary.length ? (
                <div className="nutrition-result-list">
                  {filteredLibrary.map((item) => resultRow(item))}
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
      {(pane === "detail" || pane === "custom") && (
        <div className="space-y-4 pt-4">
          {pane === "custom" && (
            <label className="nutrition-field">
              Food or meal name
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="My usual breakfast"
              />
            </label>
          )}
          {draft.map((entry, index) => (
            <div key={entry.id} className="space-y-3">
              {pane === "detail" && draft.length > 1 && (
                <p className="text-xs font-semibold text-muted-foreground">
                  {titleCase(entry.meal)}
                </p>
              )}
              <FoodEditor
                editable={pane === "custom" && entry.source !== "fatsecret"}
                disabled={saving}
                entry={entry}
                product={index === 0 ? product : undefined}
                onChange={(next) =>
                  changeDraft(draft.map((old, i) => (i === index ? next : old)))
                }
                onRemove={
                  draft.length > 1 || pane === "custom"
                    ? () => {
                        changeDraft(draft.filter((_, i) => i !== index))
                        setNotes("")
                      }
                    : undefined
                }
              />
            </div>
          ))}
          {existing && pane === "detail" && (
            <div className="space-y-3 rounded-2xl border bg-card p-4">
              <Button
                variant="outline"
                className="w-full rounded-full"
                disabled={saving || !library}
                onClick={() => void toggleExistingFavorite()}
              >
                <Star
                  className={`size-4 ${existingFavorite?.favorite ? "fill-amber-400 text-amber-500" : ""}`}
                />
                {existingFavorite?.favorite
                  ? "Remove from favorites"
                  : "Add to favorites"}
              </Button>
              <label className="nutrition-field">
                Move to meal
                <select
                  aria-label="Move to meal"
                  value={existing.meal}
                  disabled={saving}
                  onChange={(event) =>
                    void moveExistingFood(event.target.value as Meal)
                  }
                >
                  {meals.map((nextMeal) => (
                    <option key={nextMeal} value={nextMeal}>
                      {titleCase(nextMeal)}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="outline"
                className="w-full rounded-full text-destructive"
                disabled={saving}
                onClick={() => void deleteExistingFood()}
              >
                <Trash2 className="size-4" />
                Delete food
              </Button>
            </div>
          )}
          {pane === "custom" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                variant="outline"
                className="w-full rounded-full"
                onClick={() => {
                  setIngredients(
                    draft.filter(
                      (entry) =>
                        entry.name.trim() ||
                        entry.calories ||
                        entry.protein ||
                        entry.carbs ||
                        entry.fat
                    )
                  )
                  setQuery("")
                  setTab("all")
                  setPane("browse")
                  cancel()
                }}
              >
                <Search className="size-4" />
                Search ingredients
              </Button>
              <Button
                variant="outline"
                className="w-full rounded-full"
                onClick={() => changeDraft([...draft, blankFood(meal)])}
              >
                <Plus className="size-4" />
                Add custom ingredient
              </Button>
            </div>
          )}
          {notes && (
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              {notes}
            </p>
          )}
          <div className="nutrition-save-bar">
            <Button
              className={nutritionSaveClass}
              disabled={saving || !draft.length}
              onClick={() => void (pane === "custom" ? saveCustom() : save())}
            >
              {saving && <LoaderCircle className="size-4 animate-spin" />}
              {pane === "custom"
                ? "Save to My foods"
                : ingredients
                  ? "Add to my meal"
                  : existing
                    ? "Save changes"
                    : draft.every((e) => e.meal === draft[0]?.meal)
                      ? `Add to ${titleCase(draft[0]?.meal || meal)}`
                      : "Add foods to log"}
            </Button>
            {pane === "detail" && !existing && !ingredients && (
              <Button
                variant="ghost"
                className="mt-2 w-full rounded-full"
                disabled={saving}
                onClick={() => {
                  setCustomName(
                    customName ||
                      draft
                        .map((e) => e.name)
                        .join(" + ")
                        .slice(0, 180)
                  )
                  setProduct(null)
                  setPane("custom")
                }}
              >
                <Utensils className="size-4" />
                {customId ? "Edit saved meal" : "Save as my food or meal"}
              </Button>
            )}
          </div>
        </div>
      )}
      {aiAvailable === false && tab === "type" && (
        <p className="mt-4 text-sm text-muted-foreground">
          AI food entry is unavailable. Search or add a custom food instead.
        </p>
      )}
      {notice && (
        <p role="status" className="nutrition-notice">
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error}
          {pane === "browse" && tab === "all" && query.trim().length >= 2 && (
            <button
              className="ml-2 underline"
              onClick={() => setSearchRetry((v) => v + 1)}
            >
              Retry search
            </button>
          )}
          {pane === "detail" && detailFatSecretFoodId && !product && (
            <Button
              variant="outline"
              onClick={() => {
                setError("")
                setDetailRetry((value) => value + 1)
              }}
            >
              Retry servings
            </Button>
          )}
        </p>
      )}
      <p className="sr-only">Logging for {date}</p>
    </NutritionScreen>
  )
}
