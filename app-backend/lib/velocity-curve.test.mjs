import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as netServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createApiHandler } from "../../api/handler.mjs";
import { velocityCurveSelection, VELOCITY_GRID_SECONDS } from "./velocity-curve-model.mjs";
import {
  velocityInventory,
  projectVelocityActivityCurve,
  createVelocityCurveService,
} from "./velocity-curve.mjs";
import { createVelocityCurveEndpoint } from "./velocity-curve-http.mjs";
import { createDesktopVelocityFixtures } from "../../tools/desktop-velocity-fixtures.mjs";

const today = "2026-10-20",
  input = { kind: "velocity", sport: "all", start: "2026-10-01", end: today };
const actor = { id: "actor-a", origin: "http://localhost" },
  config = { INTERVALS_API_KEY: "synthetic-key", SETTINGS_SCOPE: "synthetic" };
const clock = Date.parse(`${today}T12:00:00Z`);
const row = (id = "i11", type = "Ride", seconds = 600) => ({
  id,
  type,
  start_date_local: "2026-10-19T08:00:00",
  elapsed_time: seconds,
  name: "Recorded velocity",
  stream_types: ["time", "velocity_smooth"],
  icu_sync_date: "2026-10-19T09:00:00Z",
});
const curve = (values = [90.5, 0, 80]) => [
  {
    id: "velocity-not-an-activity-id",
    stream_type: "velocity_smooth",
    after_kj: 0,
    secs: [5, 60, 600],
    values,
    watts: [...values],
    start_index: [0, 0, 0],
    end_index: [5, 60, 600],
  },
];
function provider() {
  const state = { rows: [row()], fail: false, gate: null, malformed: false },
    calls = [];
  return {
    state,
    calls,
    request: async (path) => {
      calls.push(path);
      if (state.gate) await state.gate;
      if (state.fail) throw Error("private-provider-outage synthetic-key");
      return path.includes("/activities?")
        ? structuredClone(state.rows)
        : state.malformed
          ? [{ stream_type: "watts" }]
          : curve();
    },
  };
}

test("velocity input rejects unsupported dates/sports/tags before any provider read", async () => {
  for (const patch of [
    { kind: "watts" },
    { sport: "Brick" },
    { sport: "Run,Run" },
    { start: "2026-02-30" },
    { end: "2026-10-21" },
    { start: "2026-10-21" },
    { start: "1899-12-31" },
    { extra: true },
  ])
    assert.throws(() => velocityCurveSelection({ ...input, ...patch }, today), {
      code: "VELOCITY_CURVE_INVALID",
    });
  assert.throws(() => velocityCurveSelection({ ...input, tags: "anything" }, today), {
    code: "VELOCITY_FILTER_UNSUPPORTED",
  });
  assert.deepEqual(velocityCurveSelection({ ...input, sport: "Swim,Run" }, today).nativeTypes, [
    "Run",
    "Swim",
  ]);
  const p = provider(),
    service = createVelocityCurveService({ request: () => p.request, now: () => clock });
  await assert.rejects(service.load(config, { ...input, tags: "" }, { actor }), { status: 400 });
  await assert.rejects(service.load(config, input, { actor: { id: "forged" } }), { status: 401 });
  await assert.rejects(service.load({}, input, { actor }), { status: 503 });
  assert.equal(p.calls.length, 0);
});

test("native per-record velocity shape binds requested recording, retains decimal m/s and zero, never uses generic curve id", () => {
  const record = velocityInventory([row()], velocityCurveSelection(input, today)).eligible[0];
  const result = projectVelocityActivityCurve(curve(), record);
  assert.deepEqual(
    result.points.map((point) => [
      point.duration_seconds,
      point.value,
      point.activity_id,
      point.native_type,
    ]),
    [
      [5, 90.5, "i11", "Ride"],
      [60, 0, "i11", "Ride"],
      [600, 80, "i11", "Ride"],
    ]
  );
  assert.equal(result.partial, false);
  assert.equal(result.points[0].end_index, 5);
  assert.deepEqual(
    VELOCITY_GRID_SECONDS,
    [5, 10, 12, 20, 30, 60, 120, 300, 360, 600, 720, 1200, 1800, 3600, 5400]
  );
  assert.equal(result.points.length, 3, "unreturned reference anchors are not invented");
});

