import test from "node:test";
import assert from "node:assert/strict";
import {
  createFoodCatalog,
  normalizeFatSecret,
  entryFromFatSecret,
  estimateFood,
  exactCatalogPortion,
} from "./nutrition-fatsecret.mjs";
import { createNutritionStore, storedNutritionEntry } from "./nutrition-model.mjs";

test("explicit portions use exact catalog measurements rather than rounded model serving counts", () => {
  const drink = {
    servings: [
      { id: "cup", label: "1 cup", metricUnit: "g", metricAmount: 248 },
      { id: "fluid", label: "1 fl oz", metricUnit: "g", metricAmount: 31 },
    ],
  };
  assert.equal(exactCatalogPortion(drink, "10oz", "orange juice").servingId, "fluid");
  assert.equal(exactCatalogPortion(drink, "10oz", "orange juice").quantity, 10);
  assert.equal(
    exactCatalogPortion({ servings: [drink.servings[0]] }, "10 fl oz", "juice").quantity,
    1.25
  );
  const solid = { servings: [{ id: "grams", label: "100 g", metricUnit: "g", metricAmount: 100 }] };
  assert.equal(exactCatalogPortion(solid, "200g", "white rice").quantity, 2);
  assert.equal(exactCatalogPortion(solid, "2 oz", "steak").quantity, 56.69904625 / 100);
  assert.equal(exactCatalogPortion(solid, "2 bagels", "bagels"), null);
  assert.equal(exactCatalogPortion(solid, "200 ml", "rice"), null);
});

const food = {
  food_id: "123",
  food_name: "cooked white rice",
  brand_name: "",
  servings: {
    serving: [
      {
        serving_id: "11",
        serving_description: "1 cup",
        measurement_description: "cup",
        number_of_units: "1",
        metric_serving_amount: "158",
        metric_serving_unit: "g",
        calories: "205",
        protein: "4.3",
        carbohydrate: "44.5",
        fat: "0.4",
      },
      {
        serving_id: "12",
        serving_description: "100 g",
        measurement_description: "g",
        number_of_units: "100",
        metric_serving_amount: "100",
        metric_serving_unit: "g",
        calories: "130",
        protein: "2.7",
        carbohydrate: "28.2",
        fat: "0.3",
      },
    ],
  },
};
const product = normalizeFatSecret(food);
const env = () => ({ FATSECRET_CLIENT_ID: "fake-id", FATSECRET_CLIENT_SECRET: "fake-secret" });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
test("available food photos survive hydration and untrusted image hosts are discarded", () => {
  const imageUrl = "https://www.foodimagedb.com/food-images/fixture_72x72.png";
  const withImage = normalizeFatSecret({
    ...food,
    food_images: { food_image: { image_url: imageUrl } },
  });
  assert.equal(withImage.imageUrl, imageUrl);
  assert.equal(entryFromFatSecret(withImage, "11", 1, "lunch").imageUrl, imageUrl);
  const unsafe = normalizeFatSecret({
    ...food,
    food_images: {
      food_image: { image_url: "https://www.foodimagedb.com.evil.example/photo.png" },
    },
  });
  assert.equal(unsafe.imageUrl, null);
});
test("FatSecret normalizes singleton servings and requires all macros, preserving true zeros", () => {
  assert.equal(product.name, "Cooked White Rice");
  assert.equal(product.servingId, "11");
  const singleton = normalizeFatSecret({
    ...food,
    servings: { serving: { ...food.servings.serving[0], fat: "0" } },
  });
  assert.equal(singleton.nutrients.fat, 0);
  assert.equal(singleton.complete, true);
  assert.equal(
    normalizeFatSecret({
      ...food,
      servings: { serving: { ...food.servings.serving[0], fat: undefined } },
    }).complete,
    false
  );
  const summary = normalizeFatSecret({
    food_id: "8",
    food_name: "pizza",
    brand_name: "Pizza Hut",
    food_description:
      "Per 1 slice - Calories: 300kcal | Fat: 10.00g | Carbs: 42.00g | Protein: 11.00g",
  });
  assert.equal(summary.servingSize, "1 slice");
  assert.equal(summary.nutrients.protein, 11);
  assert.equal(summary.complete, true);
});
test("FatSecret uses server-only OAuth, US default and token reuse without a Basic catalog cache", async () => {
  let tokens = 0,
    searches = 0;
  const catalog = createFoodCatalog({
    env,
    fetchImpl: async (url, options) => {
      if (url.includes("/connect/token")) {
        tokens++;
        assert.equal(options.body, "grant_type=client_credentials&scope=basic");
        assert.match(options.headers.Authorization, /^Basic /);
        return json({ access_token: "test-token", expires_in: 86400 });
      }
      searches++;
      assert.equal(options.headers.Authorization, "Bearer test-token");
      assert.equal(new URL(url).searchParams.has("region"), false);
      return json({ foods: { food: [] } });
    },
  });
  await catalog.search("rice");
  await catalog.search("rice");
  assert.equal(tokens, 1);
  assert.equal(searches, 2);
});
test("FatSecret denied IP, missing keys, timeouts and incomplete products fail without fallback", async () => {
  await assert.rejects(createFoodCatalog({ env: () => ({}) }).search("rice"), { status: 503 });
  const denied = createFoodCatalog({
    env,
    fetchImpl: async (url) =>
      url.includes("/connect/token")
        ? json({ access_token: "test", expires_in: 1000 })
        : json({ error: { code: 21, message: "Private details" } }),
  });
  await assert.rejects(
    denied.search("rice"),
    (e) => e.status === 502 && !e.message.includes("Private details") && /IP/.test(e.message)
  );
  const down = createFoodCatalog({
    env,
    fetchImpl: async () => {
      throw Error("secret transport details");
    },
  });
  await assert.rejects(
    down.search("rice"),
    (e) => e.status === 502 && !e.message.includes("secret transport")
  );
});

