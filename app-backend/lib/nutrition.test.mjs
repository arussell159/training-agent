import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import {
  createNutritionStore,
  NutritionError,
  emptyTargets,
  nutritionDate,
  validateEntry,
  validateTargets,
} from "./nutrition-model.mjs";
import { localNutritionRecords } from "./nutrition-local-store.mjs";
import {
  createFoodCatalog,
  normalizeFoodProduct,
  estimateFood,
  rankFoodProducts,
} from "./nutrition-providers.mjs";
import { createNutritionHttp } from "./nutrition-http.mjs";
import {
  createFoodCatalog as createFatSecretCatalog,
  entryFromFatSecret,
} from "./nutrition-fatsecret.mjs";

function memoryRecords() {
  const data = new Map();
  return (key, fresh) => ({
    read: async () => structuredClone(data.get(key) || fresh()),
    update: async (change) => {
      const next = structuredClone(data.get(key) || fresh());
      const result = change(next);
      data.set(key, next);
      return structuredClone(result);
    },
  });
}
test("percentage macro targets validate and persist with effective dates", async () => {
  const store = createNutritionStore(memoryRecords());
  const targets = {
    ...emptyTargets(),
    calories: 2000,
    macroMode: "percent",
    percentages: { protein: 30, carbs: 45, fat: 25 },
  };
  await store.setTargets({ targets, revision: 0, effectiveDate: "2026-10-02" });
  const saved = (await store.view("2026-10-03")).targets;
  assert.equal(saved.protein, 150);
  assert.equal(saved.carbs, 225);
  assert.equal(saved.fat, 55.56);
  assert.equal(saved.macroMode, "percent");
  assert.deepEqual(saved.percentages, targets.percentages);
  assert.equal((await store.view("2026-10-01")).targets.calories, null);
  for (const invalid of [
    { ...targets, calories: null },
    { ...targets, percentages: { protein: 30, carbs: 30, fat: 30 } },
    { ...targets, percentages: { protein: -1, carbs: 51, fat: 50 } },
    { ...targets, percentages: { protein: null, carbs: 50, fat: 50 } },
  ])
    assert.throws(() => validateTargets(invalid));
  await store.setTargets({
    targets: { ...saved, macroMode: "grams", protein: 160 },
    revision: 1,
    effectiveDate: "2026-10-04",
  });
  assert.equal((await store.view("2026-10-05")).targets.protein, 160);
  assert.equal((await store.view("2026-10-05")).targets.percentages, undefined);
});
const food = (patch = {}) => ({
  id: "test-food-123",
  name: "Cooked rice",
  meal: "lunch",
  quantity: 200,
  unit: "g",
  calories: 260,
  protein: 5.4,
  carbs: 56.4,
  fat: 0.6,
  fiber: null,
  source: "manual",
  ...patch,
});
const add = (patch = {}) => ({
  date: "2026-10-01",
  action: "add",
  entries: [food()],
  operationId: "operation-123",
  revision: 0,
  ...patch,
});
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test("unavailable historical food never erases the requested diary or fabricates a zero total", async () => {
  const store = createNutritionStore(memoryRecords());
  await store.change(add({ date: "2026-10-20", entries: [food({ id: "historical-food" })] }));
  await store.change(add({ date: "2026-10-21", entries: [food({ id: "current-food" })] }));
  const calls = [];
  const resolve = async (entry) => {
    calls.push(entry.id);
    if (entry.id === "historical-food") {
      const error = new NutritionError("FatSecret denied access to this saved food.", 502);
      error.providerCode = 14;
      throw error;
    }
    return entry;
  };
  const view = await store.view("2026-10-21", resolve);
  assert.equal(calls[0], "current-food");
  assert.equal(view.day.entries[0].id, "current-food");
  const failed = view.week.find((day) => day.date === "2026-10-20");
  assert.equal(failed.logged, true);
  assert.equal(failed.unavailable, true);
  assert.equal(failed.totals, null);
  assert.equal(failed.providerCode, 14);
  assert.ok(!view.recentDays.some((day) => day.date === "2026-10-20"));
  await assert.rejects(store.view("2026-10-20", resolve), { status: 502, providerCode: 14 });
});

