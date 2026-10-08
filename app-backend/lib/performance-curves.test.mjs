import test from "node:test";
import assert from "node:assert/strict";
import {
  createPerformanceHistory,
  performancePeriods,
  performanceTotals,
  performanceWindow,
  performanceAnchors,
  performanceAccount,
  performanceActivityId,
  performanceEffortSelection,
  curvePeak,
  curveBestEfforts,
  homeCurvePeak,
  normalizeActivityCurves,
  activityCurvePeak,
  fetchPersonalActivityRecords,
} from "./performance-curves.mjs";

const instant = Date.parse("2026-10-08T17:00:00Z");
const config = { INTERVALS_API_KEY: "mock-key", SETTINGS_SCOPE: "mock-account" };
const activity = (id, type = "Ride", extras = {}) => ({
  id,
  type,
  start_date_local: "2026-10-07T06:00:00",
  moving_time: 3600,
  distance: 30000,
  icu_training_load: 60,
  icu_joules: 600000,
  ...extras,
});
function provider() {
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    const url = new URL(path, "https://mock.invalid");
    if (url.pathname.endsWith("/activities"))
      return [activity("i1"), activity("i2", "Run"), activity("i3", "Swim")];
    const type = url.searchParams.get("type");
    const ride = type === "Ride";
    const list = url.searchParams
      .get("curves")
      .split(",")
      .map((id) => ({
        id,
        ...(ride
          ? {
              secs: [5, 10, 30, 60, 300, 600, 1200, 3600],
              values: [600, 550, 450, 400, 300, 280, 250, 200],
              watts_per_kg: [8, 7, 6, 5, 4, 3.8, 3.4, 2.6],
            }
          : {
              distance:
                type === "Run"
                  ? [400, 1000, 1609, 5000, 10000, 21097.5]
                  : [100, 200, 400, 1000, 1500],
              values: type === "Run" ? [60, 170, 300, 1200, 2600, 6200] : [75, 160, 340, 920, 1450],
            }),
        activity_id: Array(8).fill(type === "Ride" ? "i1" : type === "Run" ? "i2" : "i3"),
      }));
    return {
      list,
      activities: {
        i1: { ...activity("i1"), name: "Ride" },
        i2: { ...activity("i2", "Run"), name: "Run" },
        i3: { ...activity("i3", "Swim"), name: "Swim" },
      },
    };
  };
  return { calls, request };
}

test("periods are four Monday weeks and twelve calendar months, newest first, with partial current periods", () => {
  const periods = performancePeriods("2024-03-01");
  assert.deepEqual(periods.weeks[0], {
    start: "2024-02-26",
    end: "2024-03-01",
    label: "2024-02-26",
    token: "r.2024-02-26.2024-03-01",
  });
  assert.equal(periods.weeks.length, 4);
  assert.equal(periods.months.length, 12);
  assert.equal(periods.months[1].end, "2024-02-29");
  assert.equal(periods.months[11].start, "2023-04-01");
  assert.equal(performancePeriods("2026-01-01").months[1].end, "2025-12-31");
  assert.equal(performancePeriods("2026-11-02").weeks[0].start, "2026-11-02");
});

test("invalid types and reversed, future, malformed or unpaired ranges fail before provider requests", async () => {
  const { calls, request } = provider();
  const service = createPerformanceHistory({ request: () => request, now: () => instant });
  await assert.rejects(service.history(config, "EBikeRide"), (error) => error.status === 400);
  for (const options of [
    { oldest: "2026-02-30", newest: "2026-10-08" },
    { oldest: "2026-10-09", newest: "2026-10-10" },
    { oldest: "2026-10-08", newest: "2026-10-07" },
    { oldest: "2026-10-01" },
  ])
    await assert.rejects(service.personal(config, options), (error) => error.status === 400);
  assert.equal(calls.length, 0);
  assert.deepEqual(performanceWindow(null, null, "2026-10-08"), {
    oldest: null,
    newest: "2026-10-08",
    token: "all",
  });
});

test("totals deduplicate IDs, group sport variants, exclude other and future activities, and convert only recorded joules to kJ", () => {
  const rows = [
    activity("i1", "VirtualRide"),
    activity("i1", "VirtualRide"),
    activity("i2", "GravelRide"),
    activity("i3", "MountainBikeRide"),
    activity("i4", "TrailRun"),
    activity("future", "Ride", { start_date_local: "2026-10-09T06:00:00" }),
  ];
  const totals = performanceTotals(rows, "Ride", "2026-10-05", "2026-10-08");
  assert.equal(totals.activities, 3);
  assert.equal(totals.duration_seconds, 10800);
  assert.equal(totals.distance_meters, 90000);
  assert.equal(totals.tss, 180);
  assert.equal(totals.work_kj, 1800);
  assert.equal(performanceTotals(rows, "Run", "2026-10-05", "2026-10-08").activities, 1);
  assert.equal(
    performanceTotals([activity("i1", "OpenWaterSwim")], "Swim", "2026-10-05", "2026-10-08")
      .work_kj,
    null
  );
});

test("explicit zero is known, missing totals are null, partial known sums and truncation are marked incomplete", () => {
  const rows = [
    activity("i1", "Ride", { icu_training_load: 0, icu_joules: 0, distance: 0 }),
    activity("i2", "Ride", { icu_training_load: null, icu_joules: null, distance: null }),
  ];
  const total = performanceTotals(rows, "Ride", "2026-10-05", "2026-10-08");
  assert.equal(total.tss, 0);
  assert.equal(total.work_kj, 0);
  assert.equal(total.distance_meters, 0);
  assert.equal(total.incomplete.tss, true);
  assert.equal(total.incomplete.work_kj, true);
  const missing = performanceTotals([rows[1]], "Ride", "2026-10-05", "2026-10-08");
  assert.equal(missing.tss, null);
  assert.equal(missing.work_kj, null);
  const empty = performanceTotals([], "Ride", "2026-10-05", "2026-10-08");
  assert.equal(empty.tss, 0);
  assert.equal(empty.incomplete.tss, false);
  assert.equal(
    performanceTotals([rows[0]], "Ride", "2026-10-05", "2026-10-08", true).incomplete.tss,
    true
  );
  assert.equal(
    performanceTotals([{ id: "strava-stub" }], "Ride", "2026-10-05", "2026-10-08").incomplete.tss,
    true
  );
});