test("simultaneous catalog reads share authentication and identical in-flight requests", async () => {
  let tokens = 0,
    searches = 0;
  const catalog = createFoodCatalog({
    env,
    fetchImpl: async (url) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (url.includes("/connect/token")) {
        tokens++;
        return json({ access_token: "token", expires_in: 3600 });
      }
      searches++;
      return json({ foods: { food: [] } });
    },
  });
  await Promise.all([catalog.search("rice"), catalog.search("rice"), catalog.search("beans")]);
  assert.equal(tokens, 1);
  assert.equal(searches, 2);
});

test("FatSecret rate limits and malformed responses fail distinctly without retry or false empty matches", async () => {
  for (const code of [11, 12]) {
    let calls = 0;
    const catalog = createFoodCatalog({
      env: () => ({ FATSECRET_CONSUMER_KEY: "dummy", FATSECRET_CONSUMER_SECRET: "dummy" }),
      fetchImpl: async () => {
        calls++;
        return json({ error: { code, message: "secret must not escape" } });
      },
    });
    await assert.rejects(
      catalog.search("rice"),
      (error) => error.status === 429 && !error.message.includes("secret must")
    );
    assert.equal(calls, 1);
  }
  const catalog = createFoodCatalog({
    env,
    fetchImpl: async (url) =>
      url.includes("/connect/token")
        ? json({ access_token: "token", expires_in: 3600 })
        : json({ unexpected: [] }),
  });
  await assert.rejects(catalog.search("rice"), /incomplete search results/);
  await assert.rejects(catalog.product("123"), /incomplete food details/);
});

test("expired OAuth token refresh is coalesced and stale failures cannot invalidate its replacement", async () => {
  let tokens = 0;
  const calls = new Map();
  const catalog = createFoodCatalog({
    env,
    fetchImpl: async (url, options) => {
      if (url.includes("/connect/token"))
        return json({ access_token: `token-${++tokens}`, expires_in: 3600 });
      const query = new URL(url).searchParams.get("search_expression");
      calls.set(query, (calls.get(query) || 0) + 1);
      if (options.headers.Authorization === "Bearer token-1") return json({ error: { code: 13 } });
      return json({ foods: { food: [] } });
    },
  });
  await Promise.all([catalog.search("rice"), catalog.search("beans"), catalog.search("milk")]);
  assert.equal(tokens, 2);
  assert.deepEqual([...calls.values()], [2, 2, 2]);
});

test("one deadline bounds hung provider work and queued requests, then permits recovery", async () => {
  let hung = true;
  const catalog = createFoodCatalog({
    deadlineMs: 30,
    env: () => ({ FATSECRET_CONSUMER_KEY: "dummy", FATSECRET_CONSUMER_SECRET: "dummy" }),
    fetchImpl: async () => {
      if (hung) return new Promise(() => {});
      return json({ foods: { food: [] } });
    },
  });
  const start = performance.now();
  const outcomes = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) => catalog.search(`food-${i}`))
  );
  assert.ok(
    outcomes.every((result) => result.status === "rejected" && result.reason.status === 504)
  );
  assert.ok(performance.now() - start < 250);
  hung = false;
  assert.deepEqual(await catalog.search("recovered"), []);
});

test("catalog retries one transient provider failure but does not retry a bad signature", async () => {
  for (const code of [20, 8]) {
    let calls = 0;
    const catalog = createFoodCatalog({
      env: () => ({ FATSECRET_CONSUMER_KEY: "dummy", FATSECRET_CONSUMER_SECRET: "dummy" }),
      fetchImpl: async () => {
        calls++;
        return calls === 1 ? json({ error: { code } }) : json({ foods: { food: [] } });
      },
    });
    if (code === 20) {
      assert.deepEqual(await catalog.search("rice"), []);
      assert.equal(calls, 2);
    } else {
      await assert.rejects(catalog.search("rice"), /denied/);
      assert.equal(calls, 1);
    }
  }
});

