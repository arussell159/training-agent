import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApiHandler } from "../../api/handler.mjs";
import { heartRateCurveSelection } from "./heart-rate-curve-model.mjs";
import {
  heartRateInventory,
  projectHeartRateCurve,
  createHeartRateCurveService,
} from "./heart-rate-curve.mjs";
import { createHeartRateCurveEndpoint } from "./heart-rate-curve-http.mjs";
import { createDesktopHeartRateFixtures } from "../../tools/desktop-heart-rate-fixtures.mjs";

const input = { kind: "heartRate", sport: "all", start: "2026-10-01", end: "2026-10-20" },
  today = "2026-10-20";
const actor = { id: "trusted-actor-a", origin: "http://localhost" },
  config = { INTERVALS_API_KEY: "synthetic-not-real", SETTINGS_SCOPE: "a" };
const rows = () => [
  {
    id: "i11",
    type: "Run",
    name: "Run source",
    start_date_local: "2026-10-19T07:00:00",
    elapsed_time: 1000,
    icu_ignore_hr: false,
    max_heartrate: 255,
  },
  {
    id: "i12",
    type: "VirtualRide",
    name: "Bike source",
    start_date_local: "2026-10-18T07:00:00",
    elapsed_time: 500,
    icu_ignore_hr: false,
  },
  {
    id: "i13",
    type: "Swim",
    name: "Swim source",
    start_date_local: "2026-10-17T07:00:00",
    elapsed_time: 1000,
    icu_ignore_hr: false,
  },
];
const payload = (type = "all") => ({
  list: [
    {
      id: "r.2026-10-01.2026-10-20",
      secs: [5, 60, 300, 600],
      values:
        type === "Run"
          ? [180, 178, 175, 176]
          : type === "Swim"
            ? [150, 149, 145, 140]
            : [200, 190, 180, 176],
      activity_id:
        type === "Run"
          ? Array(4).fill("i11")
          : type === "Swim"
            ? Array(4).fill("i13")
            : ["i12", "i12", "i11", "i11"],
    },
  ],
  activities: Object.fromEntries(
    rows().map(({ id, start_date_local, name }) => [
      id,
      { id, start_date_local, name, private_field: "not-public" },
    ])
  ),
});
function provider() {
  const calls = [],
    state = { fail: false, failType: null, gate: null, inventory: null };
  return {
    calls,
    state,
    request: async (path) => {
      calls.push(path);
      if (state.gate) await state.gate;
      if (state.fail) throw Error("raw-private-provider-message");
      const url = new URL(path, "https://synthetic.invalid");
      if (url.pathname.endsWith("/activities")) return state.inventory ?? rows();
      const type = url.searchParams.get("type") || "all";
      if (type === state.failType) throw Error("private-type-outage");
      const value = payload(type);
      value.list[0].id = url.searchParams.get("curves");
      return value;
    },
  };
}

test("HR selection uses exact native sports, explicit app-all omission contract, bounded canonical multisport selections and valid athlete-local dates", () => {
  assert.deepEqual(heartRateCurveSelection({ ...input, sport: "Swim,Run" }, today), {
    ...input,
    sport: "Run,Swim",
    nativeTypes: ["Run", "Swim"],
  });
  assert.equal(
    heartRateCurveSelection(
      { kind: "heartRate", sport: "Other", start: "2024-02-29", end: "2024-03-10" },
      today
    ).sport,
    "Other"
  );
  for (const change of [
    { sport: "All" },
    { sport: "Bike" },
    { sport: "Run,Run" },
    { sport: "Run, all" },
    { sport: "Brick" },
    { kind: "maxHR" },
    { start: "2026-02-30" },
    { start: "2026-10-21" },
    { end: "2026-10-21" },
    { start: "1899-12-31" },
    { type: "Run" },
  ])
    assert.throws(() => heartRateCurveSelection({ ...input, ...change }, today), {
      status: 400,
      code: "HR_CURVE_INVALID",
    });
});