test("power anchors are exact, zero watts is real, missing and nonfinite values do not become records", () => {
  const bundle = {
    curve: {
      secs: [5, 60, 299, 1200],
      values: [0, null, 500, Infinity],
      activity_id: ["i1"],
      watts_per_kg: [0],
    },
    activities: {},
  };
  const anchors = performanceAnchors("Ride");
  assert.equal(curvePeak(bundle, "Ride", anchors[0]).value, 0);
  assert.equal(curvePeak(bundle, "Ride", anchors[0]).watts_per_kg, 0);
  assert.equal(curvePeak(bundle, "Ride", anchors[1]).value, null);
  assert.equal(curvePeak(bundle, "Ride", anchors[2]).value, null);
  assert.equal(curvePeak(bundle, "Ride", anchors[3]).value, null);
});

test("pace uses source metres and elapsed seconds, never interpolation or whole-activity average", () => {
  const bundle = {
    curve: {
      distance: [400, 1000, 4999, 10000],
      values: [60, 180, 1200, null],
      activity_id: ["i1", "i1", "i1", "i1"],
    },
    activities: {
      i1: {
        type: "TrailRun",
        name: "Intervals",
        start_date_local: "2026-10-07T06:00:00",
        average_speed: 1,
      },
    },
  };
  const anchors = performanceAnchors("Run");
  const peak = curvePeak(bundle, "Run", anchors[0]);
  assert.equal(peak.value, 400 / 60);
  assert.equal(peak.duration_seconds, null);
  assert.equal(peak.elapsed_seconds, 60);
  assert.equal(peak.date, "2026-10-07");
  assert.equal(peak.estimated, false);
  assert.equal(curvePeak(bundle, "Run", anchors[2]).value, null);
  assert.equal(curvePeak(bundle, "Run", anchors[3]).value, null);
  bundle.activities.i1.type = "Ride";
  assert.equal(curvePeak(bundle, "Run", anchors[0]).value, null);
});

test("nominal mile labels retain source distance/time and do not fabricate adjusted elapsed or W/kg", () => {
  const bundle = {
    curve: { distance: [1609], values: [300], activity_id: ["i1"] },
    activities: { i1: { weight: 75 } },
  };
  const effort = curveBestEfforts(bundle, "Run").find(
    (value) => value.requested_distance_meters === 1609.344
  );
  assert.equal(effort.distance_meters, 1609);
  assert.equal(effort.duration_seconds, 300);
  assert.equal(effort.value, 1609 / 300);
  assert.equal(effort.watts_per_kg, undefined);
});

test("simultaneous Home readers share one summary and one batched curve request with account-safe clone isolation", async () => {
  const { calls, request } = provider();
  const service = createPerformanceHistory({ request: () => request, now: () => instant });
  const results = await Promise.all(
    Array.from({ length: 10 }, () => service.history(config, "Ride"))
  );
  assert.equal(calls.length, 2);
  const curveUrl = new URL(
    calls.find((value) => value.includes("power-curves")),
    "https://mock.invalid"
  );
  assert.equal(curveUrl.searchParams.get("curves").split(",").length, 29);
  assert.equal(curveUrl.searchParams.get("newest"), "2026-10-08T23:59:59");
  assert.equal(results[0].weeks.length, 4);
  assert.equal(results[0].months.length, 12);
  results[0].weeks[0].peaks[0].value = -1;
  assert.equal(results[1].weeks[0].peaks[0].value, 600);
  assert.equal((await service.history(config, "Ride")).weeks[0].peaks[0].value, 600);
  assert.equal(calls.length, 2);
});

test("sport changes reuse shared activity totals, and Settings reuses Home all-time curves", async () => {
  const { calls, request } = provider();
  const service = createPerformanceHistory({ request: () => request, now: () => instant });
  const [ride, run] = await Promise.all([
    service.history(config, "Ride"),
    service.history(config, "Run"),
  ]);
  assert.equal(calls.length, 3);
  assert.equal(run.weeks[0].peaks[0].value, 400 / 60);
  assert.equal(ride.weeks[0].peaks[0].duration_seconds, 5);
  const value = await service.personal(config);
  assert.equal(calls.filter((path) => /(?:power|pace)-curves/.test(path)).length, 3);
  assert.ok(
    value.bestEfforts.some((effort) => effort.sport === "Bike" && effort.duration_seconds === 1200)
  );
  assert.ok(
    value.bestEfforts.some((effort) => effort.sport === "Run" && effort.distance_meters === 5000)
  );
  assert.ok(
    value.bestEfforts.some((effort) => effort.sport === "Swim" && effort.distance_meters === 100)
  );
  assert.deepEqual(value.bestEffortsWindow, { oldest: null, newest: "2026-10-08" });
  assert.equal(value.records.length, 3);
});

test("Settings windows query exact ranges without downloading activity history again", async () => {
  const { calls, request } = provider();
  const service = createPerformanceHistory({ request: () => request, now: () => instant });
  await service.personal(config);
  const recordCalls = calls.filter((path) => path.includes("/activities?")).length;
  const result = await service.personal(config, { oldest: "2026-01-01", newest: "2026-10-08" });
  assert.deepEqual(result.bestEffortsWindow, { oldest: "2026-01-01", newest: "2026-10-08" });
  assert.equal(calls.filter((path) => path.includes("/activities?")).length, recordCalls);
  assert.equal(
    new URL(calls.at(-1), "https://mock.invalid").searchParams.get("curves"),
    "r.2026-01-01.2026-10-08"
  );
  await service.personal(config, { oldest: "2026-01-01", newest: "2026-10-08" });
  assert.equal(calls.length, recordCalls + 6);
});

