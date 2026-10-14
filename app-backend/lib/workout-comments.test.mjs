import { test } from "node:test";
import assert from "node:assert/strict";
import { appendWorkoutComment } from "./workout-comments.mjs";
const input = {
  workoutId: "event:12",
  body: "  Start easy.  ",
  type: "pre",
  creationId: "cc44731e-9415-4ee3-ab45-a6d30502f823",
};
test("planned comments retain type, workout identity, text and a stable retry ID", () => {
  const saved = appendWorkoutComment([], input, new Date("2026-10-14T14:00:00Z"));
  assert.equal(saved.comment.type, "pre");
  assert.equal(saved.comment.body, "Start easy.");
  assert.equal(saved.comment.workout_id, "event:12");
  const retry = appendWorkoutComment(saved.comments, input);
  assert.equal(retry.comments.length, 1);
  assert.deepEqual(retry.comment, saved.comment);
  assert.throws(() => appendWorkoutComment(saved.comments, { ...input, body: "Different" }), {
    status: 409,
  });
});
test("invalid comments are rejected and existing post comments remain available", () => {
  for (const change of [
    { body: " " },
    { body: "x".repeat(2001) },
    { workoutId: "library:12" },
    { type: "invalid" },
    { creationId: "bad" },
  ])
    assert.throws(() => appendWorkoutComment([], { ...input, ...change }));
  const saved = appendWorkoutComment([], { ...input, type: undefined });
  assert.equal(saved.comment.type, "post");
});
