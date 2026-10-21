import test from "node:test";
import assert from "node:assert/strict";
import { projectPaceCurve, PACE_CURVE_ERROR } from "./pace-curve-projection.mjs";
import { createPerformanceHistory, curveBestEfforts } from "./performance-curves.mjs";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";

const window = { oldest: "2026-10-01", newest: "2026-10-20" };
const distances = [
  91.44, 400, 800, 1000, 1600, 1609, 1609.344, 5000, 8046.72, 10000, 15000, 16093.44, 21097.5,
  30000,
];
const bundle = (sport = "Run") => ({
  curve: {
    id: "r.2026-10-01.2026-10-20",
    type: "PACE",
    distance: [...distances],
    values: distances.map((_, i) => 100 + i * 100),
    activity_id: distances.map(() => "i42"),
  },
  activities: {
    i42: {
      id: "i42",
      type: sport,
      start_date_local: "2026-10-19T07:00:00",
      name: "Synthetic exact recording",
      elapsed_time: 10000,
      distance: 42000,
      private_key: "not-public",
    },
  },
});

test("full pace DTO retains every native distance and exact elapsed/value pair, separating metric and nominal distances without interpolation", () => {
  for (const sport of ["Run", "Swim"]) {
    const input = bundle(sport),
      before = structuredClone(input),
      result = projectPaceCurve(input, sport, window);
    assert.deepEqual(result.window, window);
    assert.equal(result.sport, sport);
    assert.equal(result.source, "intervals-pace-curve");
    assert.equal(result.unit, "m/s");
    assert.equal(result.warning, null);
    assert.deepEqual(
      result.points.map((p) => p.distance_meters),
      distances
    );
    for (let i = 0; i < distances.length; i++) {
      const point = result.points[i];
      assert.equal(point.elapsed_seconds, input.curve.values[i]);
      assert.equal(point.value, distances[i] / input.curve.values[i]);
      assert.equal(point.activity_id, "i42");
      assert.equal(point.date, "2026-10-19");
      assert.equal(point.estimated, false);
    }
    assert.equal(
      result.points.find((p) => p.distance_meters === 1500),
      undefined
    );
    assert.notEqual(result.points[5].distance_meters, result.points[6].distance_meters);
    assert.doesNotMatch(JSON.stringify(result), /private_key|not-public/);
    result.points[0].value = 999;
    result.window.oldest = "2026-09-01";
    assert.deepEqual(input, before);
  }
});

test("zero, missing, nonfinite and negative elapsed values remain unknown instead of inventing zero or infinite pace", () => {
  const source = bundle();
  source.curve.values.splice(0, 5, 0, null, NaN, -1, Infinity);
  const result = projectPaceCurve(source, "Run", window);
  assert.deepEqual(
    result.points.slice(0, 5).map((p) => [p.value, p.elapsed_seconds]),
    Array.from({ length: 5 }, () => [null, null])
  );
  assert.ok(result.warning);
  assert.notEqual(result.points[5].value, null);
});

test("pace samples reject ignored, mismatched, out-of-window, malformed or known too-short recordings without using another sport or stale attribution", () => {
  for (const change of [
    (x) => (x.activities.i42.ignore_pace = true),
    (x) => (x.activities.i42.type = "Ride"),
    (x) => (x.activities.i42.id = "i99"),
    (x) => (x.activities.i42.start_date_local = "2026-09-30T07:00:00"),
    (x) => (x.activities.i42.start_date_local = "2026-10-21T07:00:00"),
    (x) => (x.activities.i42.start_date_local = "2026-02-30T07:00:00"),
    (x) => (x.activities.i42.elapsed_time = 1),
    (x) => {
      delete x.activities.i42.elapsed_time;
      x.activities.i42.moving_time = 1;
    },
    (x) => (x.activities.i42.distance = 1),
    (x) => delete x.activities.i42,
    (x) => x.curve.activity_id.fill("https://untrusted.invalid/"),
  ]) {
    const source = bundle();
    change(source);
    const result = projectPaceCurve(source, "Run", window);
    assert.ok(result.points.every((p) => p.value === null && p.elapsed_seconds === null));
    assert.ok(result.warning);
  }
  const source = bundle();
  delete source.activities.i42.type;
  delete source.activities.i42.distance;
  delete source.activities.i42.elapsed_time;
  assert.ok(
    projectPaceCurve(source, "Run", window).points.every((p) => p.value !== null),
    "compact metadata permits unknown recording length; no fabricated eligibility bound"
  );
  source.activities.i42.elapsed_time = 20000;
  source.activities.i42.moving_time = 1;
  assert.ok(
    projectPaceCurve(source, "Run", window).points.every((p) => p.value !== null),
    "elapsed source wins shorter moving duration for elapsed pace"
  );
});

