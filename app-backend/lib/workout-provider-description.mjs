// Pure shared projection: internal envelopes never belong in provider prose.
export const workoutMetadataEnvelopes =
  /\r?\n\r?\n```(?:\r?\nWorkout editor v1\r?\n|training-agent-(?:manual-description|planned-values|workout-comments)-v1\r?\n)[^]*?\r?\n```/g;
export function providerWorkoutDescription(description) {
  return String(description ?? "").replace(workoutMetadataEnvelopes, "");
}
