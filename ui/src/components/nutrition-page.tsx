import { NutritionDashboardSkeleton } from "@/components/loading-layouts"
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import "./nutrition.css"
import { LoaderCircle, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { randomId } from "@/lib/random-id"
import { Card } from "@/components/ui/card"
import { NutritionScreen, nutritionSaveClass } from "./nutrition-screen"
import { NutritionDateHeader } from "./nutrition-date-header"
import { FoodThumbnail } from "./food-thumbnail"
import { NutritionComposer, type EntryMode } from "./nutrition-composer"
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
  useExerciseCaloriesForDates,
  type FoodEntry,
  type Meal,
  type NutritionDay,
  type Targets,
} from "@/lib/nutrition"
import {
  calorieGoal,
  dailyTargets,
  portionLabel,
  calorieMovingAverage,
} from "@/lib/nutrition-math"

const progressMetrics = [
  {
    key: "calories",
    label: "Calories",
    short: "Cal",
    color: "var(--nutrition-calories)",
  },
  {
    key: "protein",
    label: "Protein",
    short: "P",
    color: "var(--nutrition-protein)",
  },
  { key: "fat", label: "Fat", short: "F", color: "var(--nutrition-fat)" },
  { key: "carbs", label: "Carbs", short: "C", color: "var(--nutrition-carbs)" },
] as const
function TargetEditor({
  date,
  onClose,
  onSaved,
}: {
  date: string
  onClose: () => void
  onSaved: () => void
}) {
  const { data, error: loadError } = useNutrition(date)
  const [values, setValues] = useState<Targets | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const current = values || data?.targets
  const percentMode = current?.macroMode === "percent"
  const percentageTotal = Object.values(
    current?.percentages || {}
  ).reduce<number>((sum, n) => sum + (n || 0), 0)
  async function save() {
    if (!data || !current) return
    setBusy(true)
    setError("")
    try {
      await nutritionRequest("/targets", {
        targets: { ...current, fiber: null },
        revision: data.targetsRevision,
        effectiveDate: date,
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
        Base targets apply from{" "}
        {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}{" "}
        onward, until your next target change. Completed workout calories are
        added automatically.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label className="nutrition-field">
          Macro targets
          <select
            aria-label="Macro target mode"
            value={percentMode ? "percent" : "grams"}
            disabled={busy || !data}
            onChange={(e) => {
              if (!current) return
              const next = dailyTargets(current)
              setValues({
                ...next,
                macroMode: e.target.value as "grams" | "percent",
                percentages: current.percentages || {
                  protein: null,
                  carbs: null,
                  fat: null,
                },
              })
            }}
          >
            <option value="grams">Specific grams</option>
            <option value="percent">Percentage of daily calories</option>
          </select>
        </label>
        {nutrientKeys
          .filter((key) => key !== "fiber")
          .map((key) => (
            <label className="nutrition-field" key={key}>
              {titleCase(key)} (
              {key === "calories" ? "kcal" : percentMode ? "%" : "g"})
              <Input
                aria-label={titleCase(key) + " target"}
                type="number"
                min="0"
                max={key === "calories" ? 20000 : percentMode ? 100 : 3000}
                step="any"
                placeholder="No target"
                disabled={busy || !data}
                required={percentMode}
                value={
                  (percentMode && key !== "calories"
                    ? current?.percentages?.[key as "protein" | "carbs" | "fat"]
                    : current?.[key]) ?? ""
                }
                onChange={(e) =>
                  setValues(
                    percentMode && key !== "calories"
                      ? {
                          ...current!,
                          percentages: {
                            protein: null,
                            carbs: null,
                            fat: null,
                            ...current?.percentages,
                            [key]:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          },
                        }
                      : {
                          ...current!,
                          [key]:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        }
                  )
                }
              />
            </label>
          ))}
        {percentMode && (
          <p className="text-sm text-muted-foreground">
            {Math.round(percentageTotal * 100) / 100}% of 100% allocated. Gram
            targets adjust with completed workout calories.
          </p>
        )}
        <Button
          type="submit"
          disabled={
            busy ||
            !data ||
            (percentMode &&
              (Math.abs(percentageTotal - 100) > 0.01 ||
                !(current?.calories && current.calories > 0)))
          }
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

export function NutritionPage({
  onBack,
  returnLabel,
  quickAddRequest = 0,
}: {
  onBack: () => void
  returnLabel: string
  quickAddRequest?: number
}) {
  const nutritionSwipe = useRef<{
    pointerId: number
    x: number
    y: number
  } | null>(null)
  const [date, setDate] = useState(nutritionToday),
    { data, error, loading, reload, setData } = useNutrition(date)
  const [composer, setComposer] = useState<{
      mode: EntryMode
      meal: Meal
      existing?: FoodEntry
    } | null>(() =>
      quickAddRequest > 0 ? { mode: "write", meal: suggestedMeal() } : null
    ),
    [targetsOpen, setTargetsOpen] = useState(false),
    [mutationError, setMutationError] = useState(""),
    [mutating, setMutating] = useState(false),
    [deleted, setDeleted] = useState<FoodEntry | null>(null)
  const exercise = useExerciseCalories(date)
  const weekExercise = useExerciseCaloriesForDates(
    data?.week.map((day) => day.date) || []
  )
  const weekGoals =
    data?.week.map((day, index) =>
      calorieGoal(day.targets?.calories, weekExercise[index])
    ) || []
  const averages = calorieMovingAverage(data?.week || [])
  const totals = foodTotals(data?.day.entries || []),
    target = calorieGoal(data?.targets.calories, exercise)
  const averageDaily = (key: keyof typeof totals) =>
    data?.week.length
      ? data.week.reduce((sum, day) => sum + day.totals[key], 0) /
        data.week.length
      : null
  const resolvedTargets = data ? dailyTargets(data.targets, exercise) : null
  const add = (mode: EntryMode, meal?: Meal) => {
    setMutationError("")
    setComposer({
      mode,
      meal: meal || suggestedMeal(),
    })
  }
  async function change(
    action: "add" | "update" | "delete",
    entries?: FoodEntry[],
    id?: string,
    operationId: string = randomId()
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
    await change("delete", undefined, entry.id)
    setDeleted(entry)
  }
  const selectDate = (next: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return
    setDeleted(null)
    setMutationError("")
    setDate(next)
  }
  const startNutritionSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || !event.isPrimary) return
    nutritionSwipe.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
  }
  const finishNutritionSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = nutritionSwipe.current
    nutritionSwipe.current = null
    if (!start || start.pointerId !== event.pointerId || mutating) return
    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25)
      return
    const next = new Date(date + "T12:00:00")
    next.setDate(next.getDate() + (deltaX < 0 ? 1 : -1))
    selectDate(
      [
        next.getFullYear(),
        String(next.getMonth() + 1).padStart(2, "0"),
        String(next.getDate()).padStart(2, "0"),
      ].join("-")
    )
  }
  const maximum = Math.max(
    ...weekGoals.map((goal) => goal || 0),
    ...(data?.week.map((day) => day.totals.calories) || []),
    1
  )
  return (
    <div className="nutrition-surface nutrition-dashboard home-dashboard-shell w-full min-w-0">
      <NutritionDateHeader
        onBack={onBack}
        returnLabel={returnLabel}
        date={date}
        onSelect={selectDate}
        disabled={mutating}
        onTargets={() => setTargetsOpen(true)}
      />
      <div className="mobile-dashboard mx-auto w-full max-w-7xl space-y-5 px-4 pt-4 pb-8 md:px-8 lg:pt-6">
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
        {!data && !error && <NutritionDashboardSkeleton />}
        {data && (
          <>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:gap-6">
              <Card
                className="nutrition-progress-card order-1 min-h-[368px] touch-pan-y gap-5 p-5 md:touch-auto"
                onPointerDown={startNutritionSwipe}
                onPointerUp={finishNutritionSwipe}
                onPointerCancel={() => {
                  nutritionSwipe.current = null
                }}
              >
                {progressMetrics.map(({ key, label, color }) => {
                  const goal = resolvedTargets![key]
                  const left = goal == null ? null : goal - totals[key]
                  const overGoal =
                    goal != null && goal > 0 && totals[key] > goal
                  const goalPosition = overGoal
                    ? (goal / totals[key]) * 100
                    : Math.min(100, goal ? (totals[key] / goal) * 100 : 0)
                  return (
                    <div key={key} className="nutrition-progress-row">
                      <div className="flex items-baseline gap-2 text-[15px]">
                        <span className="font-semibold">{label}</span>
                        <span className="nutrition-progress-detail text-xs text-muted-foreground">
                          {left == null
                            ? "No target set"
                            : `${displayNutrient(Math.abs(left))}${key === "calories" ? "" : " g"} ${left < 0 ? "over" : "remaining"}`}
                        </span>
                      </div>
                      <div className="nutrition-progress-line">
                        <div
                          role="progressbar"
                          aria-label={label}
                          aria-valuemin={0}
                          aria-valuemax={goal || undefined}
                          aria-valuenow={
                            goal ? Math.min(totals[key], goal) : undefined
                          }
                          className="nutrition-progress-track"
                          style={{
                            background: `color-mix(in srgb, ${color} 16%, var(--card))`,
                          }}
                        >
                          <span
                            className={`nutrition-progress-fill ${overGoal ? "nutrition-progress-fill-before-goal" : ""}`}
                            style={{
                              width: `${goalPosition}%`,
                              background: color,
                            }}
                          />
                          {overGoal && (
                            <>
                              <span
                                className="nutrition-progress-overfill"
                                style={{
                                  left: `${goalPosition}%`,
                                  background: `color-mix(in srgb, ${color} 78%, #000 22%)`,
                                }}
                              />
                              <i
                                className="nutrition-progress-goal-marker"
                                style={{ left: `${goalPosition}%` }}
                                aria-hidden="true"
                              />
                            </>
                          )}
                        </div>
                        <span className="text-[14px] font-semibold tabular-nums">
                          {displayNutrient(totals[key])} /{" "}
                          {displayNutrient(goal)}
                          {key === "calories" ? "" : " g"}
                        </span>
                      </div>
                    </div>
                  )
                })}
                {target == null && (
                  <button
                    className="text-left text-xs text-emerald-700 underline"
                    onClick={() => setTargetsOpen(true)}
                  >
                    Set targets
                  </button>
                )}
                {exercise > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Includes {displayNutrient(exercise)} kcal from completed
                    workouts.
                  </p>
                )}
              </Card>
              <Card className="order-3 min-h-[383px] gap-4 p-5 lg:order-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">Last 7 days</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Calories logged
                    </p>
                  </div>
                </div>
                <div
                  className="relative grid h-40 grid-cols-7 items-end"
                  aria-label="Calories logged over the last seven days"
                >
                  <svg
                    className="pointer-events-none absolute inset-x-0 top-6 z-10 h-28 w-full overflow-visible"
                    viewBox="0 0 700 112"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      d={averages
                        .map((value, index) =>
                          value == null
                            ? ""
                            : `${index === 0 || averages[index - 1] == null ? "M" : "L"}${index * 100 + 50},${112 - (value / maximum) * 108}`
                        )
                        .join(" ")}
                      fill="none"
                      stroke="var(--nutrition-chart-line)"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </svg>
                  {data.week.map((day, index) => (
                    <button
                      key={day.date}
                      type="button"
                      aria-current={day.date === date ? "date" : undefined}
                      onClick={() => selectDate(day.date)}
                      disabled={mutating}
                      aria-label={`${day.date}: ${day.logged ? Math.round(day.totals.calories) + " calories" : "no food logged"}${weekGoals[index] != null ? `, target ${Math.round(weekGoals[index]!)} calories` : ""}`}
                      className="relative grid h-full w-full grid-rows-[16px_112px_16px] justify-items-center gap-2"
                    >
                      <span className="nutrition-week-total text-[11px] font-medium text-muted-foreground tabular-nums">
                        {day.logged
                          ? displayNutrient(day.totals.calories)
                          : "—"}
                      </span>
                      <span className="relative h-28 w-full max-w-6">
                        {weekGoals[index] != null && (
                          <span
                            className="nutrition-week-target absolute inset-x-0 bottom-0 rounded-full"
                            style={{
                              height: `${(weekGoals[index]! / maximum) * 108}px`,
                            }}
                          />
                        )}
                        {day.logged && (
                          <span
                            className={`nutrition-week-bar absolute inset-x-0 bottom-0 rounded-full ${day.date === date ? "is-selected" : ""}`}
                            style={{
                              height: `${Math.max(3, (day.totals.calories / maximum) * 108)}px`,
                            }}
                          />
                        )}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {new Date(`${day.date}T12:00:00`).toLocaleDateString(
                          undefined,
                          { weekday: "short" }
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                <div
                  className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4"
                  aria-label="Average daily nutrition over the last 7 days"
                >
                  {[
                    { key: "calories", label: "Avg daily calories", unit: "" },
                    { key: "protein", label: "Avg daily protein", unit: " g" },
                    { key: "fat", label: "Avg daily fat", unit: " g" },
                    { key: "carbs", label: "Avg daily carbs", unit: " g" },
                  ].map(({ key, label, unit }) => (
                    <div key={key} className="min-w-0">
                      <p className="font-semibold tabular-nums">
                        {displayNutrient(
                          averageDaily(key as keyof typeof totals)
                        )}
                        {unit}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {label}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            <section
              className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0 xl:gap-6"
              aria-label="Daily meals"
            >
              <div className="pt-1 lg:col-span-2 lg:pb-1">
                <h2 className="text-lg font-semibold">Your meals</h2>
              </div>
              {meals.map((meal) => {
                const entries = data.day.entries.filter((e) => e.meal === meal),
                  subtotal = foodTotals(entries)
                return (
                  <Card key={meal} className="gap-0 overflow-hidden py-0">
                    <div className="nutrition-meal-header p-4">
                      <h3 className="text-lg font-semibold">
                        {titleCase(meal)}
                      </h3>
                      <div
                        className="nutrition-meal-totals"
                        aria-label={`${titleCase(meal)} totals`}
                      >
                        {progressMetrics.map(({ key, short, color }) => (
                          <span key={key}>
                            <i style={{ background: color }} />
                            {displayNutrient(subtotal[key])} {short}
                          </span>
                        ))}
                      </div>
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
                            className="flex items-center gap-3 px-4 py-4"
                          >
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                              onClick={() => {
                                setComposer({
                                  mode: "manual",
                                  meal: entry.meal,
                                  existing: entry,
                                })
                              }}
                              disabled={mutating}
                              aria-label={`Edit ${titleCase(entry.name)}`}
                            >
                              <FoodThumbnail
                                name={entry.name}
                                imageUrl={entry.imageUrl}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-base font-medium">
                                  {titleCase(entry.name)}
                                </span>
                                <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                                  {portionLabel(entry)}
                                  {entry.source === "ai" ? " · estimated" : ""}
                                </span>
                                <span className="nutrition-food-macros mt-1 flex max-w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-medium tabular-nums">
                                  <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                                    <span
                                      className="size-2 rounded-full"
                                      style={{
                                        background: "var(--nutrition-calories)",
                                      }}
                                      aria-hidden="true"
                                    />
                                    {displayNutrient(entry.calories)} Cal
                                  </span>
                                  <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                                    <span
                                      aria-hidden="true"
                                      className="size-2 rounded-full"
                                      style={{
                                        background: "var(--nutrition-protein)",
                                      }}
                                    />
                                    {displayNutrient(entry.protein)} P
                                  </span>
                                  <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                                    <span
                                      aria-hidden="true"
                                      className="size-2 rounded-full"
                                      style={{
                                        background: "var(--nutrition-carbs)",
                                      }}
                                    />
                                    {displayNutrient(entry.carbs)} C
                                  </span>
                                  <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                                    <span
                                      aria-hidden="true"
                                      className="size-2 rounded-full"
                                      style={{
                                        background: "var(--nutrition-fat)",
                                      }}
                                    />
                                    {displayNutrient(entry.fat)} F
                                  </span>
                                </span>
                              </span>
                              <Pencil className="hidden size-3 text-muted-foreground sm:block" />
                            </button>
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
      {composer && (
        <NutritionComposer
          {...composer}
          date={date}
          aiAvailable={data?.aiAvailable}
          onClose={() => setComposer(null)}
          onSave={async (entries, operationId) =>
            change(
              composer.existing ? "update" : "add",
              entries,
              undefined,
              operationId
            )
          }
          onMoveExisting={async (nextMeal) => {
            if (!composer.existing) return
            await change("update", [{ ...composer.existing, meal: nextMeal }])
            setComposer(null)
          }}
          onDeleteExisting={async () => {
            if (!composer.existing) return
            await remove(composer.existing)
            setComposer(null)
          }}
        />
      )}
      {targetsOpen && data && (
        <TargetEditor
          date={date}
          onClose={() => setTargetsOpen(false)}
          onSaved={nutritionChanged}
        />
      )}
    </div>
  )
}