test("exact HR duration samples retain native provenance and nonmonotonic values without max-HR fallback, source metadata leakage or null-to-zero conversion", () => {
  const selection = heartRateCurveSelection(input, today),
    inventory = heartRateInventory(rows(), selection),
    source = payload("Run");
  source.list[0].values = [0, null, 175, 176];
  const result = projectHeartRateCurve(source, selection, inventory, "Run");
  assert.deepEqual(
    result.map((point) => point.value),
    [0, null, 175, 176]
  );
  assert.equal(result[0].native_type, "Run");
  assert.equal(result[0].date, "2026-10-19");
  assert.equal(result[0].estimated, false);
  assert.doesNotMatch(JSON.stringify(result), /max_heartrate|private_field|not-public|255/);
  assert.equal(
    result.find((point) => point.duration_seconds === 10),
    undefined
  );
});

test("HR source eligibility joins authoritative inventory and masks ignored, known-short, unmatched, outside-window, missing or conflicting source identities", () => {
  const selection = heartRateCurveSelection(input, today);
  for (const change of [
    (x) => (x[0].icu_ignore_hr = true),
    (x) => (x[0].elapsed_time = 1),
    (x) => (x[0].type = "Swim"),
    (x) => (x[0].start_date_local = "2026-09-30"),
    (x) => (x[0].start_date_local = "2026-02-30"),
    (x) => x.shift(),
    (x) => x.push({ ...x[0], type: "Walk" }),
  ]) {
    const records = rows();
    change(records);
    const result = projectHeartRateCurve(
      payload("Run"),
      selection,
      heartRateInventory(records, selection),
      "Run"
    );
    assert.ok(result.every((point) => point.value === null));
  }
  for (const change of [
    (x) => (x.activities.i11.id = "i99"),
    (x) => (x.activities.i11.type = "Ride"),
    (x) => (x.activities.i11.start_date_local = "2026-10-18"),
    (x) => (x.activities.i11.icu_ignore_hr = true),
  ]) {
    const source = payload("Run");
    change(source);
    assert.ok(
      projectHeartRateCurve(source, selection, heartRateInventory(rows(), selection), "Run").every(
        (point) => point.value === null
      )
    );
  }
  const compact = payload("Run");
  delete compact.activities.i11;
  assert.equal(
    projectHeartRateCurve(compact, selection, heartRateInventory(rows(), selection), "Run")[0]
      .value,
    180,
    "complete inventory still binds explicit native winning identity"
  );
});

test("HR curves reject wrong periods, malformed/oversized/duplicate axes and misaligned optional arrays while invalid individual indices stay unavailable", () => {
  const selection = heartRateCurveSelection(input, today),
    inventory = heartRateInventory(rows(), selection);
  for (const change of [
    (x) => x.list[0].secs.reverse(),
    (x) => (x.list[0].secs[1] = 5),
    (x) => (x.list[0].secs[0] = 0),
    (x) => (x.list[0].secs[0] = 1.5),
    (x) => x.list[0].values.pop(),
    (x) => x.list[0].activity_id.pop(),
    (x) => (x.list[0].id = "wrong-window"),
    (x) => (x.list[0].end_date_local = "2026-10-21"),
    (x) => (x.list[0].start_index = [0]),
    (x) => (x.list[0].end_index = {}),
    (x) => x.list.push(x.list[0]),
    (x) => (x.activities = []),
    (x) => {
      x.list[0].secs = Array.from({ length: 10001 }, (_, i) => i + 1);
      x.list[0].values = Array(10001).fill(180);
    },
  ]) {
    const source = payload();
    change(source);
    assert.throws(() => projectHeartRateCurve(source, selection, inventory), {
      code: "HR_CURVE_UNAVAILABLE",
    });
  }
  assert.deepEqual(projectHeartRateCurve({ list: [], activities: {} }, selection, inventory), []);
  const source = payload("Run");
  source.list[0].start_index = [0, -1, 0, 0];
  source.list[0].end_index = [5, 60, 0, 600];
  const result = projectHeartRateCurve(source, selection, inventory, "Run");
  assert.equal(result[0].end_index, 5);
  assert.equal(result[1].start_index, undefined);
  assert.equal(result[2].end_index, undefined);
  assert.equal(result[3].end_index, 600);
});

