import { randomUUID } from "node:crypto";
export function appendWorkoutComment(
  comments,
  { workoutId, body, type = "post", creationId = randomUUID() },
  now = new Date()
) {
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  if (!/^(event:\d+|activity:i?\d+)$/.test(workoutId || "")) fail("Choose a calendar workout.");
  if (!["pre", "post"].includes(type)) fail("Choose a valid comment type.");
  if (typeof body !== "string" || !body.trim() || body.length > 2000)
    fail("Enter a comment under 2,000 characters.");
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(creationId))
    fail("Invalid comment identifier.");
  const id = `comment-${creationId}`,
    existing = comments.find((item) => item.id === id);
  if (existing) {
    if (
      existing.workout_id !== workoutId ||
      existing.body !== body.trim() ||
      (existing.type || existing.comment_type) !== type
    )
      fail(
        "This comment was already saved with different text. Reload comments before trying again.",
        409
      );
    return { comment: existing, comments };
  }
  const comment = {
    id,
    workout_id: workoutId,
    type,
    body: body.trim(),
    created_at: now.toISOString(),
  };
  return { comment, comments: [comment, ...comments] };
}
