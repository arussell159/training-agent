import { appendWorkoutComment } from "./workout-comments.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import { readWorkoutCommentText, withWorkoutCommentText } from "./workout-comment-text.mjs";
import { loadNativeActivityComments } from "./native-workout-comments.mjs";

export function commentWorkoutPath(id) {
  const match = String(id).match(/^(event:[1-9]\d*|activity:i?[1-9]\d*)$/);
  if (!match) throw Object.assign(Error("Choose a calendar workout."), { status: 400 });
  const [kind, value] = id.split(":");
  return kind === "event" ? `/athlete/0/events/${value}` : `/activity/${value}`;
}
export async function loadProviderWorkoutComments(request, id, legacy = []) {
  const workout = await request(commentWorkoutPath(id));
  const provider = readWorkoutCommentText(workout.description, id, true);
  const old = legacy.filter((item) => item.workout_id === id);
  const comments = [...new Map([...old, ...provider].map((item) => [item.id, item])).values()];
  if (id.startsWith("activity:")) {
    const native = await loadNativeActivityComments(request, id);
    return {
      comments: [...new Map([...native, ...comments].map((item) => [item.id, item])).values()],
      needsSync: false,
    };
  }
  return {
    comments,
    needsSync: old.some(
      (item) =>
        !provider.some(
          (saved) =>
            saved.id === item.id &&
            saved.body === item.body &&
            (saved.type || saved.comment_type) === (item.type || item.comment_type)
        )
    ),
  };
}
export async function saveProviderWorkoutComment(request, input, legacy = [], now = new Date()) {
  if (input.workoutId?.startsWith("activity:"))
    throw Object.assign(Error("Activity comments must use the durable workout save path."), {
      status: 409,
      code: "DURABLE_COMMENT_REQUIRED",
    });
  const path = commentWorkoutPath(input.workoutId),
    workout = await request(path);
  const provider = readWorkoutCommentText(workout.description, input.workoutId, true);
  const existing = [
    ...new Map(
      [
        ...legacy
          .filter((item) => item.workout_id === input.workoutId)
          .map((item) => ({ ...item, type: item.type || item.comment_type || "post" })),
        ...provider,
      ].map((item) => [item.id, item])
    ).values(),
  ];
  const result = input.syncOnly
    ? { comments: existing, comment: null }
    : appendWorkoutComment(existing, input, now);
  if (result.comments.length > 100)
    throw Object.assign(
      Error("This workout has reached the 100-comment limit. Your draft is retained."),
      { status: 400 }
    );
  const description = withWorkoutCommentText(workout.description, result.comments);
  if (providerWorkoutDescription(description).length > 30000)
    throw Object.assign(
      Error("Workout comments exceed the Intervals.icu text limit. Your draft is retained."),
      { status: 400 }
    );
  if (description !== String(workout.description || "")) {
    try {
      await request(path, { method: "PUT", body: JSON.stringify({ description }) });
    } catch (error) {
      if (error.status >= 400 && error.status < 500) throw error;
    }
  }
  const verified = await request(path);
  if (
    verified.description !== description ||
    JSON.stringify(verified.workout_doc?.steps ?? []) !==
      JSON.stringify(workout.workout_doc?.steps ?? [])
  )
    throw Object.assign(
      Error(
        "Intervals.icu did not confirm the comments and unchanged device intervals. Your draft is retained; reload before retrying."
      ),
      { status: 502 }
    );
  return {
    ...(result.comment || {}),
    comments: result.comments,
    workout_id: input.workoutId,
    verified: true,
  };
}
