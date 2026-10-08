import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fitnessGraphSeries,
  fitnessGraphDomain,
  formatFitnessGraphValue,
  formatFitnessGraphDate,
} from "../src/lib/fitness-history-graph.ts";

const power = { duration_seconds: 300, distance_meters: null, unit: "watts" };
const pace = { duration_seconds: null, distance_meters: 5000, unit: "m/s" };
const row = (start, anchor, value) => ({
  start,
  end: start,
  peaks: [{ ...anchor, value, source: "calculated-activity-curves", activity_id: "i-real" }],
});
test("graph sorts actual calendar periods without inventing points or connecting missing data", () => {
  const points = fitnessGraphSeries(
    [row("2026-10-01", power, 220), row("2026-08-01", power, 0), row("2026-09-01", power, null)],
    power,
    "Ride"
  );
  assert.deepEqual(
    points.map((point) => point.value),
    [0, null, 220]
  );
  assert.equal(points[0].source, "calculated-activity-curves");
  assert.equal(points[0].activity_id, "i-real");
  assert.equal((points[1].time - points[0].time) / 86400000, 31);
  assert.equal((points[2].time - points[1].time) / 86400000, 30);
});
test("pace graphs convert recorded metres-per-second to seconds-per-mile or 100yards", () => {
  const run = fitnessGraphSeries([row("2026-10-01", pace, 4)], pace, "Run");
  assert.equal(run[0].value, 1609.344 / 4);
  assert.equal(formatFitnessGraphValue(run[0].value, "Run"), "6:42");
  const swim = { ...pace, distance_meters: 365.76 };
  const points = fitnessGraphSeries([row("2026-10-01", swim, 1)], swim, "Swim");
  assert.equal(points[0].value, 91.44);
  assert.equal(formatFitnessGraphValue(points[0].value, "Swim"), "1:31");
});
test("missing anchors, invalid speeds and invalid dates cannot produce fabricated chart measurements", () => {
  const points = fitnessGraphSeries(
    [
      row("2026-10-01", pace, 0),
      row("2026-09-01", pace, Number.MIN_VALUE),
      row("2026-08-01", power, 200),
      row("2026-02-31", pace, 5),
    ],
    pace,
    "Run"
  );
  assert.equal(points.length, 3);
  assert.ok(points.every((point) => point.value === null));
});
test("empty, zero-only, single and extreme-value domains stay finite and usable", () => {
  assert.deepEqual(fitnessGraphDomain([], "Ride"), [0, 1]);
  assert.deepEqual(fitnessGraphDomain([{ value: 0 }], "Ride"), [0, 1]);
  for (const values of [[220], [200, 220], [Number.MAX_VALUE]]) {
    const domain = fitnessGraphDomain(
      values.map((value) => ({ value })),
      "Ride"
    );
    assert.ok(domain.every(Number.isFinite));
    assert.ok(domain[0] < domain[1]);
    assert.ok(domain[0] <= Math.min(...values) && domain[1] >= Math.max(...values));
  }
  assert.equal(formatFitnessGraphValue(0, "Ride"), "0");
  assert.equal(formatFitnessGraphValue(null, "Run"), "—");
  assert.equal(formatFitnessGraphValue(Infinity, "Swim"), "—");
  assert.equal(formatFitnessGraphValue(Number.MAX_VALUE, "Run"), "—");
});
test("graph dates use calendar labels consistently across year changes", () => {
  assert.equal(formatFitnessGraphDate(Date.parse("2025-12-01T12:00:00Z"), "months"), "Dec 25");
  assert.equal(formatFitnessGraphDate(Date.parse("2026-01-05T12:00:00Z"), "weeks"), "Jan 5");
  assert.equal(formatFitnessGraphDate(NaN, "weeks"), "—");
});
