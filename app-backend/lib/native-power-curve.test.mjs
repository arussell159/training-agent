import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as netServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createApiHandler } from "../../api/handler.mjs";
import { nativePowerCurveSelection } from "./native-power-curve-model.mjs";
import {
  nativePowerInventory,
  mergeNativePowerPoints,
  createNativePowerCurveService,
} from "./native-power-curve.mjs";
import { createNativePowerCurveEndpoint } from "./native-power-curve-http.mjs";
import { createTaggedCurvesEndpoint } from "./chart-tags-http.mjs";
import { createDesktopNativePowerFixtures } from "../../tools/desktop-native-power-fixtures.mjs";

test("new native Power source records pass the unchanged strict UI workout validator with actual recorded duration", async () => {
  const { validatedTrainingWorkout } =
      await import("../../ui/src/lib/training-context-validation.ts"),
    f = createDesktopNativePowerFixtures({ today: "2026-10-21" });
  for (const [id, type, seconds] of [
    ["i780000001", "Bike", 5400],
    ["i780000002", "Run", 600],
    ["i780000003", "TrailRun", 120],
    ["i780000005", "Walk", 60],
  ]) {
    const workout = validatedTrainingWorkout(f.lookup(id));
    assert.equal(workout.activity_id, id);
    assert.equal(workout.sport, type);
    assert.equal(workout.workout_summary.planned, null);
    assert.equal(workout.workout_summary.completed.duration_seconds, seconds);
    assert.equal(f.analysis(id).duration, seconds);
    const watts = f.snapshot().sources.find((source) => source.activity.id === id).watts;
    assert.ok(f.analysis(id).points.every((point) => point.power === watts));
  }
});
const today = "2026-10-21",
  clock = Date.parse(`${today}T12:00:00Z`),
  input = { kind: "power", sport: "all", start: "2026-10-01", end: today },
  fixture = () => createDesktopNativePowerFixtures({ today }),
  load = (f, patch = {}) => f.service.load(f.config, { ...input, ...patch }, { actor: f.actor }),
  at = (result, seconds) => result.points.find((point) => point.duration_seconds === seconds);

test("unfiltered native power selection accepts real sports/families and rejects unknown dates/options without catalog or provider reads", async () => {
  assert.deepEqual(nativePowerCurveSelection({ ...input, sport: "Run,Ride" }, today).nativeTypes, [
    "Ride",
    "Run",
  ]);
  const f = fixture();
  assert.deepEqual(f.snapshot().requests, []);
  for (const patch of [
    { kind: "pace" },
    { sport: "Brick" },
    { sport: "All" },
    { sport: "Run,Run" },
    { start: "2026-02-30" },
    { end: "2026-10-22" },
    { tags: [] },
    { tagScope: "a".repeat(64) },
  ])
    await assert.rejects(load(f, patch), { status: 400 });
  await assert.rejects(f.service.load(f.config, input, { actor: { id: "forged" } }), {
    status: 401,
  });
  assert.deepEqual(f.snapshot().requests, []);
});

test("All unfiltered native Power includes actual Run/TrailRun winners and preserves complete axis, native zero, null and unknown eligibility coverage", async () => {
  const f = fixture(),
    result = await load(f);
  assert.equal(result.version, 1);
  assert.equal(result.source, "intervals-activity-power-curves");
  assert.equal(result.unit, "W");
  assert.equal(result.unitPolicy, "native-watts");
  assert.equal(result.tagsSupported, false);
  assert.equal(at(result, 5).value, 500);
  assert.equal(at(result, 5).native_type, "Run");
  assert.equal(at(result, 60).value, 450);
  assert.equal(at(result, 60).native_type, "TrailRun");
  assert.equal(at(result, 600).value, 400);
  assert.equal(at(result, 5400).value, 300);
  assert.equal(at(result, 17).value, null);
  assert.equal(
    result.points.some((point) => Object.hasOwn(point, "sourceTags")),
    false
  );
  assert.deepEqual(result.coverage, {
    status: "partial",
    inventoryRecords: 12,
    excludedWithoutPower: 1,
    excludedIgnoredRecordings: 1,
    unknownLengthRecordings: 1,
    unknownStreamRecordings: 1,
    invalidInventoryRecords: 0,
    conflictingRecordings: 0,
    eligibleRecordings: 10,
    fetchedRecordings: 10,
    failedRecordings: 1,
    missingRecordings: 1,
    skippedForCap: 0,
    unknownPoints: 1,
  });
  assert.equal(at(await load(f, { sport: "Walk" }), 60).value, 0);
  const swim = await load(f, { sport: "Swim" });
  assert.deepEqual(swim.points, []);
  assert.equal(swim.coverage.excludedWithoutPower, 1);
  assert.ok(
    f
      .snapshot()
      .requests.every(
        (path) =>
          !path.includes("activity-tags") &&
          !path.includes("tags=") &&
          !new URL(path, "http://local").searchParams.get("fields")?.split(",").includes("tags")
      )
  );
});