test("history has a finite shared deadline and at most two days hydrate after the requested diary", async () => {
  const store = createNutritionStore(memoryRecords(), { historyDeadlineMs: 15 });
  for (let day = 15; day <= 21; day++)
    await store.change(add({ date: `2026-10-${day}`, entries: [food({ id: `food-row-${day}` })] }));
  let running = 0,
    maximum = 0;
  const calls = [];
  const start = performance.now();
  const view = await store.view("2026-10-21", async (entry, signal) => {
    calls.push(entry.id);
    if (entry.id === "food-row-21") return entry;
    running++;
    maximum = Math.max(maximum, running);
    await new Promise((_, reject) =>
      signal.addEventListener(
        "abort",
        () => {
          running--;
          reject(new Error("Aborted"));
        },
        { once: true }
      )
    );
  });
  assert.equal(calls[0], "food-row-21");
  assert.ok(maximum <= 2);
  assert.ok(performance.now() - start < 200);
  assert.equal(view.day.entries.length, 1);
  assert.equal(
    view.week.filter((day) => day.unavailable && day.logged && day.totals === null).length,
    6
  );
});

test("nutrition rejects impossible dates and invalid quantities/macros", () => {
  for (const date of ["2026-02-30", "2026-2-01", "2026-13-01", null])
    assert.throws(() => nutritionDate(date));
  for (const patch of [
    { quantity: 0 },
    { calories: -1 },
    { protein: null },
    { meal: "brunch" },
    { fat: Infinity },
  ])
    assert.throws(() => validateEntry(food(patch)));
  assert.equal(validateEntry(food({ calories: 0 })).calories, 0);
  assert.equal(validateEntry(food({ imageUrl: "https://evil.example/image" })).imageUrl, null);
});

test("food log saves once, detects conflicts, updates, deletes and restores", async () => {
  const store = createNutritionStore(memoryRecords());
  const saved = await store.change(add());
  assert.equal(saved.revision, 1);
  assert.deepEqual(await store.change(add()), saved);
  await assert.rejects(store.change(add({ operationId: "different-operation" })), { status: 409 });
  const updated = await store.change(
    add({
      action: "update",
      entries: [food({ calories: 130, quantity: 100 })],
      operationId: "update-operation",
      revision: 1,
    })
  );
  assert.equal(updated.entries[0].calories, 130);
  const deleted = await store.change(
    add({ action: "delete", id: food().id, operationId: "delete-operation", revision: 2 })
  );
  assert.equal(deleted.entries.length, 0);
  await store.change(add({ operationId: "restore-operation", revision: 3 }));
  assert.equal((await store.view("2026-10-01")).day.entries.length, 1);
});

test("failed batch is atomic and week totals cross month boundaries", async () => {
  const store = createNutritionStore(memoryRecords());
  await assert.rejects(
    store.change(add({ entries: [food(), food({ id: "second-food", protein: null })] }))
  );
  assert.equal((await store.view("2026-10-01")).day.revision, 0);
  await store.change(add({ date: "2026-09-30" }));
  const view = await store.view("2026-10-01");
  assert.equal(view.week.length, 7);
  assert.equal(view.week[5].totals.calories, 260);
  assert.equal(view.week[5].logged, true);
  assert.equal(view.week[6].logged, false);
});

test("editable targets remain optional and use revision checks", async () => {
  const store = createNutritionStore(memoryRecords());
  const targets = { ...emptyTargets(), calories: 2400, protein: 140 };
  await store.setTargets({ targets, revision: 0, effectiveDate: "2026-10-01" });
  await assert.rejects(store.setTargets({ targets, revision: 0 }), { status: 409 });
  await assert.rejects(store.setTargets({ targets: { ...targets, fat: -2 }, revision: 1 }));
  assert.deepEqual((await store.view("2026-10-01")).targets, targets);
});

