import test from "node:test";
import assert from "node:assert/strict";
import { readWorkoutLibrary } from "./workout-library.mjs";
test("existing native and legacy mirror templates remain readable and unchanged without any automatic writes", async () => {
  const workouts = [
      {
        id: 2,
        name: "Existing independent template",
        type: "Ride",
        description: "- 10m 100w",
        folder_id: 1,
      },
      {
        id: 3,
        name: "Existing legacy mirror",
        type: "Run",
        description: "- 5m Z2 HR",
        tags: ["training-agent-event-24"],
        folder_id: 2,
      },
    ],
    before = structuredClone(workouts);
  const previews = await readWorkoutLibrary(async (path, options) => {
    assert.equal(path, "/athlete/0/workouts");
    assert.equal(options, undefined);
    return structuredClone(workouts);
  });
  assert.deepEqual(
    previews.map((row) => row.id),
    ["library:2", "library:3"]
  );
  assert.equal(
    previews.every(
      (row) =>
        row.editable === false && row.workout_date === undefined && row.date === "Saved workout"
    ),
    true
  );
  assert.deepEqual(workouts, before);
});
