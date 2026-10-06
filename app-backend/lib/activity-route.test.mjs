import { test } from "node:test";
import assert from "node:assert/strict";
import { activityRoute } from "./activity-route.mjs";
test("GPS supports separate Intervals latitude/longitude arrays and skips missing coordinates", () => {
  assert.deepEqual(
    activityRoute([{ type: "latlng", data: [null, 30, 31], data2: [null, -97, -98] }]),
    [
      [30, -97],
      [31, -98],
    ]
  );
  assert.deepEqual(
    activityRoute([
      {
        type: "latlng",
        data: [
          [30, -97],
          [null, -97],
        ],
      },
    ]),
    [[30, -97]]
  );
  assert.deepEqual(activityRoute([]), []);
});
test("maps retain every GPS sample, including the final point of long workouts", () => {
  const points = Array.from({ length: 12000 }, (_, i) => [30 + i / 100000, -97 + i / 100000]);
  assert.deepEqual(activityRoute([{ type: "latlng", data: points }]), points);
});