test("target changes preserve past days and apply to future days", async () => {
  const store = createNutritionStore(memoryRecords());
  const first = { ...emptyTargets(), calories: 2400 },
    next = { ...emptyTargets(), calories: 2600 };
  await store.setTargets({ targets: first, revision: 0, effectiveDate: "2026-10-01" });
  await store.setTargets({ targets: next, revision: 1, effectiveDate: "2026-10-05" });
  assert.equal((await store.view("2026-09-30")).targets.calories, null);
  assert.equal((await store.view("2026-10-02")).targets.calories, 2400);
  assert.equal((await store.view("2026-10-04")).targets.calories, 2400);
  assert.equal((await store.view("2026-10-05")).targets.calories, 2600);
  assert.equal((await store.view("2026-10-06")).targets.calories, 2600);
  const week = (await store.view("2026-10-06")).week;
  assert.equal(week.find((d) => d.date === "2026-10-04").targets.calories, 2400);
  assert.equal(week.find((d) => d.date === "2026-10-05").targets.calories, 2600);
});

test("favorite foods and reusable meals persist independently of the food log", async () => {
  const records = memoryRecords(),
    store = createNutritionStore(records);
  const item = {
    id: "favorite-food",
    name: "Rice and eggs",
    entries: [food(), food({ id: "second-food", name: "Eggs" })],
    favorite: true,
    custom: true,
  };
  await store.changeLibrary({ action: "save", item, revision: 0 });
  const restarted = createNutritionStore(records);
  assert.equal((await restarted.library()).items[0].entries.length, 2);
  assert.equal((await restarted.view("2026-10-01")).day.entries.length, 0);
  await assert.rejects(store.changeLibrary({ action: "save", item, revision: 0 }), { status: 409 });
  await store.changeLibrary({ action: "save", item: { ...item, favorite: false }, revision: 1 });
  assert.equal((await store.library()).items.length, 1);
  assert.equal((await store.library()).items[0].favorite, false);
});

test("food ranking hides incomplete labels, favors matching brands, then popularity", () => {
  const products = [
    { code: "11111111", name: "Pizza sauce", brand: "Other", complete: true, popularity: 10000 },
    {
      code: "22222222",
      name: "Pepperoni pizza",
      brand: "Pizza Hut",
      complete: true,
      popularity: 50,
    },
    { code: "33333333", name: "Cheese pizza", brand: "Pizza Hut", complete: true, popularity: 500 },
    { code: "44444444", name: "Pizza Hut", brand: "Pizza Hut", complete: false, popularity: 90000 },
  ];
  assert.deepEqual(
    rankFoodProducts(products, "pizza hut").map((p) => p.code),
    ["33333333", "22222222", "11111111"]
  );
  const p = normalizeFoodProduct({
    product_name: "Milk",
    serving_quantity: "240",
    serving_quantity_unit: "ml",
    nutriments: {},
  });
  assert.equal(p.servingQuantity, 240);
  assert.deepEqual(
    rankFoodProducts(
      [
        {
          code: "side",
          name: "Pizza Hut, chicken wings",
          brand: "Pizza Hut",
          complete: true,
          popularity: 1000,
        },
        {
          code: "pizza",
          name: "Pizza Hut, Cheese Pizza, Slice",
          brand: "Pizza Hut",
          categories: "en:pizzas",
          complete: true,
          popularity: 1,
        },
      ],
      "pizza hut"
    ).map((product) => product.code),
    ["pizza", "side"]
  );
});

