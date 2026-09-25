import { test } from "node:test";
import assert from "node:assert/strict";
import { retainRecentTrainingContext, twelveWeekStart } from "./training-retention.mjs";
import { snapshotCoversRange } from "./completed-workout-store.mjs";

const now = new Date("2026-09-25T18:00:00Z");

test("the retained history starts with the first day of the past 12 weeks", () => {
  assert.equal(twelveWeekStart(now, "America/Chicago"), "2026-07-06");
  const trimmed = retainRecentTrainingContext(
    {
      athlete: { time_zone: "America/Chicago" },
      history: [
        { id: "old", activity_id: "old", workout_date: "2026-07-05" },
        { id: "first", activity_id: "first", workout_date: "2026-07-06" },
        { id: "recent", activity_id: "recent", workout_date: "2026-09-25" },
      ],
      planned: [{ id: "future", workout_date: "2026-10-04" }],
      wellness_history: [{ date: "2026-06-06" }, { date: "2026-06-07" }],
      performance: [{ workoutDay: "2026-06-06" }, { workoutDay: "2026-06-07" }],
      archived_activity_versions: { old: "1", first: "2", recent: "3" },
      cached_ranges: [
        { start: "1900-01-01", end: "2026-10-04" },
        { start: "2025-01-01", end: "2025-02-01" },
      ],
    },
    now
  );
  assert.deepEqual(
    trimmed.history.map((item) => item.id),
    ["first", "recent"]
  );
  assert.equal(trimmed.planned.length, 1);
  assert.deepEqual(
    trimmed.wellness_history.map((row) => row.date),
    ["2026-06-07"]
  );
  assert.deepEqual(
    trimmed.performance.map((row) => row.workoutDay),
    ["2026-06-07"]
  );
  assert.deepEqual(trimmed.archived_activity_versions, { first: "2", recent: "3" });
  assert.deepEqual(trimmed.cached_ranges, [{ start: "2026-07-06", end: "2026-10-04" }]);
  assert.equal(snapshotCoversRange(trimmed, { start: "2026-07-06", end: "2026-07-12" }), true);
  assert.equal(snapshotCoversRange(trimmed, { start: "2026-06-29", end: "2026-07-05" }), false);
});