test("full pace axis, period identity, native kind and optional arrays are bounded and strictly validated", () => {
  for (const change of [
    (x) => x.curve.distance.reverse(),
    (x) => (x.curve.distance[1] = 91.44),
    (x) => (x.curve.distance[0] = 0),
    (x) => (x.curve.distance[0] = Infinity),
    (x) => x.curve.values.pop(),
    (x) => x.curve.activity_id.pop(),
    (x) => (x.curve.start_index = [0]),
    (x) => (x.curve.end_index = {}),
    (x) => (x.activities = []),
    (x) => (x.curve.type = "GAP"),
    (x) => (x.curve.id = "r.2026-09-01.2026-09-30"),
    (x) => (x.curve.start_date_local = "2026-09-01"),
    (x) => (x.curve.end_date_local = "2026-10-21"),
    (x) => {
      x.curve.distance = Array.from({ length: 10001 }, (_, i) => i + 1);
      x.curve.values = Array(10001).fill(1);
    },
  ]) {
    const source = bundle();
    change(source);
    assert.throws(() => projectPaceCurve(source, "Run", window), /verified/);
  }
  for (const invalid of [
    { oldest: "2026-10-21", newest: window.newest },
    { oldest: "2026-02-30", newest: window.newest },
    { oldest: window.oldest, newest: "2026-02-30" },
  ])
    assert.throws(() => projectPaceCurve(bundle(), "Run", invalid));
  assert.throws(() => projectPaceCurve(bundle(), "Ride", window));
  assert.deepEqual(projectPaceCurve({ curve: null, activities: {} }, "Swim", window).points, []);
  const all = bundle();
  all.curve.id = "all";
  assert.equal(
    projectPaceCurve(all, "Run", { oldest: null, newest: window.newest }).points.length,
    distances.length
  );
});

test("native recording indices require aligned valid pairs and never fill unknown samples", () => {
  const source = bundle();
  source.curve.start_index = distances.map(() => 0);
  source.curve.end_index = distances.map((_, i) => 100 + i * 100);
  source.curve.start_index[1] = -1;
  source.curve.end_index[2] = 0;
  source.curve.start_index[3] = 0.5;
  source.curve.values[4] = 0;
  const result = projectPaceCurve(source, "Run", window);
  assert.deepEqual([result.points[0].start_index, result.points[0].end_index], [0, 100]);
  for (const p of result.points.slice(1, 5)) {
    assert.equal(p.start_index, undefined);
    assert.equal(p.end_index, undefined);
  }
  assert.ok(result.warning);
  delete source.curve.end_index;
  assert.ok(
    projectPaceCurve(source, "Run", window).points.every((p) => p.start_index === undefined)
  );
});

function provider() {
  const calls = [],
    state = { badRun: false, failSwim: false };
  const request = async (path) => {
    calls.push(path);
    const url = new URL(path, "https://synthetic.invalid");
    if (url.pathname.endsWith("/activities")) return [];
    const type = url.searchParams.get("type");
    if (type === "Swim" && state.failSwim) throw Error("private-raw-upstream-message");
    const source = bundle(type);
    return {
      activities: source.activities,
      list: url.searchParams
        .get("curves")
        .split(",")
        .map((id) =>
          type === "Ride"
            ? { id, secs: [], values: [] }
            : {
                ...source.curve,
                id,
                ...(type === "Run" && state.badRun ? { distance: [...distances].reverse() } : {}),
              }
        ),
    };
  };
  return { calls, state, request };
}