test("account identity isolates scope, credentials, project and OAuth/provider transitions without leaking keys", async () => {
  const { calls, request } = provider();
  const service = createPerformanceHistory({ request: () => request, now: () => instant });
  const configurations = [
    config,
    { ...config, SETTINGS_SCOPE: "other" },
    { ...config, INTERVALS_API_KEY: "other-key" },
    { ...config, SUPABASE_URL: "https://other.invalid" },
    { ...config, INTERVALS_CLIENT_ID: "oauth-app" },
    { ...config, INTERVALS_ACCESS_TOKEN: "mock-token" },
  ];
  for (const value of configurations) await service.history(value, "Ride");
  assert.equal(calls.length, 12);
  assert.equal(new Set(configurations.map(performanceAccount)).size, 6);
  assert.match(performanceAccount(config), /^[a-f0-9]{64}$/);
});

test("expiry and explicit invalidation refresh once; DST uses athlete local dates", async () => {
  const { calls, request } = provider();
  let clock = instant;
  const service = createPerformanceHistory({ request: () => request, now: () => clock });
  await service.history(config, "Ride");
  clock += 30 * 60_000 + 1;
  await Promise.all([service.history(config, "Ride"), service.history(config, "Ride")]);
  assert.equal(calls.length, 4);
  service.clear();
  await service.history(config, "Ride");
  assert.equal(calls.length, 6);
  const midnight = createPerformanceHistory({
    request: () => request,
    now: () => Date.parse("2026-11-02T04:30:00Z"),
  });
  assert.equal(
    (await midnight.history(config, "Ride", { timeZone: "America/Chicago" })).asOf,
    "2026-11-01"
  );
});

test("provider failures have a bounded cooldown, partial bests preserve activity records, and retry recovers", async () => {
  const { calls, request } = provider();
  let clock = instant,
    fail = true,
    failures = 0;
  const service = createPerformanceHistory({
    now: () => clock,
    request: () => async (path) => {
      if (
        path.includes("pace-curves") &&
        new URL(path, "https://mock.invalid").searchParams.get("type") === "Swim" &&
        fail
      ) {
        failures++;
        throw Error("mock provider unavailable");
      }
      return request(path);
    },
  });
  const result = await service.personal(config);
  assert.equal(result.records.length, 3);
  assert.ok(result.bestEffortsError);
  assert.ok(result.bestEfforts.some((value) => value.sport === "Bike"));
  await service.personal(config);
  assert.equal(failures, 1);
  fail = false;
  clock += 60_000 + 1;
  const recovered = await service.personal(config);
  assert.equal(recovered.bestEffortsError, undefined);
  assert.ok(recovered.bestEfforts.some((value) => value.sport === "Swim"));
  assert.equal(calls.filter((path) => path.includes("/activities?")).length, 6);
});

test("malformed curve arrays fail safely without turning mismatched positions into bests", async () => {
  const service = createPerformanceHistory({
    now: () => instant,
    request: () => async (path) =>
      path.includes("/activities?") ? [] : { list: [{ id: "all", secs: [5, 60], values: [900] }] },
  });
  const value = await service.personal(config);
  assert.deepEqual(value.bestEfforts, []);
  assert.ok(value.bestEffortsError);
});

test("legacy activity records keep achievements, deduplicate pages and omit future entries", async () => {
  const rows = [
    activity("i1", "Ride", {
      icu_achievements: [{ type: "BEST_POWER", secs: 5, watts: 600 }, null],
    }),
    activity("future", "Ride", { start_date_local: "2027-01-01" }),
    { id: "stub" },
  ];
  const value = await fetchPersonalActivityRecords(async () => rows, "2026-10-08");
  assert.equal(value.length, 1);
  assert.equal(value[0].duration_seconds, 3600);
  assert.equal(value[0].achievements[0].watts, 600);
});

test("cache capacity reserves a whole batch, preserves pending readers and recovers by evicting settled entries", async () => {
  const { calls, request } = provider();
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const service = createPerformanceHistory({
    request: () => async (path) => {
      await hold;
      return request(path);
    },
    now: () => instant,
    maxEntries: 30,
  });
  const first = service.history(config, "Ride");
  await assert.rejects(
    service.history({ ...config, SETTINGS_SCOPE: "other-account" }, "Ride"),
    (error) => error.status === 429
  );
  assert.equal(calls.length, 0);
  release();
  const result = await first;
  assert.equal(result.months.length, 12);
  assert.equal(result.weeks[0].peaks[0].value, 600);
  assert.equal(calls.length, 2);
  assert.equal(
    (await service.history({ ...config, SETTINGS_SCOPE: "other-account" }, "Ride")).weeks[0]
      .peaks[0].value,
    600
  );
  assert.equal(calls.length, 4);
});

test("an undersized cache rejects an unreservable curve batch before contacting that endpoint", async () => {
  const { calls, request } = provider();
  const service = createPerformanceHistory({
    request: () => request,
    now: () => instant,
    maxEntries: 2,
  });
  await assert.rejects(service.history(config, "Ride"), (error) => error.status === 429);
  assert.equal(calls.filter((path) => path.includes("power-curves")).length, 0);
});

test("unconfigured Home returns an honest empty state without any provider read", async () => {
  const service = createPerformanceHistory({
    now: () => instant,
    request: () => () => {
      throw Error("unexpected provider call");
    },
  });
  const result = await service.history({}, "Swim");
  assert.equal(result.configured, false);
  assert.deepEqual(result.weeks, []);
  assert.deepEqual(result.months, []);
  assert.deepEqual(
    result.anchors.map((value) => value.distance_meters),
    [100, 200, 400, 1000, 1500].map((yards) => yards * 0.9144)
  );
});

test("native screenshot running distances 800m, 1500m and 3000m are available as measured best efforts", () => {
  const bundle = {
    curve: { distance: [800, 1500, 3000], values: [150, 300, 650] },
    activities: {},
  };
  const results = curveBestEfforts(bundle, "Run");
  assert.deepEqual(
    results.map((value) => value.distance_meters),
    [800, 1500, 3000]
  );
  assert.deepEqual(
    results.map((value) => value.duration_seconds),
    [150, 300, 650]
  );
});

