import { createHash } from "node:crypto";
import {
  NUTRIENTS,
  NutritionError,
  nutritionDate,
  nutritionTotals,
  validateEntry,
} from "./nutrition-model.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const remoteId = (id) => /^fsdiary_\d+$/.test(id || "");
const samePortion = (a, b) =>
  a.foodId === b.foodId &&
  a.servingId === b.servingId &&
  a.meal === b.meal &&
  Math.abs(a.quantity - b.quantity) < 0.0001;

// Local preview adapter. FatSecret owns catalog diary entries; local files keep
// custom foods, preferences and a write journal so retries cannot double-log food.
export function createFatSecretDiaryStore({ local, diary, record }) {
  const queues = new Map();
  const journal = (date) => record(date.slice(0, 7), () => ({ operations: {} }));
  async function readDay(date, hydrate) {
    const [base, remote] = await Promise.all([local.view(date, hydrate), diary.readDay(date)]);
    const entries = [...base.day.entries, ...remote];
    const revision = parseInt(hash([base.day.revision, remote]).slice(0, 12), 16);
    return { base, remote, day: { entries, revision } };
  }
  async function change(payload) {
    const date = nutritionDate(payload?.date);
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
    const log = journal(date),
      digest = hash([date, payload.action, entries, payload.id]);
    let operation = (await log.read()).operations[payload.operationId];
    if (operation && operation.digest !== digest)
      throw new NutritionError("This save identifier was already used for another change.", 409);
    const current = await readDay(date);
    if (operation?.complete) return current.day;
    if (!operation) {
      if (current.day.revision !== payload.revision)
        throw new NutritionError("Your food log changed. Reload it before saving.", 409);
      if (payload.action === "add") {
        if (current.day.entries.length + entries.length > 150)
          throw new NutritionError("This day has reached its limit of 150 foods.");
        if (entries.some((entry) => current.day.entries.some((old) => old.id === entry.id)))
          throw new NutritionError("This food was already saved. Reload your log.", 409);
      } else {
        const id = payload.action === "delete" ? payload.id : entries[0]?.id;
        if (
          (payload.action === "update" && entries.length !== 1) ||
          !current.day.entries.some((entry) => entry.id === id)
        )
          throw new NutritionError("This food no longer exists. Reload your log.", 409);
        if (payload.action === "update" && remoteId(id)) {
          const before = current.remote.find((entry) => entry.id === id);
          if (entries[0].source !== "fatsecret" || entries[0].foodId !== before.foodId)
            throw new NutritionError("Choose the original food when editing this diary entry.");
        }
      }
      operation = { digest, date, steps: {}, complete: false };
      await log.update((state) => {
        state.operations[payload.operationId] = operation;
      });
    }
    const remember = async (key, step) => {
      operation.steps[key] = step;
      await log.update((state) => {
        state.operations[payload.operationId] = operation;
      });
    };
    if (payload.action === "add") {
      for (const entry of entries.filter((e) => e.source === "fatsecret")) {
        const step = operation.steps[entry.id];
        if (step?.done) continue;
        if (step?.sending) {
          const matches = current.remote.filter(
            (candidate) => !step.before.includes(candidate.id) && samePortion(candidate, entry)
          );
          if (matches.length === 1) {
            await remember(entry.id, { done: true, id: matches[0].id });
            continue;
          }
          throw new NutritionError(
            "A previous FatSecret save could not be confirmed. Reload your diary and check the foods before adding them again.",
            409
          );
        }
        const before = (await diary.readDay(date)).map((e) => e.id);
        await remember(entry.id, { sending: true, before });
        const id = await diary.add(date, entry);
        await remember(entry.id, { done: true, id });
      }
    } else if (payload.action === "update" && remoteId(entries[0].id)) {
      await diary.update(entries[0]);
    } else if (payload.action === "delete" && remoteId(payload.id)) {
      if (current.remote.some((entry) => entry.id === payload.id)) await diary.remove(payload.id);
    }
    const localEntries =
      payload.action === "add" ? entries.filter((e) => e.source !== "fatsecret") : entries;
    const localChange =
      payload.action === "add" ? localEntries.length > 0 : !remoteId(payload.id || entries[0]?.id);
    if (localChange)
      await local.change({
        ...payload,
        entries: localEntries,
        revision: current.base.day.revision,
      });
    operation.complete = true;
    await log.update((state) => {
      state.operations[payload.operationId] = operation;
    });
    return (await readDay(date)).day;
  }
  return {
    ...local,
    async view(date, hydrate) {
      const current = await readDay(date, hydrate);
      const months = [...new Set(current.base.week.map((day) => day.date.slice(0, 7)))];
      const days = (await Promise.all(months.map((month) => diary.month(`${month}-01`)))).flat();
      return {
        ...current.base,
        diaryStorage: "fatsecret",
        day: current.day,
        week: current.base.week.map((day) => {
          if (day.date === date)
            return {
              ...day,
              logged: current.day.entries.length > 0,
              totals: nutritionTotals(current.day.entries),
            };
          const remote = days.find((item) => item.date === day.date);
          return !remote
            ? day
            : {
                ...day,
                logged: true,
                totals: Object.fromEntries(
                  NUTRIENTS.map((key) => [key, day.totals[key] + remote.totals[key]])
                ),
              };
        }),
      };
    },
    change(payload) {
      const date = nutritionDate(payload?.date);
      const work = (queues.get(date) || Promise.resolve())
        .catch(() => {})
        .then(() => change(payload));
      queues.set(date, work);
      void work
        .finally(() => {
          if (queues.get(date) === work) queues.delete(date);
        })
        .catch(() => {});
      return work;
    },
  };
}
