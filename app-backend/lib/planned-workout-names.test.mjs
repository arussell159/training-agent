import { test } from "node:test";
import assert from "node:assert/strict";
import { plannedWorkoutNames, renamePlannedWorkouts } from "../scripts/rename-planned-workouts.mjs";
test("planned workout names follow coach-style discipline and main-set conventions", () => {
  assert.equal(plannedWorkoutNames.size, 23);
  for (const name of plannedWorkoutNames.values()) {
    assert.match(name, /^(Bike|Run|Swim|Brick Run|Aerobic Run)\b/);
    assert.doesNotMatch(
      name,
      /Tune-Up|Shakeout|Activation|Easy Aerobic|Race-Power|Race-Pace Brick/
    );
  }
});
test("renaming verifies names and preserves every workout field", async () => {
  const events = [...plannedWorkoutNames].map(([id]) => ({
    id,
    name: "Old",
    category: "WORKOUT",
    description: "d",
    workout_doc: { steps: [{ duration: 60 }] },
    moving_time: 60,
    start_date_local: "2026-09-20",
    type: "Run",
  }));
  const state = new Map(events.map((e) => [e.id, e]));
  const result = await renamePlannedWorkouts(async (path, options) => {
    if (path.includes("events?")) return [...state.values()];
    const id = Number(path.split("/").at(-1));
    if (options) state.set(id, { ...state.get(id), ...JSON.parse(options.body) });
    return state.get(id);
  });
  assert.equal(result.changed.length, 23);
  assert.deepEqual(state.get(136494156).workout_doc, { steps: [{ duration: 60 }] });
});
