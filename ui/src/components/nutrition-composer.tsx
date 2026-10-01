import { useEffect, useRef, useState } from "react"
import { Searchbar } from "framework7-react"
import {
  Camera,
  ScanBarcode,
  Search,
  Star,
  Plus,
  LoaderCircle,
  X,
  Utensils,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MobileFilterTabs } from "@/components/ui/mobile-filter-tabs"
import { FoodEditor } from "./nutrition-food-editor"
import { NutritionScanner, prepareMealPhoto } from "./nutrition-scanner"
import { NutritionScreen, nutritionSaveClass } from "./nutrition-screen"
import {
  blankFood,
  displayNutrient,
  foodFromProduct,
  foodTotals,
  nutritionRequest,
  titleCase,
  type FoodEntry,
  type FoodProduct,
  type Meal,
  type SavedFood,
  type FoodLibrary,
} from "@/lib/nutrition"

export type EntryMode = "write" | "search" | "scan" | "photo" | "manual"
type Tab = "all" | "favorites" | "mine" | "type"
type Pane = "browse" | "scan" | "photo" | "detail" | "custom"
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
  fixedMeal = false,
  onClose,
  onSave,
}: {
  meal: Meal
  mode: EntryMode
  existing?: FoodEntry
  date: string
  aiAvailable: boolean
  fixedMeal?: boolean
  onClose: () => void
  onSave: (entries: FoodEntry[], operationId: string) => Promise<void>
}) {
  const [searchRetry, setSearchRetry] = useState(0)
  const [tab, setTab] = useState<Tab>(mode === "write" ? "type" : "all")
  const [pane, setPane] = useState<Pane>(
    existing
      ? "detail"
      : mode === "scan"
        ? "scan"
        : mode === "photo"
          ? "photo"
          : mode === "manual"
            ? "custom"
            : "browse"
  )
  const [query, setQuery] = useState(""),
    [text, setText] = useState(""),
    [photo, setPhoto] = useState<string | null>(null)
  const [products, setProducts] = useState<FoodProduct[] | null>(null),
    [library, setLibrary] = useState<FoodLibrary | null>(null)
  const [draft, setDraft] = useState<FoodEntry[]>(
    existing ? [existing] : mode === "manual" ? [blankFood(meal)] : []
  )
  const [product, setProduct] = useState<FoodProduct | null>(null),
    [customId, setCustomId] = useState<string | null>(null),
    [customName, setCustomName] = useState("")
  const [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false)
  const alive = useRef(true),
    request = useRef<AbortController | null>(null),
    operation = useRef<string>(crypto.randomUUID()),
    photoVersion = useRef(0)
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
  const changeDraft = (next: FoodEntry[]) => {
    operation.current = crypto.randomUUID()
    setDraft(next)
  }
  const cancel = () => {
    request.current?.abort()
    request.current = null
    photoVersion.current++
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
    setTab(next)
    setPane("browse")
  }
  function selectPane(next: Pane) {
    cancel()
    setPane(next)
  }
  function review(entries: FoodEntry[], p: FoodProduct | null = null) {
    cancel()
    changeDraft(entries)
    setProduct(p)
    setCustomId(null)
    setNotes("")
    setPane("detail")
  }
  function lookup(code: string) {
    void run(
      (signal) =>
        nutritionRequest<{ product: FoodProduct }>(
          `/product?barcode=${code}`,
          undefined,
          signal
        ),
      (result) => {
        if (!result.product.complete) {
          setError(
            "This product has an incomplete nutrition label. Try another product or create it in My foods."
          )
          return
        }
        review([foodFromProduct(result.product, meal)], result.product)
      }
    )
  }
  const estimate = () =>
    run(
      (signal) =>
        nutritionRequest<{ entries: FoodEntry[]; notes: string }>(
          "/estimate",
          {
            text,
            meal,
            ...(pane === "photo" && photo ? { image: photo } : {}),
          },
          signal
        ),
      (result) => {
        if (!result.entries.length) {
          setError(result.notes || "No food found. Add more detail.")
          return
        }
        review(
          fixedMeal
            ? result.entries.map((entry) => ({ ...entry, meal }))
            : result.entries
        )
        setNotes(result.notes)
      }
    )
  async function photoFile(file: File) {
    const version = ++photoVersion.current
    setBusy(true)
    setError("")
    try {
      const image = await prepareMealPhoto(file)
      if (alive.current && version === photoVersion.current) setPhoto(image)
    } catch (e) {
      if (alive.current && version === photoVersion.current)
        setError((e as Error).message)
    } finally {
      if (alive.current && version === photoVersion.current) setBusy(false)
    }
  }
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
    setSaving(true)
    setError("")
    try {
      await onSave(draft, operation.current)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (alive.current) setSaving(false)
    }
  }
  async function quickAdd(key: string, entries: FoodEntry[], name: string) {
    if (saving) return
    setSaving(true)
    setError("")
    let pending = quickOperations.current.get(key)
    if (!pending) {
      pending = {
        id: crypto.randomUUID(),
        entries: entries.map((e) => ({ ...e, id: crypto.randomUUID(), meal })),
      }
      quickOperations.current.set(key, pending)
    }
    try {
      await onSave(pending.entries, pending.id)
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
    if (!valid() || !customName.trim()) {
      setError("Name your food or meal and enter its macros.")
      return
    }
    const saved = await saveLibrary({
      id: customId || crypto.randomUUID(),
      name: customName,
      entries: draft,
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
  function resultRow(item: SavedFood, p?: FoodProduct) {
    const saved = library?.items.find((i) => i.id === item.id),
      totals = foodTotals(item.entries)
    return (
      <div key={item.id} className="nutrition-result">
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => {
            if (item.custom) {
              review(
                item.entries.map((e) => ({
                  ...e,
                  id: crypto.randomUUID(),
                  meal,
                }))
              )
              setCustomId(item.id)
              setCustomName(item.name)
            } else
              review(
                item.entries.map((e) => ({
                  ...e,
                  id: crypto.randomUUID(),
                  meal,
                })),
                p || null
              )
          }}
          aria-label={`Details for ${item.name}`}
        >
          <span className="block text-sm font-medium">{item.name}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {p?.brand ? `${p.brand} · ` : ""}
            {p
              ? p.servingQuantity
                ? `1 serving · ${p.servingQuantity} ${p.unit}`
                : `100 ${p.unit} · serving not listed`
              : item.entries.length > 1
                ? `${item.entries.length} foods`
                : `${item.entries[0].quantity} ${item.entries[0].unit}`}
          </span>
          <span className="mt-1.5 block text-xs text-muted-foreground">
            {displayNutrient(totals.calories)} kcal ·{" "}
            {displayNutrient(totals.protein)} P ·{" "}
            {displayNutrient(totals.carbs)} C · {displayNutrient(totals.fat)} F
          </span>
        </button>
        <button
          className="nutrition-row-action"
          aria-label={`${saved?.favorite ? "Unstar" : "Star"} ${item.name}`}
          aria-pressed={Boolean(saved?.favorite)}
          disabled={saving || !library}
          onClick={() =>
            void saveLibrary({ ...(saved || item), favorite: !saved?.favorite })
          }
        >
          <Star
            className={`size-4 ${saved?.favorite ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`}
          />
        </button>
        <button
          className="nutrition-row-action bg-muted/70"
          aria-label={`Add one serving of ${item.name}`}
          disabled={saving}
          onClick={() => void quickAdd(item.id, item.entries, item.name)}
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
            : pane === "scan"
              ? "Scan barcode"
              : pane === "photo"
                ? "Meal photo"
                : "Add food"
      }
      onBack={back}
      onExit={onClose}
      right={
        <div
          className="nutrition-action-group liquid-glass-button"
          role="group"
          aria-label="Food scanners"
        >
          <button
            aria-label="Scan barcode"
            disabled={saving}
            onClick={() => selectPane("scan")}
          >
            <ScanBarcode className="size-5" />
          </button>
          <button
            aria-label="Take meal photo"
            disabled={saving}
            onClick={() => selectPane("photo")}
          >
            <Camera className="size-5" />
          </button>
        </div>
      }
    >
      {pane === "browse" && (
        <>
          {tab !== "type" && (
            <Searchbar
              className="nutrition-searchbar"
              form={false}
              customSearch
              backdrop={false}
              disableButton={false}
              clearButton={false}
              value={query}
              placeholder="Search foods or brands"
              onInput={(e) => setQuery(e.target.value)}
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
          )}
          <MobileFilterTabs
            label="Food library"
            items={tabs}
            value={tab}
            onChange={selectTab}
            inline
          />
          {tab === "type" ? (
            <div className="space-y-4 pt-6">
              <label className="block text-sm font-medium">
                What did you eat?
                <textarea
                  autoFocus
                  aria-label="Meal description"
                  className="nutrition-textarea mt-3"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Lunch was 200g white rice, 2 eggs and 3 scoops Tailwind. Dinner was 3 slices of Pizza Hut pizza."
                />
              </label>
              <Button
                className={nutritionSaveClass}
                disabled={busy || !text.trim() || !aiAvailable}
                onClick={() => void estimate()}
              >
                {busy && <LoaderCircle className="size-4 animate-spin" />}
                {busy ? "Searching…" : "Search"}
              </Button>
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
                    setPane("custom")
                  }}
                >
                  <Plus className="size-4" />
                  Create food or meal
                </Button>
              )}
              {tab === "all" ? (
                <>
                  {busy ? (
                    <p role="status" className="nutrition-empty">
                      <LoaderCircle className="mx-auto mb-2 size-5 animate-spin" />
                      Searching foods…
                    </p>
                  ) : products?.length ? (
                    <div className="nutrition-result-list">
                      {products.map((p) => resultRow(productItem(p), p))}
                    </div>
                  ) : (
                    <div className="nutrition-empty">
                      <Search className="mx-auto mb-3 size-7 opacity-40" />
                      {query.trim().length < 2
                        ? "Search for a food or brand."
                        : "No complete matches found. Try a specific product, or use Type for an editable estimate."}
                    </div>
                  )}
                </>
              ) : filteredLibrary.length ? (
                <div className="nutrition-result-list">
                  {filteredLibrary.map((item) => resultRow(item))}
                </div>
              ) : (
                <p className="nutrition-empty">
                  {tab === "favorites"
                    ? "Star foods to keep them here."
                    : "Save your own foods and meals here."}
                </p>
              )}
            </div>
          )}
        </>
      )}
      {pane === "scan" && (
        <div className="space-y-5 pt-4">
          <NutritionScanner onCode={lookup} />
          {busy && (
            <p
              role="status"
              className="flex items-center justify-center gap-2 text-sm"
            >
              <LoaderCircle className="size-4 animate-spin" />
              Finding your food…
            </p>
          )}
        </div>
      )}
      {pane === "photo" && (
        <div className="space-y-4 pt-4">
          {photo ? (
            <div className="relative overflow-hidden rounded-3xl bg-white">
              <img
                src={photo}
                alt="Meal to estimate"
                className="max-h-80 w-full object-contain"
              />
              <button
                className="nutrition-row-action absolute top-3 right-3 bg-white"
                aria-label="Remove photo"
                onClick={() => setPhoto(null)}
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <label className="nutrition-photo-picker">
              <Camera className="size-10 text-muted-foreground" />
              <span className="font-medium">Take or choose a meal photo</span>
              <span className="text-xs text-muted-foreground">
                Include the whole plate for a better estimate
              </span>
              <input
                aria-label="Meal photo"
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void photoFile(file)
                  e.target.value = ""
                }}
              />
            </label>
          )}
          <textarea
            aria-label="Photo details"
            className="nutrition-textarea"
            placeholder="Anything to add? Portions, ingredients, cooking oil…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            className={nutritionSaveClass}
            disabled={busy || !photo || !aiAvailable}
            onClick={() => void estimate()}
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {busy ? "Estimating…" : "Review food"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Photo estimates use OpenAI. Review portions before saving.
          </p>
        </div>
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
            <FoodEditor
              key={entry.id}
              editable={pane === "custom"}
              disabled={saving}
              entry={entry}
              product={index === 0 ? product : undefined}
              onChange={(next) =>
                changeDraft(draft.map((old, i) => (i === index ? next : old)))
              }
              onRemove={
                draft.length > 1
                  ? () => {
                      changeDraft(draft.filter((_, i) => i !== index))
                      setNotes("")
                    }
                  : undefined
              }
            />
          ))}
          {pane === "custom" && (
            <Button
              variant="outline"
              className="w-full rounded-full"
              onClick={() => changeDraft([...draft, blankFood(meal)])}
            >
              <Plus className="size-4" />
              Add another food to this meal
            </Button>
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
                : existing
                  ? "Save changes"
                  : draft.every((e) => e.meal === draft[0]?.meal)
                    ? `Add to ${titleCase(draft[0]?.meal || meal)}`
                    : "Add foods to log"}
            </Button>
            {pane === "detail" && !existing && (
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
          {draft.some((e) => e.source === "openfoodfacts") && (
            <p className="text-center text-[11px] text-muted-foreground">
              <a
                href="https://world.openfoodfacts.org/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Open Food Facts
              </a>{" "}
              ·{" "}
              <a
                href="https://opendatacommons.org/licenses/odbl/1-0/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                ODbL
              </a>{" "}
              · Product images CC BY-SA
            </p>
          )}
        </div>
      )}
      {!aiAvailable && (tab === "type" || pane === "photo") && (
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
