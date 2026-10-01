import test from "node:test"
import assert from "node:assert/strict"
import {
  completedWorkoutCalories,
  calorieGoal,
  portionOptions,
  scaleFood,
} from "../src/lib/nutrition-math.ts"
const workout = (patch = {}) => ({
  id: "event:1",
  activity_id: "a1",
  workout_date: "2026-10-01",
  status: "completed",
  workout_summary: { completed: { calories: 600 } },
  ...patch,
})
test("calorie goal adds recorded workout calories once and updates when recordings change", () => {
  const context = {
    planned: [
      workout(),
      workout({
        id: "event:2",
        activity_id: null,
        status: "upcoming",
        workout_summary: { planned: { calories: 900 } },
      }),
    ],
    history: [
      workout({ id: "activity:a1" }),
      workout({
        id: "activity:a2",
        activity_id: "a2",
        workout_summary: { completed: { calories: 250 } },
      }),
      workout({
        id: "yesterday",
        activity_id: "old",
        workout_date: "2026-09-30",
      }),
    ],
  }
  assert.equal(completedWorkoutCalories(context, "2026-10-01"), 850)
  assert.equal(calorieGoal(2000, 850), 2850)
  context.history[1].workout_summary.completed.calories = 350
  assert.equal(
    calorieGoal(2000, completedWorkoutCalories(context, "2026-10-01")),
    2950
  )
  context.history[0].workout_summary.completed.calories = 500
  assert.equal(completedWorkoutCalories(context, "2026-10-01"), 850)
  assert.equal(calorieGoal(null, 850), null)
})
test("missing calories and invalid records never fabricate exercise energy", () => {
  assert.equal(
    completedWorkoutCalories(
      {
        planned: [
          workout({ workout_summary: { completed: { calories: null } } }),
          workout({
            id: "invalid",
            activity_id: "invalid",
            workout_summary: { completed: { calories: NaN } },
          }),
        ],
        history: [],
      },
      "2026-10-01"
    ),
    0
  )
})
const food = {
  quantity: 100,
  unit: "g",
  servingQuantity: 50,
  calories: 200,
  protein: 10,
  carbs: 20,
  fat: 8,
  fiber: null,
}
test("servings, grams and ounces represent the same portion without calorie drift", () => {
  const options = portionOptions(food)
  assert.equal(options.find((o) => o.value === "serving").factor, 50)
  assert.equal(scaleFood(food, 2 * 50).calories, 200)
  assert.equal(scaleFood(food, 50).calories, 100)
  const ounces = 100 / options.find((o) => o.value === "oz").factor
  assert.equal(
    scaleFood(food, ounces * options.find((o) => o.value === "oz").factor)
      .calories,
    200
  )
  assert.throws(() => scaleFood(food, 0))
  assert.throws(() => scaleFood(food, Infinity))
})
test("AI portions convert using their estimated gram weight; unknown weights stay unavailable", () => {
  const eggs = {
    ...food,
    quantity: 2,
    unit: "eggs",
    servingQuantity: null,
    gramsPerUnit: 50,
  }
  assert.equal(portionOptions(eggs).find((o) => o.value === "g").factor, 0.02)
  assert.equal(scaleFood(eggs, 50 * 0.02).calories, 100)
  assert.equal(portionOptions({ ...eggs, gramsPerUnit: null }).length, 1)
  assert.equal(
    portionOptions({ ...food, unit: "ml" }).find((o) => o.value === "fl oz")
      .factor,
    29.5735295625
  )
})
