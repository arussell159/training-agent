import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTwelveWeekTrainingHistory } from "./training-history.mjs";

test("12-week history uses saved completed activity durations across the entire window", () => {
  const workout = (date, id, sport, minutes) => ({
    id: `event:${id}`,
    activity_id: id,
    workout_date: date,
    sport,
    status: "completed",
    actualDurationMinutes: minutes,
    workout_summary: { completed: { duration_seconds: minutes * 60, distance_meters: 1000 } },
  });
  const history = [
    workout("2026-07-06", "a", "Run", 60),
    workout("2026-08-10", "b", "Ride", 90),
    workout("2026-09-25", "c", "Swim", 30),
    workout("2026-07-05", "old", "Run", 120),
    { ...workout("2026-07-06", "a", "Run", 60), id: "activity:a" },
  ];
  const weeks = buildTwelveWeekTrainingHistory(
    { athlete: { time_zone: "America/Chicago" }, history },
    new Date("2026-09-25T18:00:00Z")
  );
  assert.equal(weeks.length, 12);
  assert.equal(weeks[0].week, "2026-07-06");
  assert.equal(weeks[0].all.hours, 1);
  assert.equal(weeks[0].run.hours, 1);
  assert.equal(weeks[5].bike.hours, 1.5);
  assert.equal(weeks[11].swim.hours, 0.5);
  assert.equal(weeks[11].all.distanceMeters, 1000);
});
