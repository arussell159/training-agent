import { ChevronRight, Utensils } from "lucide-react"
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
    <div className="grid grid-cols-3 gap-4">
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
  return (
    <button
      data-slot="card"
      type="button"
      aria-label="Open nutrition tracker"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("app-navigate", { detail: "Nutrition" })
        )
      }
      className="col-span-2 rounded-[22px] border bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring lg:col-span-6 lg:col-start-7"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
          <Utensils className="size-3.5" />
          Nutrition
        </span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </div>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="text-2xl font-semibold tabular-nums">
          {data ? displayNutrient(totals.calories) : "—"}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            kcal eaten
          </span>
        </p>
        <p className="text-right text-xs text-muted-foreground">
          {error
            ? "Tap to retry"
            : goal != null
              ? `Target ${displayNutrient(goal)}`
              : data
                ? "Set your targets"
                : "Loading…"}
        </p>
      </div>
      <MacroBars
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
    </button>
  )
}
