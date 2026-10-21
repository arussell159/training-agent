import test from "node:test";
import assert from "node:assert/strict";
import { createChartReadCache } from "./chart-read-cache.mjs";
import {
  mergeTaggedCurvePoints,
  createTaggedActivityCurvesService,
} from "./tagged-activity-curves.mjs";
import { createDesktopChartTagsFixtures } from "../../tools/desktop-chart-tags-fixtures.mjs";
const point = (duration_seconds = 5, value = 1) => ({
  duration_seconds,
  value,
  activity_id: "i1",
  native_type: "Run",
  date: "2026-10-19",
  name: null,
  estimated: false,
});
const result = (points, tags = ["Running"]) => ({ points, record: { tags } });
const busy = () => Object.assign(Error("busy"), { status: 429 });

test("incremental response admission rejects before copying rejected winner tags or advancing its next point", () => {
  const small = result([point()]),
    largeTags = Array.from({ length: 20 }, (_, i) => `Running ${i} ${"x".repeat(20)}`);
  let copies = 0,
    advanced = 0;
  largeTags[Symbol.iterator] = function* () {
    copies++;
    throw Error("Rejected source tags were copied");
  };
  const points = [point(5, 2), point(60, 2)];
  points[Symbol.iterator] = function* () {
    advanced++;
    yield this[0];
    advanced++;
    throw Error("Budget should stop before visiting the next point");
  };
  const admitted = mergeTaggedCurvePoints([small]);
  assert.throws(
    () =>
      mergeTaggedCurvePoints([small, result(points, largeTags)], {
        maxCharacters: admitted.characters + 10,
      }),
    (error) => error.code === "CHART_TAG_UNAVAILABLE" && /smaller date range/.test(error.message)
  );
  assert.equal(copies, 0);
  assert.equal(advanced, 1);
  assert.throws(
    () => mergeTaggedCurvePoints([], { maxCharacters: 5, headerCharacters: 6 }),
    /smaller date range/
  );
});

test("replacement subtracts old winner cost and exact response accounting preserves full tags without whole-response serialization", () => {
  const oldTags = ["Running", ...Array.from({ length: 100 }, (_, i) => `old-${i}`)],
    headerCharacters = JSON.stringify({ points: [] }).length;
  const first = mergeTaggedCurvePoints([result([point()], oldTags)], { headerCharacters });
  const merged = mergeTaggedCurvePoints(
    [result([point()], oldTags), result([point(5, 2), point(60, 2)])],
    { maxCharacters: first.characters + headerCharacters, headerCharacters }
  );
  assert.deepEqual(
    merged.points.map((value) => value.value),
    [2, 2]
  );
  assert.deepEqual(
    merged.points.map((value) => value.sourceTags),
    [["Running"], ["Running"]]
  );
  assert.equal(
    merged.characters + headerCharacters,
    JSON.stringify({ points: merged.points }).length
  );
});

test("weighted cache evicts by admitted weight, clears accounting and returns oversized values uncached without evicting healthy data", async () => {
  const cache = createChartReadCache({ maxWeight: 5, weight: (value) => value.length, busy });
  let calls = 0;
  await cache.read("a", async () => {
    calls++;
    return "aaaa";
  });
  assert.deepEqual(cache.stats(), { entries: 1, totalWeight: 4 });
  await cache.read("b", async () => "bbbb");
  assert.deepEqual(cache.stats(), { entries: 1, totalWeight: 4 });
  await cache.read("a", async () => {
    calls++;
    return "aaaa";
  });
  assert.equal(calls, 2);
  assert.equal(await cache.read("large", async () => "123456"), "123456");
  assert.deepEqual(cache.stats(), { entries: 1, totalWeight: 4 });
  cache.clear();
  assert.deepEqual(cache.stats(), { entries: 0, totalWeight: 0 });
});