test("local preview persists after restart and serializes concurrent saves", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nutrition-test-"));
  try {
    const store = createNutritionStore(localNutritionRecords(directory));
    const results = await Promise.allSettled([
      store.change(add()),
      store.change(add({ entries: [food({ id: "other-food" })], operationId: "other-operation" })),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const restarted = createNutritionStore(localNutritionRecords(directory));
    assert.equal((await restarted.view("2026-10-01")).day.entries.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("catalog preserves unknown nutrients and valid zeroes", () => {
  const product = normalizeFoodProduct({
    code: "3017624010701",
    product_name: "Example",
    nutriments: { "energy-kcal_100g": 0, fat_100g: 0 },
  });
  assert.equal(product.nutrients.calories, 0);
  assert.equal(product.nutrients.protein, null);
  assert.equal(product.complete, false);
  assert.equal(
    normalizeFoodProduct({
      product_name: "Juice",
      nutrition_data_per: "100ml",
      nutriments: { energy_100g: 418.4, energy_unit: "kJ" },
    }).nutrients.calories.toFixed(2),
    "100.00"
  );
  assert.equal(
    normalizeFoodProduct({ product_name: "Juice", serving_quantity_unit: "ml" }).unit,
    "ml"
  );
});

test("catalog deduplicates and caches provider requests; validates inputs", async () => {
  let calls = 0;
  const catalog = createFoodCatalog({
    fetchImpl: async (url, options) => {
      calls++;
      assert.match(url, /search_terms=rice/);
      const query = new URL(url).searchParams;
      assert.equal(query.get("tagtype_0"), "countries");
      assert.equal(query.get("tag_0"), "united-states");
      assert.equal(query.get("lc"), "en");
      assert.match(options.headers["User-Agent"], /ARPerformance/);
      return ok({ products: [{ product_name: "Rice" }] });
    },
  });
  await Promise.all([catalog.search("rice"), catalog.search("rice")]);
  await catalog.search("rice");
  assert.equal(calls, 1);
  assert.throws(() => catalog.product("https://example.com"));
  assert.throws(() => catalog.search("x"));
});

test("catalog retries a transient server failure once without caching errors", async () => {
  let calls = 0;
  const catalog = createFoodCatalog({
    fetchImpl: async () =>
      ++calls === 1 ? new Response("Unavailable", { status: 503 }) : ok({ products: [] }),
  });
  assert.deepEqual(await catalog.search("pizza"), []);
  assert.equal(calls, 2);
  await catalog.search("pizza");
  assert.equal(calls, 2);
  let failures = 0;
  const unavailable = createFoodCatalog({
    fetchImpl: async () => {
      failures++;
      return new Response("Unavailable", { status: 503 });
    },
  });
  await assert.rejects(unavailable.search("pizza"));
  assert.equal(failures, 2);
});

test("AI returns an editable estimate using structured output without storage", async () => {
  const result = await estimateFood(
    { meal: "lunch", text: "200g rice", image: "data:image/jpeg;base64,YQ==" },
    {
      key: "test-key",
      model: "test-model",
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://api.openai.com/v1/responses");
        const body = JSON.parse(options.body);
        assert.equal(body.store, false);
        assert.equal(body.text.format.strict, true);
        assert.equal(body.input[0].content[1].type, "input_image");
        return ok({
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ foods: [food()], notes: "Assumed cooked." }),
                },
              ],
            },
          ],
        });
      },
    }
  );
  assert.equal(result.entries[0].calories, 260);
  assert.equal(result.entries[0].quantity, 200);
  assert.equal(result.entries[0].source, "ai");
  assert.equal(result.notes, "Assumed cooked.");
});

test("AI rejects invalid images, incomplete output and malformed nutrition", async () => {
  await assert.rejects(
    estimateFood({ meal: "lunch", image: "https://example.com/private.jpg" }, { key: "test" }),
    { status: 400 }
  );
  await assert.rejects(estimateFood({ meal: "lunch", text: "rice" }, { key: "" }), { status: 503 });
  await assert.rejects(
    estimateFood(
      { meal: "lunch", text: "rice" },
      { key: "test", fetchImpl: async () => ok({ status: "incomplete" }) }
    ),
    { status: 502 }
  );
  await assert.rejects(
    estimateFood(
      { meal: "lunch", text: "rice" },
      {
        key: "test",
        fetchImpl: async () =>
          ok({
            status: "completed",
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({ foods: [food({ protein: null })] }),
                  },
                ],
              },
            ],
          }),
      }
    )
  );
});

async function request(
  handler,
  {
    route = "/api/nutrition?date=2026-10-01",
    method = "GET",
    session = true,
    origin = "http://localhost",
    payload,
  } = {}
) {
  const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
  Object.assign(req, {
    url: route,
    method,
    appSession: session ? {} : null,
    headers: {
      host: "localhost",
      origin,
      "x-coach-request": "1",
      "content-type": "application/json",
    },
  });
  const res = new EventEmitter();
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers;
  };
  res.end = (value) => {
    res.body = JSON.parse(value);
    res.writableEnded = true;
  };
  await handler(req, res, new URL(route, "http://localhost").pathname);
  return res;
}

