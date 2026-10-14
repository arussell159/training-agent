// Disposable nutrition data for the local preview. No provider or disk writes.
import { randomUUID } from "node:crypto";
import { validDate } from "./desktop-preview-fixtures.mjs";

const nutrients = ["calories", "protein", "carbs", "fat", "fiber"];
const samples = [
  ["Rolled oats", "Quaker", "1 bowl", 150, 5, 27, 3, 4],
  ["Oatmeal with berries", "", "1 bowl", 280, 9, 48, 6, 7],
  ["Overnight oats with peanut butter", "", "1 jar", 390, 18, 46, 15, 8],
  ["Banana", "", "1 medium", 105, 1, 27, 0, 3],
  ["Greek yogurt plain", "Chobani", "1 pot", 100, 17, 6, 0, 0],
  ["Greek yogurt strawberry", "Fage", "1 pot", 140, 15, 18, 1, 0],
  ["Grilled chicken breast", "", "100 g", 165, 31, 0, 4, 0],
  ["Chicken and rice bowl", "", "1 bowl", 520, 42, 61, 12, 5],
  ["White rice cooked", "", "1 cup", 205, 4, 45, 0, 1],
  ["Brown rice cooked", "", "1 cup", 216, 5, 45, 2, 4],
  ["Scrambled eggs", "", "2 eggs", 180, 13, 2, 13, 0],
  ["Hard boiled egg", "", "1 large", 78, 6, 1, 5, 0],
  ["Coffee black", "", "1 cup", 2, 0, 0, 0, 0],
  ["Coffee latte", "Starbucks", "1 regular", 190, 13, 19, 7, 0],
  ["Whole milk", "", "1 cup", 149, 8, 12, 8, 0],
  ["Almond milk unsweetened", "Alpro", "1 cup", 30, 1, 1, 3, 1],
  ["Apple", "", "1 medium", 95, 0, 25, 0, 4],
  ["Peanut butter", "", "2 tbsp", 190, 7, 7, 16, 2],
  ["Whole wheat bread", "", "1 slice", 90, 4, 16, 1, 3],
  ["Salmon grilled", "", "100 g", 208, 20, 0, 13, 0],
  ["Tuna sandwich", "", "1 sandwich", 380, 28, 35, 14, 4],
  ["Pepperoni pizza", "Pizza Hut", "1 slice", 300, 13, 34, 13, 2],
  ["Cheese pizza", "Domino's", "1 slice", 260, 11, 32, 10, 2],
  ["Whey protein chocolate", "Optimum Nutrition", "1 scoop", 120, 24, 3, 1, 1],
  ["Banana protein smoothie", "", "1 glass", 320, 28, 44, 5, 5],
  ["Endurance fuel", "Tailwind", "1 scoop", 100, 0, 25, 0, 0],
  ["Thirst quencher fruit punch", "Gatorade", "1 bottle", 140, 0, 36, 0, 0],
];

