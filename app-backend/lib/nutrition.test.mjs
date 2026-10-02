import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import {
  createNutritionStore,
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
