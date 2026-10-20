import { foodTotals, type FoodEntry, type NutritionView } from "./nutrition.ts"

export function projectNutritionChange(
  view: NutritionView,
  action: "add" | "update" | "delete",
  entries: FoodEntry[] = [],
  id?: string
): NutritionView {
  const current = new Map(view.day.entries.map((entry) => [entry.id, entry]))
  if (action === "delete") current.delete(id || "")
  else for (const entry of entries) current.set(entry.id, entry)
  const next = [...current.values()]
  return {
    ...view,
    day: { ...view.day, entries: next },
    week: view.week.map((day) =>
      day.date === view.date
        ? { ...day, logged: next.length > 0, totals: foodTotals(next) }
        : day
    ),
  }
}
