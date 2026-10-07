import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Utensils } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  displayNutrient,
  foodTotals,
  useNutrition,
  useExerciseCalories,
  type Targets,
  type Nutrient,
} from "@/lib/nutrition"
import { calorieGoal, dailyTargets } from "@/lib/nutrition-math"

const colors = { protein: "#ed7d83", carbs: "#e6ae45", fat: "#7198e1" }
export function MacroBars({
  totals,
  targets,
  loading = false,
}: {
  totals: Record<Nutrient, number>
  targets: Targets
  loading?: boolean
}) {
  return (
    <div className="grid min-h-[59px] grid-cols-3 gap-4" aria-busy={loading || undefined} aria-label={loading ? "Loading macros" : undefined}>
      {(["protein", "carbs", "fat"] as const).map((key) => (
        <div key={key} className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className="size-1.5 rounded-full"
              style={{ background: colors[key] }}
            />
            {key[0].toUpperCase() + key.slice(1)}
          </p>
          <div className="mt-1 flex h-6 items-center text-base font-semibold tabular-nums">
            {loading ? <Skeleton className="h-5 w-16" /> : (
              <span className="truncate whitespace-nowrap">
                {displayNutrient(totals[key])}
                <span className="text-[11px] font-normal text-muted-foreground">
                  {targets[key] != null
                    ? ` / ${displayNutrient(targets[key])}`
                    : ""}{" "}
                  g
                </span>
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                background: colors[key],
                width: `${targets[key] ? Math.min(100, (totals[key] / targets[key]!) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
export function NutritionHomeCard({ date }: { date: string }) {
  const { data, error } = useNutrition(date)
  const exercise = useExerciseCalories(date)
  const goal = calorieGoal(data?.targets.calories, exercise)
  const totals = foodTotals(data?.day.entries || [])
  const openNutrition = () =>
    window.dispatchEvent(
      new CustomEvent("app-navigate", { detail: { item: "Nutrition" } })
    )
  const quickAdd = () =>
    window.dispatchEvent(
      new CustomEvent("app-navigate", {
        detail: { item: "Nutrition", quickAdd: "type" },
      })
    )
  return (
    <div
      data-slot="card"
      className="dashboard-nutrition-card group relative col-span-2 rounded-[22px] border bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md lg:col-span-4 lg:col-start-13 lg:row-start-2 lg:flex lg:flex-col lg:gap-(--card-spacing) lg:overflow-hidden lg:rounded-xl lg:border-0 lg:bg-card lg:py-4 lg:text-sm lg:text-card-foreground lg:shadow-none lg:ring-1 lg:ring-foreground/10 lg:hover:shadow-none lg:[--card-spacing:--spacing(4)]"
    >
      <button
        type="button"
        aria-label="Open nutrition tracker"
        onClick={openNutrition}
        className="absolute inset-0 z-10 rounded-[22px] focus-visible:outline-2 focus-visible:outline-ring lg:rounded-xl"
      >
        <span className="sr-only">Open nutrition tracker</span>
      </button>
      <div className="pointer-events-none relative z-0">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
            <Utensils className="size-3.5" />
            Nutrition
          </span>
        </div>
        <div className="mb-4 flex h-8 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1 whitespace-nowrap text-2xl leading-8 font-semibold tabular-nums">
            <span className="inline-flex h-8 w-20 shrink-0 items-center overflow-hidden">
              {data ? displayNutrient(totals.calories) : error ? "—" : <Skeleton className="h-6 w-20" />}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              kcal eaten
            </span>
          </div>
          <div className="w-24 shrink-0 truncate text-right text-xs text-muted-foreground">
            {error
              ? "Tap to retry"
              : goal != null
                ? `Target ${displayNutrient(goal)}`
                : data
                  ? "Set your targets"
                  : <Skeleton className="h-3 w-20" />}
          </div>
        </div>
        <MacroBars
          loading={!data && !error}
          totals={totals}
          targets={
            data
              ? dailyTargets(data.targets, exercise)
              : {
                  calories: null,
                  protein: null,
                  carbs: null,
                  fat: null,
                  fiber: null,
                }
          }
        />
      </div>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        aria-label="Quick add food by typing"
        title="Quick add food"
        onClick={quickAdd}
        className="!absolute !top-3 !right-3 !z-20 !size-7 rounded-full"
      >
        <Plus />
      </Button>
    </div>
  )
}