export function createDesktopNutritionPreview(fixture) {
  const products = samples.map(([name, brand, label, ...values], index) => {
    const totals = Object.fromEntries(nutrients.map((key, i) => [key, values[i]]));
    return {
      source: "fatsecret",
      code: `demo-food-${index}`,
      name,
      brand,
      imageUrl: null,
      unit: "serving",
      servingId: "standard",
      servingSize: label,
      servingQuantity: 1,
      nutrients: totals,
      complete: true,
      url: "",
      servings: [
        {
          id: "standard",
          label,
          unit: "serving",
          units: 1,
          metricAmount: label === "100 g" ? 100 : null,
          metricUnit: label === "100 g" ? "g" : null,
          ...totals,
        },
      ],
    };
  });
  const toEntry = (product, meal = "breakfast") => ({
    id: randomUUID(),
    name: product.name,
    meal,
    quantity: 1,
    unit: product.servingSize,
    ...product.nutrients,
    source: "fatsecret",
    foodId: product.code,
    servingId: product.servingId,
    servingQuantity: 1,
    notes: "Sample food for the local preview",
    barcode: null,
    imageUrl: null,
  });
  const library = {
    revision: 1,
    items: [
      {
        id: "product-demo-food-4",
        name: "Greek yogurt plain",
        entries: [toEntry(products[4])],
        favorite: true,
        custom: false,
      },
      {
        id: "product-demo-food-3",
        name: "Banana",
        entries: [toEntry(products[3])],
        favorite: true,
        custom: false,
      },
      {
        id: "demo-breakfast",
        name: "My oats and banana breakfast",
        entries: [toEntry(products[0]), toEntry(products[3])],
        favorite: true,
        custom: true,
      },
    ],
  };
  const days = new Map(),
    operations = new Map();
  const getDay = (date) => {
    if (!days.has(date)) days.set(date, structuredClone(fixture.nutrition(date).day));
    return days.get(date);
  };
  const totals = (entries) =>
    Object.fromEntries(
      nutrients.map((key) => [
        key,
        entries.reduce((sum, entry) => sum + (Number(entry[key]) || 0), 0),
      ])
    );
  const matches = (query) => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return products.filter((product) =>
      words.every((word) => `${product.name} ${product.brand}`.toLowerCase().includes(word))
    );
  };
  return {
    canWrite: (api, method) =>
      method === "POST" &&
      ["nutrition/entries", "nutrition/library", "nutrition/estimate"].includes(api),
    handle(api, method, input, url) {
      if (api === "nutrition") {
        const date = validDate(url.searchParams.get("date"))
          ? url.searchParams.get("date")
          : fixture.today;
        const view = structuredClone(fixture.nutrition(date));
        view.day = structuredClone(getDay(date));
        view.aiAvailable = true;
        view.week = view.week.map((day) =>
          days.has(day.date)
            ? {
                ...day,
                logged: getDay(day.date).entries.length > 0,
                totals: totals(getDay(day.date).entries),
              }
            : day
        );
        return view;
      }
      if (api === "nutrition/search") return { products: matches(url.searchParams.get("q") || "") };
      if (api === "nutrition/product") {
        const product = products.find((product) => product.code === url.searchParams.get("id"));
        return product ? { product } : { error: "Sample food not found." };
      }
      if (api === "nutrition/estimate") {
        const words = String(input.text || "")
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((word) => word.length > 3);
        const found = products
          .filter((product) => words.some((word) => product.name.toLowerCase().includes(word)))
          .slice(0, 4);
        return {
          entries: found.map((product) => toEntry(product, input.meal || "breakfast")),
          notes: "Demo portions from sample foods. Adjust the amounts before adding.",
        };
      }
      if (api === "nutrition/library") {
        if (method === "POST") {
          if (input.action !== "save" || !input.item?.id || !Array.isArray(input.item.entries))
            return { error: "Invalid sample food." };
          const index = library.items.findIndex((item) => item.id === input.item.id);
          if (index < 0) library.items.push(structuredClone(input.item));
          else library.items[index] = structuredClone(input.item);
          library.revision++;
        }
        return structuredClone(library);
      }
      if (api === "nutrition/entries") {
        if (!validDate(input.date) || !input.operationId)
          return { error: "Choose a date and food first." };
        const key = `${input.date}:${input.operationId}`;
        if (operations.has(key)) return structuredClone(operations.get(key));
        const day = getDay(input.date);
        if (input.revision !== day.revision)
          return { error: "The sample log changed. Reload and try again." };
        if (input.action === "delete")
          day.entries = day.entries.filter((entry) => entry.id !== input.id);
        else if (["add", "update"].includes(input.action) && Array.isArray(input.entries)) {
          for (const entry of input.entries) {
            const index = day.entries.findIndex((saved) => saved.id === entry.id);
            if (index < 0) day.entries.push(structuredClone(entry));
            else day.entries[index] = structuredClone(entry);
          }
        } else return { error: "Choose sample foods to add." };
        day.revision++;
        const result = structuredClone({ day });
        operations.set(key, result);
        return structuredClone(result);
      }
      return null;
    },
  };
}