test("demand-driven All omits native type, fetches only HR and inventory, preserves exact selection/provenance and refuses unauthenticated or invalid reads before provider calls", async () => {
  const p = provider(),
    service = createHeartRateCurveService({
      request: () => p.request,
      now: () => Date.parse("2026-10-20T12:00:00Z"),
    });
  await assert.rejects(service.load(config, input), { status: 401 });
  await assert.rejects(service.load(config, { ...input, sport: "All" }, { actor }), {
    status: 400,
  });
  assert.equal(p.calls.length, 0);
  const result = await service.load(config, input, { actor });
  assert.equal(p.calls.length, 2);
  const query = new URL(
    p.calls.find((path) => path.includes("/hr-curves.json")),
    "https://synthetic.invalid"
  ).searchParams;
  assert.equal(query.has("type"), false);
  assert.equal(query.get("curves"), "r.2026-10-01.2026-10-20");
  assert.equal(result.kind, "heartRate");
  assert.equal(result.unit, "bpm");
  assert.deepEqual(result.selection, { sport: "all", nativeTypes: [] });
  assert.deepEqual(
    result.points.map((point) => point.native_type),
    ["VirtualRide", "VirtualRide", "Run", "Run"]
  );
  assert.equal(result.coverage.status, "native-aggregate");
  assert.equal(result.warning, "");
});

test("selected native families and combined requests use exact-duration verified maxima and retain healthy components with explicit partial failure", async () => {
  const p = provider(),
    service = createHeartRateCurveService({
      request: () => p.request,
      now: () => Date.parse("2026-10-20T12:00:00Z"),
    });
  p.state.failType = "Swim";
  const result = await service.load(config, { ...input, sport: "Run,Swim" }, { actor });
  assert.deepEqual(
    result.points.map((point) => point.value),
    [180, 178, 175, 176]
  );
  assert.equal(result.coverage.status, "partial");
  assert.deepEqual(result.coverage.failedSelections, ["Swim"]);
  assert.doesNotMatch(JSON.stringify(result), /private-type-outage/);
  assert.equal(p.calls.length, 3);
  const other = await service.load(config, { ...input, sport: "Other" }, { actor });
  assert.ok(
    other.points.every((point) => point.value === null),
    "wrong-sport native winners cannot masquerade as selected Other"
  );
  assert.equal(other.coverage.status, "partial");
});

test("HR cache coalesces demand reads, isolates actor/config/window, clones results and bounds provider failures with retry after cooldown", async () => {
  const p = provider();
  let now = Date.parse("2026-10-20T12:00:00Z");
  const service = createHeartRateCurveService({
    request: () => p.request,
    now: () => now,
    failureTtl: 100,
    ttl: 1000,
  });
  const [a, b] = await Promise.all([
    service.load(config, input, { actor }),
    service.load(config, input, { actor }),
  ]);
  assert.equal(p.calls.length, 2);
  a.points[0].value = 1;
  a.selection.nativeTypes.push("Other");
  assert.equal(b.points[0].value, 200);
  assert.deepEqual((await service.load(config, input, { actor })).selection.nativeTypes, []);
  await service.load(config, input, { actor: { ...actor, id: "b" } });
  await service.load({ ...config, INTERVALS_API_KEY: "rotated" }, input, { actor });
  await service.load(config, { ...input, start: "2026-10-02" }, { actor });
  assert.equal(p.calls.length, 8);
  service.clear();
  p.state.fail = true;
  await assert.rejects(service.load(config, input, { actor }), { code: "HR_CURVE_UNAVAILABLE" });
  const failedCalls = p.calls.length;
  await assert.rejects(service.load(config, input, { actor }), { code: "HR_CURVE_UNAVAILABLE" });
  assert.equal(p.calls.length, failedCalls);
  p.state.fail = false;
  now += 101;
  assert.equal((await service.load(config, input, { actor })).points[0].value, 200);
  assert.equal(p.calls.length, failedCalls + 2);
});

