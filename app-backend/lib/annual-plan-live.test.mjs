import test from "node:test";
import assert from "node:assert/strict";
import { calendarActuals } from "../../ui/src/lib/annual-plan.ts";

test("current planner week follows synced duration instead of an imported snapshot", () => {
  const week = { id: "current", startDate: "2026-09-14", endDate: "2026-09-20", completedHours: 1 };
  const past = { id: "past", startDate: "2026-09-07", endDate: "2026-09-13", completedHours: 9 };
  const workout = {
    id: "event:1",
    workout_date: "2026-09-18",
    status: "completed",
    workout_summary: { completed: { duration_seconds: 7200 } },
  };
  const context = {
    athlete: { time_zone: "America/Chicago" },
    history: [workout],
    planned: [workout],
  };
  const now = new Date("2026-09-18T20:00:00Z");
  assert.equal(
    calendarActuals(context, { weeks: [past, week] }, now).get("current").completedHours,
    2
  );
  context.history[0].workout_summary.completed.duration_seconds = 10800;
  assert.equal(
    calendarActuals(context, { weeks: [past, week] }, now).get("current").completedHours,
    3
  );
  assert.equal(
    calendarActuals(context, { weeks: [past, week] }, now).get("past").completedHours,
    9
  );
});
