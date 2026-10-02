import test from "node:test";
import assert from "node:assert/strict";
import { createFatSecretDiaryStore } from "./fatsecret-diary-store.mjs";
import { createFatSecretDiary, diaryDate } from "./fatsecret-diary.mjs";
import { createNutritionStore } from "./nutrition-model.mjs";
import { oauth1Signature } from "./fatsecret-oauth1.mjs";

function records() {
  const data = new Map();
  return (key, fresh) => ({
    read: async () => structuredClone(data.get(key) || fresh()),
    update: async (change) => {
      const state = structuredClone(data.get(key) || fresh());
      const result = await change(state);
      data.set(key, state);
      return structuredClone(result);
    },
  });
}
const food = (patch = {}) => ({
  id: "fixture_food_1",
  name: "Rice",
  source: "fatsecret",
  foodId: "123",
  servingId: "11",
  quantity: 1,
  unit: "1 cup",
  meal: "lunch",
  calories: 205,
  protein: 4.3,
  carbs: 44.5,
  fat: 0.4,
  fiber: null,
  ...patch,
});
function fixture() {
  let rows = [],
    creates = 0,
    uncertain = false;
  const diary = {
    readDay: async () => structuredClone(rows),
    month: async () => [],
    add: async (_date, entry) => {
      const id = `fsdiary_${++creates}`;
      rows.push({ ...entry, id });
      if (uncertain) {
        uncertain = false;
        throw Error("timeout after save");
      }
      return id;
    },
    update: async (entry) => {
      rows = rows.map((row) => (row.id === entry.id ? entry : row));
    },
    remove: async (id) => {
      rows = rows.filter((row) => row.id !== id);
    },
  };
  const local = createNutritionStore(records());
  const journal = records();
  const store = createFatSecretDiaryStore({ local, diary, record: journal });
  return {
    store,
    local,
    diary,
    journal,
    creates: () => creates,
    failAfterSave: () => {
      uncertain = true;
    },
  };
}
test("OAuth 1.0 signature matches the standard photos example", () => {
  const signature = oauth1Signature(
    "GET",
    "http://photos.example.net/photos",
    {
      file: "vacation.jpg",
      size: "original",
      oauth_consumer_key: "dpf43f3p2l4k3l03",
      oauth_token: "nnch734d00sl2jdk",
      oauth_nonce: "kllo9940pd9333jh",
      oauth_timestamp: "1191242096",
      oauth_signature_method: "HMAC-SHA1",
      oauth_version: "1.0",
    },
    "kd94hf93k423kf44",
    "pfkkdhi9sl3r4s00"
  );
  assert.equal(signature, "tR3+Ty81lMeYAr/Fid0kMTYa/WM=");
});
test("FatSecret diary stores catalog foods remotely, local custom foods separately, and retries once", async () => {
  const { store, local, creates } = fixture(),
    date = "2026-10-02";
  const revision = (await store.view(date)).day.revision;
  const payload = {
    date,
    revision,
    action: "add",
    operationId: "operation_add_1",
    entries: [food(), food({ id: "custom_food_1", source: "manual" })],
  };
  const day = await store.change(payload);
  assert.equal(day.entries.length, 2);
  assert.equal((await local.view(date)).day.entries.length, 1);
  assert.equal((await store.change(payload)).entries.length, 2);
  assert.equal(creates(), 1);
  const remote = day.entries.find((e) => e.id.startsWith("fsdiary_"));
  const edited = await store.change({
    date,
    revision: day.revision,
    action: "update",
    operationId: "operation_edit_1",
    entries: [{ ...remote, meal: "snacks", quantity: 2 }],
  });
  assert.equal(edited.entries.find((e) => e.id === remote.id).meal, "snacks");
  const removed = await store.change({
    date,
    revision: edited.revision,
    action: "delete",
    operationId: "operation_delete_1",
    id: remote.id,
  });
  assert.equal(removed.entries.length, 1);
  const restored = await store.change({
    date,
    revision: removed.revision,
    action: "add",
    operationId: "operation_undo_1",
    entries: [remote],
  });
  assert.equal(restored.entries.length, 2);
  await assert.rejects(store.change({ ...payload, operationId: "operation_stale_1" }), {
    status: 409,
  });
});
test("uncertain remote create is reconciled after restart without duplicate food", async () => {
  const { store, local, diary, journal, creates, failAfterSave } = fixture(),
    date = "2026-10-02";
  const payload = {
    date,
    revision: (await store.view(date)).day.revision,
    action: "add",
    operationId: "operation_uncertain",
    entries: [food()],
  };
  failAfterSave();
  await assert.rejects(store.change(payload), /timeout/);
  const restarted = createFatSecretDiaryStore({ local, diary, record: journal });
  assert.equal((await restarted.change(payload)).entries.length, 1);
  assert.equal(creates(), 1);
  await assert.rejects(restarted.change({ ...payload, entries: [food({ quantity: 3 })] }), {
    status: 409,
  });
});
test("diary converts serving counts to provider units and maps snacks to other", async () => {
  const calls = [];
  const product = {
    code: "123",
    name: "Rice",
    brand: "",
    servings: [
      {
        id: "11",
        label: "100 g",
        units: 100,
        metricAmount: 100,
        metricUnit: "g",
        calories: 130,
        protein: 2.7,
        carbs: 28,
        fat: 0.3,
        fiber: null,
      },
    ],
  };
  const diary = createFatSecretDiary({
    env: () => ({ FATSECRET_CONSUMER_KEY: "fixture" }),
    catalog: { product: async () => product },
    oauth: {
      configured: () => true,
      request: async (path, params, options) => {
        calls.push({ path, params, options });
        if (path === "profile/auth/v1")
          return { profile: { auth_token: "token", auth_secret: "secret" } };
        if (options?.method === "POST") return { food_entry_id: { value: "900" } };
        return {
          food_entries: {
            food_entry: [
              {
                food_entry_id: "900",
                food_id: "123",
                serving_id: "11",
                number_of_units: "250",
                meal: "Other",
              },
            ],
          },
        };
      },
    },
  });
  await diary.add("2026-10-02", food({ quantity: 2.5, meal: "snacks" }));
  assert.equal(calls[1].params.number_of_units, 250);
  assert.equal(calls[1].params.meal, "other");
  const [saved] = await diary.readDay("2026-10-02");
  assert.equal(saved.quantity, 2.5);
  assert.equal(saved.calories, 325);
  assert.equal(saved.meal, "snacks");
  assert.equal(diaryDate("1970-01-01"), 0);
  assert.equal(diaryDate("2026-10-02") - diaryDate("2026-10-01"), 1);
});
