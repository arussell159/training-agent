import { test } from "node:test";
import assert from "node:assert/strict";
import { lapHeartRatePath } from "../../ui/src/lib/lap-heart-rate.ts";

const point = (time, heartRate) => ({ time, heartRate, power: null, speed: null, distance: null });
const coordinates = (path) =>
  [...path.matchAll(/([ML])([\d.]+),([\d.]+)/g)].map(([, command, x, y]) => ({
    command,
    x: Number(x),
    y: Number(y),
  }));

test("lap HR uses recorded sample times and each bar's duration-proportional position", () => {
  const path = lapHeartRatePath(
    [point(0, 120), point(10, 130), point(20, 140), point(30, 150)],
    [
      { start: 0, end: 10, left: 0, width: 100 },
      { start: 10, end: 30, left: 102, width: 200 },
    ]
  );
  const values = coordinates(path);
  assert.deepEqual(
    values.map((v) => v.x),
    [0, 100, 102, 202, 302]
  );
  assert.equal(values[1].y, values[2].y);
  assert.ok(values[0].y > values.at(-1).y);
  assert.ok(values.every((v) => v.y >= 20 && v.y <= 190));
  assert.ok(!path.includes("Z"));
});

test("lap HR breaks at missing readings, long recording gaps, and omitted laps", () => {
  const path = lapHeartRatePath(
    [
      point(0, 120),
      point(5, null),
      point(10, 130),
      point(15, 0),
      point(20, 140),
      point(55, 150),
      point(60, 150),
      point(70, 160),
      point(75, 165),
    ],
    [
      { start: 0, end: 60, left: 0, width: 120 },
      { start: 70, end: 75, left: 122, width: 10 },
    ]
  );
  assert.deepEqual(
    coordinates(path).map((v) => v.command),
    ["M", "M", "M", "M", "L", "M", "L"]
  );
});

test("lap HR has no line when recorded heart rate is unavailable", () => {
  assert.equal(
    lapHeartRatePath(
      [point(0, null), point(5, NaN), point(10, 0)],
      [{ start: 0, end: 10, left: 0, width: 100 }]
    ),
    ""
  );
  assert.equal(lapHeartRatePath([point(0, 140)], []), "");
  const emptyLap = lapHeartRatePath(
    [point(0, 120), point(5, 125), point(35, 130), point(40, 135)],
    [
      { start: 0, end: 10, left: 0, width: 100 },
      { start: 10, end: 30, left: 102, width: 200 },
      { start: 30, end: 40, left: 304, width: 100 },
    ]
  );
  assert.deepEqual(
    coordinates(emptyLap).map((v) => v.command),
    ["M", "L", "M", "L"]
  );
});
