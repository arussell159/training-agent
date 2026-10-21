// Fenced metadata is ignored by the Intervals workout parser. Keep optional
// planned totals on the event itself without changing its device intervals.
const marker = "\n\n```training-agent-planned-values-v1\n";
const block = /\n\n```training-agent-planned-values-v1\n[^]*?\n```/g;
export const plannedValueFields = [
  "duration_seconds",
  "distance_meters",
  "average_speed",
  "average_power",
  // App-owned planned NP; completed/native power fields are not writable aliases.
  "normalized_power",
  "calories",
  "elevation_gain",
  "elevation_loss",
  "tss",
  "intensity_factor",
  "work_kj",
];
export function validatePlannedValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw Error("Enter planned workout values.");
  for (const [key, value] of Object.entries(values)) {
    if (
      !plannedValueFields.includes(key) ||
      (value !== null &&
        (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e8))
    )
      throw Error(`Invalid planned value: ${key}`);
    if (value !== null && key === "intensity_factor" && value > 5)
      throw Error("IF must be between 0 and 5.");
    if (
      value !== null &&
      key === "duration_seconds" &&
      (!Number.isInteger(value) || value > 604800)
    )
      throw Error("Duration must be whole seconds, up to seven days.");
    if (value !== null && key === "tss" && !Number.isInteger(value))
      throw Error("TSS must be a whole number.");
  }
  return values;
}
export function readPlannedValues(description) {
  const text = String(description || ""),
    index = text.indexOf(marker);
  if (index < 0) return {};
  try {
    return validatePlannedValues(JSON.parse(text.slice(index + marker.length).split("\n```")[0]));
  } catch {
    return {};
  }
}
export function stripPlannedValues(description) {
  return String(description || "").replace(block, "");
}
export function withPlannedValues(description, values) {
  validatePlannedValues(values);
  const text = stripPlannedValues(description);
  return Object.keys(values).length ? `${text}${marker}${JSON.stringify(values)}\n\`\`\`` : text;
}
