import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, matchingActivities } from "./trainingpeaks-import.mjs";
test("export CSV preserves quoted multiline descriptions, commas and empty actual duration", () => {
  const rows = parseCsv(
    '\uFEFFTitle,WorkoutDescription,TimeTotalInHours\r\n"Ride, easy","Warm up\nThen ""easy""",1\r\nRest,,\r\n'
  );
  assert.equal(rows[0].Title, "Ride, easy");
  assert.equal(rows[0].WorkoutDescription, 'Warm up\nThen "easy"');
  assert.equal(rows[1].TimeTotalInHours, "");
});
test("existing original recording wins over duplicate summary and sport aliases match", () => {
  const date = "2026-08-18";
  const fit = {
    id: "fit",
    start_date_local: date + "T10:00:00",
    type: "VirtualRide",
    file_type: "fit",
    moving_time: 2900,
  };
  const summary = {
    id: "summary",
    start_date_local: date + "T12:00:00",
    type: "Ride",
    moving_time: 2904,
  };
  assert.deepEqual(matchingActivities([fit, summary], date, "Ride", 2904), [fit]);
  assert.deepEqual(matchingActivities([{ ...fit, type: "OpenWaterSwim" }], date, "Swim", 4000), [
    { ...fit, type: "OpenWaterSwim" },
  ]);
});
