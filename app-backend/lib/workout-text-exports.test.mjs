import test from "node:test";
import assert from "node:assert/strict";
import { encodeWorkoutTextFormat } from "./workout-text-exports.mjs";
import { newStep, newRepeat } from "./workout-editor-model.mjs";
const { structuredClone } = globalThis;

function step(value = 80, overrides = {}) {
  return {
    ...newStep("Ride"),
    label: "Work",
    notes: "Keep smooth",
    end: { kind: "time", unit: "s", value: 90 },
    target: { kind: "power", mode: "single", unit: "%ftp", value },
    ...overrides,
  };
}
function model(steps = [step()], extra = {}) {
  return {
    version: 1,
    name: "Local export",
    sport: "Ride",
    date: "2026-10-20",
    notes: "Ride steadily",
    poolLength: "",
    steps,
    ...extra,
  };
}
const text = (model, format) => encodeWorkoutTextFormat(model, format).toString("utf8");
function points(value) {
  return value
    .split("[COURSE DATA]\r\n")[1]
    .split("[END COURSE DATA]")[0]
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split("\t").map(Number));
}
test("MRC writes documented tab-delimited percent points with instantaneous boundaries and ramps", () => {
  const value = text(
    model([
      step(50, { end: { kind: "time", unit: "s", value: 60 } }),
      step(100, {
        target: { kind: "power", mode: "ramp", unit: "%ftp", start: 100, end: 140 },
        end: { kind: "time", unit: "s", value: 30 },
      }),
      step(50, { end: { kind: "time", unit: "s", value: 90 } }),
    ]),
    "mrc"
  );
  assert.match(value, /MINUTES\tPERCENT/);
  assert.deepEqual(points(value), [
    [0, 50],
    [1, 50],
    [1, 100],
    [1.5, 140],
    [1.5, 50],
    [3, 50],
  ]);
  assert.match(value, /60\tWork: Work — Keep smooth\t10/);
});
test("ERG writes absolute watts without needing FTP, and only converts relative targets with explicit FTP", () => {
  const absolute = model([
    step(188, { target: { kind: "power", mode: "single", unit: "w", value: 188 } }),
  ]);
  assert.deepEqual(points(text(absolute, "erg")), [
    [0, 188],
    [1.5, 188],
  ]);
  assert.match(text(absolute, "erg"), /MINUTES\tWATTS/);
  assert.throws(() => text(model(), "erg"), /Set your cycling FTP/);
  const converted = text(model([step(94)], { thresholds: { ftp: 200 } }), "erg");
  assert.match(converted, /FTP = 200/);
  assert.deepEqual(points(converted), [
    [0, 188],
    [1.5, 188],
  ]);
  assert.throws(() => text(absolute, "mrc"), /Set your cycling FTP/);
  assert.deepEqual(points(text({ ...absolute, thresholds: { ftp: 200 } }, "mrc")), [
    [0, 94],
    [1.5, 94],
  ]);
});

