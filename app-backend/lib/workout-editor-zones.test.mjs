import test from "node:test";
import assert from "node:assert/strict";
import { workoutZoneOptions } from "./workout-editor-zones.mjs";
import { loadWorkoutEditor, saveWorkoutEditor } from "./workout-editor.mjs";
import { fakeProvider, fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";

test("zone presets use the configured sport and retain absolute or relative units", () => {
  const settings = [
    { types: ["Ride", "VirtualRide"], ftp: 200, power_zones: [55, 75, 90, 999] },
    { types: ["Run"], threshold_pace: 1609.344 / 480, pace_zones: [80, 90, 100, 999] },
    { types: ["Swim"], threshold_pace: 91.44 / 90, pace_zones: [75, 90, 100, 999] },
  ];
  assert.deepEqual(workoutZoneOptions(settings, "VirtualRide", "w")[1].target, {
    kind: "power",
    unit: "w",
    mode: "range",
    start: 110,
    end: 150,
  });
  assert.deepEqual(workoutZoneOptions(settings, "Ride", "%ftp")[1].target, {
    kind: "power",
    unit: "%ftp",
    mode: "range",
    start: 55,
    end: 75,
  });
  const swim = workoutZoneOptions(settings, "Swim", "secs/100y");
  assert.deepEqual(swim[1].target, {
    kind: "pace",
    unit: "secs/100y",
    mode: "range",
    start: 120,
    end: 100,
  });
  assert.match(swim[1].label, /1:40–2:00.*100 yd/);
  assert.deepEqual(workoutZoneOptions(settings, "TrailRun", "%pace")[2].target, {
    kind: "pace",
    unit: "%pace",
    mode: "range",
    start: 90,
    end: 100,
  });
  assert.equal(swim[0].target.unit, "pace_zone");
  assert.equal(swim[3].target.unit, "pace_zone");
  assert.deepEqual(workoutZoneOptions([], "Swim"), []);
});

test("selected zone range survives provider save and reload for each sport", async () => {
  for (const sport of ["Ride", "Run", "Swim"]) {
    const provider = fakeProvider(fixtureEvent(sport));
    const loaded = await loadWorkoutEditor(provider.request, "event:100");
    const unit = sport === "Ride" ? "w" : sport === "Run" ? "secs/mi" : "secs/100y";
    const target = workoutZoneOptions(loaded.zoneSettings, sport, unit)[1].target;
    loaded.model.steps[0].target = target;
    await saveWorkoutEditor(
      provider.request,
      "event:100",
      { model: loaded.model, revision: loaded.revision },
      "zone-test"
    );
    const reloaded = await loadWorkoutEditor(provider.request, "event:100");
    assert.deepEqual(reloaded.model.steps[0].target, target);
  }
});

test("zone lookup failure leaves the workout editable without fabricated ranges", async () => {
  const provider = fakeProvider(fixtureEvent());
  const loaded = await loadWorkoutEditor(async (path, options) => {
    if (path === "/athlete/0") throw Error("offline");
    return provider.request(path, options);
  }, "event:100");
  assert.deepEqual(loaded.zoneSettings, []);
  assert.match(loaded.zoneError, /could not be loaded/);
  assert.equal(loaded.model.name, "Ride custom title");
});