test("native families and combined selections deduplicate actual recordings without changing run power into pace or excluding missing tag membership", async () => {
  const f = fixture(),
    run = await load(f, { sport: "Run" }),
    ride = await load(f, { sport: "Ride" }),
    both = await load(f, { sport: "Run,Ride" });
  assert.equal(at(run, 60).native_type, "TrailRun");
  assert.equal(at(run, 600).value, 400);
  assert.equal(
    run.points.some((point) => point.duration_seconds === 5400),
    false
  );
  assert.equal(at(ride, 60).value, 300);
  assert.equal(at(both, 60).value, 450);
  assert.equal(at(both, 5400).value, 300);
  assert.equal(both.coverage.inventoryRecords, 5);
  assert.equal(at(run, 600).activity_id, "i780000002");
  assert.equal(
    f.snapshot().sources.find((source) => source.activity.id === "i780000002").activity.tags,
    null
  );
  const workout = await load(f, { sport: "Workout" });
  assert.equal(at(workout, 600).value, 200);
  assert.equal(workout.coverage.unknownLengthRecordings, 1);
  assert.equal(workout.coverage.status, "partial");
  const strength = await load(f, { sport: "WeightTraining" });
  assert.equal(at(strength, 600).value, 150);
  assert.equal(strength.coverage.unknownStreamRecordings, 1);
});

test("native Power inventory independently rejects conflicting/invalid identity and power ignore metadata while unrelated ignores and tags are irrelevant", () => {
  const f = fixture(),
    rows = f.snapshot().sources.map((source) => source.activity),
    selection = nativePowerCurveSelection(input, today);
  const inventory = nativePowerInventory(
    [
      ...rows,
      structuredClone(rows[1]),
      { ...rows[1], elapsed_time: 123 },
      { ...rows[0], id: "wrong" },
      { ...rows[0], id: "i999", icu_ignore_power: "false" },
    ],
    selection
  );
  assert.equal(inventory.counts.conflictingRecordings, 1);
  assert.equal(inventory.counts.invalidInventoryRecords, 2);
  assert.equal(inventory.records.has("i780000002"), false);
  const unrelated = nativePowerInventory(
    [
      {
        ...rows[0],
        icu_ignore_hr: true,
        ignore_pace: true,
        tags: { arbitrary: true },
        ignore_parts: [{ hr: true, pace: true }],
      },
    ],
    selection
  );
  assert.equal(unrelated.eligible.length, 1);
  assert.deepEqual(unrelated.eligible[0].ignoredParts, []);
});

test("actual native curve samples supply independent raw weighted power oracle and known-short/ignored-part values cannot win", async () => {
  const f = fixture(),
    result = await load(f),
    source = f
      .snapshot()
      .sources.find((source) => source.activity.id === at(result, 60).activity_id),
    times = source.streams.find((stream) => stream.type === "time").data,
    watts = source.streams.find((stream) => stream.type === "watts").data;
  let total = 0;
  for (let i = 1; i <= 60; i++) total += watts[i] * (times[i] - times[i - 1]);
  assert.equal(total / (times[60] - times[0]), at(result, 60).value);
  assert.ok(result.points.every((point) => point.activity_id !== "i780000006"));
  assert.notEqual(at(result, 60).value, 999);
  const part = await load(f, { sport: "Run" });
  assert.notEqual(at(part, 60).activity_id, "i780000012");
  assert.equal(part.coverage.unknownPoints, 1);
  assert.ok(
    result.points.every(
      (point) =>
        typeof point.activity_id === "string" &&
        typeof point.date === "string" &&
        point.estimated === false
    )
  );
});