const currentPeriod = { start: "2026-10-05", end: "2026-10-08" };
const currentYear = { start: "2025-11-01", end: "2026-10-08" };
function fallbackProvider({
  rows = [activity("i1")],
  aggregate = {},
  bulk,
  aggregateFailure = false,
} = {}) {
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    const url = new URL(path, "https://mock.invalid");
    if (url.pathname.endsWith("/activities")) return rows;
    const type = url.searchParams.get("type");
    if (/\/activity-(power|pace)-curves$/.test(url.pathname)) {
      const axis = url.searchParams
        .get(type === "Ride" ? "secs" : "distances")
        .split(",")
        .map(Number);
      if (bulk) return bulk({ type, axis, url });
      return {
        [type === "Ride" ? "secs" : "distances"]: axis,
        curves: rows
          .filter((row) => row.type === type)
          .map((row) => ({
            id: row.id,
            start_date_local: row.start_date_local,
            [type === "Ride" ? "watts" : "secs"]: axis.map(() => (type === "Ride" ? 400 : 100)),
            weight: 80,
          })),
      };
    }
    if (aggregateFailure) throw Error("mock aggregate unavailable");
    const anchors = performanceAnchors(type);
    const axis = anchors.map((anchor) =>
      type === "Ride" ? anchor.duration_seconds : anchor.distance_meters
    );
    return {
      list: url.searchParams
        .get("curves")
        .split(",")
        .map((id) => ({
          id,
          [type === "Ride" ? "secs" : "distance"]: axis,
          values: axis.map((value) => aggregate[value] ?? null),
          activity_id: axis.map(() => rows[0]?.id),
        })),
      activities: Object.fromEntries(rows.map((row) => [row.id, row])),
    };
  };
  return { calls, request };
}

test("Home aggregate provenance rejects invalid dates, out-of-period records and explicitly ignored sensors", () => {
  const anchor = performanceAnchors("Ride")[0];
  const bundle = {
    curve: { secs: [5], values: [900], activity_id: ["i1"] },
    activities: { i1: activity("i1") },
  };
  assert.equal(homeCurvePeak(bundle, "Ride", anchor, currentPeriod).source, "intervals-curve");
  for (const extras of [
    { start_date_local: "2026-09-07T06:00:00" },
    { start_date_local: "2026-02-30T06:00:00" },
    { icu_ignore_power: true },
    { type: "Run" },
  ]) {
    bundle.activities.i1 = activity("i1", "Ride", extras);
    assert.equal(homeCurvePeak(bundle, "Ride", anchor, currentPeriod).value, null);
  }
  bundle.activities = {};
  assert.equal(
    homeCurvePeak(
      bundle,
      "Ride",
      anchor,
      currentPeriod,
      new Map([["i1", activity("i1", "Ride", { icu_ignore_power: true })]])
    ).value,
    null
  );
  assert.equal(
    homeCurvePeak(
      bundle,
      "Ride",
      anchor,
      currentPeriod,
      new Map([["i1", activity("i1", "Ride", { start_date_local: "2026-09-07T06:00:00" })]])
    ).value,
    null
  );
  assert.equal(
    homeCurvePeak(bundle, "Ride", anchor, currentPeriod, new Map([["i1", activity("i1")]])).date,
    "2026-10-07"
  );
  assert.equal(homeCurvePeak(bundle, "Ride", anchor, currentPeriod).value, 900);
});

test("recorded power adapter uses exact seconds, retains measured zero and rejects malformed or oversized axes", () => {
  const rows = [activity("i1", "VirtualRide")];
  const normalized = normalizeActivityCurves(
    { secs: [5, 60, 299], curves: [{ id: "i1", watts: [0, null, 500], weight: 75 }] },
    "Ride",
    rows,
    currentYear
  );
  const anchors = performanceAnchors("Ride");
  assert.equal(activityCurvePeak(normalized, "Ride", anchors[0], currentPeriod).value, 0);
  assert.equal(activityCurvePeak(normalized, "Ride", anchors[0], currentPeriod).watts_per_kg, 0);
  assert.equal(activityCurvePeak(normalized, "Ride", anchors[1], currentPeriod).value, null);
  assert.equal(activityCurvePeak(normalized, "Ride", anchors[2], currentPeriod).value, null);
  assert.equal(normalized.incomplete, true);
  for (const payload of [
    { secs: [5, 5], curves: [] },
    { secs: [5.1], curves: [] },
    { secs: [null], curves: [] },
    { secs: [5], curves: null },
    { secs: Array.from({ length: 101 }, (_, i) => i + 1), curves: Array(1000).fill({}) },
  ])
    assert.throws(() => normalizeActivityCurves(payload, "Ride", rows, currentYear));
  const misaligned = normalizeActivityCurves(
    { secs: [5, 60], curves: [{ id: "i1", watts: [800] }] },
    "Ride",
    rows,
    currentYear
  );
  assert.equal(misaligned.records.length, 0);
  assert.equal(misaligned.incomplete, true);
});

test("recorded pace uses actual native metres and elapsed seconds without nearest Run anchors or rescaling nominal yards", () => {
  const run = normalizeActivityCurves(
    { distances: [400, 999, 5000], curves: [{ id: "i1", secs: [80, 150, null] }] },
    "Run",
    [activity("i1", "TrailRun")],
    currentYear
  );
  assert.equal(activityCurvePeak(run, "Run", performanceAnchors("Run")[0], currentPeriod).value, 5);
  assert.equal(
    activityCurvePeak(run, "Run", performanceAnchors("Run")[1], currentPeriod).value,
    null
  );
  assert.equal(run.incomplete, true);
  const swim = normalizeActivityCurves(
    { distances: [91, 183], curves: [{ id: "i2", secs: [70, 160] }] },
    "Swim",
    [activity("i2", "OpenWaterSwim")],
    currentYear
  );
  const peak = activityCurvePeak(swim, "Swim", performanceAnchors("Swim")[0], currentPeriod);
  assert.equal(peak.value, 91 / 70);
  assert.equal(peak.distance_meters, 91);
  assert.equal(peak.elapsed_seconds, 70);
  assert.equal(peak.duration_seconds, null);
  assert.equal(peak.watts_per_kg, undefined);
  assert.equal(peak.source, "calculated-activity-curves");
});