test("native source parser rejects wrong sensor/fatigue/misalignment/conflicting aliases and malformed axis", () => {
  const record = velocityInventory([row()], velocityCurveSelection(input, today)).eligible[0];
  for (const mutate of [
    (c) => (c.stream_type = "watts"),
    (c) => (c.after_kj = 1),
    (c) => (c.secs = [5, 5, 600]),
    (c) => (c.secs = [5, 60.5, 600]),
    (c) => c.values.pop(),
    (c) => (c.watts[0] = 91),
    (c) => c.start_index.pop(),
    (c) => (c.start_date_local = "2026-10-18T00:00:00"),
  ]) {
    const bad = curve();
    mutate(bad[0]);
    assert.throws(() => projectVelocityActivityCurve(bad, record), { status: 502 });
  }
  assert.throws(() => projectVelocityActivityCurve([...curve(), ...curve()], record), {
    status: 502,
  });
  assert.deepEqual(projectVelocityActivityCurve([], record), {
    points: [],
    missing: true,
    partial: false,
  });
});

test("unknown samples preserve honest source provenance; short recordings and conflicting supplied identity cannot win", () => {
  const record = velocityInventory([row("i11", "Run", 60)], velocityCurveSelection(input, today))
    .eligible[0];
  const raw = curve([null, 0, 300]);
  raw[0].activity_id = ["i11", "i999", "i11"];
  const result = projectVelocityActivityCurve(raw, record);
  assert.deepEqual(
    result.points.map((point) => point.value),
    [null, null, null]
  );
  assert.ok(
    result.points.every(
      (point) =>
        point.activity_id === "i11" &&
        point.native_type === "Run" &&
        point.date === "2026-10-19" &&
        !Object.hasOwn(point, "start_index")
    )
  );
  const noIndices = curve();
  delete noIndices[0].start_index;
  delete noIndices[0].end_index;
  assert.equal(
    projectVelocityActivityCurve(noIndices, { ...record, duration: null }).partial,
    false
  );
  const badIndices = curve();
  badIndices[0].end_index[0] = -1;
  assert.equal(
    projectVelocityActivityCurve(badIndices, { ...record, duration: null }).points[0].value,
    90.5
  );
  assert.equal(
    projectVelocityActivityCurve(badIndices, { ...record, duration: null }).partial,
    true
  );
});

test("inventory honors native families, velocity/pace exclusions and stream availability without borrowing HR/power flags", () => {
  const selection = velocityCurveSelection({ ...input, sport: "Run,Ride" }, today);
  const source = {
    ...row("i12", "TrailRun"),
    icu_ignore_hr: true,
    icu_ignore_power: true,
  };
  const absent = { ...row("i13", "VirtualRide"), stream_types: ["time", "watts"] };
  const unknown = { ...row("i14", "Run"), stream_types: null };
  const result = velocityInventory(
    [
      source,
      absent,
      unknown,
      { ...row("i17", "Run"), ignore_pace: true },
      { ...row("i18", "Run"), ignore_velocity: true },
      row("i15", "Swim"),
      { ...row("i16"), start_date_local: "2026-09-01" },
    ],
    selection
  );
  assert.deepEqual(
    result.eligible.map((value) => value.id),
    ["i12", "i14"]
  );
  assert.equal(result.excludedWithoutVelocity, 1);
  assert.equal(result.excludedIgnoredRecordings, 2);
  assert.equal(result.partial, true);
  const conflict = velocityInventory([row(), { ...row(), elapsed_time: 99 }], selection);
  assert.equal(conflict.eligible.length, 0);
  assert.equal(conflict.partial, true);
});

test("actual synthetic velocity service aggregates exact source maxima, preserves raw Run/zero/null and declares failed/missing coverage", async () => {
  const f = createDesktopVelocityFixtures({ today }),
    load = (sport) => f.service.load(f.config, { ...input, sport }, { actor: f.actor });
  const result = await load("all"),
    by = (seconds) => result.points.find((point) => point.duration_seconds === seconds);
  assert.equal(by(5).value, 25);
  assert.equal(by(60).value, 12);
  assert.equal(by(600).value, 12);
  assert.equal(by(5400).value, 12);
  assert.equal(by(17).value, null);
  assert.deepEqual(result.coverage, {
    status: "partial",
    inventoryRecords: 11,
    eligibleRecordings: 8,
    fetchedRecordings: 8,
    failedRecordings: 1,
    missingRecordings: 1,
    skippedForCap: 0,
    excludedWithoutVelocity: 1,
    excludedIgnoredRecordings: 2,
    unknownPoints: 1,
  });
  assert.equal(
    (await load("Run")).points[0].value,
    8,
    "unignored native running sample must not be removed by ignore_hr"
  );
  assert.equal((await load("Walk")).points[0].value, 0);
  const source = f.snapshot().sources.find((source) => source.activity.id === by(600).activity_id);
  const times = source.streams.find((stream) => stream.type === "time").data,
    values = source.streams.find((stream) => stream.type === "velocity_smooth").data;
  let total = 0;
  for (let i = 1; i <= 600; i++) total += values[i] * (times[i] - times[i - 1]);
  assert.equal(
    total / (times[600] - times[0]),
    by(600).value,
    "independent raw recording duration-weighted oracle"
  );
  assert.ok(
    f.snapshot().requests.every((path) => !path.includes("hr-curves") && !path.includes("type=all"))
  );
  assert.equal(result.unit, "m/s");
  assert.equal(result.unitPolicy, "native-velocity-smooth");
  assert.equal(result.valuePolicy, "native-reported");
  const swim = await load("Swim");
  assert.equal(swim.points.find((point) => point.duration_seconds === 1800).value, 1);
  assert.equal(
    swim.points.some((point) => point.duration_seconds === 3600),
    false
  );
  assert.ok(
    result.warning.startsWith(
      "Speed uses the provider’s reported precision; rounded speed values can make pace less precise."
    )
  );
  assert.doesNotMatch(result.warning, /TrainingPeaks|probes?|unverified|unsupported/i);
});