test("one canceled HR reader cannot abort shared provider work; pending capacity rejects safely rather than duplicating unbounded requests", async () => {
  const p = provider();
  let release;
  p.state.gate = new Promise((resolve) => (release = resolve));
  const service = createHeartRateCurveService({
      request: () => p.request,
      maxEntries: 1,
      now: () => Date.parse("2026-10-20T12:00:00Z"),
    }),
    abort = new AbortController();
  const first = service.load(config, input, { actor, signal: abort.signal }),
    second = service.load(config, input, { actor });
  abort.abort(Error("caller canceled"));
  await assert.rejects(first, /caller canceled/);
  await assert.rejects(service.load(config, { ...input, sport: "Run" }, { actor }), {
    status: 429,
    code: "HR_CURVE_BUSY",
  });
  release();
  assert.equal((await second).points[0].value, 200);
  assert.equal(p.calls.length, 2);
});

test("actual authenticated HR HTTP adapter retains production route normalization, ignores forged actor headers, validates options and never exposes provider errors", async (t) => {
  const p = provider(),
    service = createHeartRateCurveService({
      request: () => p.request,
      now: () => Date.parse("2026-10-20T12:00:00Z"),
    }),
    endpoint = createHeartRateCurveEndpoint({ service, readConfig: async () => config });
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
  const url = `http://127.0.0.1:${server.address().port}/api/handler?__api_route=performance-curves&kind=heartRate&sport=all&start=2026-10-01&end=2026-10-20`;
  const unauthorized = await fetch(url, { headers: { "X-App-Actor": "forged" } });
  assert.equal(unauthorized.status, 401);
  assert.equal(p.calls.length, 0);
  const headers = { Authorization: "Bearer synthetic-auth" },
    success = await fetch(url, { headers });
  assert.equal(success.status, 200);
  assert.equal((await success.json()).points[0].native_type, "VirtualRide");
  assert.equal(success.headers.get("Cache-Control"), "private,no-store");
  for (const bad of [
    url + "&sport=Run",
    url + "&unknown=x",
    url.replace("heartRate", "maxHR"),
    url.replace("sport=all", "sport=Brick"),
  ])
    assert.equal((await fetch(bad, { headers })).status, 400);
  assert.equal((await fetch(url, { method: "POST", headers })).status, 405);
  service.clear();
  p.state.fail = true;
  const unavailable = await fetch(url, { headers });
  assert.equal(unavailable.status, 502);
  assert.doesNotMatch(
    JSON.stringify(await unavailable.json()),
    /raw-private-provider-message|synthetic-not-real/
  );
});

test("synthetic HR provider exercises real projection, all/native selection, ignored/short masks, measured zero and independently sampled raw effort bounds", async () => {
  const fixture = createDesktopHeartRateFixtures({ today }),
    result = await fixture.service.load(fixture.config, input, { actor: fixture.actor });
  assert.deepEqual(
    result.points.map((point) => point.value),
    [240, 210, null, null, 210, 180]
  );
  assert.equal(result.coverage.status, "partial");
  const native = await fixture.service.load(
    fixture.config,
    { ...input, sport: "Other" },
    { actor: fixture.actor }
  );
  assert.equal(native.points[0].value, 210);
  const zero = await fixture.service.load(
    fixture.config,
    { ...input, sport: "Walk" },
    { actor: fixture.actor }
  );
  assert.equal(zero.points[0].value, 0);
  const point = result.points[1],
    raw = fixture.snapshot().sources.find((source) => source.activity.id === point.activity_id),
    times = raw.streams.find((stream) => stream.type === "time").data,
    hr = raw.streams.find((stream) => stream.type === "heartrate").data,
    seconds = times[point.end_index] - times[point.start_index],
    weighted =
      hr
        .slice(point.start_index, point.end_index)
        .reduce(
          (sum, value, index) =>
            sum + value * (times[point.start_index + index + 1] - times[point.start_index + index]),
          0
        ) / seconds;
  assert.equal(seconds, 60);
  assert.equal(weighted, 210);
  assert.equal(weighted, point.value);
  const bounds = fixture.effort(point.activity_id, 60);
  assert.equal(bounds.available, true);
  assert.equal(bounds.chart_start_seconds, 0);
  assert.equal(bounds.chart_end_seconds, 60);
  assert.equal(fixture.analysis(point.activity_id).points[5].heartRate, 210);
  assert.equal(fixture.lookup(point.activity_id).duration, "5m 0s");
  assert.equal(fixture.effort("i710000005", 5).available, false);
  assert.equal(fixture.effort("i710000006", 60).available, false);
});
