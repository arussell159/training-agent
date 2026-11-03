import type { FoodProduct, FatSecretServing } from "./nutrition"

// Choose only servings supplied by the catalog. Never invent portion macros.
export function preferredFoodServing(product: FoodProduct): FoodProduct {
  if (product.source !== "fatsecret" || !product.servings?.length) return product
  const score = (serving: FatSecretServing) => {
    const label = serving.label.toLowerCase().trim()
    if (/^1\s+(?:small\s+)?(?:bag|packet|pack|container|pot|bottle|bar|can|pouch)\b/.test(label)) return 100
    if (/^1\s+(?:large\s+)?egg\b/.test(label)) return 95
    if (/\begg\b/.test(product.name.toLowerCase()) && /^1\s+large\b/.test(label)) return 95
    if (/^1\s+(?:medium|regular|slice|piece|whole|scoop|bowl|sandwich|wrap)\b/.test(label)) return 85
    if (/^1\s+(?:large|small|serving)\b/.test(label)) return 80
    if (/^1\s+(?:cup|tbsp|tablespoon|tsp|teaspoon)\b/.test(label)) return 70
    if (/^\d+(?:\.\d+)?\s*(?:g|grams?|ml|milliliters?|oz|ounces?|fl oz)\b/.test(label)) return 10
    return 50
  }
  const serving = product.servings.reduce((best, next) => score(next) > score(best) ? next : best)
  return {
    ...product,
    servingId: serving.id,
    servingSize: serving.label,
    servingQuantity: 1,
    nutrients: { calories: serving.calories, protein: serving.protein, fat: serving.fat, carbs: serving.carbs, fiber: serving.fiber },
  }
}
