export class NutritionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const MEALS = ["breakfast", "lunch", "dinner", "snacks"];
export const NUTRIENTS = ["calories", "protein", "carbs", "fat", "fiber"];
export const emptyTargets = () => Object.fromEntries(NUTRIENTS.map((key) => [key, null]));
export const emptyDay = () => ({ revision: 0, entries: [], operations: [] });
export const foodImageUrl = (value) =>
  typeof value === "string" &&
  /^https:\/\/(images\.openfoodfacts\.org|(?:www\.)?foodimagedb\.com)\//.test(value)
    ? value.slice(0, 1000)
    : null;
export function nutritionDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new NutritionError("Choose a valid date.");
  return value;
}
export function shiftDate(date, days) {
  const d = new Date(`${nutritionDate(date)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function text(value, max, label) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new NutritionError(`Check ${label}.`);
  return value.trim();
}
function number(value, max, label, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max)
    throw new NutritionError(`Check ${label}.`);
  return Math.round(value * 100) / 100;
}
export function validateTargets(input) {
  if (!input || typeof input !== "object") throw new NutritionError("Enter your daily targets.");
  const targets = Object.fromEntries(
    NUTRIENTS.map((key) => [
      key,
      input.macroMode === "percent" && ["protein", "carbs", "fat"].includes(key)
        ? null
        : number(input[key], key === "calories" ? 20000 : 3000, `${key} target`, true),
    ])
  );
  if (input.macroMode !== undefined && !["grams", "percent"].includes(input.macroMode))
    throw new NutritionError("Choose grams or percentage for macro targets.");
  if (input.macroMode === "percent") {
    if (!(targets.calories > 0))
      throw new NutritionError("Set a calorie target before using percentages.");
    const percentages = Object.fromEntries(
      ["protein", "carbs", "fat"].map((key) => [
        key,
        number(input.percentages?.[key], 100, `${key} percentage`),
      ])
    );
    if (Math.abs(Object.values(percentages).reduce((sum, n) => sum + n, 0) - 100) > 0.01)
      throw new NutritionError("Macro percentages must total 100%.");
    for (const key of ["protein", "carbs", "fat"])
      targets[key] =
        Math.round(((targets.calories * percentages[key]) / 100 / (key === "fat" ? 9 : 4)) * 100) /
        100;
    targets.macroMode = "percent";
    targets.percentages = percentages;
  }
  return targets;
}
export function validateEntry(input) {
  if (!input || typeof input !== "object") throw new NutritionError("Check the food entry.");
  if (Array.isArray(input.missingValues) && input.missingValues.length)
    throw new NutritionError("Enter the missing nutrition values before saving.");
  if (!MEALS.includes(input.meal))
    throw new NutritionError("Choose breakfast, lunch, dinner, or snacks.");
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(input.id || ""))
    throw new NutritionError("The food identifier is invalid.");
  number(input.quantity, 100000, "quantity");
  const quantity = Math.round(input.quantity * 10000) / 10000;
  if (quantity <= 0) throw new NutritionError("Quantity must be greater than zero.");
  const source = ["fatsecret", "openfoodfacts", "ai", "manual"].includes(input.source)
    ? input.source
    : "manual";
  const entry = {
    id: input.id,
    ...(source === "fatsecret"
      ? {
          foodId: text(input.foodId, 20, "FatSecret food ID"),
          servingId: text(input.servingId, 20, "FatSecret serving ID"),
        }
      : {}),
    name: text(input.name, 180, "food name").replace(
      /(^|[\s(/-])([a-z])/g,
      (_, prefix, c) => prefix + c.toUpperCase()
    ),
    meal: input.meal,
    quantity,
    unit: text(input.unit, 40, "portion unit"),
    millilitersPerUnit:
      input.millilitersPerUnit == null
        ? null
        : number(input.millilitersPerUnit, 100000, "unit volume"),
    gramsPerUnit:
      input.gramsPerUnit == null ? null : number(input.gramsPerUnit, 100000, "unit weight"),
    servingQuantity:
      input.servingQuantity == null
        ? null
        : number(input.servingQuantity, 100000, "serving quantity"),
    source,
    notes: typeof input.notes === "string" ? input.notes.slice(0, 800) : "",
    barcode: /^\d{8,14}$/.test(input.barcode || "") ? input.barcode : null,
    imageUrl: foodImageUrl(input.imageUrl),
  };
  for (const key of NUTRIENTS)
    entry[key] = number(input[key], key === "calories" ? 30000 : 5000, key, key === "fiber");
  return entry;
}
export function nutritionTotals(entries) {
  const result = Object.fromEntries(NUTRIENTS.map((key) => [key, 0]));
  for (const entry of entries) for (const key of NUTRIENTS) result[key] += entry[key] ?? 0;
  return result;
}

// FatSecret permits indefinitely storing identifiers; resolve catalog values on read.
export function storedNutritionEntry(entry) {
  if (entry.source !== "fatsecret") return entry;
  return {
    id: entry.id,
    source: entry.source,
    foodId: entry.foodId,
    servingId: entry.servingId,
    quantity: entry.quantity,
    meal: entry.meal,
  };
}
export function createNutritionStore(record) {
  const preferences = () => record("preferences", () => ({ revision: 0, targets: emptyTargets() }));
  const month = (date) => record(date.slice(0, 7), () => ({ days: {} }));
  const library = () => record("library", () => ({ revision: 0, items: [] }));
  return {
    async view(date, resolve = async (entry) => entry) {
      nutritionDate(date);
      const dates = Array.from({ length: 7 }, (_, i) => shiftDate(date, i - 6));
      const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
      const [settings, ...records] = await Promise.all([
        preferences().read(),
        ...months.map((m) => month(m).read()),
      ]);
      const days = Object.assign({}, ...records.map((r) => r.days));
      await Promise.all(
        dates.map(async (d) => {
          if (days[d])
            days[d] = { ...days[d], entries: await Promise.all(days[d].entries.map(resolve)) };
        })
      );
      const targetsAt = (day) =>
        [...(settings.targetHistory || [])]
          .filter((item) => item.date <= day)
          .sort((a, b) => b.date.localeCompare(a.date))[0]?.targets ||
        settings.baselineTargets ||
        settings.targets;
      return {
        date,
        day: days[date] || emptyDay(),
        targets: targetsAt(date),
        targetsRevision: settings.revision,
        week: dates.map((d) => ({
          date: d,
          logged: Boolean(days[d]?.entries.length),
          targets: targetsAt(d),
          totals: nutritionTotals(days[d]?.entries || []),
        })),
      };
    },
    async setTargets(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new NutritionError("Enter your daily targets.");
      const targets = validateTargets(payload.targets);
      const effectiveDate = nutritionDate(
        payload.effectiveDate || new Date().toISOString().slice(0, 10)
      );
      return preferences().update((state) => {
        if (state.revision !== payload.revision)
          throw new NutritionError("Targets changed in another view. Reload before saving.", 409);
        state.baselineTargets ||= state.targets;
        state.targetHistory = [
          ...(state.targetHistory || []).filter((item) => item.date !== effectiveDate),
          { date: effectiveDate, targets },
        ];
        state.targets = targets;
        state.revision++;
        return { targets, revision: state.revision };
      });
    },
    async library(resolve = async (entry) => entry) {
      const result = await library().read();
      result.items = await Promise.all(
        result.items.map(async (item) => {
          const entries = await Promise.all(item.entries.map(resolve));
          return {
            ...item,
            entries,
            name:
              item.name ||
              entries
                .map((e) => e.name)
                .join(" + ")
                .slice(0, 180),
          };
        })
      );
      return result;
    },
    async changeLibrary(payload) {
      if (!payload || !["save", "delete"].includes(payload.action))
        throw new NutritionError("Choose a library action.");
      let item;
      if (payload.action === "save") {
        const input = payload.item;
        if (
          !input ||
          !/^[a-zA-Z0-9_-]{8,80}$/.test(input.id || "") ||
          !Array.isArray(input.entries) ||
          !input.entries.length ||
          input.entries.length > 30
        )
          throw new NutritionError("Save a food or a meal with up to 30 foods.");
        item = {
          id: input.id,
          name: text(input.name, 180, "food name").replace(
            /(^|[\s(/-])([a-z])/g,
            (_, prefix, c) => prefix + c.toUpperCase()
          ),
          entries: input.entries.map(validateEntry).map(storedNutritionEntry),
          favorite: input.favorite === true,
          custom: input.custom === true,
        };
      }
      if (item && !item.custom && item.entries.some((e) => e.source === "fatsecret"))
        item.name = "";
      return library().update((state) => {
        if (state.revision !== payload.revision)
          throw new NutritionError("Your food library changed. Reload and try again.", 409);
        state.items = state.items.filter((old) => old.id !== (item?.id || payload.id));
        if (item && (item.custom || item.favorite)) state.items.push(item);
        if (state.items.length > 200)
          throw new NutritionError("Your library is full. Remove an unused food first.");
        state.revision++;
        return state;
      });
    },
    async change(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new NutritionError("Check the food entry.");
      const date = nutritionDate(payload.date);
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(payload.operationId || ""))
        throw new NutritionError("The save identifier is invalid.");
      if (!["add", "update", "delete"].includes(payload.action))
        throw new NutritionError("Unknown food action.");
      const entries =
        payload.action === "delete"
          ? []
          : (Array.isArray(payload.entries) ? payload.entries : []).map(validateEntry);
      if (payload.action !== "delete" && (!entries.length || entries.length > 30))
        throw new NutritionError("Save between 1 and 30 foods at a time.");
      if (new Set(entries.map((e) => e.id)).size !== entries.length)
        throw new NutritionError("Duplicate food identifiers.");
      return month(date).update((state) => {
        const day = state.days[date] || emptyDay();
        if (day.operations.includes(payload.operationId)) return day;
        if (day.revision !== payload.revision)
          throw new NutritionError(
            "Your food log changed in another view. Reload it, then save again.",
            409
          );
        let next = [...day.entries];
        if (payload.action === "add") {
          if (entries.some((e) => next.some((old) => old.id === e.id)))
            throw new NutritionError("This food was already saved. Reload your log.", 409);
          next.push(...entries);
        } else if (payload.action === "update") {
          if (entries.length !== 1 || !next.some((e) => e.id === entries[0].id))
            throw new NutritionError("This food no longer exists. Reload your log.", 409);
          next = next.map((e) => (e.id === entries[0].id ? entries[0] : e));
        } else {
          if (!next.some((e) => e.id === payload.id))
            throw new NutritionError("This food was already removed. Reload your log.", 409);
          next = next.filter((e) => e.id !== payload.id);
        }
        if (next.length > 150)
          throw new NutritionError("This day has reached its limit of 150 foods.");
        state.days[date] = {
          entries: next.map(storedNutritionEntry),
          revision: day.revision + 1,
          operations: [...day.operations, payload.operationId].slice(-100),
        };
        return state.days[date];
      });
    },
  };
}
