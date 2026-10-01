import type { FoodEntry } from "./nutrition"
import type { PlannedWorkout, TrainingContext } from "./training-context"

export function completedWorkoutCalories(
  context: TrainingContext,
  date: string
) {
  const activities = new Map<string, { calories: number; recorded: boolean }>()
  for (const workout of [
    ...context.planned,
    ...context.history,
  ] as PlannedWorkout[]) {
    if (workout.workout_date !== date || workout.status !== "completed")
      continue
    const calories = workout.workout_summary?.completed?.calories
    if (
      typeof calories !== "number" ||
      !Number.isFinite(calories) ||
      calories < 0
    )
      continue
    const id = workout.activity_id
      ? `activity:${workout.activity_id}`
      : workout.id
    if (!id) continue
    // A linked event and its activity are two views of one recording.
    const recorded = workout.id.startsWith("activity:")
    if (!activities.get(id)?.recorded || recorded)
      activities.set(id, { calories, recorded })
  }
  return Math.round(
    [...activities.values()].reduce((sum, item) => sum + item.calories, 0)
  )
}

export function calorieGoal(base: number | null | undefined, exercise: number) {
  return base == null ? null : base + exercise
}

export function portionOptions(
  entry: FoodEntry,
  serving = entry.servingQuantity
) {
  const unit = entry.unit.trim().toLowerCase()
  const grams = /^(g|gram|grams)$/.test(unit)
    ? 1
    : /^(oz|ounce|ounces)$/.test(unit)
      ? 28.349523125
      : /^(kg|kilogram|kilograms)$/.test(unit)
        ? 1000
        : entry.gramsPerUnit
  const volume = /^(ml|milliliter|milliliters)$/.test(unit)
  const knownUnit = /^(g|gram|grams)$/.test(unit)
    ? "g"
    : /^(oz|ounce|ounces)$/.test(unit)
      ? "oz"
      : volume
        ? "ml"
        : null
  const options = [
    {
      value: serving ? "serving" : knownUnit || "serving",
      label: serving
        ? `Serving (${serving} ${entry.unit})`
        : knownUnit
          ? { g: "Grams", oz: "Ounces", ml: "Milliliters" }[knownUnit]
          : entry.unit === "serving"
            ? "Serving"
            : entry.unit,
      factor: serving || 1,
    },
  ]
  if (grams && grams > 0)
    options.push(
      { value: "g", label: "Grams", factor: 1 / grams },
      { value: "oz", label: "Ounces", factor: 28.349523125 / grams }
    )
  if (volume)
    options.push(
      { value: "ml", label: "Milliliters", factor: 1 },
      { value: "fl oz", label: "Fluid ounces (US)", factor: 29.5735295625 }
    )
  return options.filter(
    (option, index) =>
      options.findIndex((o) => o.value === option.value) === index
  )
}

export function scaleFood(entry: FoodEntry, quantity: number): FoodEntry {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000)
    throw Error("Enter an amount greater than zero.")
  const ratio = quantity / entry.quantity
  return {
    ...entry,
    quantity: Math.round(quantity * 10000) / 10000,
    ...Object.fromEntries(
      (["calories", "protein", "carbs", "fat", "fiber"] as const).map((key) => [
        key,
        entry[key] == null ? null : Math.round(entry[key]! * ratio * 100) / 100,
      ])
    ),
  }
}