test("recorded candidates require known ID, sport and local date membership and never select ignored or impossible recordings", () => {
  const rows = [
    activity("valid", "Run", { elapsed_time: 300 }),
    activity("wrong-sport", "Ride"),
    activity("future", "Run", { start_date_local: "2026-10-09T01:00:00" }),
    activity("outside", "Run", { start_date_local: "2025-10-31T23:59:59" }),
    activity("mismatch", "Run"),
    activity("ignored", "Run", { ignore_pace: true }),
    activity("impossible", "Run", { elapsed_time: 20 }),
  ];
  const bundle = normalizeActivityCurves(
    {
      distances: [400],
      curves: [
        { id: "valid", secs: [100], start_date_local: "2026-10-07T06:00:00" },
        ...["unknown", "wrong-sport", "future", "outside", "ignored"].map((id) => ({
          id,
          secs: [1],
        })),
        { id: "mismatch", secs: [1], start_date_local: "2026-10-06T06:00:00" },
        { id: "impossible", secs: [100] },
      ],
    },
    "Run",
    rows,
    currentYear
  );
  const best = activityCurvePeak(bundle, "Run", performanceAnchors("Run")[0], currentPeriod);
  assert.equal(best.activity_id, "valid");
  assert.equal(best.date, "2026-10-07");
  assert.equal(best.value, 4);
  assert.equal(bundle.incomplete, true);
  assert.equal(
    activityCurvePeak(bundle, "Run", performanceAnchors("Run")[0], {
      start: "2026-10-08",
      end: "2026-10-08",
    }).value,
    null
  );
});

test("missing or null eligible recordings mark subset maxima incomplete, while ignored and known shorter recordings are excluded", () => {
  for (const missing of [[], [{ id: "i2", watts: [null] }]]) {
    const normalized = normalizeActivityCurves(
      { secs: [60], curves: [{ id: "i1", watts: [200] }, ...missing] },
      "Ride",
      [activity("i1"), activity("i2")],
      currentYear
    );
    assert.equal(normalized.incomplete, true);
    assert.equal(
      activityCurvePeak(normalized, "Ride", performanceAnchors("Ride")[1], currentPeriod).value,
      200
    );
  }
  const excluded = normalizeActivityCurves(
    {
      secs: [60],
      curves: [
        { id: "i1", watts: [200] },
        { id: "ignored", watts: [9000] },
      ],
    },
    "Ride",
    [
      activity("i1"),
      activity("ignored", "Ride", { icu_ignore_power: true }),
      activity("short", "Ride", { elapsed_time: 20 }),
    ],
    currentYear
  );
  assert.equal(excluded.incomplete, false);
  assert.equal(
    activityCurvePeak(excluded, "Ride", performanceAnchors("Ride")[1], currentPeriod).value,
    200
  );
  const duplicates = normalizeActivityCurves(
    {
      secs: [60],
      curves: [
        { id: "i1", watts: [200] },
        { id: "i1", watts: [9000] },
      ],
    },
    "Ride",
    [activity("i1")],
    currentYear
  );
  assert.equal(duplicates.incomplete, true);
  assert.equal(
    activityCurvePeak(duplicates, "Ride", performanceAnchors("Ride")[1], currentPeriod).value,
    200
  );
});

test("concurrent Home readers issue one missing-axis bulk request, preserve aggregate zero and reuse it for week/month and graph data", async () => {
  const { calls, request } = fallbackProvider({
    aggregate: { 5: 0, 300: 250, 1200: 200, 3600: 150 },
  });
  const service = createPerformanceHistory({ request: () => request, now: () => instant });
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => service.history(config, "Ride"))
  );
  assert.equal(calls.length, 3);
  const bulkUrl = new URL(
    calls.find((path) => path.includes("/activity-power-curves")),
    "https://mock.invalid"
  );
  assert.equal(bulkUrl.searchParams.get("secs"), "60");
  assert.equal(bulkUrl.searchParams.get("oldest"), "2024-11-01T00:00:00");
  assert.equal(bulkUrl.searchParams.get("newest"), "2026-10-08T23:59:59");
  const result = responses[0];
  assert.equal(result.weeks[0].peaks[0].value, 0);
  assert.equal(result.weeks[0].peaks[0].source, "intervals-curve");
  assert.equal(result.weeks[0].peaks[1].value, 400);
  assert.equal(result.weeks[0].peaks[1].source, "calculated-activity-curves");
  assert.equal(result.weeks[0].peaks[1].watts_per_kg, 5);
  assert.deepEqual(result.weeks[0].peaks[1], result.months[0].peaks[1]);
  assert.equal(result.peakCoverage, "complete");
  assert.equal(result.peaksError, undefined);
  assert.equal(result.months[1].peaks[1].value, null);
  result.weeks[0].peaks[1].value = -1;
  assert.equal(responses[1].weeks[0].peaks[1].value, 400);
  assert.equal((await service.history(config, "Ride")).weeks[0].peaks[1].value, 400);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((path) => !path.includes("/streams") && !/\/activity\//.test(path)));
  const fields = new URL(calls[0], "https://mock.invalid").searchParams.get("fields");
  assert.match(fields, /icu_ignore_power/);
  assert.match(fields, /ignore_pace/);
});

