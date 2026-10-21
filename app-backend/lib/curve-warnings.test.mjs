import test from "node:test";
import assert from "node:assert/strict";
import { heartRateCurveWarning } from "./heart-rate-curve.mjs";
import { cadenceCurveWarning } from "./cadence-curve.mjs";
import { velocityCurveWarning } from "./velocity-curve.mjs";
import { taggedCurveWarning } from "./tagged-activity-curves.mjs";
import { nativePowerCurveWarning } from "./native-power-curve.mjs";
import { createDesktopNativePowerFixtures } from "../../tools/desktop-native-power-fixtures.mjs";
import { createDesktopChartTagsFixtures } from "../../tools/desktop-chart-tags-fixtures.mjs";

const cadence =
  "Cadence is shown as recorded RPM; running values are not doubled into steps per minute.";
const velocity =
  "Speed uses the provider’s reported precision; rounded speed values can make pace less precise.";
const remedy = "Try a smaller date range or refresh later.";
test("complete curve warnings contain only actionable cadence/velocity units and no tag or numerical QA claims", () => {
  assert.equal(cadenceCurveWarning(false), cadence);
  assert.equal(velocityCurveWarning(false), velocity);
  assert.equal(nativePowerCurveWarning(false), "");
  assert.equal(heartRateCurveWarning(false), "");
  assert.equal(taggedCurveWarning("heartRate", false), "");
  assert.equal(taggedCurveWarning("power", false), "");
  assert.equal(taggedCurveWarning("cadence", false), cadence);
  assert.equal(taggedCurveWarning("velocity", false), velocity);
  for (const text of [
    cadence,
    velocity,
    taggedCurveWarning("heartRate", true, { unknownPoints: 1 }),
  ])
    assert.doesNotMatch(text, /TrainingPeaks|probe|unverified|unsupported|velocity_smooth/i);
});
test("partial warnings show the actual nonzero failed/missing/cap/sample counts and use singular/plural correctly", () => {
  const suffix =
    "Partial coverage: 2 recordings omitted by the 128-recording limit; 1 recording could not load; 1 recording has no curve; 3 duration samples unavailable. " +
    remedy;
  const counts = {
    skippedForCap: 2,
    failedRecordings: 1,
    missingRecordings: 1,
    unknownPoints: 3,
    unknownMembershipRecordings: 0,
  };
  assert.equal(cadenceCurveWarning(true, counts), cadence + " " + suffix);
  assert.equal(velocityCurveWarning(true, counts), velocity + " " + suffix);
  assert.equal(nativePowerCurveWarning(true, counts), suffix);
  assert.equal(taggedCurveWarning("heartRate", true, counts), suffix);
  assert.doesNotMatch(suffix, /0 recordings|0 duration/);
  assert.equal(
    nativePowerCurveWarning(true, { skippedForCap: 1 }, 16),
    "Partial coverage: 1 recording omitted by the 16-recording limit. " + remedy
  );
});
test("metadata and membership limitations remain explicit without displaying unused zero counters", () => {
  const counts = {
    unknownMembershipRecordings: 1,
    unknownLengthRecordings: 2,
    unknownStreamRecordings: 1,
    invalidInventoryRecords: 2,
    conflictingRecordings: 1,
  };
  assert.equal(
    taggedCurveWarning("power", true, counts),
    "Partial coverage: 1 recording tag membership unavailable; 2 recording lengths unavailable; 1 recording stream list unavailable; 2 invalid recording rows excluded; 1 conflicting recording identity excluded. " +
      remedy
  );
  assert.equal(
    nativePowerCurveWarning(true, {}),
    "Partial coverage: some recording details are unavailable. " + remedy
  );
});
test("reserved unknown-sample warning size covers zero, singular and full-axis messages including longer metadata-only fallback", () => {
  for (const warning of [
    nativePowerCurveWarning,
    (partial, counts) => taggedCurveWarning("heartRate", partial, counts),
    (partial, counts) => taggedCurveWarning("velocity", partial, counts),
  ]) {
    for (const initial of [{}, { failedRecordings: 1 }, { unknownMembershipRecordings: 9999 }]) {
      const reserved = Math.max(
        warning(true, initial).length,
        warning(true, { ...initial, unknownPoints: 10000 }).length
      );
      for (const unknownPoints of [0, 1, 2, 9999, 10000])
        assert.ok(warning(true, { ...initial, unknownPoints }).length <= reserved);
    }
  }
});
test("actual native and tagged projections report final merged missing-sample counts while leaving measured values and coverage intact", async () => {
  const today = "2026-10-20",
    range = { start: "2026-10-01", end: today },
    power = createDesktopNativePowerFixtures({ today });
  const native = await power.service.load(
    power.config,
    { kind: "power", sport: "all", ...range },
    { actor: power.actor }
  );
  assert.equal(native.points.find((point) => point.duration_seconds === 5).value, 500);
  assert.equal(native.coverage.unknownPoints, 1);
  assert.equal(native.warning, nativePowerCurveWarning(true, native.coverage));
  assert.match(native.warning, /1 duration sample unavailable/);
  const tags = createDesktopChartTagsFixtures({ today }),
    catalog = await tags.catalog.load(tags.config, { actor: tags.actor });
  const filtered = await tags.service.load(
    tags.config,
    {
      kind: "heartRate",
      sport: "all",
      ...range,
      tags: JSON.stringify(["Running", "Cycling"]),
      tagScope: catalog.accountScope,
      tagRevision: catalog.revision,
    },
    { actor: tags.actor }
  );
  assert.equal(filtered.coverage.unknownPoints, 1);
  assert.equal(filtered.warning, taggedCurveWarning("heartRate", true, filtered.coverage));
  assert.match(filtered.warning, /1 duration sample unavailable/);
  assert.doesNotMatch(filtered.warning, /TrainingPeaks|probe|unverified|unsupported/i);
});

test("unfiltered HR removes complete-data QA assertions and reports only actual missing samples or sport-selection failures", () => {
  assert.equal(heartRateCurveWarning(false, { unknownPoints: 0, failedSelections: [] }), "");
  assert.equal(
    heartRateCurveWarning(true, { unknownPoints: 1, failedSelections: ["Run", "Ride"] }),
    "Partial coverage: 1 duration sample unavailable; 2 selected sports could not load. " + remedy
  );
  assert.equal(
    heartRateCurveWarning(true, { unknownPoints: 0, failedSelections: [] }),
    "Partial coverage: some recording details are unavailable. " + remedy
  );
});