test("native Power source cap is real, bounded and explicit with higher omitted native candidates", async () => {
  const f = fixture();
  f.setScenario("cap");
  const result = await load(f);
  assert.equal(result.coverage.eligibleRecordings, 130);
  assert.equal(result.coverage.fetchedRecordings, 128);
  assert.equal(result.coverage.skippedForCap, 2);
  assert.equal(result.coverage.status, "partial");
  assert.equal(at(result, 5).value, 300);
  assert.equal(f.snapshot().requests.filter((path) => path.includes("/activity/")).length, 128);
  assert.ok(result.points.every((point) => point.value !== 999));
  assert.match(result.warning, /2 recordings omitted by the 128-recording limit/);
});

test("native Power demand coalesces, reuses unchanged recording curves across windows and isolates actor/credentials with cloned output", async () => {
  const f = fixture(),
    [a, b] = await Promise.all([load(f, { sport: "Ride" }), load(f, { sport: "Ride" })]);
  assert.equal(f.snapshot().requests.length, 2);
  a.points[0].value = 999;
  assert.equal(b.points[0].value, 300);
  await load(f, { sport: "Ride", start: "2026-10-02" });
  assert.equal(f.snapshot().requests.length, 3);
  await f.service.load(f.config, { ...input, sport: "Ride" }, { actor: { ...f.actor, id: "b" } });
  assert.equal(f.snapshot().requests.length, 5);
  await f.service.load(
    { ...f.config, INTERVALS_API_KEY: "rotated" },
    { ...input, sport: "Ride" },
    { actor: f.actor }
  );
  assert.equal(f.snapshot().requests.length, 7);
  f.service.clear();
  await load(f, { sport: "Ride" });
  assert.equal(f.snapshot().requests.length, 9);
});

test("safe native Power failures cool down, retain healthy sources and never invent aggregate fallback", async () => {
  const f = fixture();
  let now = clock,
    fail = true,
    calls = 0;
  const service = createNativePowerCurveService({
    now: () => now,
    failureTtl: 10,
    request: () => async (path, options) => {
      calls++;
      if (fail && path.includes("/activity/")) throw Error("private-native-body secret");
      return f.request(path, options);
    },
  });
  await assert.rejects(
    service.load(f.config, { ...input, sport: "Ride" }, { actor: f.actor }),
    (error) =>
      error.code === "NATIVE_POWER_UNAVAILABLE" && !error.message.includes("private-native-body")
  );
  const count = calls;
  fail = false;
  await assert.rejects(service.load(f.config, { ...input, sport: "Ride" }, { actor: f.actor }), {
    status: 502,
  });
  assert.equal(calls, count);
  now += 11;
  assert.equal(
    at(await service.load(f.config, { ...input, sport: "Ride" }, { actor: f.actor }), 60).value,
    300
  );
  const healthy = await load(f);
  assert.equal(healthy.coverage.failedRecordings, 1);
  assert.equal(at(healthy, 600).value, 400);
  assert.doesNotMatch(JSON.stringify(healthy), /private-native-body/);
});

test("native Power cancellation cannot stop another reader and pending capacity never spawns unbounded windows", async () => {
  const f = fixture();
  let release;
  const gate = new Promise((resolve) => (release = resolve)),
    controller = new AbortController(),
    service = createNativePowerCurveService({
      request: () => async (path, options) => {
        if (path.includes("/activities?")) await gate;
        return f.request(path, options);
      },
      now: () => clock,
      maxEntries: 1,
    });
  const first = service.load(f.config, input, { actor: f.actor, signal: controller.signal }),
    second = service.load(f.config, input, { actor: f.actor });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(Error("reader canceled"));
  await assert.rejects(first, /reader canceled/);
  await assert.rejects(service.load(f.config, { ...input, sport: "Run" }, { actor: f.actor }), {
    status: 429,
  });
  release();
  assert.equal(at(await second, 600).value, 400);
  assert.equal(f.snapshot().requests.filter((path) => path.includes("/activities?")).length, 1);
});

