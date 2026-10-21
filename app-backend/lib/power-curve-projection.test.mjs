import test from "node:test";
import assert from "node:assert/strict";
import { projectPowerCurve, POWER_CURVE_ERROR } from "./power-curve-projection.mjs";
import { createPerformanceHistory, POWER_DURATIONS } from "./performance-curves.mjs";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";

const axis = [5, 10, 12, 20, 30, 60, 120, 300, 360, 600, 720, 1200, 1800, 3600, 5400];
const window = { oldest: "2026-10-01", newest: "2026-10-20" };
const bundle = () => ({
  curve: {
    id: "r.2026-10-01.2026-10-20",
    secs: [...axis],
    values: axis.map((_, index) => 500 - index * 7),
    activity_id: axis.map(() => "i42"),
  },
  activities: {
    i42: {
      id: "i42",
      type: "VirtualRide",
      start_date_local: "2026-10-19T06:00:00",
      elapsed_time: 7200,
      name: "Synthetic source recording",
      weight: 75,
      private_key: "not-public",
    },
  },
});
test("full power DTO preserves all fifteen exact duration/value pairs and source provenance without resampling or inferred W/kg", () => {
  const input = bundle(),
    before = structuredClone(input),
    result = projectPowerCurve(input, window);
  assert.equal(result.version, 1);
  assert.equal(result.source, "intervals-power-curve");
  assert.deepEqual(result.window, window);
  assert.equal(result.warning, null);
  assert.deepEqual(
    result.points.map((point) => point.duration_seconds),
    axis
  );
  assert.deepEqual(
    result.points.map((point) => point.value),
    input.curve.values
  );
  assert.ok(
    result.points.every(
      (point) =>
        point.activity_id === "i42" && point.date === "2026-10-19" && point.estimated === false
    )
  );
  assert.equal(
    result.points.find((point) => point.duration_seconds === 15),
    undefined
  );
  assert.equal(result.points[0].watts_per_kg, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private_key|not-public|"weight"/);
  result.points[0].value = 999;
  result.window.oldest = "2026-09-01";
  assert.deepEqual(input, before);
});
test("missing or invalid samples remain null while measured zero survives; unverified, excluded or impossible sources cannot become measured values", () => {
  const input = bundle();
  input.curve.values[0] = 0;
  input.curve.values[1] = null;
  input.curve.values[2] = -1;
  input.curve.values[3] = NaN;
  const result = projectPowerCurve(input, window);
  assert.deepEqual(
    result.points.slice(0, 4).map((point) => point.value),
    [0, null, null, null]
  );
  assert.ok(result.warning);
  for (const alter of [
    (source) => (source.activities.i42.icu_ignore_power = true),
    (source) => (source.activities.i42.type = "Run"),
    (source) => (source.activities.i42.id = "i99"),
    (source) => (source.activities.i42.start_date_local = "2026-09-30T08:00:00"),
    (source) => (source.activities.i42.start_date_local = "2026-10-21T08:00:00"),
    (source) => (source.activities.i42.start_date_local = "2026-02-30T08:00:00"),
    (source) => (source.activities.i42.elapsed_time = 1),
    (source) => delete source.activities.i42,
    (source) => source.curve.activity_id.fill("https://other.invalid/"),
  ]) {
    const source = bundle();
    alter(source);
    const projected = projectPowerCurve(source, window);
    assert.ok(projected.points.every((point) => point.value === null));
    assert.ok(projected.warning);
  }
});
test("malformed, unsorted, duplicate, unaligned, oversized or wrong-window full curves reject without inventing anchors", () => {
  for (const alter of [
    (value) => value.curve.secs.reverse(),
    (value) => (value.curve.secs[1] = 5),
    (value) => (value.curve.secs[0] = 0),
    (value) => (value.curve.secs[0] = 5.5),
    (value) => value.curve.values.pop(),
    (value) => value.curve.activity_id.pop(),
    (value) => (value.curve.watts_per_kg = [1]),
    (value) => (value.curve.start_index = [0]),
    (value) => (value.curve.end_index = {}),
    (value) => (value.activities = []),
    (value) => (value.curve.id = "r.2026-09-01.2026-09-30"),
    (value) => (value.curve.start_date_local = "2026-09-01"),
    (value) => (value.curve.end_date_local = "2026-10-21"),
    (value) => {
      value.curve.secs = Array.from({ length: 10001 }, (_, i) => i + 1);
      value.curve.values = Array(10001).fill(200);
    },
  ]) {
    const source = bundle();
    alter(source);
    assert.throws(() => projectPowerCurve(source, window), /verified/);
  }
  assert.throws(() => projectPowerCurve(bundle(), { oldest: "2026-10-21", newest: "2026-10-20" }));
  assert.deepEqual(projectPowerCurve({ curve: null, activities: {} }, window).points, []);
});
test("exact optional recording indices and native W/kg survive only when individually valid, and compact metadata may omit type", () => {
  const source = bundle();
  delete source.activities.i42.type;
  source.curve.start_index = axis.map(() => 0);
  source.curve.end_index = [...axis];
  source.curve.watts_per_kg = axis.map(() => 5.5);
  source.curve.wkg_activity_id = axis.map(() => "i42");
  source.curve.start_index[1] = -1;
  source.curve.watts_per_kg[2] = -1;
  source.curve.wkg_activity_id[3] = "i99";
  const result = projectPowerCurve(source, window);
  assert.equal(result.points[0].value, 500);
  assert.equal(result.points[0].watts_per_kg, 5.5);
  assert.equal(result.points[0].start_index, 0);
  assert.equal(result.points[0].end_index, 5);
  assert.equal(result.points[1].start_index, undefined);
  assert.equal(result.points[2].watts_per_kg, undefined);
  assert.equal(result.points[3].watts_per_kg, undefined);
  assert.ok(result.warning);
});

