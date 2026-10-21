import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { workoutRevision } from "./workout-editor.mjs";
import { workoutRevisionInput } from "./workout-revision-input.mjs";

test("cached native event revisions computed by Web Crypto match server revisions and protect hidden prescription edits", async () => {
  const event = {
    id: 71,
    name: "Cached event",
    type: "Run",
    category: "WORKOUT",
    start_date_local: "2026-10-21T07:15:00",
    description: "Same visible prose",
    workout_doc: { steps: [{ duration: 600, pace: { units: "percent", value: 95 } }] },
    custom_metadata: { b: 2, a: 1 },
  };
  const browserRevision = async (value) =>
    [
      ...new Uint8Array(
        await webcrypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(workoutRevisionInput(value))
        )
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  assert.equal(await browserRevision(event), workoutRevision(event));
  assert.equal(
    await browserRevision({ ...event, custom_metadata: { a: 1, b: 2 } }),
    workoutRevision(event)
  );
  const changed = structuredClone(event);
  changed.workout_doc.steps[0].pace.value = 105;
  assert.notEqual(await browserRevision(changed), workoutRevision(event));
  for (const patch of [
    { read_only: true },
    { athlete_cannot_edit: true },
    { paired_activity_id: "i123" },
    { external_id: "other" },
  ])
    assert.notEqual(await browserRevision({ ...event, ...patch }), workoutRevision(event));
  assert.equal(event.workout_doc.steps[0].pace.value, 95);
});