test("nutrition errors expose only a sanitized numeric provider code for diagnosis", async () => {
  const error = new NutritionError("FatSecret denied this request.", 502);
  error.providerCode = 14;
  const handler = createNutritionHttp({
    getStore: async () => ({
      view: async () => {
        throw error;
      },
    }),
  });
  const result = await request(handler);
  assert.equal(result.status, 502);
  assert.deepEqual(result.body, { error: "FatSecret denied this request.", providerCode: 14 });
});
test("HTTP requires session and same-origin writes; estimate never saves", async () => {
  const store = createNutritionStore(memoryRecords());
  const handler = createNutritionHttp({
    getStore: async () => store,
    env: () => ({ OPENAI_API_KEY: "test", NUTRITION_LOCAL_PREVIEW: "true" }),
    estimate: async () => ({ entries: [food()], notes: "Review" }),
  });
  assert.equal((await request(handler, { session: false })).status, 401);
  assert.equal(
    (
      await request(handler, {
        route: "/api/nutrition/entries",
        method: "POST",
        origin: "https://evil.example",
        payload: add(),
      })
    ).status,
    403
  );
  assert.equal(
    (
      await request(handler, {
        route: "/api/nutrition/estimate",
        method: "POST",
        payload: { text: "rice", meal: "lunch" },
      })
    ).status,
    200
  );
  const view = await request(handler);
  assert.equal(view.body.day.entries.length, 0);
  assert.equal(view.headers["Cache-Control"], "no-store");
  assert.equal(view.body.localPreview, true);
  assert.equal(
    (await request(handler, { route: "/api/nutrition/entries", method: "POST", payload: add() }))
      .status,
    200
  );
  assert.equal((await request(handler)).body.day.entries.length, 1);
});

test("nutrition opens share only an in-flight view; completed responses and writes are never cached", async () => {
  const store = createNutritionStore(memoryRecords());
  let reads = 0;
  const handler = createNutritionHttp({
    getStore: async () => {
      reads++;
      return store;
    },
    catalog: { hydrate: async (entry) => entry },
    env: () => ({}),
  });
  const [a, b] = await Promise.all([request(handler), request(handler)]);
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, b.body);
  await request(handler);
  assert.equal(reads, 2);
  assert.equal((await request(handler, { session: false })).status, 401);
  const write = await request(handler, {
    route: "/api/nutrition/entries",
    method: "POST",
    payload: add(),
  });
  assert.equal(write.status, 200);
  assert.equal((await request(handler)).body.day.entries.length, 1);
  assert.equal(reads, 4);
});

