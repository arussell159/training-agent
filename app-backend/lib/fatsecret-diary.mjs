import { createHash } from "node:crypto";
import { createFatSecretOAuth1 } from "./fatsecret-oauth1.mjs";
import { entryFromFatSecret } from "./nutrition-fatsecret.mjs";
import { nutritionDate, NutritionError } from "./nutrition-model.mjs";

export const diaryDate = (date) =>
  Math.floor(Date.parse(`${nutritionDate(date)}T00:00:00Z`) / 86400000);
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);

export function createFatSecretDiary({
  env = () => process.env,
  oauth = createFatSecretOAuth1({ env }),
  catalog,
} = {}) {
  let profilePromise;
  const userId = () =>
    env().FATSECRET_DIARY_PROFILE_ID ||
    `ar-local-${createHash("sha256")
      .update(env().FATSECRET_CONSUMER_KEY || "")
      .digest("hex")
      .slice(0, 24)}`;
  async function profile() {
    if (!profilePromise)
      profilePromise = (async () => {
        let data;
        try {
          data = await oauth.request("profile/auth/v1", { user_id: userId() });
        } catch (error) {
          if (error.providerCode !== 106) throw error;
          data = await oauth.request("profile/v1", { user_id: userId() }, { method: "POST" });
        }
        if (!data.profile?.auth_token || !data.profile?.auth_secret)
          throw new NutritionError("FatSecret did not provide a diary profile.", 502);
        return data.profile;
      })().catch((error) => {
        profilePromise = null;
        throw error;
      });
    return profilePromise;
  }
  async function request(path, params, method = "GET") {
    return oauth.request(path, params, { method, profile: await profile() });
  }
  async function rawDay(date) {
    const data = await request("food-entries/v2", { date: diaryDate(date) });
    return list(data.food_entries?.food_entry);
  }
  async function readDay(date) {
    const rows = await rawDay(date);
    const products = new Map();
    return Promise.all(
      rows.map(async (row) => {
        const foodId = String(row.food_id);
        if (!products.has(foodId)) products.set(foodId, catalog.product(foodId));
        const product = await products.get(foodId);
        const serving = product?.servings.find((s) => s.id === String(row.serving_id));
        if (!serving)
          throw new NutritionError("A saved FatSecret serving is no longer available.", 502);
        return entryFromFatSecret(
          product,
          serving.id,
          Number(row.number_of_units) / serving.units,
          String(row.meal).toLowerCase() === "other" ? "snacks" : String(row.meal).toLowerCase(),
          `fsdiary_${row.food_entry_id}`
        );
      })
    );
  }
  async function portion(entry) {
    const product = await catalog.product(entry.foodId);
    const serving = product?.servings.find((s) => s.id === entry.servingId);
    if (!serving) throw new NutritionError("Choose an available FatSecret serving.");
    return {
      food_entry_name: entry.name,
      serving_id: entry.servingId,
      number_of_units: Number((entry.quantity * serving.units).toFixed(4)),
      meal: entry.meal === "snacks" ? "other" : entry.meal,
    };
  }
  return {
    configured: oauth.configured,
    rawDay,
    readDay,
    async month(date) {
      const data = await request("food-entries/month/v1", { date: diaryDate(date) });
      return list(data.month?.day).map((day) => ({
        date: new Date(Number(day.date_int) * 86400000).toISOString().slice(0, 10),
        totals: {
          calories: Number(day.calories),
          protein: Number(day.protein),
          carbs: Number(day.carbohydrate),
          fat: Number(day.fat),
          fiber: 0,
        },
      }));
    },
    async add(date, entry) {
      const data = await request(
        "food-entries/v1",
        { date: diaryDate(date), food_id: entry.foodId, ...(await portion(entry)) },
        "POST"
      );
      const row = list(data.food_entries?.food_entry)[0];
      const id = row?.food_entry_id || data.food_entry_id?.value || data.food_entry_id;
      if (!/^\d+$/.test(String(id || "")))
        throw new NutritionError(
          "FatSecret did not confirm the new diary entry. Reload before retrying.",
          502
        );
      return `fsdiary_${id}`;
    },
    async update(entry) {
      const data = await request(
        "food-entries/v1",
        { food_entry_id: entry.id.replace(/^fsdiary_/, ""), ...(await portion(entry)) },
        "PUT"
      );
      if (Number(data.success?.value ?? data.success) !== 1)
        throw new NutritionError("FatSecret did not confirm this edit.", 502);
    },
    async remove(id) {
      const data = await request(
        "food-entries/v1",
        { food_entry_id: id.replace(/^fsdiary_/, "") },
        "DELETE"
      );
      if (Number(data.success?.value ?? data.success) !== 1)
        throw new NutritionError("FatSecret did not confirm this deletion.", 502);
    },
  };
}
