import test from "node:test";
import assert from "node:assert/strict";
import {
  saveProviderWorkoutComment,
  loadProviderWorkoutComments,
} from "./provider-workout-comments.mjs";
import {
  readWorkoutCommentText,
  withWorkoutCommentText,
  stripWorkoutCommentText,
} from "./workout-comment-text.mjs";
import { updateWorkoutDescription } from "./workout-description.mjs";
import { readableDescription } from "./workout-editor-model.mjs";
import { loadWorkoutEditor, saveWorkoutEditor } from "./workout-editor.mjs";
import { fixtureEvent, fakeProvider } from "./fixtures/workout-editor-fixtures.mjs";

const input = {
  workoutId: "event:100",
  body: "Keep it easy.\n- 10m 300w",
  type: "pre",
  creationId: "cc44731e-9415-4ee3-ab45-a6d30502f823",
};
const now = new Date("2026-10-15T12:00:00Z");

for (const sport of ["Ride", "Run", "Swim"])
  test(`${sport}: comments save to the provider and survive description and structured edits`, async () => {
    const provider = fakeProvider(fixtureEvent(sport));
    const before = await provider.request("/athlete/0/events/100");
    const saved = await saveProviderWorkoutComment(provider.request, input, [], now);
    assert.equal(saved.verified, true);
    const after = await provider.request("/athlete/0/events/100");
    assert.deepEqual(after.workout_doc.steps, before.workout_doc.steps);
    assert.equal(readWorkoutCommentText(after.description, input.workoutId)[0].body, input.body);
    assert.equal(readableDescription(after.description), readableDescription(before.description));
    await updateWorkoutDescription(
      provider.request,
      input.workoutId,
      "Updated coaching description"
    );
    assert.equal(
      (await loadProviderWorkoutComments(provider.request, input.workoutId)).comments[0].body,
      input.body
    );
    const editor = await loadWorkoutEditor(provider.request, input.workoutId);
    editor.model.name = "Updated title";
    await saveWorkoutEditor(provider.request, input.workoutId, {
      model: editor.model,
      revision: editor.revision,
    });
    const final = await loadProviderWorkoutComments(provider.request, input.workoutId);
    assert.equal(final.needsSync, false);
    assert.equal(final.comments.length, 1);
    assert.equal(final.comments[0].body, input.body);
  });

test("lost provider replies reconcile by readback and a retry never duplicates a comment", async () => {
  let current = { description: "Original", workout_doc: { steps: [{ duration: 300 }] } },
    writes = 0;
  const request = async (path, options) => {
    assert.equal(path, "/activity/i123");
    if (options) {
      writes++;
      current = { ...current, ...JSON.parse(options.body) };
      throw Error("Lost reply");
    }
    return structuredClone(current);
  };
  const payload = { ...input, workoutId: "activity:i123", type: "post" };
  assert.equal((await saveProviderWorkoutComment(request, payload, [], now)).verified, true);
  assert.equal((await saveProviderWorkoutComment(request, payload, [], new Date())).verified, true);
  assert.equal(writes, 1);
  assert.equal(readWorkoutCommentText(current.description, payload.workoutId).length, 1);
  await assert.rejects(saveProviderWorkoutComment(request, { ...payload, body: "Different" }), {
    status: 409,
  });
});

test("provider denial, unconfirmed writes and changed device steps never report success", async () => {
  for (const mode of ["denied", "unchanged", "structure"]) {
    let current = { description: "Original", workout_doc: { steps: [{ duration: 300 }] } };
    const request = async (path, options) => {
      if (options) {
        if (mode === "denied") throw Object.assign(Error("Forbidden"), { status: 403 });
        if (mode !== "unchanged")
          current = {
            ...current,
            ...JSON.parse(options.body),
            workout_doc: { steps: [{ duration: 5 }] },
          };
      }
      return structuredClone(current);
    };
    await assert.rejects(
      saveProviderWorkoutComment(request, input),
      mode === "denied" ? /Forbidden/ : /did not confirm/
    );
  }
});

test("legacy comments migrate on save, remain readable after moving/copying and stay out of descriptions", async () => {
  const legacy = [
    {
      id: "older-comment",
      workout_id: input.workoutId,
      body: "Legacy coaching note",
      type: "pre",
      created_at: now.toISOString(),
    },
  ];
  let current = { description: "Original" };
  const request = async (_, options) => {
    if (options) current = { ...current, ...JSON.parse(options.body) };
    return structuredClone(current);
  };
  assert.equal(
    (await loadProviderWorkoutComments(request, input.workoutId, legacy)).needsSync,
    true
  );
  await saveProviderWorkoutComment(request, { workoutId: input.workoutId, syncOnly: true }, legacy);
  assert.equal(
    (await loadProviderWorkoutComments(request, input.workoutId, legacy)).needsSync,
    false
  );
  assert.equal(readWorkoutCommentText(current.description, "event:200")[0].workout_id, "event:200");
  assert.equal(stripWorkoutCommentText(current.description), "Original");
});

test("malformed provider comments and oversized writes retain the draft without overwriting data", async () => {
  let writes = 0;
  const broken = {
    description: "Original\n\n```training-agent-workout-comments-v1\nnot JSON\n```",
  };
  await assert.rejects(
    saveProviderWorkoutComment(async (_, options) => {
      if (options) writes++;
      return broken;
    }, input),
    /could not be read/
  );
  await assert.rejects(
    saveProviderWorkoutComment(async (_, options) => {
      if (options) writes++;
      return { description: "x".repeat(29950) };
    }, input),
    /text limit/
  );
  assert.equal(writes, 0);
  assert.deepEqual(readWorkoutCommentText(broken.description, input.workoutId), []);
  assert.equal(withWorkoutCommentText("Original", []), "Original");
});
