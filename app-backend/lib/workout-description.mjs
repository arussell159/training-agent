import {
  readPlannedValues,
  stripPlannedValues,
  withPlannedValues,
} from "./planned-workout-values.mjs";
import {
  readWorkoutCommentText,
  stripWorkoutCommentText,
  withWorkoutCommentText,
} from "./workout-comment-text.mjs";
import {
  hasManualWorkoutDescription,
  withManualWorkoutDescription,
} from "./workout-manual-description.mjs";
export const DEFINITION_MARKER = "\n\nIntervals.icu device definition:\n";
export async function updateWorkoutDescription(request, id, description, options = {}) {
  if (typeof description !== "string" || description.length > 30000)
    throw Error("Description must be text under 30,000 characters");
  const match = String(id).match(/^(event|activity):(i?\d+)$/);
  if (!match || (match[1] === "event" && !/^\d+$/.test(match[2])))
    throw Error("Invalid Intervals.icu workout");
  const path = match[1] === "event" ? `/athlete/0/events/${match[2]}` : `/activity/${match[2]}`;
  const existing = await request(path);
  let suffix = "";
  if (match[1] === "event") {
    const original = stripPlannedValues(stripWorkoutCommentText(existing.description)),
      index = original.indexOf(DEFINITION_MARKER);
    if (index >= 0) suffix = original.slice(index);
    else if (existing.workout_doc?.steps?.length) suffix = DEFINITION_MARKER + original;
  }
  const providerText = withWorkoutCommentText(
    withPlannedValues(
      match[1] === "event" &&
        (options.descriptionMode === "manual" || hasManualWorkoutDescription(existing.description))
        ? withManualWorkoutDescription(description, suffix)
        : description + suffix,
      match[1] === "event" ? readPlannedValues(existing.description) : {}
    ),
    readWorkoutCommentText(existing.description, id, true)
  );
  if (providerText.length > 30000)
    throw Error("Workout text exceeds 30,000 characters. Your draft is retained.");
  if (existing.description !== providerText) {
    try {
      await request(path, { method: "PUT", body: JSON.stringify({ description: providerText }) });
    } catch (error) {
      if (error.status >= 400 && error.status < 500) throw error;
    }
  }
  const verified = await request(path);
  if (verified.description !== providerText)
    throw Error("Intervals.icu did not confirm the description. Refresh before retrying.");
  if (
    existing.workout_doc?.steps?.length &&
    JSON.stringify(existing.workout_doc.steps) !== JSON.stringify(verified.workout_doc?.steps)
  )
    throw Error(
      "Description saved but the workout structure needs verification. Refresh before making another change."
    );
  return { id, description, verified: true };
}
