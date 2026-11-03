import { ListSkeleton } from "@/components/loading-layouts"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { flushSync } from "react-dom"
import {
  Search,
  Star,
  Plus,
  LoaderCircle,
  X,
  Utensils,
  ArrowUp,
  Trash2,
  Check,
  CircleAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MobileFilterTabs } from "@/components/ui/mobile-filter-tabs"
import { FoodEditor } from "./nutrition-food-editor"
import { FoodThumbnail } from "./food-thumbnail"
import { NutritionSearchResult } from "./nutrition-search-result"
import { preferredFoodServing } from "@/lib/food-serving-choice"
import { queuedFoodAdds } from "@/lib/nutrition-add-outbox"
import { portionLabel, scaleFood } from "@/lib/nutrition-math"
import { randomId } from "@/lib/random-id"
import { NutritionScreen, nutritionSaveClass } from "./nutrition-screen"
import { useToastManager } from "@/components/ui/toast"
import {
  loadFoodLibrary,
  searchFoods,
  loadFoodProduct,
  forgetFoodProduct,
  peekFoodSearch,
  peekFoodLibrary,
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
  onReturnToSearch,
  onMoveExisting,
  onDeleteExisting,
}: {
  meal: Meal
  mode: EntryMode
  existing?: FoodEntry
  date: string
  aiAvailable?: boolean
  onClose: () => void
  onSave: (
    entries: FoodEntry[],
    operationId: string,
    returnHome?: boolean
  ) => Promise<void>
  onReturnToSearch?: () => void
  onMoveExisting?: (meal: Meal) => Promise<void>
  onDeleteExisting?: () => Promise<void>
}) {
  const toast = useToastManager()
  const saveLock = useRef(false)
  const acceptedOperation = useRef<string | null>(null)
  const [savePhase, setSavePhase] = useState<"confirming" | "leaving" | "arriving" | undefined>()
  const [affirmation, setAffirmation] = useState<{ verb: "Added" | "Updated"; meal: Meal } | null>(null)
  useEffect(() => {
    if (savePhase !== "arriving") return
    const timer = setTimeout(() => setSavePhase(undefined), 200)
    return () => clearTimeout(timer)
  }, [savePhase])
  const preparingProducts = useRef(new Set<string>())
  const [preparingProduct, setPreparingProduct] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<{ id: string; key?: string; name: string; portion: string; state: "queued" | "saved" | "paused" | "failed" } | null>(null)
  const confirmedAdds = useRef(new Set<string>())
  useEffect(() => {
    const confirmed = (event: Event) => {
      const id = (event as CustomEvent<{ operationId: string }>).detail?.operationId
      if (!id) return
      confirmedAdds.current.add(id)
      if (confirmedAdds.current.size > 60) confirmedAdds.current.delete(confirmedAdds.current.values().next().value!)
      setReceipt(current => current?.id === id ? { ...current, state: "saved" } : current)
    }
    window.addEventListener("nutrition-add-confirmed", confirmed)
    const status = (event: Event) => {
      const state = (event as CustomEvent<{ error?: string }>).detail
      setReceipt(current => {
        if (!current || current.state === "saved") return current
        try {
          const row = queuedFoodAdds(localStorage, deviceCacheScope()).find(row => row.operationId === current.id)
          if (!row) return current
          const next = row.failed ? "failed" : state?.error ? "paused" : "queued"
          return current.state === next ? current : { ...current, state: next }
        } catch { return current }
      })
    }
    window.addEventListener("nutrition-add-status", status)
    return () => {
      window.removeEventListener("nutrition-add-confirmed", confirmed)
      window.removeEventListener("nutrition-add-status", status)
    }
  }, [])
  useEffect(() => {
    if (!receipt || receipt.state !== "saved") return
    const timer = setTimeout(() => setReceipt(null), 1800)
    return () => clearTimeout(timer)
  }, [receipt])
  const acknowledge = (id: string, entries: FoodEntry[], name: string, key?: string, confirmed = false) => setReceipt({ id, name, key, portion: `${entries.length === 1 ? portionLabel(entries[0]) : `${entries.length} foods`} · ${displayNutrient(foodTotals(entries).calories)} kcal`, state: confirmed || confirmedAdds.current.has(id) ? "saved" : "queued" })
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
  const [searchSlow, setSearchSlow] = useState(false)
  const [invalidPortions, setInvalidPortions] = useState<Set<string>>(
    () => new Set()
  )
  const [composing, setComposing] = useState(false)
  const [pane, setPane] = useState<Pane>(
    existing ? "detail" : mode === "manual" ? "custom" : "browse"
  )
  const [query, setQuery] = useState(restoredDraft?.query || ""),
    [text, setText] = useState(restoredDraft?.text || "")

  const [products, setProducts] = useState<FoodProduct[] | null>(
      () => peekFoodSearch(restoredDraft?.query || "")?.products || null
    ),
    [library, setLibrary] = useState<FoodLibrary | null>(() =>
      peekFoodLibrary()
    )
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
    if (existing || draftScope !== deviceCacheScope() || acceptedOperation.current === operation.current) return
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
  const focusedSearchOnOpen = useRef(false)
  const focusSearchOnOpen = useCallback((host: HTMLDivElement | null) => {
    searchHost.current = host
    if (!host || focusedSearchOnOpen.current) return
    focusedSearchOnOpen.current = true
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
    if (
      !detailFatSecretFoodId ||
      (product?.code === detailFatSecretFoodId &&
        product.servings?.some((serving) => serving.catalogReceipt))
    )
      return
    const controller = new AbortController()
    void loadFoodProduct(detailFatSecretFoodId, controller.signal, detailRetry)
      .then((result) => {
        if (!controller.signal.aborted) {
          const selected = preferredFoodServing(result.product)
          setProduct(selected)
          setDraft((current) =>
            current.map((entry) => {
              if (entry.foodId !== result.product.code) return entry
              const serving =
                result.product.servings?.find(
                  (row) => row.id === entry.servingId
                ) ||
                result.product.servings?.find(
                  (row) => row.id === selected.servingId
                )
              if (!serving) return entry
              return {
                ...entry,
                ...scaleFood(
                  foodFromProduct(
                    { ...result.product, servingId: serving.id },
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
  }, [detailFatSecretFoodId, product?.code, product?.servings, detailRetry])
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
    setSearchSlow(false)
    if (!searching) return
    const timer = setTimeout(() => setSearchSlow(true), 2000)
    return () => clearTimeout(timer)
  }, [searching])
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
      timer = setTimeout(
        () => {
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
        },
        peekFoodSearch(query) ? 0 : 120
      )
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
    draft.length > 0 && !draft.some(
      (e) =>
        invalidPortions.has(e.id) ||
        !e.name.trim() ||
        !e.unit.trim() ||
        e.quantity <= 0 ||
        e.missingValues?.length
    )
  async function save(returnToSearch = false) {
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
    const mobile = window.matchMedia("(max-width: 767px)").matches
    const toSearch = existing
      ? mobile && returnToSearch && Boolean(onReturnToSearch)
      : returnToSearch || (mode !== "manual" && tab !== "type")
    const mobileFeedback = toSearch && mobile
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    saveLock.current = true
    setSaving(true)
    setError("")
    const notification = existing && !mobileFeedback
      ? toast.add({
          id: "nutrition-save",
          title: "Saving food…",
          type: "loading",
          timeout: 0,
        })
      : null
    try {
      const storage = getNutritionComposerStorage()
      await onSave(draft, operation.current)
      if (!alive.current || draftScope !== deviceCacheScope()) return
      acceptedOperation.current = operation.current
      clearNutritionComposerDraft(storage, draftScope, date, meal)
      if (!existing || toSearch) {
        acknowledge(operation.current, draft, draft.length === 1 ? draft[0].name : `${draft.length} foods`, draft.length === 1 && draft[0].foodId ? `product-${draft[0].foodId}` : undefined, Boolean(existing))
        if (mobileFeedback) {
          setAffirmation({ verb: existing ? "Updated" : "Added", meal: draft[0]?.meal || meal })
          setSavePhase("confirming")
          // Dismiss the real keyboard only after the accepted intent is durable.
          // Its following blur cannot submit again because saveLock is held.
          const focused = document.activeElement
          if (focused instanceof HTMLInputElement && focused.closest(".nutrition-food-form")) focused.blur()
          await new Promise<void>(resolve => setTimeout(resolve, reducedMotion ? 180 : 360))
          if (!alive.current || draftScope !== deviceCacheScope()) return
          if (!reducedMotion) {
            setSavePhase("leaving")
            await new Promise<void>(resolve => setTimeout(resolve, 120))
          }
        } else if (!reducedMotion)
          await new Promise<void>(resolve => setTimeout(resolve, 180))
      }
      if (notification)
        toast.update(notification, {
          title: "Food saved",
          type: "success",
          description: null,
          timeout: 1200,
        })
      if (!alive.current) return
      if (toSearch) {
        setNotice("")
        setText("")
        changeDraft([])
        setProduct(null)
        setCustomId(null)
        setCustomName("")
        setNotes("")
        if (returnToSearch && tab === "type") setTab("all")
        if (existing) onReturnToSearch?.()
        setPane("browse")
        setAffirmation(null)
        setSavePhase(mobileFeedback && !reducedMotion ? "arriving" : undefined)
      } else onClose()
    } catch (problem) {
      if (notification)
        toast.update(notification, {
          title: "Food needs confirmation",
          description: (problem as Error).message,
          type: "error",
          timeout: 8000,
        })
      if (alive.current) {
        setSavePhase(undefined)
        setAffirmation(null)
        refreshRejectedServing(problem, draft)
        setError((problem as Error).message)
      }
    } finally {
      saveLock.current = false
      if (alive.current) setSaving(false)
    }
  }
  async function quickAdd(key: string, entries: FoodEntry[], name: string) {
    if (saveLock.current) return
    if (draftScope !== deviceCacheScope()) {
      setError("Your account changed. Reopen Add food in the intended account.")
      return
    }
    if (ingredients) {
      addIngredients(entries)
      return
    }
    saveLock.current = true
    setSaving(true)
    setError("")
    let pending = quickOperations.current.get(key)
    if (!pending) {
      pending = {
        id: randomId(),
        entries: entries.map((entry) => ({ ...entry, id: randomId(), meal })),
      }
      quickOperations.current.set(key, pending)
    }
    try {
      getNutritionComposerStorage()
      await onSave(pending.entries, pending.id)
      acknowledge(pending.id, pending.entries, name, key)
      quickOperations.current.delete(key)
      if (alive.current) setNotice("")
    } catch (problem) {
      if (alive.current)
        setError((problem as Error).message || "Could not add " + name)
    } finally {
      saveLock.current = false
      if (alive.current) setSaving(false)
    }
  }
  async function saveLibrary(item: SavedFood) {
    if (saveLock.current) return
    if (draftScope !== deviceCacheScope()) {
      setError("Your account changed. Reopen Add food in the intended account.")
      return
    }
    if (!library) {
      setError("Your food library is still loading.")
      return
    }
    saveLock.current = true
    const notification = toast.add({
      id: "nutrition-save",
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
        timeout: 1200,
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
      if (preparingProducts.current.has(p.code)) return
      preparingProducts.current.add(p.code)
      setPreparingProduct(p.code)
      try {
        const selected = preferredFoodServing(p.source === "fatsecret" && !p.servings?.length ? (await loadFoodProduct(p.code)).product : p)
        if (!selected.complete || (selected.source === "fatsecret" && !selected.servings?.length))
          throw Error("This food's serving information is incomplete. Open its details or choose another result.")
        await quickAdd("product-" + p.code, [foodFromProduct(selected, meal)], p.name)
      } catch (problem) { if (alive.current) setError((problem as Error).message) }
      finally {
        preparingProducts.current.delete(p.code)
        if (alive.current) setPreparingProduct(current => current === p.code ? null : current)
      }
      return
    }
    // Paint known search facts immediately; the serving picker hydrates in place.
    review([foodFromProduct(p, meal)], p)
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
      // The editor owns incomplete numeric text. Returning to results cancels
      // that text; a retained valid food draft must be editable when reopened.
      setInvalidPortions(new Set())
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
  // Adding a food must not move the next quick-add target under the user's finger.
  const [recentItems] = useState(() => recentFoodsForMeal(meal))
  const [frequentItems] = useState(() => recentFoodsForMeal(meal, true))
  function resultRow(item: SavedFood, p?: FoodProduct, servingReady = true) {
    const saved = library?.items.find((i) => i.id === item.id),
      totals = foodTotals(item.entries)
    return (
      <div key={item.id} className="nutrition-result" data-food-added={(receipt?.key === item.id && receipt.state !== "failed" && receipt.state !== "paused") || undefined}>
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
              {!servingReady ? "Loading serving…" : p
                ? p.servingSize || "1 serving"
                : item.entries.length > 1
                  ? `${item.entries.length} foods`
                  : portionLabel(item.entries[0])}
            </span>
            <span style={{ visibility: servingReady ? undefined : "hidden" }} className="nutrition-search-macros mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
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
                    void saveLibrary(productItem(preferredFoodServing(result.product)))
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
          aria-label={receipt?.key === item.id && (receipt.state === "failed" || receipt.state === "paused") ? `Retry adding ${item.name}` : `Add one serving of ${item.name}`}
          disabled={saving || busy || Boolean(p && preparingProduct === p.code)}
          aria-busy={Boolean(p && preparingProduct === p.code)}
          onMouseDown={(event) => {
            if (document.activeElement?.matches('input[type="search"]'))
              event.preventDefault()
          }}
          onClick={() => {
            if (receipt?.key === item.id && (receipt.state === "failed" || receipt.state === "paused")) {
              window.dispatchEvent(new Event("nutrition-write-retry"))
              return
            }
            void (p
              ? loadProduct(p, true)
              : quickAdd(item.id, item.entries, item.name))
          }}
        >
          {p && preparingProduct === p.code ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" /> : receipt?.key === item.id ? (receipt.state === "failed" || receipt.state === "paused" ? <CircleAlert className="size-5 text-destructive" /> : <Check key={receipt.id} className="nutrition-add-check size-5" />) : <Plus className="size-5" />}
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
      transitionPhase={savePhase}
      overlay={affirmation && receipt && (
        <div className="nutrition-save-affirmation" role="status" aria-live="polite" aria-atomic="true" data-state={receipt.state}>
          <span className="nutrition-save-affirmation-icon" aria-hidden="true">
            {receipt.state === "failed" || receipt.state === "paused" ? <CircleAlert /> : <Check />}
          </span>
          <strong>{receipt.state === "failed" || receipt.state === "paused" ? "Retry needed" : `${affirmation.verb} to ${titleCase(affirmation.meal)}`}</strong>
          <span>{receipt.name}</span>
          <span className="nutrition-save-affirmation-portion">{receipt.portion}</span>
          <small>{receipt.state === "saved" ? "Saved to your food log" : receipt.state === "queued" ? "Syncing in the background" : "Your food is retained for retry"}</small>
        </div>
      )}
      feedback={<div className="nutrition-food-feedback" role="status" aria-live="polite" aria-atomic="true">
        {receipt && <div key={receipt.id} className="nutrition-food-receipt" data-state={receipt.state}>
          {receipt.state === "failed" || receipt.state === "paused" ? <CircleAlert className="size-5 shrink-0 text-destructive" aria-hidden="true" /> : <Check className="nutrition-add-check size-5 shrink-0" aria-hidden="true" />}
          <span className="nutrition-food-receipt-food min-w-0"><span className="block truncate">{receipt.name}</span><span className="block truncate">{receipt.portion}</span></span>
          <span className="shrink-0">{receipt.state === "saved" ? "Saved" : receipt.state === "failed" || receipt.state === "paused" ? "Retry needed" : "Added · syncing"}</span>
        </div>}
      </div>}
    >
      {pane === "browse" && (
        <>
          <div className="nutrition-search-controls">
            <div ref={focusSearchOnOpen} className="nutrition-search-host">
              <div className="searchbar nutrition-searchbar"><div className="searchbar-inner"><div className="searchbar-input-wrap">
              <input
                type="search"
                autoComplete="off"
                enterKeyHint="search"
                value={query}
                placeholder="Search foods or brands"
                onInput={(e) => {
                  if (tab === "type") selectTab("all")
                  setQuery(e.currentTarget.value)
                  const cached = peekFoodSearch(e.currentTarget.value)
                  if (cached) {
                    setProducts(cached.products)
                    setSearching(false)
                  }
                }}
              />
                <Search
                  className="nutrition-search-icon"
                />
                {query && (
                  <button
                    className="nutrition-search-clear"
                    aria-label="Clear food search"
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={clearSearch}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div></div></div>
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
              {!!text && tab === "all" && (
                <Button
                  type="button"
                  variant="outline"
                  className="mb-4 w-full"
                  onClick={() => selectTab("type")}
                >
                  Resume typed food entry
                </Button>
              )}
              {tab === "mine" && (
                <Button
                  type="button"
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
                      {searchSlow
                        ? "Food search is taking longer than usual…"
                        : "Searching…"}
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
                      {products.map((p) => <NutritionSearchResult key={p.code} product={p}>{(selected, ready) => resultRow(productItem(selected), selected, ready)}</NutritionSearchResult>)}
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
        <form
          className="nutrition-food-form space-y-4 pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            void (pane === "custom" ? saveCustom() : save(true))
          }}
        >
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
                onSubmit={
                  pane === "detail" && !ingredients
                    ? () => void save(true)
                    : undefined
                }
                product={index === 0 ? product : undefined}
                onValidityChange={(valid) =>
                  setInvalidPortions((current) => {
                    if (current.has(entry.id) === !valid) return current
                    const next = new Set(current)
                    if (valid) next.delete(entry.id)
                    else next.add(entry.id)
                    return next
                  })
                }
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
                type="button"
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
                type="button"
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
                type="button"
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
                type="button"
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
              type="button"
              className={nutritionSaveClass}
              disabled={
                saving ||
                !draft.length ||
                draft.some((entry) => invalidPortions.has(entry.id))
              }
              onClick={() => void (pane === "custom" ? saveCustom() : save())}
            >
              {saving && (receipt?.id === operation.current ? <Check className="nutrition-add-check size-4" /> : <LoaderCircle className="size-4 animate-spin" />)}
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
                type="button"
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
        </form>
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
              type="button"
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
