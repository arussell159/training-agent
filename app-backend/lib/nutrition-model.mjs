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
  return Object.fromEntries(
    NUTRIENTS.map((key) => [
      key,
      number(input[key], key === "calories" ? 20000 : 3000, `${key} target`, true),
    ])
  );
}
export function validateEntry(input) {
  if (!input || typeof input !== "object") throw new NutritionError("Check the food entry.");
  if (Array.isArray(input.missingValues) && input.missingValues.length)
    throw new NutritionError("Enter the missing nutrition values before saving.");
  if (!MEALS.includes(input.meal))
    throw new NutritionError("Choose breakfast, lunch, dinner, or snacks.");
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(input.id || ""))
    throw new NutritionError("The food identifier is invalid.");
  const quantity = number(input.quantity, 100000, "quantity");
  if (quantity <= 0) throw new NutritionError("Quantity must be greater than zero.");
  const source = ["openfoodfacts", "ai", "manual"].includes(input.source) ? input.source : "manual";
  const entry = {
    id: input.id,
    name: text(input.name, 180, "food name"),
    meal: input.meal,
    quantity,
    unit: text(input.unit, 40, "portion unit"),
    gramsPerUnit:
      input.gramsPerUnit == null ? null : number(input.gramsPerUnit, 100000, "unit weight"),
    servingQuantity:
      input.servingQuantity == null
        ? null
        : number(input.servingQuantity, 100000, "serving quantity"),
    source,
    notes: typeof input.notes === "string" ? input.notes.slice(0, 800) : "",
    barcode: /^\d{8,14}$/.test(input.barcode || "") ? input.barcode : null,
    imageUrl:
      typeof input.imageUrl === "string" &&
      /^https:\/\/images\.openfoodfacts\.org\//.test(input.imageUrl)
        ? input.imageUrl.slice(0, 1000)
        : null,
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

export function createNutritionStore(record) {
  const preferences = () => record("preferences", () => ({ revision: 0, targets: emptyTargets() }));
  const month = (date) => record(date.slice(0, 7), () => ({ days: {} }));
  const library = () => record("library", () => ({ revision: 0, items: [] }));
  return {
    async view(date) {
      nutritionDate(date);
      const dates = Array.from({ length: 7 }, (_, i) => shiftDate(date, i - 6));
      const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
      const [settings, ...records] = await Promise.all([
        preferences().read(),
        ...months.map((m) => month(m).read()),
      ]);
      const days = Object.assign({}, ...records.map((r) => r.days));
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
    async library() {
      return library().read();
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
          name: text(input.name, 180, "food name"),
          entries: input.entries.map(validateEntry),
          favorite: input.favorite === true,
          custom: input.custom === true,
        };
      }
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
          entries: next,
          revision: day.revision + 1,
          operations: [...day.operations, payload.operationId].slice(-100),
        };
        return state.days[date];
      });
    },
  };
}