test("sparse summary lengths still query exact recorded curves, but known shorter recordings require no bulk read", async () => {
  const missing = fallbackProvider({
    rows: [activity("i1", "Ride", { moving_time: null, elapsed_time: null })],
  });
  const service = createPerformanceHistory({ request: () => missing.request, now: () => instant });
  const result = await service.history(config, "Ride");
  assert.equal(result.weeks[0].peaks[0].value, 400);
  assert.equal(result.peakCoverage, "complete");
  const short = fallbackProvider({ rows: [activity("i1", "Ride", { elapsed_time: 3 })] });
  const shortResult = await createPerformanceHistory({
    request: () => short.request,
    now: () => instant,
  }).history(config, "Ride");
  assert.equal(short.calls.length, 2);
  assert.equal(shortResult.weeks[0].peaks[0].value, null);
  const ignored = fallbackProvider({
    rows: [activity("i1", "Ride", { icu_ignore_power: true })],
    aggregate: { 5: 9000 },
  });
  const ignoredResult = await createPerformanceHistory({
    request: () => ignored.request,
    now: () => instant,
  }).history(config, "Ride");
  assert.equal(ignored.calls.length, 2);
  assert.equal(ignoredResult.weeks[0].peaks[0].value, null);
});

test("Home pace bulk requests only native yard anchors with unadjusted pace and source elapsed metadata", async () => {
  const { calls, request } = fallbackProvider({
    rows: [activity("i1", "Swim")],
    bulk: () => ({
      distances: [91, 183, 366, 914, 1372],
      curves: [{ id: "i1", secs: [70, 150, 310, 820, 1300] }],
    }),
  });
  const result = await createPerformanceHistory({
    request: () => request,
    now: () => instant,
  }).history(config, "Swim");
  const query = new URL(
    calls.find((path) => path.includes("/activity-pace-curves")),
    "https://mock.invalid"
  ).searchParams;
  assert.equal(
    query.get("distances"),
    performanceAnchors("Swim")
      .map((anchor) => anchor.distance_meters)
      .join(",")
  );
  assert.equal(query.get("gap"), "false");
  assert.equal(result.weeks[0].peaks[0].distance_meters, 91);
  assert.equal(result.weeks[0].peaks[0].elapsed_seconds, 70);
  assert.equal(result.weeks[0].peaks[0].value, 91 / 70);
  assert.equal(result.peakCoverage, "complete");
});

test("bulk omissions and null candidates report partial coverage even when every available calculated peak is populated", async () => {
  for (const omitted of [[], [{ id: "i2", watts: [null, null, null, null, null] }]]) {
    const { request } = fallbackProvider({
      rows: [activity("i1"), activity("i2")],
      bulk: ({ axis }) => ({
        secs: axis,
        curves: [{ id: "i1", watts: axis.map(() => 200) }, ...omitted],
      }),
    });
    const result = await createPerformanceHistory({
      request: () => request,
      now: () => instant,
    }).history(config, "Ride");
    assert.ok(result.weeks[0].peaks.every((peak) => peak.value === 200));
    assert.equal(result.peakCoverage, "partial");
    assert.match(result.peaksError, /incomplete/);
  }
});

test("truncated or unclassified inventory never claims complete peaks, even when all aggregate anchors exist", async () => {
  for (const rows of [
    Array.from({ length: 10000 }, (_, i) => activity(`i${i + 1}`)),
    [activity("i1"), { id: "stub" }],
  ]) {
    const { calls, request } = fallbackProvider({
      rows,
      aggregate: { 5: 500, 60: 400, 300: 300, 1200: 250, 3600: 200 },
    });
    const result = await createPerformanceHistory({
      request: () => request,
      now: () => instant,
    }).history(config, "Ride");
    assert.equal(calls.length, 2);
    assert.ok(result.weeks[0].peaks.every((peak) => peak.value !== null));
    assert.equal(result.peakCoverage, "partial");
    assert.ok(result.peaksError);
  }
});

test("bulk network and malformed DTO failures cool down for sixty seconds, preserve true aggregate peaks/totals and then recover", async () => {
  for (const failure of ["network", "malformed"]) {
    let clock = instant,
      fail = true;
    const { calls, request } = fallbackProvider({
      aggregate: { 5: 0, 300: 250, 1200: 200, 3600: 150 },
      bulk: ({ axis }) => {
        if (fail && failure === "network") throw Error("mock credential text never exposed");
        if (fail) return { secs: [5, 5], curves: [] };
        return { secs: axis, curves: [{ id: "i1", watts: axis.map(() => 400) }] };
      },
    });
    const service = createPerformanceHistory({ request: () => request, now: () => clock });
    const first = await service.history(config, "Ride");
    assert.equal(first.weeks[0].tss, 60);
    assert.equal(first.weeks[0].peaks[0].value, 0);
    assert.equal(first.weeks[0].peaks[1].value, null);
    assert.equal(first.peakCoverage, "partial");
    assert.ok(first.peaksError);
    assert.doesNotMatch(first.peaksError, /credential/);
    await service.history(config, "Ride");
    assert.equal(calls.length, 3);
    fail = false;
    clock += 60001;
    const recovered = await service.history(config, "Ride");
    assert.equal(calls.length, 4);
    assert.equal(recovered.weeks[0].peaks[1].value, 400);
    assert.equal(recovered.peakCoverage, "complete");
    assert.equal(recovered.peaksError, undefined);
  }
});

test("aggregate outage still returns measured activity totals and one bulk fallback with explicit provenance and warning", async () => {
  const { calls, request } = fallbackProvider({ aggregateFailure: true });
  const result = await createPerformanceHistory({
    request: () => request,
    now: () => instant,
  }).history(config, "Ride");
  assert.equal(calls.length, 3);
  assert.equal(result.weeks[0].tss, 60);
  assert.ok(
    result.weeks[0].peaks.every(
      (peak) => peak.source === "calculated-activity-curves" && peak.value === 400
    )
  );
  assert.equal(result.peakCoverage, "complete");
  assert.match(result.peaksError, /period curves/);
});