test("personal statistics additive pace DTOs preserve legacy efforts and existing query/cache/account/window contracts", async () => {
  const p = provider(),
    service = createPerformanceHistory({
      request: () => p.request,
      now: () => Date.parse("2026-10-20T12:00:00Z"),
    }),
    config = { INTERVALS_API_KEY: "synthetic", SETTINGS_SCOPE: "first" };
  const first = await service.personal(config, window);
  assert.deepEqual(first.bestEfforts, [
    ...curveBestEfforts(bundle("Run"), "Run"),
    ...curveBestEfforts(bundle("Swim"), "Swim"),
  ]);
  assert.deepEqual(
    first.paceCurves.Run.points.map((p) => p.distance_meters),
    distances
  );
  assert.equal(first.paceCurves.Swim.sport, "Swim");
  assert.equal(first.paceCurveErrors, undefined);
  assert.equal(
    p.calls.length,
    9,
    "six existing activity inventory reads, three existing native curve reads"
  );
  assert.equal(p.calls.filter((p) => p.includes("/pace-curves?")).length, 2);
  first.paceCurves.Run.points[0].value = 999;
  first.paceCurves.Run.window.oldest = "2026-09-01";
  const again = await service.personal(config, window);
  assert.equal(again.paceCurves.Run.points[0].value, 91.44 / 100);
  assert.deepEqual(again.paceCurves.Run.window, window);
  assert.equal(p.calls.length, 9);
  await service.personal({ ...config, SETTINGS_SCOPE: "second" }, window);
  assert.equal(p.calls.filter((p) => p.includes("/pace-curves?")).length, 4);
  const next = await service.personal(config, { oldest: "2026-10-02", newest: window.newest });
  assert.deepEqual(next.paceCurves.Run.window, { oldest: "2026-10-02", newest: window.newest });
  assert.equal(p.calls.filter((p) => p.includes("/pace-curves?")).length, 6);
});

test("pace projection and provider failures are independently additive, safe and do not erase healthy sport data or legacy compatibility", async () => {
  const p = provider();
  p.state.badRun = true;
  const make = () =>
    createPerformanceHistory({
      request: () => p.request,
      now: () => Date.parse("2026-10-20T12:00:00Z"),
    });
  const partial = await make().personal({ INTERVALS_API_KEY: "synthetic" }, window);
  assert.equal(partial.paceCurves.Run, null);
  assert.equal(partial.paceCurves.Swim.points.length, distances.length);
  assert.deepEqual(partial.paceCurveErrors, { Run: PACE_CURVE_ERROR });
  p.state.failSwim = true;
  const result = await make().personal({ INTERVALS_API_KEY: "synthetic" }, window);
  assert.equal(result.paceCurves.Run, null);
  assert.equal(result.paceCurves.Swim, null);
  assert.deepEqual(result.paceCurveErrors, { Run: PACE_CURVE_ERROR, Swim: PACE_CURVE_ERROR });
  assert.ok(
    result.bestEfforts.some((p) => p.sport === "Run"),
    "legacy behavior preserved even if full projection rejects unsorted axis"
  );
  assert.ok(result.bestEffortsError);
  assert.ok(result.powerCurve);
  assert.doesNotMatch(JSON.stringify(result), /private-raw-upstream-message/);
});

test("synthetic pace DTO preserves exact non-grid and nominal distances, masks zero elapsed and binds known samples to eligible existing records", () => {
  const fixture = createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z"));
  const result = fixture.personalStatistics("2026-09-23", "2026-10-20");
  assert.deepEqual(result.paceCurves.Run.window, { oldest: "2026-09-23", newest: "2026-10-20" });
  const run = result.paceCurves.Run.points,
    swim = result.paceCurves.Swim.points;
  assert.equal(run.find((p) => p.distance_meters === 1234).value, null);
  assert.equal(run.find((p) => p.distance_meters === 1234).elapsed_seconds, null);
  assert.ok(run.some((p) => p.distance_meters === 1600));
  assert.ok(run.some((p) => p.distance_meters === 1609.344));
  assert.ok(swim.some((p) => p.distance_meters === 91.44));
  assert.ok(swim.some((p) => p.distance_meters === 100));
  assert.ok(swim.some((p) => p.distance_meters === 914.4));
  assert.ok(run.some((p) => p.value !== null));
  assert.ok(swim.some((p) => p.value !== null));
  for (const sport of ["Run", "Swim"]) {
    const curve = result.paceCurves[sport];
    assert.ok(
      curve.points.every(
        (p, i) => i === 0 || p.distance_meters > curve.points[i - 1].distance_meters
      )
    );
    for (const point of curve.points.filter((p) => p.value !== null)) {
      const record = result.records.find((row) => row.id === point.activity_id);
      assert.equal(record.sport, sport);
      assert.equal(record.date, point.date);
      assert.ok(record.date >= "2026-09-23" && record.date <= "2026-10-20");
      assert.ok(record.distance_meters >= point.distance_meters);
      assert.ok(record.duration_seconds >= point.elapsed_seconds);
      assert.equal(point.value, point.distance_meters / point.elapsed_seconds);
      if (point.start_index !== undefined) {
        const analysis = fixture.analysis(point.activity_id),
          segment = analysis.points.slice(point.start_index, point.end_index + 1);
        assert.equal(segment.at(-1).time - segment[0].time, point.elapsed_seconds);
        assert.equal(segment.at(-1).distance - segment[0].distance, point.distance_meters);
      } else assert.equal(point.end_index, undefined);
    }
  }
  const onlyToday = fixture.personalStatistics("2026-10-20", "2026-10-20");
  assert.ok(onlyToday.paceCurves.Run.points.every((point) => point.value === null));
  assert.ok(
    onlyToday.paceCurves.Swim.points.every(
      (point) => point.value === null || point.date === "2026-10-20"
    )
  );
});

