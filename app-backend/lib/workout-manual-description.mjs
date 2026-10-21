import { stripPlannedValues } from "./planned-workout-values.mjs";
import { stripWorkoutCommentText } from "./workout-comment-text.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import { STRENGTH_MARKER } from "./workout-strength-model.mjs";
import {
  DEFINITION_MARKER,
  importWorkout,
  readEditorModel,
  readableDescription,
  serializeWorkout,
  workoutDefinitionSuffix,
} from "./workout-editor-model.mjs";

// Keep an explicit choice to leave Description blank separate from a legacy
// generated outline. This block, like editor data, is ignored by device parsers.
const marker = "\n\n```training-agent-manual-description-v1\n";
const block = /\n\n```training-agent-manual-description-v1\n[^]*?\n```/g;
const strip = (description) =>
  providerWorkoutDescription(stripPlannedValues(stripWorkoutCommentText(description))).replace(
    block,
    ""
  );

function displayedText(description) {
  // The provider's parser ignores fenced text. Never allow prose containing
  // native-looking instructions or a code fence to add an executable step.
  return description
    .replaceAll("```", "'''")
    .replaceAll(DEFINITION_MARKER, "\n\nIntervals.\u200bicu device definition:\n");
}
function manualRecord(description) {
  const text = String(description || ""),
    index = text.indexOf(marker);
  if (index < 0) return null;
  try {
    const value = JSON.parse(text.slice(index + marker.length).split("\n```")[0]);
    return typeof value.text === "string" ? value : null;
  } catch {
    return null;
  }
}
export function hasManualWorkoutDescription(description) {
  return manualRecord(description) !== null;
}

export function readManualWorkoutDescription(event, originalModel) {
  const description = String(event?.description || "");
  const source = strip(description);
  const strengthModel = readEditorModel(description);
  if (strengthModel?.strength) {
    const generated = providerWorkoutDescription(serializeWorkout(strengthModel));
    const exactGenerated = source.endsWith(generated);
    const prefix = exactGenerated
      ? source.slice(0, -generated.length)
      : source.split(STRENGTH_MARKER)[0];
    const head = readableDescription(prefix),
      record = manualRecord(description);
    return record &&
      (head === displayedText(record.text) ||
        (exactGenerated && !prefix && record.text === strengthModel.notes))
      ? record.text
      : head;
  }
  const head = readableDescription(source);
  const record = manualRecord(description);
  if (record) {
    // Prefer a visible description edited directly in Intervals.icu over an
    // older app metadata copy. Lossless text only restores our fence escaping.
    return head === displayedText(record.text) ? record.text : head;
  }
  if (originalModel) {
    try {
      if (head === readableDescription(serializeWorkout(originalModel)))
        return originalModel.notes || "";
    } catch {
      // Cached models can be from an older unsupported editor version.
    }
  }
  if (source.includes(DEFINITION_MARKER)) {
    try {
      const imported = importWorkout(event);
      if (!imported.issues.length && head === readableDescription(serializeWorkout(imported.model)))
        return imported.model.notes || "";
    } catch {
      // Reading human prose must remain available on unsupported workouts.
    }
    return head;
  }
  if (!event?.workout_doc?.steps?.length)
    return readEditorModel(description)?.unstructured ? head : source;
  // Native Intervals workouts mix prose with executable lines. Keep the prose
  // without copying those old instructions into the manually edited field.
  // Preserve line breaks and headings rather than dropping whole paragraphs.
  return source
    .split("\n")
    .filter(
      (line) =>
        !/^\s*(?:\d+x\s*$|Pool length:)/i.test(line) &&
        !/^\s*-\s+(?:Press lap\s+)?(?:[^\n]*?\s)?\d+(?:\.\d+)?\s*(?:[hms]|mtr|meters|yards|yrd|km|mi|y)\b/i.test(
          line
        )
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function withManualWorkoutDescription(
  description,
  nativeSuffix = "",
  { includeVisible = true } = {}
) {
  if (typeof description !== "string" || description.length > 30000)
    throw Error("Enter a description under 30,000 characters.");
  // Store the original text in an inert block so even embedded code fences and
  // device-marker text round-trip exactly through the editable field.
  const record = JSON.stringify({ text: description }).replaceAll("`", "\\u0060");
  const visible =
    includeVisible && (description || nativeSuffix.includes(DEFINITION_MARKER))
      ? `\`\`\`\n${displayedText(description)}\n\`\`\``
      : "";
  const text = `${visible}${nativeSuffix.replace(block, "")}${marker}${record}\n\`\`\``;
  if (providerWorkoutDescription(text).length > 30000)
    throw Error("Workout text exceeds the 30,000 character export limit.");
  return text;
}

export function serializeManualWorkout(model, description) {
  const serialized = serializeWorkout(model, { checkProviderLength: false });
  return withManualWorkoutDescription(
    description,
    model.strength ? serialized : workoutDefinitionSuffix(serialized),
    { includeVisible: !model.strength || description !== model.notes }
  );
}