test("bulk curves stay isolated by account, selected sport and union axes without another inventory download per sport", async () => {
  const { calls, request } = fallbackProvider({ rows: [activity("i1"), activity("i2", "Run")] });
  const service = createPerformanceHistory({ request: () => request, now: () => instant });
  await Promise.all([service.history(config, "Ride"), service.history(config, "Run")]);
  assert.equal(calls.filter((path) => path.includes("/activities?")).length, 1);
  assert.equal(calls.filter((path) => /\/activity-(power|pace)-curves/.test(path)).length, 2);
  await service.history({ ...config, INTERVALS_ACCESS_TOKEN: "other-mock-token" }, "Ride");
  assert.equal(calls.filter((path) => /\/activity-(power|pace)-curves/.test(path)).length, 3);
});

test("Home preserves exact source indices only when position arrays and integer bounds are valid", () => {
  const bundle = {
    curve: { secs: [5], values: [400], activity_id: ["i1"], start_index: [0], end_index: [5] },
    activities: { i1: activity("i1") },
  };
  const anchor = performanceAnchors("Ride")[0];
  const peak = homeCurvePeak(bundle, "Ride", anchor, currentPeriod);
  assert.equal(peak.start_index, 0);
  assert.equal(peak.end_index, 5);
  assert.equal(peak.start_seconds, undefined);
  for (const bounds of [
    { start_index: [null], end_index: [5] },
    { start_index: [0.5], end_index: [5] },
    { start_index: [-1], end_index: [5] },
    { start_index: [5], end_index: [5] },
    { start_index: [6], end_index: [5] },
    { start_index: [0, 1], end_index: [5] },
  ]) {
    Object.assign(bundle.curve, bounds);
    const unknown = homeCurvePeak(bundle, "Ride", anchor, currentPeriod);
    assert.equal(unknown.value, 400);
    assert.equal(unknown.start_index, undefined);
    assert.equal(unknown.end_index, undefined);
  }
});

test("bulk activity provenance can attribute a missing aggregate ID only to identical real values, never closest peaks or stale indices", async () => {
  for (const measured of [400, 399, 401]) {
    const mock = fallbackProvider({
      aggregate: { 5: 400, 60: 400, 300: 400, 1200: 400, 3600: 400 },
      bulk: ({ axis }) => ({ secs: axis, curves: [{ id: "i1", watts: axis.map(() => measured) }] }),
    });
    const request = async (path) => {
      const result = await mock.request(path);
      if (Array.isArray(result?.list))
        for (const curve of result.list) {
          curve.activity_id = [];
          curve.start_index = curve.secs.map(() => 100);
          curve.end_index = curve.secs.map(() => 105);
        }
      return result;
    };
    const result = await createPerformanceHistory({
      request: () => request,
      now: () => instant,
    }).history(config, "Ride");
    assert.equal(mock.calls.length, 3);
    const peak = result.weeks[0].peaks[0];
    assert.equal(peak.value, 400);
    assert.equal(peak.source, "intervals-curve");
    if (measured === 400) {
      assert.equal(peak.activity_id, "i1");
      assert.equal(peak.date, "2026-10-07");
      assert.equal(peak.start_index, null);
      assert.equal(peak.end_index, null);
    } else {
      assert.equal(peak.activity_id, null);
      assert.match(result.peaksError, /source activity/);
    }
  }
});