test("isolated native pace sources pass real eligibility projection and exact raw stream bounds without modifying existing recordings", () => {
  const fixture = createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z")),
    snapshot = fixture.paceSourceSnapshot(),
    dto = fixture.personalStatistics("2026-09-23", "2026-10-20");
  for (const [sport, id, distance, seconds] of [
    ["Run", "i700000001", 800, 200],
    ["Run", "i700000001", 1000, 250],
    ["Run", "i700000001", 1600, 400],
    ["Swim", "i700000002", 100, 100],
    ["Swim", "i700000002", 200, 200],
  ]) {
    const source = snapshot.sources.find((source) => source.activity.id === id),
      point = dto.paceCurves[sport].points.find((point) => point.distance_meters === distance),
      rawTime = source.streams.find((stream) => stream.type === "time").data,
      rawDistance = source.streams.find((stream) => stream.type === "distance").data;
    assert.equal(point.activity_id, id);
    assert.equal(point.elapsed_seconds, seconds);
    assert.equal(point.start_index, 0);
    assert.equal(point.end_index, seconds);
    assert.equal(rawTime[point.end_index] - rawTime[point.start_index], seconds);
    assert.equal(rawDistance[point.end_index] - rawDistance[point.start_index], distance);
    const analysis = fixture.analysis(id);
    assert.equal(analysis.points[point.end_index].time, seconds);
    assert.equal(analysis.points[point.end_index].distance, distance);
    const effort = fixture.performanceEffort(id, sport, null, distance);
    assert.equal(effort.available, true);
    assert.equal(effort.value, distance / seconds);
    assert.equal(effort.start_seconds, 0);
    assert.equal(effort.end_seconds, seconds);
    assert.equal(effort.chart_start_seconds, 0);
    assert.equal(effort.chart_end_seconds, seconds);
    assert.equal(fixture.lookup(id).activity_id, id);
  }
  for (const id of ["i700000011", "i700000012", "i700000021", "i700000022"]) {
    const source = snapshot.sources.find((source) => source.activity.id === id),
      point = dto.paceCurves[source.activity.type].points.find(
        (point) => point.distance_meters === source.curve.distance[0]
      );
    assert.ok(
      source.curve.values[0] > 0,
      "attempted native value is positive, not a literal null fixture"
    );
    assert.ok(
      source.activity.ignore_pace ||
        source.activity.elapsed_time < source.curve.values[0] ||
        source.activity.distance < source.curve.distance[0]
    );
    assert.equal(point.value, null);
    assert.equal(point.elapsed_seconds, null);
    assert.equal(point.start_index, undefined);
    assert.equal(
      fixture.performanceEffort(id, source.activity.type, null, source.curve.distance[0]).available,
      false
    );
  }
  const original = dto.records.find((row) => row.sport === "Run" && !row.id.startsWith("i7000000"));
  assert.ok(original);
  assert.notEqual(
    fixture.analysis(original.id).points.length,
    401,
    "existing recording sampling remains unchanged"
  );
});
