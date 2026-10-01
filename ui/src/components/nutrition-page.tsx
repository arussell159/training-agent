import { useEffect, useRef, useState } from "react"
import "./nutrition.css"
import {
  Camera,
  Ellipsis,
  Coffee,
  Cookie,
  Flame,
  LoaderCircle,
  Moon,
  Pencil,
  Plus,
  ScanBarcode,
  Search,
  Sun,
  Trash2,
  Utensils,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { NutritionScreen, nutritionSaveClass } from "./nutrition-screen"
import { NutritionDateHeader } from "./nutrition-date-header"
import { NutritionComposer, type EntryMode } from "./nutrition-composer"
import { MacroBars } from "./nutrition-summary"
import {
  displayNutrient,
  foodTotals,
  meals,
  nutritionChanged,
  nutritionRequest,
  nutritionToday,
  suggestedMeal,
  nutrientKeys,
  titleCase,
  useNutrition,
  useExerciseCalories,
  type FoodEntry,
  type Meal,
  type NutritionDay,
  type Targets,
} from "@/lib/nutrition"
import { calorieGoal } from "@/lib/nutrition-math"

const mealIcons = {
  breakfast: Coffee,
  lunch: Sun,
  dinner: Moon,
  snacks: Cookie,
}
function TargetEditor({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const { data, error: loadError } = useNutrition(nutritionToday())
  const [values, setValues] = useState<Targets | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const current = values || data?.targets
  async function save() {
    if (!data || !current) return
    setBusy(true)
    setError("")
    try {
      await nutritionRequest("/targets", {
        targets: { ...current, fiber: null },
        revision: data.targetsRevision,
        effectiveDate: nutritionToday(),
      })
      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <NutritionScreen
      title="Daily targets"
      onBack={() => {
        if (!busy) onClose()
      }}
    >
      <p className="mt-3 mb-5 text-sm text-muted-foreground">
        Base targets apply from today onward. Completed workout calories are
        added automatically.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {nutrientKeys
          .filter((key) => key !== "fiber")
          .map((key) => (
            <label className="nutrition-field" key={key}>
              {titleCase(key)} ({key === "calories" ? "kcal" : "g"})
              <Input
                aria-label={titleCase(key) + " target"}
                type="number"
                min="0"
                max={key === "calories" ? 20000 : 3000}
                step="any"
                placeholder="No target"
                disabled={busy || !data}
                value={current?.[key] ?? ""}
                onChange={(e) =>
                  setValues({
                    ...current!,
                    [key]:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        <Button
          type="submit"
          disabled={busy || !data}
          className={nutritionSaveClass}
        >
          {busy && <LoaderCircle className="size-4 animate-spin" />}Save targets
        </Button>
        {(error || loadError) && (
          <p role="alert" className="text-sm text-destructive">
            {error || loadError}
          </p>
        )}
      </form>
    </NutritionScreen>
  )
}

export function NutritionPage() {
  const [foodActions, setFoodActions] = useState<FoodEntry | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    held = useRef(false),
    holdPoint = useRef({ x: 0, y: 0 })
  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
  }
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current)
    },
    []
  )

  const [date, setDate] = useState(nutritionToday),
    { data, error, loading, reload, setData } = useNutrition(date)
  const [composer, setComposer] = useState<{
      mode: EntryMode
      meal: Meal
      existing?: FoodEntry
      fixedMeal?: boolean
    } | null>(null),
    [targetsOpen, setTargetsOpen] = useState(false),
    [mutationError, setMutationError] = useState(""),
    [mutating, setMutating] = useState(false),
    [deleted, setDeleted] = useState<FoodEntry | null>(null)
  const exercise = useExerciseCalories(date)
  const totals = foodTotals(data?.day.entries || []),
    target = calorieGoal(data?.targets.calories, exercise),
    remaining = target == null ? null : target - totals.calories
  const ratio = target ? Math.min(1, totals.calories / target) : 0
  const add = (mode: EntryMode, meal?: Meal) => {
    setMutationError("")
    setComposer({
      mode,
      meal: meal || suggestedMeal(),
      fixedMeal: Boolean(meal),
    })
  }
  async function change(
    action: "add" | "update" | "delete",
    entries?: FoodEntry[],
    id?: string,
    operationId: string = crypto.randomUUID()
  ) {
    if (!data) throw Error("Wait for your food log to load.")
    setMutating(true)
    setMutationError("")
    try {
      const result = await nutritionRequest<{ day: NutritionDay }>("/entries", {
        date,
        action,
        entries,
        id,
        operationId,
        revision: data.day.revision,
      })
      setData({
        ...data,
        day: result.day,
        week: data.week.map((day) =>
          day.date === date
            ? {
                ...day,
                logged: result.day.entries.length > 0,
                totals: foodTotals(result.day.entries),
              }
            : day
        ),
      })
      nutritionChanged()
    } finally {
      setMutating(false)
    }
  }
  async function remove(entry: FoodEntry) {
    try {
      await change("delete", undefined, entry.id)
      setDeleted(entry)
      setFoodActions(null)
    } catch (e) {
      setMutationError((e as Error).message)
    }
  }
  const selectDate = (next: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return
    setDeleted(null)
    setMutationError("")
    setDate(next)
  }
  const maximum = Math.max(
    target || 0,
    ...(data?.week.map((day) => day.totals.calories) || []),
    1
  )
  return (
    <div className="nutrition-surface nutrition-dashboard home-dashboard-shell w-full min-w-0">
      <NutritionDateHeader
        date={date}
        onSelect={selectDate}
        disabled={mutating}
        onTargets={() => setTargetsOpen(true)}
      />
      <div className="mobile-dashboard mx-auto max-w-5xl space-y-5 px-4 pt-4 pb-8 md:px-8">
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-2xl border p-4 text-sm"
          >
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={reload}>
              Retry
            </Button>
          </div>
        )}
        {!data && !error && (
          <div
            role="status"
            className="grid min-h-60 place-items-center rounded-3xl border bg-card text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-2">
              <LoaderCircle className="size-4 animate-spin" />
              Loading your food log…
            </span>
          </div>
        )}
        {data && (
          <>
            <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
              <Card className="order-1 gap-0 rounded-3xl border p-5 shadow-sm">
                <div className="flex items-center gap-5 pb-5">
                  <div className="relative size-36 shrink-0">
                    <svg
                      viewBox="0 0 160 160"
                      className="size-full -rotate-90"
                      aria-hidden="true"
                    >
                      <circle
                        cx="80"
                        cy="80"
                        r="68"
                        fill="none"
                        stroke="currentColor"
                        className="text-muted"
                        strokeWidth="10"
                      />
                      <circle
                        cx="80"
                        cy="80"
                        r="68"
                        fill="none"
                        stroke="#71ae70"
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={`${ratio * 427.26} 427.26`}
                        className="transition-[stroke-dasharray] duration-500"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <Flame className="mb-1 size-4 text-amber-500" />
                      <span className="text-3xl font-semibold tracking-tight tabular-nums">
                        {displayNutrient(
                          remaining === null
                            ? totals.calories
                            : Math.abs(remaining)
                        )}
                      </span>
                      <span className="mt-1 text-[11px] text-muted-foreground">
                        {remaining === null
                          ? "kcal eaten"
                          : remaining < 0
                            ? "kcal over target"
                            : "kcal remaining"}
                      </span>
                    </div>
                  </div>
                  <dl className="min-w-0 flex-1 divide-y">
                    <div className="flex justify-between gap-2 py-2.5 text-sm">
                      <dt className="text-muted-foreground">Eaten</dt>
                      <dd className="font-semibold tabular-nums">
                        {displayNutrient(totals.calories)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2 py-2.5 text-sm">
                      <dt className="text-muted-foreground">Target</dt>
                      <dd className="font-semibold tabular-nums">
                        {target == null ? (
                          <button
                            className="text-xs text-emerald-700 underline"
                            onClick={() => setTargetsOpen(true)}
                          >
                            Set target
                          </button>
                        ) : (
                          displayNutrient(target)
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                {exercise > 0 && (
                  <p className="mb-4 text-xs text-muted-foreground">
                    Includes {displayNutrient(exercise)} kcal from completed
                    workouts.
                  </p>
                )}
                <div className="border-t pt-4">
                  <MacroBars totals={totals} targets={data.targets} />
                </div>
              </Card>
              <Card className="order-3 gap-4 rounded-3xl border p-5 shadow-sm lg:order-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">Last 7 days</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Calories logged
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {target
                      ? `Target ${displayNutrient(target)}`
                      : "No target set"}
                  </span>
                </div>
                <div
                  className="relative grid h-36 grid-cols-7 items-end gap-2"
                  aria-label="Calories logged over the last seven days"
                >
                  {data.week.map((day) => (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => selectDate(day.date)}
                      disabled={mutating}
                      aria-label={`${day.date}: ${day.logged ? Math.round(day.totals.calories) + " calories" : "no food logged"}`}
                      className="relative flex h-full flex-col items-center justify-end gap-2"
                    >
                      <span className="text-[9px] text-muted-foreground tabular-nums">
                        {day.logged
                          ? displayNutrient(day.totals.calories)
                          : "—"}
                      </span>
                      <span
                        className={`w-full max-w-6 rounded-full ${day.date === date ? "bg-emerald-500" : "bg-emerald-200"}`}
                        style={{
                          height: `${day.logged ? Math.max(4, (day.totals.calories / maximum) * 94) : 4}px`,
                          opacity: day.logged ? 1 : 0.35,
                        }}
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(`${day.date}T12:00:00`).toLocaleDateString(
                          undefined,
                          { weekday: "short" }
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  A dash means nothing has been logged.
                </p>
              </Card>
              <section
                className="order-2 space-y-3 lg:order-3 lg:col-span-2"
                aria-label="Add food"
              >
                <button
                  type="button"
                  onClick={() => add("write")}
                  className="flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      Add food
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      Search, scan, or describe a meal
                    </span>
                  </span>
                  <Plus className="size-5 text-muted-foreground" />
                </button>
                <div className="grid grid-cols-3 gap-3">
                  {(
                    [
                      {
                        mode: "scan",
                        label: "Scan barcode",
                        icon: ScanBarcode,
                      },
                      { mode: "search", label: "Search food", icon: Search },
                      { mode: "photo", label: "Meal photo", icon: Camera },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.mode}
                      type="button"
                      className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border bg-card p-3 text-xs font-medium shadow-sm"
                      onClick={() => add(item.mode)}
                    >
                      <item.icon className="size-5 text-muted-foreground" />
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>
            </div>
            <section className="space-y-3" aria-label="Daily meals">
              <div className="flex items-center justify-between pt-1">
                <h2 className="text-lg font-semibold">Your meals</h2>
                <span className="text-xs text-muted-foreground">
                  {data.day.entries.length} food
                  {data.day.entries.length === 1 ? "" : "s"}
                </span>
              </div>
              {meals.map((meal) => {
                const entries = data.day.entries.filter((e) => e.meal === meal),
                  subtotal = foodTotals(entries),
                  Icon = mealIcons[meal]
                return (
                  <Card
                    key={meal}
                    className="gap-0 overflow-hidden rounded-2xl py-0 shadow-sm"
                  >
                    <div className="flex items-center gap-3 p-4">
                      <Icon className="size-4 text-muted-foreground" />
                      <h3 className="flex-1 text-sm font-semibold">
                        {titleCase(meal)}
                      </h3>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {displayNutrient(subtotal.calories)} kcal
                      </span>
                      <Button
                        variant="secondary"
                        size="icon-sm"
                        className="rounded-full"
                        aria-label={`Add ${meal}`}
                        disabled={mutating}
                        onClick={() => add("write", meal)}
                      >
                        <Plus />
                      </Button>
                    </div>
                    {entries.length ? (
                      <div className="divide-y border-t">
                        {entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="flex items-center gap-3 px-4 py-3"
                          >
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                              onClick={() => {
                                if (held.current) {
                                  held.current = false
                                  return
                                }
                                setComposer({
                                  mode: "manual",
                                  meal: entry.meal,
                                  existing: entry,
                                })
                              }}
                              disabled={mutating}
                              aria-label={`Edit ${entry.name}`}
                              onPointerDown={(event) => {
                                if (event.button !== 0) return
                                held.current = false
                                cancelHold()
                                holdPoint.current = {
                                  x: event.clientX,
                                  y: event.clientY,
                                }
                                holdTimer.current = setTimeout(() => {
                                  held.current = true
                                  setFoodActions(entry)
                                }, 550)
                              }}
                              onPointerMove={(event) => {
                                if (
                                  Math.hypot(
                                    event.clientX - holdPoint.current.x,
                                    event.clientY - holdPoint.current.y
                                  ) > 8
                                )
                                  cancelHold()
                              }}
                              onPointerUp={cancelHold}
                              onPointerCancel={cancelHold}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                cancelHold()
                                setFoodActions(entry)
                              }}
                            >
                              {entry.imageUrl ? (
                                <img
                                  src={entry.imageUrl}
                                  alt=""
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  className="size-11 shrink-0 rounded-xl object-contain"
                                />
                              ) : (
                                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted/50">
                                  <Utensils className="size-4 text-muted-foreground" />
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium">
                                  {entry.name}
                                </span>
                                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                  {entry.quantity} {entry.unit}
                                  {entry.source === "ai" ? " · estimated" : ""}
                                </span>
                                <span className="mt-1 flex gap-2 text-[10px] tabular-nums">
                                  <span className="text-rose-600">
                                    {displayNutrient(entry.protein)} P
                                  </span>
                                  <span className="text-amber-700">
                                    {displayNutrient(entry.carbs)} C
                                  </span>
                                  <span className="text-blue-600">
                                    {displayNutrient(entry.fat)} F
                                  </span>
                                </span>
                              </span>
                              <span className="text-right text-sm font-semibold tabular-nums">
                                {displayNutrient(entry.calories)}
                                <span className="block text-[10px] font-normal text-muted-foreground">
                                  kcal
                                </span>
                              </span>
                              <Pencil className="hidden size-3 text-muted-foreground sm:block" />
                            </button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${entry.name}`}
                              disabled={mutating}
                              onClick={() => setFoodActions(entry)}
                            >
                              <Ellipsis className="size-4 text-muted-foreground" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => add("write", meal)}
                        className="border-t border-dashed px-4 py-4 text-left text-xs text-muted-foreground"
                      >
                        Nothing logged yet. Add your{" "}
                        {meal === "snacks" ? "snacks" : meal}.
                      </button>
                    )}
                  </Card>
                )
              })}
            </section>
            {deleted && (
              <div
                role="status"
                className="flex items-center justify-between gap-3 rounded-xl bg-muted p-3 text-sm"
              >
                <span>Removed {deleted.name}.</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mutating || loading}
                  onClick={() => {
                    void change("add", [deleted])
                      .then(() => setDeleted(null))
                      .catch((e) => setMutationError(e.message))
                  }}
                >
                  Undo
                </Button>
              </div>
            )}
            {mutationError && (
              <p role="alert" className="text-sm text-destructive">
                {mutationError}{" "}
                <button className="underline" onClick={reload}>
                  Reload log
                </button>
              </p>
            )}
          </>
        )}
      </div>
      {composer && data && (
        <NutritionComposer
          {...composer}
          date={date}
          aiAvailable={data.aiAvailable}
          onClose={() => setComposer(null)}
          onSave={async (entries, operationId) =>
            change(
              composer.existing ? "update" : "add",
              entries,
              undefined,
              operationId
            )
          }
        />
      )}
      {targetsOpen && data && (
        <TargetEditor
          onClose={() => setTargetsOpen(false)}
          onSaved={nutritionChanged}
        />
      )}
      {foodActions && (
        <NutritionScreen
          title={foodActions.name}
          onBack={() => setFoodActions(null)}
        >
          <div className="space-y-4 pt-5">
            <p className="text-sm text-muted-foreground">Move to meal</p>
            <div className="nutrition-result-list">
              {meals.map((meal) => (
                <button
                  key={meal}
                  className="flex w-full items-center justify-between border-b p-4 text-left text-sm last:border-b-0"
                  disabled={mutating}
                  onClick={() =>
                    void change("update", [{ ...foodActions, meal }])
                      .then(() => setFoodActions(null))
                      .catch((e) => setMutationError(e.message))
                  }
                >
                  {titleCase(meal)}
                  {meal === foodActions.meal && (
                    <span className="text-xs text-muted-foreground">
                      Current
                    </span>
                  )}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              className="h-12 w-full rounded-full text-destructive"
              disabled={mutating}
              onClick={() => void remove(foodActions)}
            >
              <Trash2 className="size-4" />
              Delete food
            </Button>
            {mutationError && (
              <p role="alert" className="text-sm text-destructive">
                {mutationError}
              </p>
            )}
          </div>
        </NutritionScreen>
      )}
    </div>
  )
}
