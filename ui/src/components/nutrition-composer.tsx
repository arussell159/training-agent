import "@/lib/framework7-searchbar"
import { ListSkeleton } from "@/components/loading-layouts"
import { useCallback, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Searchbar } from "framework7-react"
import { Search, Star, Plus, LoaderCircle, X, Utensils, ArrowUp, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MobileFilterTabs } from "@/components/ui/mobile-filter-tabs"
import { FoodEditor } from "./nutrition-food-editor"
import { FoodThumbnail } from "./food-thumbnail"
import { portionLabel } from "@/lib/nutrition-math"
import { randomId } from "@/lib/random-id"
import { NutritionScreen, nutritionSaveClass } from "./nutrition-screen"
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
  const [searchRetry, setSearchRetry] = useState(0)
  const [tab, setTab] = useState<Tab>(mode === "write" ? "type" : "all")
  const [pane, setPane] = useState<Pane>(
    existing ? "detail" : mode === "manual" ? "custom" : "browse"
  )
  const [query, setQuery] = useState(""),
    [text, setText] = useState("")

  const [products, setProducts] = useState<FoodProduct[] | null>(null),
    [library, setLibrary] = useState<FoodLibrary | null>(null)
  const [draft, setDraft] = useState<FoodEntry[]>(
    existing ? [existing] : mode === "manual" ? [blankFood(meal)] : []
  )
  const [product, setProduct] = useState<FoodProduct | null>(null),
    [customId, setCustomId] = useState<string | null>(null),
    [customName, setCustomName] = useState("")
  const [ingredients, setIngredients] = useState<FoodEntry[] | null>(null)
  const [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false)
  const alive = useRef(true),
    request = useRef<AbortController | null>(null),
    operation = useRef<string>(randomId())
  const searchHost = useRef<HTMLDivElement>(null)
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
    const input = searchHost.current?.querySelector<HTMLInputElement>('input[type="search"]')
    if (!input) return
    input.enterKeyHint = "send"
    const submit = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !query.trim()) return
      event.preventDefault()
      setSearchRetry((value) => value + 1)
      input.blur()
    }
    input.addEventListener("keydown", submit)
    return () => input.removeEventListener("keydown", submit)
  }, [pane, tab, query])
  const quickOperations = useRef(
    new Map<string, { entries: FoodEntry[]; id: string }>()
  )
  useEffect(() => {
    alive.current = true
    void nutritionRequest<FoodLibrary>("/library")
      .then(setLibrary)
      .catch((e) => setError(e.message))
    return () => {
      alive.current = false
      request.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (!detailFatSecretFoodId || product?.code === detailFatSecretFoodId) return
    const controller = new AbortController()
    void nutritionRequest<{ product: FoodProduct }>(
      `/product?id=${encodeURIComponent(detailFatSecretFoodId)}`,
      undefined,
      controller.signal
    )
      .then((result) => {
        if (!controller.signal.aborted) setProduct(result.product)
    })
      .catch((e) => {
        if (!controller.signal.aborted && alive.current)
          setError(e instanceof Error ? e.message : "Could not load servings.")
      })
    return () => controller.abort()
  }, [detailFatSecretFoodId, product?.code])
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
    if (tab !== "all" || pane !== "browse" || query.trim().length < 2) {
      setProducts(null)
      return
    }
    setBusy(true)
    setError("")
    const controller = new AbortController(),
      timer = setTimeout(() => {
        void nutritionRequest<{ products: FoodProduct[] }>(
          `/search?q=${encodeURIComponent(query.trim())}`,
          undefined,
          controller.signal
        )
          .then((result) => {
            if (!controller.signal.aborted)
              setProducts(result.products.filter((p) => p.complete))
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message)
          })
          .finally(() => {
            if (!controller.signal.aborted) setBusy(false)
          })
      }, 750)
    return () => {
      clearTimeout(timer)
      controller.abort()
      setBusy(false)
    }
  }, [query, tab, pane, searchRetry])
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
    if (!valid()) {
      setError("Check the food names, portions and macros.")
      return
    }
    if (ingredients) {
      addIngredients(draft)
      return
    }
    setSaving(true)
    setError("")
    try {
      await onSave(draft, operation.current)
      if (!existing) recordRecentFoods(draft)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (alive.current) setSaving(false)
    }
  }
  async function quickAdd(key: string, entries: FoodEntry[], name: string) {
    if (saving) return
    if (ingredients) {
      addIngredients(entries)
      return
    }
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
      await onSave(pending.entries, pending.id)
      recordRecentFoods(pending.entries)
      quickOperations.current.delete(key)
      setNotice(`Added ${name} to ${titleCase(meal)}.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (alive.current) setSaving(false)
    }
  }
  async function saveLibrary(item: SavedFood) {
    if (!library) {
      setError("Your food library is still loading.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const result = await nutritionRequest<FoodLibrary>("/library", {
        action: "save",
        item,
        revision: library.revision,
      })
      setLibrary(result)
      return true
    } catch (e) {
      setError((e as Error).message)
      void nutritionRequest<FoodLibrary>("/library")
        .then(setLibrary)
        .catch(() => {})
    } finally {
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
      setNotice("Saved to My foods.")
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
    await run(
      (signal) =>
        nutritionRequest<{ product: FoodProduct }>(
          `/product?id=${encodeURIComponent(p.code)}`,
          undefined,
          signal
        ),
      (result) => {
        if (!result.product.complete || !result.product.servingId)
          throw Error("This food has no complete serving. Try another match.")
        const entry = foodFromProduct(result.product, meal)
        if (addNow) void quickAdd(`product-${p.code}`, [entry], p.name)
        else review([entry], result.product)
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
            id: `diary-${existing.foodId || existing.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60)}`,
            name: existing.name,
            entries: [existing],
            favorite: true,
            custom: false,
          }
    )
  }
  const recentItems = recentFoodsForMeal(meal)
  function resultRow(item: SavedFood, p?: FoodProduct) {
    const saved = library?.items.find((i) => i.id === item.id),
      totals = foodTotals(item.entries)
    return (
      <div key={item.id} className="nutrition-result">
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
            <span className="mt-1.5 block text-[13px] text-muted-foreground tabular-nums">
              {displayNutrient(totals.calories)} kcal ·{" "}
              {displayNutrient(totals.protein)} P ·{" "}
              {displayNutrient(totals.carbs)} C · {displayNutrient(totals.fat)}{" "}
              F
            </span>
          </span>
        </button>
        <button
          className="nutrition-row-action"
          aria-label={`${saved?.favorite ? "Unstar" : "Star"} ${item.name}`}
          aria-pressed={Boolean(saved?.favorite)}
          disabled={saving || !library}
          onClick={() =>
            void (p && !saved
              ? run(
                  (signal) =>
                    nutritionRequest<{ product: FoodProduct }>(
                      `/product?id=${encodeURIComponent(p.code)}`,
                      undefined,
                      signal
                    ),
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
            <div ref={searchHost} className="nutrition-search-host">
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
                onSearchbarClear={() => setQuery("")}
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
                    onClick={() => setQuery("")}
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
                      (item) => item.value === "all" || item.value === "favorites"
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
                      ) return
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
                  {query.trim().length < 2 && recentItems.length ? (
                    <section aria-label={`Recent ${meal} foods`}>
                      <h2 className="mb-3 text-sm font-semibold">
                        Recent for {meal}
                      </h2>
                      <div className="nutrition-result-list">
                        {recentItems.map((item) => resultRow(item))}
                      </div>
                    </section>
                  ) : busy ? (
                    <ListSkeleton food />
                  ) : products?.length ? (
                    <div className="nutrition-result-list">
                      {products.map((p) => resultRow(productItem(p), p))}
                    </div>
                  ) : (
                    <div className="nutrition-empty">
                      <Search className="mx-auto mb-3 size-7 opacity-40" />
                      {query.trim().length < 2
                        ? "Search for a food or brand."
                        : "No complete matches found. Try a more specific food or brand."}
                    </div>
                  )}
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
          {pane === "browse" && tab === "all" && (
            <button
              className="ml-2 underline"
              onClick={() => setSearchRetry((v) => v + 1)}
            >
              Retry search
            </button>
          )}
        </p>
      )}
      <p className="sr-only">Logging for {date}</p>
    </NutritionScreen>
  )
}
