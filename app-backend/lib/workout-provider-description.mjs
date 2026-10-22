import {
  readWorkoutCommentText,
  renderedWorkoutComments,
  stripRenderedWorkoutComments,
} from "./workout-comment-text.mjs";
// Pure shared projection: internal envelopes never belong in provider prose.
export const workoutMetadataEnvelopes =
  /\r?\n\r?\n```(?:\r?\nWorkout editor v1\r?\n|training-agent-(?:manual-description|planned-values|workout-comments)-v1\r?\n)[^]*?\r?\n```/g;
export function providerWorkoutDescription(description) {
  const original = String(description ?? "");
  const normalized = original.replaceAll("\r\n", "\n");
  const comments = readWorkoutCommentText(normalized, "event:1");
  const clean = original.replace(workoutMetadataEnvelopes, "");
  return comments.length
    ? stripRenderedWorkoutComments(clean) +
        renderedWorkoutComments(comments, original.includes("\r\n") ? "\r\n" : "\n")
    : clean;
}