test("food commit returns a durable receipt without post-commit provider work and replays during outage", async () => {
  const store = createNutritionStore(memoryRecords());
  let calls = 0,
    offline = false;
  const handler = createNutritionHttp({
    getStore: async () => store,
    env: () => ({}),
    catalog: {
      hydrate: async (entry) => {
        calls++;
        if (offline) throw Error("Provider unavailable");
        return entry;
      },
    },
  });
  const payload = add({
    entries: [food({ source: "fatsecret", foodId: "123", servingId: "456" })],
  });
  const saved = await request(handler, {
    route: "/api/nutrition/entries",
    method: "POST",
    payload,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.committed, true);
  assert.equal(saved.body.revision, 1);
  assert.equal(calls, 1);
  offline = true;
  const replay = await request(handler, {
    route: "/api/nutrition/entries",
    method: "POST",
    payload,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.committed, true);
  assert.equal(replay.body.revision, 1);
  assert.equal(calls, 1);
  assert.equal((await store.receipt(payload.date, payload.operationId)).entries.length, 1);
  assert.match(saved.headers["Server-Timing"], /nutrition;dur=/);
});

test("a six-food meal uses one detail lookup per food and zero provider calls for six durable saves or replays", async (t) => {
  let providerCalls = 0,
    allowProvider = true;
  const catalog = createFatSecretCatalog({
    env: () => ({
      FATSECRET_CONSUMER_KEY: "dummy-account",
      FATSECRET_CONSUMER_SECRET: "dummy-secret",
    }),
    fetchImpl: async (url) => {
      assert.ok(allowProvider, "Saving an already-verified food must not contact the provider");
      providerCalls++;
      const id = new URL(url).searchParams.get("food_id");
      return new Response(
        JSON.stringify({
          food: {
            food_id: id,
            food_name: `Test food ${id}`,
            servings: {
              serving: {
                serving_id: `${id}1`,
                serving_description: "100 g",
                measurement_description: "g",
                number_of_units: "100",
                metric_serving_amount: "100",
                metric_serving_unit: "g",
                calories: "100",
                protein: "10",
                carbohydrate: "10",
                fat: "2",
                fiber: "1",
              },
            },
          },
        })
      );
    },
  });
  const store = createNutritionStore(memoryRecords());
  // Representative existing long history: writes must not hydrate any of it.
  await store.change(
    add({
      date: "2026-10-20",
      entries: Array.from({ length: 30 }, (_, i) =>
        food({
          id: `history-food-${i}`,
          source: "fatsecret",
          foodId: String(1000 + i),
          servingId: `${1000 + i}1`,
        })
      ),
    })
  );
  await store.change(
    add({
      date: "2026-10-20",
      revision: 1,
      operationId: "history-more-123",
      entries: Array.from({ length: 12 }, (_, i) =>
        food({
          id: `history-more-${i}`,
          source: "fatsecret",
          foodId: String(3000 + i),
          servingId: `${3000 + i}1`,
        })
      ),
    })
  );
  const selected = [];
  for (let i = 0; i < 6; i++) {
    const id = String(5000 + i);
    selected.push(
      entryFromFatSecret(await catalog.product(id), `${id}1`, 1, "lunch", `meal-food-${i}`)
    );
  }
  assert.equal(providerCalls, 6);
  allowProvider = false;
  const handler = createNutritionHttp({ getStore: async () => store, catalog, env: () => ({}) });
  const timings = [];
  for (let i = 0; i < selected.length; i++) {
    const start = performance.now();
    const payload = add({
      date: "2026-10-21",
      revision: i,
      operationId: `meal-operation-${i}`,
      entries: [selected[i]],
    });
    const result = await request(handler, {
      route: "/api/nutrition/entries",
      method: "POST",
      payload,
    });
    timings.push(performance.now() - start);
    assert.equal(result.status, 200);
    assert.equal(result.body.committed, true);
    assert.equal(result.body.changedEntries[0].calories, 100);
    assert.equal(result.body.revision, i + 1);
    const replay = await request(handler, {
      route: "/api/nutrition/entries",
      method: "POST",
      payload,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.revision, i + 1);
    assert.equal(replay.body.changedEntries, null);
  }
  assert.equal(providerCalls, 6);
  assert.equal((await store.receipt("2026-10-21", "meal-operation-5")).entries.length, 6);
  assert.ok(
    timings.every((time) => time < 100),
    "Synthetic in-memory saves should finish immediately"
  );
  // Reproduce the old request pattern with the same backend/provider fixture:
  // details -> unverified write -> whole-week refresh after every food.
  allowProvider = true;
  const baseline = createNutritionStore(memoryRecords());
  const history = (await store.receipt("2026-10-20", "history-more-123")).entries.map((entry) =>
    food(entry)
  );
  for (let offset = 0; offset < history.length; offset += 30)
    await baseline.change(
      add({
        date: "2026-10-20",
        revision: offset ? 1 : 0,
        operationId: `baseline-history-${offset}`,
        entries: history.slice(offset, offset + 30),
      })
    );
  const oldHandler = createNutritionHttp({
    getStore: async () => baseline,
    catalog,
    env: () => ({}),
  });
  const before = providerCalls;
  for (let i = 0; i < selected.length; i++) {
    const { catalogReceipt: _receipt, catalogExpiresAt: _expiry, ...unverified } = selected[i];
    const saved = await request(oldHandler, {
      route: "/api/nutrition/entries",
      method: "POST",
      payload: add({
        date: "2026-10-21",
        revision: i,
        operationId: `baseline-meal-${i}`,
        entries: [unverified],
      }),
    });
    assert.equal(saved.status, 200);
    const refreshed = await request(oldHandler, { route: "/api/nutrition?date=2026-10-21" });
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.week.every((day) => !day.unavailable));
  }
  const legacyCalls = providerCalls - before + selected.length;
  assert.equal(legacyCalls, 285);
  t.diagnostic(
    JSON.stringify({
      scenario: "synthetic six-food meal with 42 previous foods",
      baselineProviderCalls: legacyCalls,
      afterProviderCalls: 6,
      afterSaveProviderCalls: 0,
      saves: 6,
      lostResponseReplays: 6,
      syntheticSaveMs: timings.map((ms) => Math.round(ms * 100) / 100),
    })
  );
});