test("production cap keeps bounded native requests and reports skipped candidates rather than claiming whole-window peak", async () => {
  const f = createDesktopVelocityFixtures({ today });
  f.setScenario("cap");
  const result = await f.service.load(f.config, input, { actor: f.actor }),
    snapshot = f.snapshot();
  assert.equal(result.coverage.eligibleRecordings, 130);
  assert.equal(result.coverage.fetchedRecordings, 128);
  assert.equal(result.coverage.skippedForCap, 2);
  assert.equal(result.coverage.status, "partial");
  assert.equal(snapshot.requests.filter((path) => path.includes("power-curves")).length, 128);
  assert.equal(result.points[0].value, 12);
  assert.ok(result.points.every((point) => point.value !== 999));
  assert.match(result.warning, /2 recordings omitted by the 128-recording limit/);
  assert.throws(() => createVelocityCurveService({ maxRecordings: 129 }), /bounded/);
});

test("velocity caches coalesce identical demand, reuse source across windows, isolate actors/credentials/revisions and clone returned data", async () => {
  const p = provider(),
    service = createVelocityCurveService({ request: () => p.request, now: () => clock });
  const [a, b] = await Promise.all([
    service.load(config, input, { actor }),
    service.load(config, input, { actor }),
  ]);
  assert.equal(p.calls.length, 2);
  a.points[0].value = 999;
  assert.equal(b.points[0].value, 90.5);
  await service.load(config, { ...input, start: "2026-10-02" }, { actor });
  assert.equal(p.calls.length, 3, "overlapping window reuses unchanged validated source");
  await service.load(config, input, { actor: { ...actor, id: "b" } });
  await service.load({ ...config, INTERVALS_API_KEY: "rotated" }, input, { actor });
  assert.equal(p.calls.length, 7);
  p.state.rows[0].icu_sync_date = "2026-10-20T09:00:00Z";
  await service.load(config, { ...input, start: "2026-10-03" }, { actor });
  assert.equal(p.calls.length, 9);
  service.clear();
  await service.load(config, input, { actor });
  assert.equal(p.calls.length, 11);
});

test("pace ignored segments cannot win without verified nonoverlapping source index pairs; malformed ignore metadata fails closed", () => {
  const selection = velocityCurveSelection(input, today),
    record = velocityInventory(
      [{ ...row(), ignore_parts: [{ pace: true, start_index: 10, end_index: 30 }] }],
      selection
    ).eligible[0];
  const raw = curve([5, 6, 7]);
  raw[0].start_index = [0, 100, 0];
  raw[0].end_index = [5, 160, 600];
  const result = projectVelocityActivityCurve(raw, record);
  assert.deepEqual(
    result.points.map((point) => point.value),
    [5, 6, null]
  );
  assert.equal(result.partial, true);
  delete raw[0].start_index;
  delete raw[0].end_index;
  assert.ok(
    projectVelocityActivityCurve(raw, record).points.every((point) => point.value === null)
  );
  for (const patch of [
    { ignore_velocity: "true" },
    { ignore_pace: "false" },
    { ignore_parts: [{ pace: true, start_index: 0, end_index: -1 }] },
    { ignore_parts: "corrupt" },
  ]) {
    const inventory = velocityInventory([{ ...row(), ...patch }], selection);
    assert.equal(inventory.eligible.length, 0);
    assert.equal(inventory.partial, true);
  }
  const irrelevant = velocityInventory(
    [{ ...row(), ignore_parts: [{ power: true, hr: true }] }],
    selection
  ).eligible[0];
  assert.equal(projectVelocityActivityCurve(curve(), irrelevant).points[0].value, 90.5);
});