test("effort selections reject aliased activity IDs and invalid, mismatched or unbounded anchors before any read", async () => {
  for (const id of ["i0", "i01", "01", "activity:i1", "i1/streams", "1?x=1", null])
    assert.throws(
      () => performanceActivityId(id),
      (error) => error.status === 400
    );
  assert.equal(performanceActivityId("123"), "123");
  assert.deepEqual(performanceEffortSelection("Ride", "60", null), {
    type: "Ride",
    duration_seconds: 60,
    distance_meters: null,
    unit: "watts",
  });
  for (const args of [
    ["Ride", "0", null],
    ["Ride", "5.5", null],
    ["Ride", "5", "400"],
    ["Ride", "999999", null],
    ["Run", "5", "400"],
    ["Run", null, "Infinity"],
    ["Run", null, "0x100"],
    ["Swim", null, "100001"],
  ])
    assert.throws(
      () => performanceEffortSelection(...args),
      (error) => error.status === 400
    );
  let reads = 0;
  const service = createPerformanceHistory({
    request: () => () => {
      reads++;
      throw Error("unexpected request");
    },
  });
  await assert.rejects(
    service.effort(config, "i01", {
      type: "Ride",
      duration_seconds: 5,
      loadBundle: () => {
        reads++;
      },
    }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.effort(config, "i1", {
      type: "Run",
      distance_meters: Infinity,
      loadBundle: () => {
        reads++;
      },
    }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.effort(config, "i1", {
      type: "Ride",
      duration_seconds: 5,
      revision: "v".repeat(257),
      loadBundle: () => {
        reads++;
      },
    }),
    (error) => error.status === 400
  );
  assert.equal(reads, 0);
});

function effortBundle(type = "Ride", extras = {}) {
  return {
    activity: activity("i1", type, {
      moving_time: 5,
      elapsed_time: 14,
      name: "Recorded effort",
      ...extras,
    }),
    streams: [{ type: "time", data: [0, 1, 2, 12, 13, 14] }],
  };
}

test("clicked efforts use exact raw timestamps and the shared chart timeline, with cached singleflight and clone isolation", async () => {
  let requests = 0,
    bundles = 0;
  const service = createPerformanceHistory({
    now: () => instant,
    request: () => async (path) => {
      requests++;
      assert.equal(path, "/activity/i1/power-curve.json");
      return {
        id: "watts",
        secs: [5, 10],
        values: [400, 300],
        start_index: [1, 0],
        end_index: [3, 5],
      };
    },
  });
  const options = {
    ...performanceEffortSelection("Ride", 5, null),
    loadBundle: async () => {
      bundles++;
      return effortBundle();
    },
  };
  const results = await Promise.all(
    Array.from({ length: 10 }, () => service.effort(config, "i1", options))
  );
  assert.equal(requests, 1);
  assert.equal(bundles, 1);
  const result = results[0];
  assert.equal(result.available, true);
  assert.equal(result.value, 400);
  assert.equal(result.activity_id, "i1");
  assert.equal(result.name, "Recorded effort");
  assert.equal(result.start_seconds, 1);
  assert.equal(result.end_seconds, 12);
  assert.equal(result.chart_start_seconds, 1);
  assert.equal(result.chart_end_seconds, 3);
  assert.equal(result.start_index, 1);
  assert.equal(result.end_index, 3);
  results[0].chart_start_seconds = 1000;
  assert.equal(results[1].chart_start_seconds, 1);
  assert.equal((await service.effort(config, "i1", options)).chart_start_seconds, 1);
  await service.effort(config, "i1", { ...options, duration_seconds: 10 });
  assert.equal(requests, 1);
  assert.equal(bundles, 2);
});

test("recorded pace resolution retains native distance and source elapsed, without interpolation or invented segment bounds", async () => {
  const paths = [];
  const service = createPerformanceHistory({
    now: () => instant,
    request: () => async (path) => {
      paths.push(path);
      return { distance: [91], values: [11], start_index: [1], end_index: [3] };
    },
  });
  const result = await service.effort(config, "i1", {
    ...performanceEffortSelection("Swim", null, 91.44),
    loadBundle: async () => effortBundle("Swim"),
  });
  assert.deepEqual(paths, ["/activity/i1/pace-curve.json?gap=false"]);
  assert.equal(result.available, true);
  assert.equal(result.distance_meters, 91);
  assert.equal(result.elapsed_seconds, 11);
  assert.equal(result.duration_seconds, null);
  assert.equal(result.value, 91 / 11);
  assert.equal(result.watts_per_kg, undefined);
  const nearbyRun = await service.effort(config, "i1", {
    ...performanceEffortSelection("Run", null, 91.44),
    loadBundle: async () => effortBundle("Run"),
  });
  assert.equal(nearbyRun.available, false);
  assert.equal(nearbyRun.start_seconds, null);
});

test("missing indices, unknown timestamps, ignored sensors and mismatched recordings return unavailable without guessed highlights", async () => {
  for (const overrides of [
    { curve: { secs: [5], values: [400] } },
    { curve: { secs: [5], values: [400], start_index: [0], end_index: [999] } },
    { bundle: { ...effortBundle(), streams: [{ type: "time", data: [0, null, 2, 12] }] } },
    { bundle: effortBundle("Run") },
    { bundle: effortBundle("Ride", { icu_ignore_power: true }) },
    { bundle: { ...effortBundle(), activity: { ...effortBundle().activity, id: "i2" } } },
  ]) {
    const service = createPerformanceHistory({
      request: () => async () =>
        overrides.curve || { secs: [5], values: [400], start_index: [1], end_index: [3] },
      now: () => instant,
    });
    const result = await service.effort(config, "i1", {
      ...performanceEffortSelection("Ride", 5, null),
      loadBundle: async () => overrides.bundle || effortBundle(),
    });
    assert.equal(result.available, false);
    assert.equal(result.start_seconds, null);
    assert.equal(result.chart_start_seconds, null);
    assert.ok(result.reason);
  }
});

test("effort network and structural failures have a failure cooldown, recover and expose no provider errors", async () => {
  for (const kind of ["network", "shape", "identity"]) {
    let clock = instant,
      requests = 0,
      fail = true;
    const service = createPerformanceHistory({
      now: () => clock,
      request: () => async () => {
        requests++;
        if (fail && kind === "network") throw Error("mock credential secret");
        if (fail && kind === "shape") return { secs: [5, 5], values: [400, 400] };
        return {
          id: fail ? "i2" : "i1",
          secs: [5],
          values: [400],
          start_index: [1],
          end_index: [3],
        };
      },
    });
    const options = {
      ...performanceEffortSelection("Ride", 5, null),
      loadBundle: async () => effortBundle(),
    };
    for (let i = 0; i < 2; i++)
      await assert.rejects(
        service.effort(config, "i1", options),
        (error) => error.status === 503 && !/credential|secret/.test(error.message)
      );
    assert.equal(requests, 1);
    fail = false;
    clock += 60001;
    assert.equal((await service.effort(config, "i1", options)).available, true);
    assert.equal(requests, 2);
  }
});

test("effort cache scopes account and recording revision, and unconfigured requests never load recordings", async () => {
  let requests = 0;
  const service = createPerformanceHistory({
    now: () => instant,
    request: () => async () => {
      requests++;
      return { secs: [5], values: [0], start_index: [0], end_index: [3] };
    },
  });
  const options = {
    ...performanceEffortSelection("Ride", 5, null),
    loadBundle: async () => effortBundle(),
  };
  assert.equal((await service.effort(config, "i1", options)).value, 0);
  await service.effort(config, "i1", { ...options, revision: "new-recording" });
  await service.effort({ ...config, INTERVALS_ACCESS_TOKEN: "other-mock-token" }, "i1", options);
  assert.equal(requests, 3);
  const none = await service.effort({}, "i1", {
    ...options,
    loadBundle: () => {
      throw Error("unexpected recording load");
    },
  });
  assert.equal(none.available, false);
  assert.equal(requests, 3);
});

test("missing effort positions have a short retry cooldown rather than poisoning an unfinished provider curve", async () => {
  let clock = instant,
    requests = 0,
    processing = true;
  const service = createPerformanceHistory({
    now: () => clock,
    request: () => async () => {
      requests++;
      return {
        secs: [5],
        values: [400],
        ...(processing ? {} : { start_index: [1], end_index: [3] }),
      };
    },
  });
  const options = {
    ...performanceEffortSelection("Ride", 5, null),
    loadBundle: async () => effortBundle(),
  };
  assert.equal((await service.effort(config, "i1", options)).available, false);
  processing = false;
  assert.equal((await service.effort(config, "i1", options)).available, false);
  assert.equal(requests, 1);
  clock += 60001;
  assert.equal((await service.effort(config, "i1", options)).available, true);
  assert.equal(requests, 2);
});
