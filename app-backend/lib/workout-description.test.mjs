import { test } from "node:test";
import assert from "node:assert/strict";
import { updateWorkoutDescription, DEFINITION_MARKER } from "./workout-description.mjs";
test("description editing confirms provider save and preserves native workout intervals", async () => {
  let value = {
    description: "Old" + DEFINITION_MARKER + "- 5m 150w",
    workout_doc: { steps: [{ duration: 300 }] },
  };
  const result = await updateWorkoutDescription(
    async (path, options) => {
      assert.equal(path, "/athlete/0/events/12");
      if (options?.method === "PUT") value = { ...value, ...JSON.parse(options.body) };
      return value;
    },
    "event:12",
    "New"
  );
  assert.equal(result.verified, true);
  assert.equal(value.description, "New" + DEFINITION_MARKER + "- 5m 150w");
});
test("completed descriptions use activity endpoint; rejected saves are not reported as saved", async () => {
  let value = { description: "Old" };
  await updateWorkoutDescription(
    async (path, options) => {
      assert.equal(path, "/activity/i123");
      if (options) value = JSON.parse(options.body);
      return value;
    },
    "activity:i123",
    "New"
  );
  assert.equal(value.description, "New");
  await assert.rejects(
    updateWorkoutDescription(async () => ({ description: "Old" }), "activity:i123", "New"),
    /did not confirm/
  );
});
