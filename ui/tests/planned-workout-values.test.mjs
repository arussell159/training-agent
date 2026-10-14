import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPlannedValue, parsePlannedValue, plannedValueDraft, changedPlannedValues } from "../src/lib/planned-workout-values.ts";
test("duration and pace formats use explicit units and reject invalid clocks", () => {
  assert.equal(formatPlannedValue("duration_seconds", 3720, "Run"), "1:02:00");
  assert.equal(parsePlannedValue("duration_seconds", "1:02:00", "Run"), 3720);
  assert.equal(parsePlannedValue("average_speed", "10:12", "Run"), 1609.344 / 612);
  for (const text of ["1:60:00", "-1", "abc", "1:2"]) assert.throws(() => parsePlannedValue("duration_seconds", text, "Run"));
  assert.throws(() => parsePlannedValue("average_speed", "0:00", "Run"));
});
test("distance and elevation convert miles/feet; planned yards differ from recorded metres", () => {
  assert.equal(parsePlannedValue("distance_meters", "6.07", "Run"), 6.07 * 1609.344);
  assert.equal(parsePlannedValue("elevation_gain", "100", "Run"), 30.48);
  assert.equal(formatPlannedValue("elevation_gain", 30.48, "Run"), "100");
  assert.equal(formatPlannedValue("distance_meters", 914.4, "Swim", true), "1000");
  assert.equal(parsePlannedValue("distance_meters", "1000", "Swim"), 1000);
  assert.equal(parsePlannedValue("average_speed", "1:40", "Swim"), 1);
});
test("only edited fields are sent; blank clears while zero is retained", () => {
  const saved = plannedValueDraft({ duration_seconds: 3720, distance_meters: 9770.76543, calories: 450, intensity_factor: .87543 }, "Run");
  const draft = { ...saved, calories: "", tss: "0" };
  assert.deepEqual(changedPlannedValues(draft, saved, "Run"), { calories: null, tss: 0 });
  assert.throws(() => parsePlannedValue("tss", "4.2", "Run"));
  assert.throws(() => parsePlannedValue("intensity_factor", "5.1", "Run"));
});

test('bike speed uses mph while run and swim use pace',()=>{
 assert.equal(formatPlannedValue('average_speed',7.15264,'Bike'),'16.0');
 assert.ok(Math.abs(parsePlannedValue('average_speed','16.0','Bike')-7.15264)<1e-5);
});