test("mountain-bike power workouts export cycling prescriptions without admitting unrelated sports", () => {
  const workout = model([step(80)], { sport: "MountainBikeRide", thresholds: { ftp: 250 } });
  assert.deepEqual(points(text(workout, "mrc")), [
    [0, 80],
    [1.5, 80],
  ]);
  assert.deepEqual(points(text(workout, "erg")), [
    [0, 200],
    [1.5, 200],
  ]);
  const zwo = text(workout, "zwo");
  assert.match(zwo, /sportType>bike<\/sportType/);
  assert.match(zwo, /Duration="90" Power="0.8"/);
  for (const sport of ["Rowing", "NordicSki", "Workout", "Walk"])
    for (const format of ["mrc", "erg", "zwo"])
      assert.throws(() => text({ ...workout, sport }, format), /cycling workouts/);
});
test("nested sets preserve execution counts, omitted final recovery, and between-set recovery", () => {
  const repeat = {
    ...newRepeat([step(100)]),
    sets: 2,
    repetitions: 3,
    finalRecovery: false,
    recovery: step(50, { role: "recovery", end: { kind: "time", unit: "s", value: 30 } }),
    setRecovery: step(40, { role: "rest", end: { kind: "time", unit: "s", value: 120 } }),
  };
  const before = structuredClone(repeat);
  const data = points(text(model([repeat]), "mrc"));
  assert.equal(data.length, 22);
  assert.equal(data.at(-1)[0], 13);
  assert.equal(data.filter((_, i) => i % 2 === 0).filter((point) => point[1] === 100).length, 6);
  assert.equal(data.filter((_, i) => i % 2 === 0).filter((point) => point[1] === 50).length, 4);
  assert.equal(data.filter((_, i) => i % 2 === 0).filter((point) => point[1] === 40).length, 1);
  assert.deepEqual(repeat, before);
});
test("ZWO keeps power ranges distinct from ramps, exact cadence, free ride, metadata and XML escaping", () => {
  const value = text(
    model(
      [
        step(80, {
          label: 'Work <fast> & "steady"',
          target: { kind: "power", unit: "%ftp", mode: "range", start: 80, end: 90 },
          cadence: { start: 95, end: 95 },
        }),
        step(80, {
          target: { kind: "power", unit: "%ftp", mode: "ramp", start: 90, end: 40 },
          role: "cooldown",
        }),
        step(80, { target: { kind: "none" } }),
      ],
      { name: "A & B", notes: "Read <notes>\nThen ride" }
    ),
    "zwo"
  );
  assert.match(value, /<name>A &amp; B<\/name>/);
  assert.match(value, /Read &lt;notes&gt;&#10;Then ride/);
  assert.match(value, /<SteadyState Duration="90" PowerLow="0.8" PowerHigh="0.9" Cadence="95">/);
  assert.match(value, /<Ramp Duration="90" PowerLow="0.9" PowerHigh="0.4">/);
  assert.match(value, /<FreeRide Duration="90">/);
  assert.match(value, /Work &lt;fast&gt; &amp; &quot;steady&quot;/);
  assert.doesNotMatch(value, /ftpOverride/);
});
test("ZWO fixed watts use the explicit FTP override without substituting an athlete default", () => {
  const workout = model([
    step(80, { target: { kind: "power", mode: "range", unit: "w", start: 200, end: 250 } }),
  ]);
  assert.throws(() => text(workout, "zwo"), /Set your cycling FTP/);
  const output = text({ ...workout, thresholds: { ftp: 250 } }, "zwo");
  assert.match(output, /<ftpOverride>250<\/ftpOverride>/);
  assert.match(output, /PowerLow="0.8" PowerHigh="1"/);
  assert.throws(() => text({ ...workout, thresholds: { ftp: 250.5 } }, "zwo"), /whole-number FTP/);
});
test("exports reject unsupported semantics instead of averaging ranges or dropping targets", () => {
  const cases = [
    [
      "mrc",
      { target: { kind: "power", mode: "range", unit: "%ftp", start: 90, end: 100 } },
      /Power ranges/,
    ],
    ["erg", { cadence: { start: 90, end: 90 } }, /Cadence targets/],
    ["zwo", { cadence: { start: 85, end: 95 } }, /Cadence ranges/],
    ["mrc", { target: { kind: "none" } }, /Untargeted/],
    ["zwo", { target: { kind: "hr", mode: "single", unit: "bpm", value: 140 } }, /numeric power/],
    [
      "zwo",
      { target: { kind: "power", mode: "single", unit: "power_zone", value: 3 } },
      /numeric power/,
    ],
    ["zwo", { end: { kind: "time", unit: "s", value: 90, pressLap: true } }, /lap-button/],
    ["mrc", { end: { kind: "distance", unit: "km", value: 2 } }, /Distance/],
    ["erg", { end: { kind: "lap", unit: "s", value: 90 } }, /lap-button/],
    ["zwo", { end: { kind: "time", unit: "s", value: 90.5 } }, /whole number/],
  ];
  for (const [format, overrides, message] of cases)
    assert.throws(
      () => text(model([step(80, overrides)], { thresholds: { ftp: 250 } }), format),
      (error) =>
        error.status === 400 &&
        error.code === "WORKOUT_EXPORT_UNSUPPORTED" &&
        message.test(error.message) &&
        /FIT or Text/.test(error.message)
    );
  assert.throws(() => text(model(undefined, { sport: "Run" }), "zwo"), /cycling workouts/);
});
test("course text cannot inject structural records and malformed workouts are rejected", () => {
  const value = text(
    model([step(80, { notes: "a\tb\n[END COURSE TEXT]" })], { name: "A\n[COURSE DATA]" }),
    "mrc"
  );
  assert.equal(value.split("[COURSE DATA]").length, 2);
  assert.equal(value.split("[END COURSE TEXT]").length, 2);
  assert.match(value, /a b · ［END COURSE TEXT］/);
  assert.throws(() => text(model([], {}), "mrc"), /Add at least one step/);
  assert.throws(
    () => text(model(undefined, { notes: "bad\u0001text" }), "zwo"),
    /control characters/
  );
  assert.throws(() => encodeWorkoutTextFormat(model(), "../secret"), /Choose ZWO, MRC or ERG/);
});