test("in-flight clear/replacement cannot corrupt new cache weights or identity, and pending capacity is never evicted", async () => {
  const cache = createChartReadCache({
    maxEntries: 1,
    maxWeight: 5,
    weight: (value) => value.length,
    busy,
  });
  let release;
  const pending = cache.read("same", () => new Promise((resolve) => (release = resolve)));
  await Promise.resolve();
  assert.throws(() => cache.read("other", async () => "x"), { status: 429 });
  cache.clear();
  assert.equal(await cache.read("same", async () => "new"), "new");
  release("older");
  assert.equal(await pending, "older");
  assert.deepEqual(cache.stats(), { entries: 1, totalWeight: 3 });
  assert.equal(
    await cache.read("same", async () => {
      throw Error("new identity was lost");
    }),
    "new"
  );
  cache.clear();
  assert.deepEqual(cache.stats(), { entries: 0, totalWeight: 0 });
});

test("filtered request response and processed-source budgets reject with a bounded smaller-range error", async () => {
  const today = "2026-10-20",
    f = createDesktopChartTagsFixtures({ today }),
    catalog = await f.catalog.load(f.config, { actor: f.actor }),
    input = {
      kind: "power",
      sport: "all",
      start: "2026-10-01",
      end: today,
      tags: '["Running"]',
      tagScope: catalog.accountScope,
      tagRevision: catalog.revision,
    };
  for (const limits of [{ maxResponseCharacters: 100 }, { maxProcessedSourcePoints: 1 }]) {
    const service = createTaggedActivityCurvesService({
      request: () => f.request,
      catalog: f.catalog,
      now: () => Date.parse(`${today}T12:00:00Z`),
      ...limits,
    });
    await assert.rejects(
      service.load(f.config, input, { actor: f.actor }),
      (error) => error.code === "CHART_TAG_UNAVAILABLE" && /smaller date range/.test(error.message)
    );
  }
});

test("oversized source/window cache values remain uncached only while the current request stays within its actual response budget", async () => {
  const today = "2026-10-20",
    f = createDesktopChartTagsFixtures({ today }),
    catalog = await f.catalog.load(f.config, { actor: f.actor }),
    input = {
      kind: "power",
      sport: "all",
      start: "2026-10-01",
      end: today,
      tags: '["Running"]',
      tagScope: catalog.accountScope,
      tagRevision: catalog.revision,
    };
  const service = createTaggedActivityCurvesService({
    request: () => f.request,
    catalog: f.catalog,
    now: () => Date.parse(`${today}T12:00:00Z`),
    maxSourceCachePoints: 1,
    maxWindowCacheCharacters: 1,
  });
  const a = await service.load(f.config, input, { actor: f.actor }),
    count = f.snapshot().requests.filter((path) => path.includes("/activity/")).length;
  const b = await service.load(f.config, input, { actor: f.actor });
  assert.deepEqual(b, a);
  assert.equal(
    f.snapshot().requests.filter((path) => path.includes("/activity/")).length,
    count + 2
  );
  assert.ok(JSON.stringify(b).length <= 5_000_000);
});

test("source-point budget failure waits for its bounded in-flight batch before releasing the active request slot", async (t) => {
  const today = "2026-10-20",
    f = createDesktopChartTagsFixtures({ today }),
    catalog = await f.catalog.load(f.config, { actor: f.actor }),
    input = {
      kind: "power",
      sport: "all",
      start: "2026-10-01",
      end: today,
      tags: '["Running"]',
      tagScope: catalog.accountScope,
      tagRevision: catalog.revision,
    };
  let release, reached;
  const gate = new Promise((resolve) => (release = resolve)),
    started = new Promise((resolve) => (reached = resolve));
  t.after(() => release());
  const service = createTaggedActivityCurvesService({
    catalog: f.catalog,
    now: () => Date.parse(`${today}T12:00:00Z`),
    maxProcessedSourcePoints: 1,
    request: () => async (path, options) => {
      if (path.includes("/activity/i760000009/")) {
        reached();
        await gate;
      }
      return f.request(path, options);
    },
  });
  let settled = false;
  const read = service.load(f.config, input, { actor: f.actor }).finally(() => (settled = true)),
    checked = assert.rejects(read, /source-point budget/);
  await started;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  await checked;
  assert.equal(settled, true);
});
