import test from "node:test";
import assert from "node:assert/strict";
import { recordedSignalStatistics, recordedSignalValue, formatRecordedSignal, recordedSignalInfo } from "../src/lib/workout-signal-statistics.ts";

const point = (time, values = {}) => ({ time, power: null, heartRate: null, speed: null, distance: null, ...values });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);

test("recorded pace defaults show minutes and seconds per100 yards or mile using SI activity speed", () => {
  for (const [sport, speed, seconds, label] of [["Swim", .9144, 100, "m:ss/100yds"], ["Run", 1609.344 / 480, 480, "min/mile"], ["TrailRun", 1609.344 / 480, 480, "min/mile"]]) {
    const value = recordedSignalValue(point(0, {speed}), "pace", sport);
    close(value, seconds);
    assert.equal(recordedSignalInfo("pace", sport).unit, label);
    assert.equal(formatRecordedSignal(value, "pace", sport), sport === "Swim" ? "1:40" : "8:00");
  }
});

test("signal statistics weight recorded time and preserve zeros without filling missing values", () => {
  const points = [point(0, { power: 0, heartRate: 100 }), point(2, { power: 200 }), point(10, { power: null, heartRate: 140 }), point(12, { power: 300 })];
  const rows = recordedSignalStatistics(points, 0, 12, "Bike");
  const power = rows.find(row => row.key === "power");
  assert.equal(power.minimum, 0); assert.equal(power.maximum, 300); assert.equal(power.average, 160);
  assert.equal(rows.find(row => row.key === "heartRate").average, 120);
  assert.equal(rows.some(row => row.key === "cadence"), false);
});

test("selected ranges clip covered samples and keep unavailable values absent", () => {
  const points = [point(0, { power: 100 }), point(10, { power: 200 }), point(20, { power: 300 })];
  const row = recordedSignalStatistics(points, 5, 15, "Bike")[0];
  assert.deepEqual(row, { key: "power", minimum: 100, average: 150, maximum: 200 });
  assert.deepEqual(recordedSignalStatistics(points, 30, 40, "Bike")[0], { key: "power", minimum: null, average: null, maximum: null });
});

test("pace extrema invert speed and the mean uses covered moving speed for run and swim", () => {
  const points = [point(0, { speed: 0 }), point(5, { speed: 2 }), point(10, { speed: 4 }), point(20, { speed: 4 })];
  for (const [sport, distance] of [["Run", 1609.344], ["Swim", 91.44]]) {
    const pace = recordedSignalStatistics(points, 0, 20, sport).find(row => row.key === "pace");
    close(pace.minimum, distance / 4); close(pace.maximum, distance / 2); close(pace.average, distance / (50 / 15));
    assert.equal(recordedSignalValue(points[0], "pace", sport), null);
  }
});

test("all recorded channels retain correct units, single samples and finite display values", () => {
  const sample = point(10, { elevation: 30.48, speed: 1, cadence: 0, dfaA1: 0.78, dfaArtifacts: 2.5 });
  const rows = recordedSignalStatistics([sample], 0, 20, "Run");
  close(rows.find(row => row.key === "elevation").average, 100);
  close(rows.find(row => row.key === "speed").average, 2.2369362920544);
  assert.equal(rows.find(row => row.key === "cadence").average, 0);
  assert.equal(rows.find(row => row.key === "dfaA1").average, 0.78);
  assert.equal(formatRecordedSignal(Infinity, "power", "Run"), "—");
  assert.equal(formatRecordedSignal(402.336, "pace", "Run"), "6:42");
});

test("DFA statistics retain the existing artifact quality filter without hiding artifact measurements", () => {
  const points = [point(0, { dfaA1: 0, dfaArtifacts: 0 }), point(10, { dfaA1: 0.78, dfaArtifacts: 2 }), point(20, { dfaA1: 1.6, dfaArtifacts: 8 })];
  const rows = recordedSignalStatistics(points, 0, 20, "Run");
  assert.equal(rows.find(row => row.key === "dfaA1").average, 0.78);
  assert.equal(rows.find(row => row.key === "dfaA1").maximum, 0.78);
  assert.equal(rows.find(row => row.key === "dfaArtifacts").maximum, 8);
});