function provider() {
  const calls = [],
    state = { malformed: false, failRide: false };
  const request = async (path) => {
    calls.push(path);
    const url = new URL(path, "https://synthetic.invalid");
    if (url.pathname.endsWith("/activities")) return [];
    const ride = url.searchParams.get("type") === "Ride";
    if (ride && state.failRide) throw Error("private raw upstream failure");
    const list = url.searchParams
      .get("curves")
      .split(",")
      .map((id) =>
        ride
          ? { ...bundle().curve, id, ...(state.malformed ? { secs: [...axis].reverse() } : {}) }
          : { id, distance: [], values: [] }
      );
    return { list, activities: bundle().activities };
  };
  return { request, calls, state };
}
test("personal statistics adds exact full curve with no extra native request and preserves original eight anchors, window and scoped cache isolation", async () => {
  const p = provider(),
    service = createPerformanceHistory({
      request: () => p.request,
      now: () => Date.parse("2026-10-20T12:00:00Z"),
    }),
    config = { INTERVALS_API_KEY: "synthetic-only", SETTINGS_SCOPE: "first" };
  const first = await service.personal(config, {
    ...window,
    oldest: window.oldest,
    newest: window.newest,
  });
  assert.deepEqual(
    first.bestEfforts
      .filter((point) => point.sport === "Bike")
      .map((point) => point.duration_seconds),
    POWER_DURATIONS
  );
  assert.equal(first.powerCurve.points.length, 15);
  assert.deepEqual(first.powerCurve.window, window);
  assert.equal(first.powerCurve.points.find((point) => point.duration_seconds === 12).value, 486);
  assert.equal(p.calls.filter((path) => path.includes("/power-curves?")).length, 1);
  assert.equal(p.calls.length, 9, "six existing inventory reads and three existing curve reads");
  assert.equal(Object.hasOwn(first, "powerCurveError"), false);
  first.powerCurve.points[0].value = 999;
  first.powerCurve.window.oldest = "2026-09-01";
  const again = await service.personal(config, { oldest: window.oldest, newest: window.newest });
  assert.equal(again.powerCurve.points[0].value, 500);
  assert.deepEqual(again.powerCurve.window, window);
  assert.equal(p.calls.filter((path) => path.includes("/power-curves?")).length, 1);
  await service.personal(
    { ...config, SETTINGS_SCOPE: "second" },
    { oldest: window.oldest, newest: window.newest }
  );
  assert.equal(p.calls.filter((path) => path.includes("/power-curves?")).length, 2);
  const other = await service.personal(config, { oldest: "2026-10-02", newest: window.newest });
  assert.deepEqual(other.powerCurve.window, { oldest: "2026-10-02", newest: window.newest });
  assert.equal(p.calls.filter((path) => path.includes("/power-curves?")).length, 3);
});
test("full-curve projection or source failure is additive and generic, retaining legacy best efforts whenever their original contract succeeds", async () => {
  const p = provider();
  p.state.malformed = true;
  const make = () =>
    createPerformanceHistory({
      request: () => p.request,
      now: () => Date.parse("2026-10-20T12:00:00Z"),
    });
  const config = { INTERVALS_API_KEY: "synthetic-only" },
    result = await make().personal(config, { oldest: window.oldest, newest: window.newest });
  assert.equal(result.powerCurve, null);
  assert.equal(result.powerCurveError, POWER_CURVE_ERROR);
  assert.equal(result.bestEfforts.filter((point) => point.sport === "Bike").length, 8);
  p.state.failRide = true;
  const failed = await make().personal(config, { oldest: window.oldest, newest: window.newest });
  assert.equal(failed.powerCurve, null);
  assert.equal(failed.powerCurveError, POWER_CURVE_ERROR);
  assert.ok(failed.bestEffortsError);
  assert.doesNotMatch(JSON.stringify(failed), /private raw upstream/);
});

test("synthetic preview exposes fifteen explicitly supplied duration samples while retaining legacy eight and binding each known value to an eligible recording", () => {
  const fixture = createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z")),
    range = { oldest: "2026-09-23", newest: "2026-10-20" },
    result = fixture.personalStatistics(range.oldest, range.newest);
  assert.deepEqual(
    result.powerCurve.points.map((point) => point.duration_seconds),
    axis
  );
  assert.deepEqual(result.powerCurve.window, range);
  assert.equal(result.bestEfforts.filter((point) => point.sport === "Bike").length, 8);
  const point = result.powerCurve.points.find((point) => point.duration_seconds === 12);
  assert.equal(point.value, 370);
  assert.equal(result.powerCurve.points.find((point) => point.duration_seconds === 20).value, 340);
  for (const sample of result.powerCurve.points.filter((point) => point.value !== null)) {
    const recording = result.records.find((row) => row.id === sample.activity_id);
    assert.equal(recording.sport, "Bike");
    assert.ok(recording.duration_seconds >= sample.duration_seconds);
    assert.equal(recording.date, sample.date);
    assert.ok(sample.date >= range.oldest && sample.date <= range.newest);
  }
  const empty = fixture.personalStatistics("2026-10-20", "2026-10-20");
  assert.ok(empty.powerCurve.points.every((point) => point.value === null));
  assert.ok(empty.powerCurve.warning);
});
