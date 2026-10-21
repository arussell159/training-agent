import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as netServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createApiHandler } from "../../api/handler.mjs";
import { parseChartTagFilter, taggedCurveSelection } from "./chart-tags-model.mjs";
import { createChartTagsService } from "./chart-tags.mjs";
import {
  taggedCurveInventory,
  projectTaggedActivityCurve,
  createTaggedActivityCurvesService,
} from "./tagged-activity-curves.mjs";
import { createChartTagsEndpoint, createTaggedCurvesEndpoint } from "./chart-tags-http.mjs";
import { createDesktopChartTagsFixtures } from "../../tools/desktop-chart-tags-fixtures.mjs";

test("tagged recording fixture drillthrough passes the unchanged strict UI workout validator with exact physical raw streams", async () => {
  const { validatedTrainingWorkout } =
      await import("../../ui/src/lib/training-context-validation.ts"),
    f = createDesktopChartTagsFixtures({ today: "2026-10-20" });
  for (const [id, sport, speed] of [
    ["i760000002", "Run", 5],
    ["i760000003", "Bike", 10],
    ["i760000004", "Swim", 2],
    ["i760000011", "Walk", 0],
  ]) {
    const workout = validatedTrainingWorkout(f.lookup(id));
    assert.equal(workout.activity_id, id);
    assert.equal(workout.sport, sport);
    assert.equal(workout.workout_summary.planned, null);
    assert.equal(workout.workout_summary.completed.distance_meters, 600 * speed);
    const analysis = f.analysis(id);
    assert.equal(analysis.duration, 600);
    assert.ok(analysis.points.every((point) => point.speed === speed));
  }
});
const today = "2026-10-20",
  base = { kind: "heartRate", sport: "all", start: "2026-10-01", end: today },
  actor = { id: "a", origin: "http://localhost" },
  config = { INTERVALS_API_KEY: "synthetic-only", SETTINGS_SCOPE: "synthetic" };
const fixture = () => createDesktopChartTagsFixtures({ today });
async function selection(f, kind = "heartRate", tags = ["Running"]) {
  const catalog = await f.catalog.load(f.config, { actor: f.actor });
  return {
    ...base,
    kind,
    tags: JSON.stringify(tags),
    tagScope: catalog.accountScope,
    tagRevision: catalog.revision,
  };
}
const load = (f, input) => f.service.load(f.config, input, { actor: f.actor });
const point = (result, seconds) =>
  result.points.find((point) => point.duration_seconds === seconds);

test("tag selection is exact JSON ANY membership, not CSV/normalization, with strict count/scope/date/orphan guards", () => {
  assert.deepEqual(parseChartTagFilter({ tags: "[]" }), { tags: [] });
  const input = {
    ...base,
    tags: '["Case,Comma","Élite"]',
    tagScope: "a".repeat(64),
    tagRevision: "b".repeat(64),
  };
  assert.deepEqual(taggedCurveSelection(input, today).tags, ["Case,Comma", "Élite"]);
  for (const patch of [
    { tags: "Running,Cycling" },
    { tags: '["Running","Running"]' },
    { tags: "[null]" },
    { tags: '[""]' },
    { tags: JSON.stringify(Array.from({ length: 21 }, (_, i) => String(i))) },
    { tags: JSON.stringify(["a".repeat(129)]) },
    { tagScope: "bad" },
    { tagRevision: "bad" },
    { end: "2026-10-21" },
    { tagMatch: "all" },
  ])
    assert.throws(() => taggedCurveSelection({ ...input, ...patch }, today), { status: 400 });
  assert.throws(() => parseChartTagFilter({ tagScope: "a".repeat(64) }), { status: 400 });
  assert.throws(() => parseChartTagFilter({ tags: "[]", tagRevision: "b".repeat(64) }), {
    status: 400,
  });
});

