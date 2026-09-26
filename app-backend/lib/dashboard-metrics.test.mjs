import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyWorkouts,
  todaysWorkout,
  recoverySeries,
  workoutDurations,
} from "../../ui/src/lib/dashboard-metrics.ts";
const context = { athlete: { time_zone: "America/Chicago" }, history: [], planned: [] };

test("dashboard retains today completed prescription instead of tomorrow or an unrelated activity", () => {
  const today = {
    id: "event:1",
    workout_date: "2026-09-15",
    status: "completed",
    title: "Swim",
    activity_id: "i1",
  };
  const next = { id: "event:2", workout_date: "2026-09-16", status: "upcoming" };
  assert.equal(
    todaysWorkout({ ...context, planned: [next, today] }, new Date("2026-09-16T01:00:00Z")),
    today
  );
  assert.equal(
    todaysWorkout(
      { ...context, history: [today], planned: [next] },
      new Date("2026-09-16T01:00:00Z")
    ),
    today
  );
  assert.equal(
    todaysWorkout({ ...context, planned: [next] }, new Date("2026-09-15T20:00:00Z")),
    undefined
  );
});
test("home keeps both distinct workouts for a day and collapses paired activity duplicates", () => {
  const bike = {
    id: "event:bike",
    activity_id: "bike-1",
    workout_date: "2026-09-25",
    sport: "Ride",
    title: "Bike",
    plannedDurationMinutes: 60,
  };
  const run = {
    id: "event:run",
    activity_id: "run-1",
    workout_date: "2026-09-25",
    sport: "Run",
    title: "Run",
    plannedDurationMinutes: 30,
  };
  const recording = { ...bike, id: "activity:bike-1" };
  assert.deepEqual(
    dailyWorkouts({ ...context, planned: [bike, run], history: [recording] }, "2026-09-25"),
    [bike, run]
  );
  assert.deepEqual(
    dailyWorkouts(
      {
        ...context,
        planned: [bike],
        history: [
          {
            id: "activity:other",
            workout_date: "2026-09-25",
            sport: "Other",
            actualDurationMinutes: 0,
          },
        ],
      },
      "2026-09-25"
    ),
    [bike]
  );
  assert.deepEqual(
    dailyWorkouts(
      {
        ...context,
        planned: [
          bike,
          {
            id: "event:other",
            workout_date: "2026-09-25",
            sport: "Other",
            plannedDurationMinutes: 0,
          },
        ],
        history: [],
      },
      "2026-09-25"
    ),
    [bike]
  );
});
test("Intervals wellness supplies daily HRV and resting HR range and average without workouts", () => {
  const c = {
    ...context,
    wellness_history: [
      { date: "2026-09-15", hrv: 60, restingHR: 50 },
      { date: "2026-09-14", hrv: 40, restingHR: 54 },
      { date: "2026-09-13", hrv: null, restingHR: null },
    ],
  };
  const h = recoverySeries(c, "hrv"),
    r = recoverySeries(c, "resting_hr");
  assert.equal(h.length, 2);
  assert.equal(h[1].average, 50);
  assert.ok(h[1].baselineLow < 50);
  assert.ok(h[1].baselineHigh > 50);
  assert.equal(r[1].average, 52);
  assert.equal(r[1].value, 50);
  assert.equal(recoverySeries(context, "hrv").length, 0);
});
test("wellness deduplicates dates and calendar gaps do not become extra samples or zero values", () => {
  const c = {
    ...context,
    history: [
      { workout_date: "2026-09-15", recovery: { hrv: 20 } },
      { workout_date: "2026-09-15", recovery: { hrv: 30 } },
    ],
    wellness_history: [
      { date: "2026-09-01", hrv: 100 },
      { date: "2026-09-15", hrv: 50 },
    ],
  };
  const h = recoverySeries(c, "hrv");
  assert.equal(h.length, 2);
  assert.equal(h[1].value, 50);
  assert.equal(h[1].average, 50);
});
test("completed duration fills the plan, retaining the exact uncompleted remainder", () => {
  const w = {
    workout_summary: { planned: { duration_seconds: 3600 }, completed: { duration_seconds: 2700 } },
    plannedDurationMinutes: 60,
    actualDurationMinutes: 45,
  };
  assert.deepEqual(workoutDurations(w), { planned: 60, completed: 45, remaining: 15 });
  assert.deepEqual(
    workoutDurations({ workout_summary: { planned: null, completed: { duration_seconds: 614 } } }),
    { planned: 0, completed: 614 / 60, remaining: 0 }
  );
});