test("malformed/failed source reads use bounded cooldown, never false empty success, and recover after retry lifetime", async () => {
  const p = provider();
  let now = clock;
  const service = createVelocityCurveService({
    request: () => p.request,
    now: () => now,
    failureTtl: 100,
    ttl: 1000,
  });
  p.state.malformed = true;
  await assert.rejects(service.load(config, input, { actor }), { status: 502 });
  const count = p.calls.length;
  p.state.malformed = false;
  await assert.rejects(service.load(config, input, { actor }), { status: 502 });
  assert.equal(p.calls.length, count);
  now += 101;
  assert.equal((await service.load(config, input, { actor })).points[0].value, 90.5);
  assert.equal(p.calls.length, count + 2);
  service.clear();
  p.state.fail = true;
  await assert.rejects(
    service.load(config, input, { actor }),
    (error) =>
      error.code === "VELOCITY_CURVE_UNAVAILABLE" && !error.message.includes("private-provider")
  );
});

test("canceled velocity subscriber does not abort shared native work; pending capacity prevents unbounded extra requests", async () => {
  const p = provider();
  let release;
  p.state.gate = new Promise((resolve) => (release = resolve));
  const service = createVelocityCurveService({
      request: () => p.request,
      now: () => clock,
      maxEntries: 1,
    }),
    controller = new AbortController();
  const first = service.load(config, input, { actor, signal: controller.signal }),
    second = service.load(config, input, { actor });
  controller.abort(Error("reader left"));
  await assert.rejects(first, /reader left/);
  await assert.rejects(service.load(config, { ...input, sport: "Run" }, { actor }), {
    status: 429,
  });
  release();
  assert.equal((await second).points[0].value, 90.5);
  assert.equal(p.calls.length, 2);
});

test("authenticated HTTP velocity endpoint uses actual function routing, strict query validation and safe failures without forged actor selection", async (t) => {
  const p = provider(),
    service = createVelocityCurveService({ request: () => p.request, now: () => clock }),
    endpoint = createVelocityCurveEndpoint({ service, readConfig: async () => config });
  const handler = createApiHandler({
    hosted: () => false,
    loadServer: async () => ({
      handleRequest: async (req, res) => {
        if (req.headers.authorization === "Bearer synthetic-auth") req.appActor = actor;
        return endpoint(req, res);
      },
    }),
  });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/handler?__api_route=performance-curves&${new URLSearchParams(input)}`,
    headers = { Authorization: "Bearer synthetic-auth" };
  assert.equal((await fetch(url, { headers: { "X-App-Actor": "forged" } })).status, 401);
  assert.equal(p.calls.length, 0);
  const good = await fetch(url, { headers });
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("Cache-Control"), "private,no-store");
  assert.equal((await good.json()).points[0].value, 90.5);
  for (const bad of [
    url + "&sport=Run",
    url + "&unknown=x",
    url.replace("sport=all", "sport=Brick"),
  ])
    assert.equal((await fetch(bad, { headers })).status, 400);
  const tag = await fetch(url + "&tags=real-tag", { headers });
  assert.equal(tag.status, 400);
  assert.equal((await tag.json()).code, "VELOCITY_FILTER_UNSUPPORTED");
  assert.equal((await fetch(url, { headers, method: "POST" })).status, 405);
  service.clear();
  p.state.fail = true;
  const failed = await fetch(url, { headers });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(JSON.stringify(await failed.json()), /private-provider|synthetic-key/);
});

test(
  "actual synthetic HTTP velocity source Summary dependencies and cap mode are independently readable without provider mutations",
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
      const timer = setTimeout(() => reject(Error("Velocity preview startup timed out")), 10000);
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
    const oracle = await get("preview/velocity-sources"),
      query = new URLSearchParams({ ...input, start: oracle.day, end: oracle.today });
    const result = await get(`performance-curves&${query}`);
    assert.equal(result.kind, "velocity");
    assert.equal(result.points.find((point) => point.duration_seconds === 600).value, 12);
    const history = await get("workout-history/i740000001");
    assert.equal(history.workout.duration, "90m 0s");
    for (const route of [
      "workouts/activity%3Ai740000001/personal",
      "workouts/activity%3Ai740000001/personal/attachments",
      "comments&workoutId=activity%3Ai740000001",
      "activities/i740000001/summary",
      "activities/i740000001/analysis",
      "activities/i740000001/route",
    ])
      await get(route);
    const writes = await get("preview/provider-records");
    assert.equal(writes.writes.length, 0);
    const cap = await fetch(base + "preview/velocity-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "cap" }),
    });
    assert.equal(cap.status, 200);
    const limited = await get(`performance-curves&${query}`);
    assert.equal(limited.coverage.skippedForCap, 2);
    assert.equal(limited.points[0].value, 12);
    const unknown = await fetch(base + "performance-curves&" + query + "&tags=x");
    assert.equal(unknown.status, 400);
  }
);