test("native catalog distinguishes verified empty from malformed/error, coalesces demand and isolates signed-in accounts", async () => {
  let calls = 0,
    now = Date.parse(`${today}T12:00:00Z`),
    values = [];
  const service = createChartTagsService({
    request: () => async () => {
      calls++;
      return values;
    },
    now: () => now,
    ttl: 100,
    failureTtl: 10,
  });
  const [a, b] = await Promise.all([
    service.load(config, { actor }),
    service.load(config, { actor }),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(a.tags, []);
  assert.match(a.accountScope, /^[a-f0-9]{64}$/);
  a.tags.push("fake");
  assert.deepEqual(b.tags, []);
  const other = await service.load(config, { actor: { ...actor, id: "b" } });
  assert.notEqual(other.accountScope, b.accountScope);
  assert.equal(calls, 2);
  service.clear();
  values = ["Case,Comma", "Élite", "Running", "running"];
  const valid = await service.load(config, { actor });
  assert.deepEqual(valid.tags, values);
  service.clear();
  values = ["duplicate", "duplicate"];
  await assert.rejects(service.load(config, { actor }), { status: 502 });
  const failed = calls;
  await assert.rejects(service.load(config, { actor }), { status: 502 });
  assert.equal(calls, failed);
  now += 11;
  values = [];
  assert.deepEqual((await service.load(config, { actor })).tags, []);
  await assert.rejects(service.load(config, { actor: null }), { status: 401 });
});

test("all four filtered sensors recompute slower matching sources instead of masking the untagged aggregate winner", async () => {
  const f = fixture(),
    expected = { heartRate: 180, power: 300, cadence: 85, velocity: 5 };
  for (const kind of Object.keys(expected)) {
    const result = await load(f, await selection(f, kind));
    assert.equal(result.version, 2);
    assert.equal(result.kind, kind);
    assert.equal(result.source, "intervals-tagged-activity-curves");
    assert.equal(result.tagsSupported, true);
    assert.equal(point(result, 60).value, expected[kind]);
    assert.equal(point(result, 60).activity_id, "i760000002");
    assert.deepEqual(point(result, 60).sourceTags, ["Running", "Case,Comma", "Élite"]);
    assert.equal(point(result, 17).value, null);
    assert.equal(
      result.points.some((point) => point.duration_seconds === 10),
      false
    );
    assert.equal(result.selection.tagMatch, "any");
    assert.deepEqual(result.selection.tags, ["Running"]);
    assert.equal(result.coverage.unknownMembershipRecordings, 3);
    assert.equal(result.coverage.inventoryRecords, 11);
    assert.equal(result.coverage.matchedRecordings, 3);
    assert.equal(result.coverage.excludedIgnoredRecordings, kind === "cadence" ? 0 : 1);
    assert.equal(result.coverage.excludedWithoutStream, kind === "cadence" ? 1 : 0);
    assert.equal(result.coverage.fetchedRecordings, 2);
    assert.equal(result.coverage.skippedForCap, 0);
    assert.ok(
      result.points.every(
        (point) => point.sourceTags.includes("Running") && point.activity_id !== "i760000001"
      )
    );
  }
  assert.ok(
    f
      .snapshot()
      .requests.every(
        (path) =>
          !path.includes("/athlete/0/hr-curves") && !path.includes("/athlete/0/power-curves")
      )
  );
  assert.ok(f.snapshot().requests.some((path) => path.endsWith("/hr-curve.json")));
  assert.ok(f.snapshot().requests.some((path) => path.endsWith("/power-curve.json")));
});

test("tag union, commas, Unicode and case remain exact; native zero and full raw sample attribution survive", async () => {
  const f = fixture();
  const one = await load(f, await selection(f, "power", ["Running"])),
    other = await load(f, await selection(f, "power", ["Cycling"])),
    union = await load(f, await selection(f, "power", ["Running", "Cycling"]));
  assert.equal(point(one, 60).value, 300);
  assert.equal(point(other, 60).value, 400);
  assert.equal(point(union, 60).value, 400);
  assert.deepEqual(union.selection.tags, ["Running", "Cycling"]);
  const exact = await load(f, await selection(f, "power", ["Case,Comma"]));
  assert.equal(point(exact, 60).activity_id, "i760000002");
  const unicode = await load(f, await selection(f, "heartRate", ["Élite"]));
  assert.equal(point(unicode, 60).value, 190);
  const zero = await load(f, await selection(f, "velocity", ["running"]));
  assert.equal(point(zero, 60).value, 0);
  assert.equal(point(zero, 60).activity_id, "i760000011");
  const source = f
      .snapshot()
      .sources.find((row) => row.activity.id === point(union, 60).activity_id),
    time = source.streams.find((s) => s.type === "time").data,
    watts = source.streams.find((s) => s.type === "watts").data;
  let sum = 0;
  for (let i = 1; i <= 60; i++) sum += watts[i] * (time[i] - time[i - 1]);
  assert.equal(sum / (time[60] - time[0]), point(union, 60).value);
  const { coverage: c } = union;
  assert.equal(
    c.inventoryRecords,
    c.matchedRecordings + c.unmatchedRecordings + c.unknownMembershipRecordings
  );
  assert.equal(
    c.matchedRecordings,
    c.eligibleRecordings + c.excludedWithoutStream + c.excludedIgnoredRecordings
  );
});

test("membership partition distinguishes [] from absent/null/malformed and excludes conflicting identities before matching totals", async () => {
  const f = fixture(),
    input = taggedCurveSelection(await selection(f), today),
    rows = f.snapshot().sources.map((source) => source.activity),
    inventory = taggedCurveInventory(
      [
        ...rows,
        structuredClone(rows[1]),
        { ...rows[1], tags: ["Cycling"] },
        { ...rows[0], id: "bad" },
      ],
      input
    );
  assert.equal(inventory.counts.unknownMembershipRecordings, 3);
  assert.equal(inventory.counts.conflictingRecordings, 1);
  assert.equal(inventory.counts.invalidInventoryRecords, 1);
  assert.equal(inventory.records.has("i760000002"), false);
  assert.equal(inventory.counts.inventoryRecords, 10);
  assert.equal(inventory.partial, true);
  assert.equal(inventory.counts.unmatchedRecordings, 5);
  assert.equal(
    inventory.counts.inventoryRecords,
    inventory.counts.matchedRecordings +
      inventory.counts.unmatchedRecordings +
      inventory.counts.unknownMembershipRecordings
  );
});

test("real cap is applied after exact membership, so 130 unmatched fastest recordings cannot displace 128 of130 matching sources", async () => {
  const f = fixture();
  f.setScenario("cap");
  const result = await load(f, await selection(f, "power"));
  assert.equal(result.coverage.inventoryRecords, 260);
  assert.equal(result.coverage.unmatchedRecordings, 130);
  assert.equal(result.coverage.matchedRecordings, 130);
  assert.equal(result.coverage.fetchedRecordings, 128);
  assert.equal(result.coverage.skippedForCap, 2);
  assert.equal(point(result, 5).value, 300);
  const native = f.snapshot().requests.filter((path) => path.includes("/activity/"));
  assert.equal(native.length, 128);
  assert.ok(
    native.every(
      (path) =>
        !f
          .snapshot()
          .sources.slice(0, 130)
          .some((row) => path.includes(row.activity.id))
    )
  );
  assert.equal(result.coverage.status, "partial");
});

test("disappeared tag/catalog revision and wrong account reject before inventory without dropping or broadening the retained selection", async () => {
  const f = fixture(),
    old = await selection(f, "cadence");
  f.setScenario("removed");
  await assert.rejects(load(f, old), { status: 409, code: "CHART_TAG_SELECTION_CHANGED" });
  assert.equal(f.snapshot().requests.filter((path) => path.includes("/activities?")).length, 0);
  f.setScenario("empty");
  await assert.rejects(load(f, old), { status: 409 });
  const fresh = fixture(),
    input = await selection(fresh);
  const before = fresh.snapshot().requests.length;
  await assert.rejects(
    fresh.service.load(fresh.config, input, { actor: { ...fresh.actor, id: "different" } }),
    { status: 409, code: "CHART_TAG_ACCOUNT_CHANGED" }
  );
  assert.equal(fresh.snapshot().requests.length, before);
});

test("validated curve caches reuse recording values across filters while freshly binding sourceTags/membership and cloning results", async () => {
  const f = fixture(),
    a = await load(f, await selection(f, "power", ["Running"])),
    before = f.snapshot().requests.filter((path) => path.includes("/activity/")).length;
  const b = await load(f, await selection(f, "power", ["Case,Comma"]));
  assert.equal(f.snapshot().requests.filter((path) => path.includes("/activity/")).length, before);
  a.points[0].sourceTags.push("forged");
  assert.equal(b.points[0].sourceTags.includes("forged"), false);
  const query = await selection(f, "power", ["Running"]);
  let rows = f.snapshot().sources.map((source) => structuredClone(source.activity)),
    calls = 0,
    now = Date.parse(`${today}T12:00:00Z`);
  const service = createTaggedActivityCurvesService({
    catalog: f.catalog,
    now: () => now,
    membershipTtl: 10,
    request: () => async (path, options) => {
      if (path.includes("/activities?")) return rows;
      calls++;
      return f.request(path, options);
    },
  });
  await service.load(f.config, query, { actor: f.actor });
  const count = calls;
  rows = rows.map((row) =>
    row.id === "i760000002" ? { ...row, tags: ["Running", "Cycling"] } : row
  );
  now += 11;
  const changed = await service.load(f.config, query, { actor: f.actor });
  assert.equal(calls, count);
  assert.deepEqual(point(changed, 60).sourceTags, ["Running", "Cycling"]);
});

test("per-record native shapes, ignore parts, duration and stream provenance fail closed without fabricated aggregate fallback", async () => {
  const f = fixture(),
    input = taggedCurveSelection(await selection(f, "heartRate"), today),
    record = taggedCurveInventory(
      f.snapshot().sources.map((source) => source.activity),
      input
    ).eligible[0];
  const raw = { secs: [5, 60], values: [150, 999], start_index: [20, 0], end_index: [25, 60] };
  const projected = projectTaggedActivityCurve(
    raw,
    { ...record, ignoredParts: [{ start: 0, end: 12 }] },
    "heartRate"
  );
  assert.deepEqual(
    projected.points.map((point) => point.value),
    [150, null]
  );
  assert.throws(
    () => projectTaggedActivityCurve({ ...raw, stream_type: "watts" }, record, "heartRate"),
    { status: 502 }
  );
  assert.throws(() => projectTaggedActivityCurve({ ...raw, secs: [5, 5] }, record, "power"), {
    status: 502,
  });
  assert.throws(
    () =>
      projectTaggedActivityCurve(
        [{ ...raw, stream_type: "cadence", after_kj: 1 }],
        record,
        "cadence"
      ),
    { status: 502 }
  );
  const short = projectTaggedActivityCurve(raw, { ...record, duration: 10 }, "heartRate");
  assert.equal(short.points[1].value, null);
});

test("catalog and tagged HTTP adapters preserve routing/auth, empty-filter v1 fallback with zero config/catalog work and safe account errors", async (t) => {
  const f = fixture();
  let configs = 0,
    fallbacks = 0;
  const catalog = createChartTagsEndpoint({
      service: f.catalog,
      readConfig: async () => {
        configs++;
        return f.config;
      },
    }),
    curves = createTaggedCurvesEndpoint({
      service: f.service,
      readConfig: async () => {
        configs++;
        return f.config;
      },
      unfiltered: async (req, res) => {
        fallbacks++;
        assert.equal(new URL(req.url, "http://local").searchParams.has("tags"), false);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"version":1}');
      },
    });
  const handler = createApiHandler({
      hosted: () => false,
      loadServer: async () => ({
        handleRequest: async (req, res) => {
          if (req.headers.authorization === "Bearer trusted") req.appActor = f.actor;
          return req.url.startsWith("/api/chart-tags") ? catalog(req, res) : curves(req, res);
        },
      }),
    }),
    server = createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/handler?__api_route=`,
    headers = { Authorization: "Bearer trusted" };
  assert.equal(
    (await fetch(base + "chart-tags", { headers: { "X-App-Actor": "forged" } })).status,
    401
  );
  assert.equal(configs, 0);
  const plain = await fetch(
    base +
      "performance-curves&kind=heartRate&sport=all&start=2026-10-01&end=2026-10-20&tags=%5B%5D",
    { headers }
  );
  assert.deepEqual(await plain.json(), { version: 1 });
  assert.equal(configs, 0);
  assert.equal(fallbacks, 1);
  const catalogReply = await fetch(base + "chart-tags", { headers });
  assert.equal(catalogReply.status, 200);
  assert.equal(catalogReply.headers.get("Cache-Control"), "private,no-store");
  const listed = await catalogReply.json();
  assert.match(listed.accountScope, /^[a-f0-9]{64}$/);
  const input = await selection(f, "power"),
    url = base + "performance-curves&" + new URLSearchParams(input);
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, 2);
  for (const invalid of [url + "&tags=[]", url + "&operator=and", base + "chart-tags&unknown=1"])
    assert.equal((await fetch(invalid, { headers })).status, 400);
  assert.equal((await fetch(base + "chart-tags", { headers, method: "POST" })).status, 405);
});

test("tagged canceled readers share bounded native work and a pending window cannot be evicted to create extra provider requests", async () => {
  const f = fixture(),
    input = await selection(f);
  let release;
  const gate = new Promise((resolve) => (release = resolve)),
    controller = new AbortController();
  const service = createTaggedActivityCurvesService({
    catalog: f.catalog,
    now: () => Date.parse(`${today}T12:00:00Z`),
    maxEntries: 1,
    request: () => async (path, options) => {
      if (path.includes("/activities?")) await gate;
      return f.request(path, options);
    },
  });
  const canceled = service.load(f.config, input, { actor: f.actor, signal: controller.signal }),
    healthy = service.load(f.config, input, { actor: f.actor });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(Error("reader left"));
  await assert.rejects(canceled, /reader left/);
  await assert.rejects(
    service.load(f.config, { ...input, tags: '["Cycling"]' }, { actor: f.actor }),
    { status: 429, code: "CHART_TAG_BUSY" }
  );
  release();
  assert.equal(point(await healthy, 60).value, 180);
  assert.equal(f.snapshot().requests.filter((path) => path.includes("/activities?")).length, 1);
});

test("failed filtered sources retain healthy components explicitly and complete failure cools down without raw provider information", async () => {
  const f = fixture(),
    input = await selection(f, "power");
  let now = Date.parse(`${today}T12:00:00Z`),
    mode = "one",
    calls = 0;
  const service = createTaggedActivityCurvesService({
    catalog: f.catalog,
    now: () => now,
    failureTtl: 10,
    request: () => async (path, options) => {
      calls++;
      if (path.includes("/activity/") && (mode === "all" || path.includes("i760000009")))
        throw Error("raw-private-provider-message synthetic-only");
      return f.request(path, options);
    },
  });
  const partial = await service.load(f.config, input, { actor: f.actor });
  assert.equal(point(partial, 60).value, 300);
  assert.equal(partial.coverage.failedRecordings, 1);
  assert.equal(partial.coverage.status, "partial");
  assert.doesNotMatch(JSON.stringify(partial), /raw-private/);
  service.clear();
  mode = "all";
  await assert.rejects(
    service.load(f.config, input, { actor: f.actor }),
    (error) => error.code === "CHART_TAG_UNAVAILABLE" && !error.message.includes("raw-private")
  );
  const count = calls;
  mode = "none";
  await assert.rejects(service.load(f.config, input, { actor: f.actor }), { status: 502 });
  assert.equal(calls, count);
  now += 11;
  assert.equal(point(await service.load(f.config, input, { actor: f.actor }), 60).value, 300);
});

test(
  "actual localhost preview serves tagged v2/native catalog/source Summary reads and real cap with no native writes",
  { timeout: 20000 },
  async (t) => {
    const reservation = netServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(
      process.execPath,
      ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    t.after(async () => {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    });
    await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Tagged preview startup timed out")), 10000);
      child.stdout.on("data", (data) => {
        output += data;
        if (output.includes("http://127.0.0.1:")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(Error(output));
      });
    });
    const base = `http://127.0.0.1:${port}/api/handler?__api_route=`,
      get = async (route) => {
        const response = await fetch(base + route);
        assert.equal(response.status, 200, route);
        return response.json();
      };
    const native = await get("chart-tags"),
      oracle = await get("preview/chart-tag-sources"),
      query = {
        kind: "power",
        sport: "all",
        start: oracle.day,
        end: oracle.today,
        tags: '["Running"]',
        tagScope: native.accountScope,
        tagRevision: native.revision,
      };
    const result = await get("performance-curves&" + new URLSearchParams(query));
    assert.equal(result.version, 2);
    assert.equal(point(result, 60).value, 300);
    assert.equal(point(result, 60).activity_id, "i760000002");
    for (const route of [
      "workout-history/i760000002",
      "workouts/activity%3Ai760000002/personal",
      "workouts/activity%3Ai760000002/personal/attachments",
      "comments&workoutId=activity%3Ai760000002",
      "activities/i760000002/summary",
      "activities/i760000002/analysis",
      "activities/i760000002/route",
    ])
      await get(route);
    const before = await get("preview/provider-records");
    assert.equal(before.writes.length, 0);
    const unfiltered = await get(
      "performance-curves&" +
        new URLSearchParams({
          kind: "cadence",
          sport: "all",
          start: oracle.day,
          end: oracle.today,
          tags: "[]",
        })
    );
    assert.equal(unfiltered.version, 1);
    assert.equal(unfiltered.tagsSupported, false);
    const scenario = async (value) => {
      const response = await fetch(base + "preview/chart-tags-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: value }),
      });
      assert.equal(response.status, 200);
    };
    await scenario("cap");
    const cap = await get("performance-curves&" + new URLSearchParams(query));
    assert.equal(cap.coverage.unmatchedRecordings, 130);
    assert.equal(cap.coverage.fetchedRecordings, 128);
    assert.equal(cap.coverage.skippedForCap, 2);
    await scenario("empty");
    assert.deepEqual((await get("chart-tags")).tags, []);
    const stale = await fetch(base + "performance-curves&" + new URLSearchParams(query));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "CHART_TAG_SELECTION_CHANGED");
    assert.equal((await get("preview/provider-records")).writes.length, 0);
  }
);
