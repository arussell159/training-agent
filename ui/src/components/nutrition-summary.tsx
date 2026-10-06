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
}: {
  totals: Record<Nutrient, number>
  targets: Targets
}) {
  return (
    <div className="grid min-h-[59px] grid-cols-3 gap-4">
      {(["protein", "carbs", "fat"] as const).map((key) => (
        <div key={key} className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className="size-1.5 rounded-full"
              style={{ background: colors[key] }}
            />
            {key[0].toUpperCase() + key.slice(1)}
          </p>
          <p className="mt-1 text-base font-semibold tabular-nums">
            {displayNutrient(totals[key])}
            <span className="text-[11px] font-normal text-muted-foreground">
              {targets[key] != null
                ? ` / ${displayNutrient(targets[key])}`
                : ""}{" "}
              g
            </span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-300"
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
      className="group relative col-span-2 rounded-[22px] border bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md lg:col-span-6 lg:col-start-7"
    >
      <button
        type="button"
        aria-label="Open nutrition tracker"
        onClick={openNutrition}
        className="absolute inset-0 z-10 rounded-[22px] focus-visible:outline-2 focus-visible:outline-ring"
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
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <div className="text-2xl leading-8 font-semibold tabular-nums">
            {data ? displayNutrient(totals.calories) : error ? "—" : <Skeleton className="inline-block h-6 w-20 align-middle" />}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              kcal eaten
            </span>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            {error
              ? "Tap to retry"
              : goal != null
                ? `Target ${displayNutrient(goal)}`
                : data
                  ? "Set your targets"
                  : <Skeleton className="h-3 w-20" />}
          </div>
        </div>
        {!data && !error ? <div className="grid min-h-[59px] grid-cols-3 gap-4" aria-label="Loading macros">{[0, 1, 2].map(i => <div key={i} className="space-y-2"><Skeleton className="h-3 w-14" /><Skeleton className="h-5 w-16" /><Skeleton className="h-1.5 w-full" /></div>)}</div> : <MacroBars
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
        />}
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
