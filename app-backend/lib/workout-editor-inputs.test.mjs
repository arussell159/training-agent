import test from "node:test";
import assert from "node:assert/strict";
import {
  durationClock,
  parseDurationInput,
  editorTarget,
  editorUnits,
} from "./workout-editor-inputs.mjs";
import { defaultTarget } from "./workout-editor-model.mjs";
import { fakeProvider, fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";
import { loadWorkoutEditor, saveWorkoutEditor } from "./workout-editor.mjs";

test("compact duration entry reads hours, minutes and seconds from the right", () => {
  for (const [input, seconds, clock] of [
    ["0600", 360, "00:06:00"],
    ["30", 30, "00:00:30"],
    ["10000", 3600, "01:00:00"],
    ["12345", 5025, "01:23:45"],
    ["6:00", 360, "00:06:00"],
    ["01:15:30", 4530, "01:15:30"],
    ["000000", 0, "00:00:00"],
  ]) {
    assert.equal(parseDurationInput(input), seconds);
    assert.equal(durationClock(seconds), clock);
  }
  for (const invalid of ["", "-30", "90", "160", "1:60", "006000", "12.5", "abc"])
    assert.equal(parseDurationInput(invalid), null);
});
test("fixed sport units and new targets use absolute pace or watts", () => {
  for (const [sport, unit, distance] of [
    ["Run", "secs/mi", "mi"],
    ["Ride", "w", "mi"],
    ["Swim", "secs/100y", "yd"],
  ]) {
    assert.equal(editorUnits(sport).target, unit);
    assert.equal(editorUnits(sport).distance, distance);
    assert.equal(defaultTarget(sport).unit, unit);
  }
});
test("pace conversions preserve the prescription and do not mutate imported targets", () => {
  const target = { kind: "pace", unit: "secs/km", mode: "range", start: 300, end: 330 };
  const displayed = editorTarget(target, "Run");
  assert.ok(Math.abs(displayed.start - 482.8032) < 1e-6);
  assert.ok(Math.abs(displayed.end - 531.08352) < 1e-6);
  assert.equal(target.unit, "secs/km");
  assert.equal(
    editorTarget({ kind: "pace", unit: "secs/100m", mode: "single", value: 100 }, "Swim").value,
    91.44
  );
});
test("percent targets resolve with athlete thresholds without inventing missing values", () => {
  const watts = { kind: "power", unit: "%ftp", mode: "ramp", start: 60, end: 100 };
  assert.deepEqual(editorTarget(watts, "Ride", [], { ftp: 200 }), {
    ...watts,
    unit: "w",
    start: 120,
    end: 200,
  });
  assert.equal(editorTarget(watts, "Ride"), null);
  const pace = { kind: "pace", unit: "%pace", mode: "single", value: 80 };
  assert.equal(editorTarget(pace, "Run", [], { pace: 4 }).value, 502.92);
  assert.equal(editorTarget(pace, "Swim"), null);
});
test("configured closed zones display absolute ranges and open zones remain native", () => {
  const settings = [{ types: ["Swim"], threshold_pace: 1, pace_zones: [80, 90, 100, 999] }];
  const native = { kind: "pace", unit: "pace_zone", mode: "single", value: 2 };
  const displayed = editorTarget(native, "Swim", settings);
  assert.equal(displayed.unit, "secs/100y");
  assert.equal(displayed.mode, "range");
  assert.ok(Math.abs(displayed.start - 114.3) < 1e-6);
  assert.ok(Math.abs(displayed.end - 101.6) < 1e-6);
  assert.equal(native.value, 2);
  assert.equal(editorTarget({ ...native, value: 1 }, "Swim", settings), null);
  assert.equal(editorTarget({ ...native, value: 4 }, "Swim", settings), null);
});
test("typed durations survive provider serialization and verified reload", async () => {
  for (const input of ["0600", "30", "10000"]) {
    const provider = fakeProvider(fixtureEvent());
    const loaded = await loadWorkoutEditor(provider.request, "event:123");
    loaded.model.steps[0].end.value = parseDurationInput(input);
    await saveWorkoutEditor(provider.request, "event:123", {
      model: loaded.model,
      revision: loaded.revision,
    });
    const saved = await loadWorkoutEditor(provider.request, "event:123");
    assert.equal(saved.model.steps[0].end.value, parseDurationInput(input));
    assert.equal(saved.model.steps[0].end.unit, "s");
  }
});
