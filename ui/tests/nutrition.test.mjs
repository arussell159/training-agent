import test from "node:test"
import assert from "node:assert/strict"
import {
  completedWorkoutCalories,
  calorieGoal,
  dailyTargets,
  portionOptions,
  scaleFood,
  portionLabel,
  calorieMovingAverage,
} from "../src/lib/nutrition-math.ts"
test("diary portions combine serving counts with catalog labels without confusing weight and volume", () => {
  assert.equal(portionLabel({ quantity: 2, unit: "1 regular" }), "2 regular")
  assert.equal(portionLabel({ quantity: 10, unit: "1 fl oz" }), "10 fl oz")
  assert.equal(portionLabel({ quantity: 10, unit: "1 fluid ounce" }), "10 fl oz")
  assert.equal(portionLabel({ quantity: 2, unit: "100 g" }), "200 g")
  assert.equal(portionLabel({ quantity: 2, unit: "1/2 cup" }), "1 cup")
  assert.equal(portionLabel({ quantity: 2, unit: "1 1/2 cups" }), "3 cups")
  assert.equal(portionLabel({ quantity: 10, unit: "1 oz" }), "10 oz")
  assert.equal(portionLabel({ quantity: 1.25, unit: "serving" }), "1.25 serving")
})
test("three-day calorie average leaves unlogged days empty and averages only recorded intake", () => {
  const days = [1000, 2000, null, 3000, 1500].map((calories) => ({ logged: calories != null, totals: { calories: calories || 0 } }))
  assert.deepEqual(calorieMovingAverage(days), [1000, 1500, null, 2500, 2250])
})
test("percentage macros follow workout-adjusted calories while gram targets remain fixed", () => {
  const base = { calories: 2000, protein: 150, carbs: 225, fat: 55.56, fiber: null };
  assert.deepEqual(dailyTargets(base, 400), { ...base, calories: 2400 });
  const percent = { ...base, macroMode: "percent", percentages: { protein: 30, carbs: 45, fat: 25 } };
  const result = dailyTargets(percent, 400);
  assert.equal(result.protein, 180);
  assert.equal(result.carbs, 270);
  assert.equal(result.fat, 66.67);
  assert.equal(percent.protein, 150);
  assert.equal(dailyTargets({ ...percent, calories: null }, 400).protein, null);
});
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
test("FatSecret portions preserve catalog servings and support exact weight and volume units", () => {
  const rice = {
    ...food,
    source: "fatsecret",
    quantity: 1,
    unit: "1 cup",
    servingQuantity: 1,
    gramsPerUnit: 158,
    calories: 205,
  }
  const options = portionOptions(rice)
  assert.equal(options[0].label, "1 cup")
  assert.equal(options.find((o) => o.value === "g").factor, 1 / 158)
  assert.equal(
    scaleFood(rice, 158 * options.find((o) => o.value === "g").factor).calories,
    205
  )
  const drink = { ...rice, gramsPerUnit: null, millilitersPerUnit: 240 }
  assert.equal(
    portionOptions(drink).find((o) => o.value === "ml").factor,
    1 / 240
  )
  assert.equal(scaleFood(drink, 120 / 240).calories, 102.5)
})