test("cancelled views stop obsolete provider work without cancelling another shared consumer", async () => {
  let upstream, complete;
  const catalog = createFoodCatalog({
    env: () => ({ FATSECRET_CONSUMER_KEY: "dummy", FATSECRET_CONSUMER_SECRET: "dummy" }),
    fetchImpl: async (_url, options) => {
      upstream = options.signal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  });
  const a = new AbortController(),
    b = new AbortController();
  const first = catalog.search("rice", a.signal);
  const second = catalog.search("rice", b.signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  a.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(upstream.aborted, false);
  complete(json({ foods: { food: [] } }));
  assert.deepEqual(await second, []);
  const c = new AbortController();
  const obsolete = catalog.product("123", c.signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  c.abort();
  await assert.rejects(obsolete, { name: "AbortError" });
  assert.equal(upstream.aborted, true);
});

test("provider Retry-After prevents repeated searches from hammering a rate-limited account", async () => {
  let calls = 0,
    clock = 0;
  const catalog = createFoodCatalog({
    now: () => clock,
    env: () => ({ FATSECRET_CONSUMER_KEY: "dummy", FATSECRET_CONSUMER_SECRET: "dummy" }),
    fetchImpl: async () => {
      if (++calls === 1)
        return new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
      return json({ foods: { food: [] } });
    },
  });
  await assert.rejects(
    catalog.search("rice"),
    (error) => error.status === 429 && error.retryAfter === 2
  );
  await assert.rejects(
    catalog.search("beans"),
    (error) => error.status === 429 && error.retryAfter === 2
  );
  assert.equal(calls, 1);
  clock = 2001;
  assert.deepEqual(await catalog.search("beans"), []);
  assert.equal(calls, 2);
});
test("API serving values determine nutrition and durable records contain only references", () => {
  const entry = entryFromFatSecret(product, "12", 2, "lunch", "entry-test-123");
  assert.equal(entry.calories, 260);
  assert.equal(entry.protein, 5.4);
  assert.equal(entry.gramsPerUnit, 100);
  assert.deepEqual(storedNutritionEntry(entry), {
    id: "entry-test-123",
    source: "fatsecret",
    foodId: "123",
    servingId: "12",
    quantity: 2,
    meal: "lunch",
  });
  assert.throws(() => entryFromFatSecret(product, "missing", 2, "lunch"));
  assert.throws(() => entryFromFatSecret(product, "12", -1, "lunch"));
});
test("typed matching only uses returned catalog identifiers and nutrients; unmatched foods remain unresolved", async () => {
  let calls = 0;
  const catalog = {
    configured: () => true,
    search: async () => [product],
    product: async () => product,
  };
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.store, false);
    const response =
      calls++ === 0
        ? {
            foods: [
              { query: "cooked white rice", portion: "200 g", meal: "lunch" },
              { query: "unavailable pizza", portion: "1 slice", meal: "dinner" },
            ],
          }
        : {
            matches: [
              { index: 0, foodId: "123", servingId: "12", quantity: 2, notes: "" },
              { index: 1, foodId: "invented", servingId: "12", quantity: 1, notes: "" },
            ],
          };
    return json({
      status: "completed",
      output: [{ content: [{ type: "output_text", text: JSON.stringify(response) }] }],
    });
  };
  const result = await estimateFood(
    { text: "Lunch 200g cooked rice, dinner unavailable pizza", meal: "snacks" },
    { key: "fake", model: "test", catalog, fetchImpl }
  );
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].calories, 260);
  assert.equal(result.entries[0].source, "fatsecret");
  assert.match(result.notes, /Not added: Unavailable Pizza/);
});
test("saved FatSecret log and favorites hydrate from identifiers for totals and retain revisions", async () => {
  const records = new Map();
  const store = createNutritionStore((key, fresh) => ({
    read: async () => structuredClone(records.get(key) || fresh()),
    update: async (fn) => {
      const state = structuredClone(records.get(key) || fresh());
      const result = fn(state);
      records.set(key, state);
      return structuredClone(result);
    },
  }));
  const entry = entryFromFatSecret(product, "12", 2, "lunch", "entry-test-123");
  await store.change({
    date: "2026-10-02",
    action: "add",
    entries: [entry],
    operationId: "operation-test-123",
    revision: 0,
  });
  const raw = records.get("2026-10");
  assert.equal(raw.days["2026-10-02"].entries[0].calories, undefined);
  const hydrate = async (e) => entryFromFatSecret(product, e.servingId, e.quantity, e.meal, e.id);
  const view = await store.view("2026-10-02", hydrate);
  assert.equal(view.day.entries[0].calories, 260);
  assert.equal(view.week[6].totals.calories, 260);
  await store.changeLibrary({
    action: "save",
    revision: 0,
    item: { id: "favorite-123", name: entry.name, entries: [entry], favorite: true, custom: false },
  });
  assert.equal(records.get("library").items[0].name, "");
  const library = await store.library(hydrate);
  assert.equal(library.items[0].name, "Cooked White Rice");
  assert.equal(library.items[0].entries[0].calories, 260);
});