test("native Power resource guards account exact winning JSON incrementally, source budgets and uncached weights without truncation", async () => {
  const point = {
      duration_seconds: 5,
      value: 300,
      activity_id: "i1",
      native_type: "Run",
      date: "2026-10-20",
      name: null,
      estimated: false,
    },
    first = mergeNativePowerPoints([{ points: [point] }]);
  assert.equal(first.characters, JSON.stringify(first.points).length - 2);
  assert.throws(
    () => mergeNativePowerPoints([{ points: [point] }], { maxCharacters: 10 }),
    /smaller date range/
  );
  const f = fixture();
  for (const option of [{ maxResponseCharacters: 10 }, { maxProcessedSourcePoints: 1 }]) {
    const service = createNativePowerCurveService({
      request: () => f.request,
      now: () => clock,
      ...option,
    });
    await assert.rejects(service.load(f.config, input, { actor: f.actor }), /smaller date range/);
  }
  const service = createNativePowerCurveService({
    request: () => f.request,
    now: () => clock,
    maxSourceCachePoints: 1,
    maxWindowCacheCharacters: 1,
  });
  const a = await service.load(f.config, { ...input, sport: "Ride" }, { actor: f.actor }),
    before = f.snapshot().requests.length,
    b = await service.load(f.config, { ...input, sport: "Ride" }, { actor: f.actor });
  assert.deepEqual(a, b);
  assert.equal(f.snapshot().requests.length, before + 2);
});

test("actual authenticated native Power HTTP routing handles All and normalized empty tags without catalog work or forged actor headers", async (t) => {
  const f = fixture();
  let configs = 0,
    tagCalls = 0;
  const native = createNativePowerCurveEndpoint({
      service: f.service,
      readConfig: async () => {
        configs++;
        return f.config;
      },
    }),
    endpoint = createTaggedCurvesEndpoint({
      service: {
        load: async () => {
          tagCalls++;
          throw Error("not an unfiltered path");
        },
      },
      readConfig: async () => f.config,
      unfiltered: native,
    });
  const handler = createApiHandler({
      hosted: () => false,
      loadServer: async () => ({
        handleRequest: async (req, res) => {
          if (req.headers.authorization === "Bearer native-auth") req.appActor = f.actor;
          return endpoint(req, res);
        },
      }),
    }),
    server = createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/handler?__api_route=performance-curves&${new URLSearchParams(input)}`,
    headers = { Authorization: "Bearer native-auth" };
  assert.equal((await fetch(url, { headers: { "X-App-Actor": "forged" } })).status, 401);
  assert.equal(configs, 0);
  const result = await fetch(url + "&tags=%5B%5D", { headers });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "private,no-store");
  assert.equal((await result.json()).source, "intervals-activity-power-curves");
  assert.equal(tagCalls, 0);
  assert.equal((await fetch(url + "&unknown=1", { headers })).status, 400);
  assert.equal((await fetch(url, { headers, method: "POST" })).status, 405);
});

test(
  "actual preview preserves Home payload and zero new native reads until demand, then provides real source Summary dependencies and tagless cap",
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
      const timer = setTimeout(() => reject(Error("Native Power preview timed out")), 10000);
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
    const personal = await get("personal-statistics"),
      oracle = await get("preview/native-power-sources");
    assert.equal(oracle.requests.length, 0);
    assert.ok(Array.isArray(personal.bestEfforts));
    assert.equal(personal.powerCurve.sport, "Bike");
    const query = new URLSearchParams({
        ...input,
        start: oracle.day,
        end: oracle.today,
        sport: "Run",
      }),
      run = await get("performance-curves&" + query);
    assert.equal(at(run, 60).native_type, "TrailRun");
    assert.equal(at(run, 600).activity_id, "i780000002");
    assert.deepEqual(await get("personal-statistics"), personal);
    const after = await get("preview/native-power-sources");
    assert.ok(after.requests.every((path) => !path.includes("tags")));
    for (const route of [
      "workout-history/i780000002",
      "workouts/activity%3Ai780000002/personal",
      "workouts/activity%3Ai780000002/personal/attachments",
      "comments&workoutId=activity%3Ai780000002",
      "activities/i780000002/summary",
      "activities/i780000002/analysis",
      "activities/i780000002/route",
    ])
      await get(route);
    assert.equal((await get("preview/provider-records")).writes.length, 0);
    const response = await fetch(base + "preview/native-power-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "cap" }),
    });
    assert.equal(response.status, 200);
    const cap = await get(
      "performance-curves&" +
        new URLSearchParams({ ...input, start: oracle.day, end: oracle.today })
    );
    assert.equal(cap.coverage.skippedForCap, 2);
    assert.equal(cap.coverage.fetchedRecordings, 128);
  }
);
