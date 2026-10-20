import test from "node:test";
import assert from "node:assert/strict";
import { fakeProvider, fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";
import { loadWorkoutEditor, saveWorkoutEditor } from "./workout-editor.mjs";
import { readPlannedValues } from "./planned-workout-values.mjs";
import { readWorkoutCommentText } from "./workout-comment-text.mjs";
import { updateWorkoutDescription } from "./workout-description.mjs";
import { readableDescription, serializeWorkout } from "./workout-editor-model.mjs";
const commentId = "d7704c47-a625-409d-9f45-fb5c54ca9b9b";
test("desktop builder saves intervals, planned fields, time and comments in one verified provider update", async () => {
  const p = fakeProvider(fixtureEvent("Ride"));
  const loaded = await loadWorkoutEditor(p.request, "event:100");
  loaded.model.name = "Inline builder edit";
  loaded.model.steps[0].end.value = 900;
  const values = {
    duration_seconds: 3600,
    distance_meters: 30000,
    tss: 60,
    intensity_factor: 0.8,
    calories: 700,
    work_kj: 650,
  };
  const saved = await saveWorkoutEditor(p.request, "event:100", {
    model: loaded.model,
    revision: loaded.revision,
    values,
    time: "07:15",
    comment: "Controlled effort.",
    commentId,
  });
  assert.equal(saved.verified, true);
  assert.equal(p.calls.filter((call) => call.method === "PUT").length, 1);
  assert.equal(saved.event.start_date_local, "2026-10-10T07:15:00");
  assert.equal(saved.event.end_date_local, "2026-10-10T08:45:00");
  assert.equal(saved.event.time_target, 3600);
  assert.equal(saved.event.joules, 650000);
  assert.equal(saved.event.workout_doc.steps[0].duration, 900);
  assert.deepEqual(readPlannedValues(saved.event.description), values);
  assert.equal(
    readWorkoutCommentText(saved.event.description, "event:100")[0].body,
    "Controlled effort."
  );
});
test("an uncertain desktop builder save rechecks the same comment and fields without replaying a PUT", async () => {
  const p = fakeProvider(fixtureEvent("Run"), { uncertain: true });
  const loaded = await loadWorkoutEditor(p.request, "event:100");
  const input = {
    model: loaded.model,
    revision: loaded.revision,
    values: { tss: 42 },
    time: "09:10",
    comment: "One comment.",
    commentId,
  };
  await saveWorkoutEditor(p.request, "event:100", input);
  await saveWorkoutEditor(p.request, "event:100", input);
  assert.equal(p.calls.filter((call) => call.method === "PUT").length, 1);
  assert.equal(readWorkoutCommentText(p.event().description, "event:100").length, 1);
});
test("desktop builder cannot confirm lost planned targets or overwrite stale metadata", async () => {
  const p = fakeProvider(fixtureEvent("Ride"), {
    corrupt: (event) => {
      event.time_target = null;
    },
  });
  const loaded = await loadWorkoutEditor(p.request, "event:100");
  await assert.rejects(
    saveWorkoutEditor(p.request, "event:100", {
      model: loaded.model,
      revision: loaded.revision,
      values: { duration_seconds: 3600 },
    }),
    (e) => e.code === "VERIFICATION_FAILED"
  );
  const fresh = fakeProvider(fixtureEvent("Ride"));
  const other = await loadWorkoutEditor(fresh.request, "event:100");
  fresh.setEvent({ ...fresh.event(), name: "Changed elsewhere" });
  await assert.rejects(
    saveWorkoutEditor(fresh.request, "event:100", {
      model: other.model,
      revision: other.revision,
      time: "10:00",
    }),
    (e) => e.status === 409
  );
  assert.equal(fresh.calls.filter((call) => call.method === "PUT").length, 0);
});
test("clearing a previously saved desktop planned field persists null on a later save", async () => {
  const p = fakeProvider(fixtureEvent("Ride"));
  const loaded = await loadWorkoutEditor(p.request, "event:100");
  const first = await saveWorkoutEditor(p.request, "event:100", {
    model: loaded.model,
    revision: loaded.revision,
    values: { calories: 450 },
  });
  const second = await saveWorkoutEditor(p.request, "event:100", {
    model: loaded.model,
    revision: first.revision,
    values: { calories: null },
  });
  assert.equal(readPlannedValues(second.event.description).calories, null);
  assert.equal(p.calls.filter((call) => call.method === "PUT").length, 2);
});
test("editing intervals preserves a custom Summary description and allows editing that description atomically", async () => {
  const p = fakeProvider(fixtureEvent("Run"));
  const original = await loadWorkoutEditor(p.request, "event:100");
  p.setEvent({ ...p.event(), description: serializeWorkout(original.model) });
  await updateWorkoutDescription(p.request, "event:100", "Easy effort; stop if form fades.");
  const loaded = await loadWorkoutEditor(p.request, "event:100");
  assert.equal(loaded.descriptionOverride, "Easy effort; stop if form fades.");
  loaded.model.steps[0].end.value = 420;
  const saved = await saveWorkoutEditor(p.request, "event:100", {
    model: loaded.model,
    revision: loaded.revision,
  });
  assert.equal(readableDescription(saved.event.description), "Easy effort; stop if form fades.");
  assert.equal(saved.event.workout_doc.steps[0].duration, 420);
  const edited = await saveWorkoutEditor(p.request, "event:100", {
    model: loaded.model,
    revision: saved.revision,
    description: "Updated description from the builder.",
  });
  assert.equal(
    readableDescription(edited.event.description),
    "Updated description from the builder."
  );
  assert.equal(edited.event.workout_doc.steps[0].duration, 420);
});
