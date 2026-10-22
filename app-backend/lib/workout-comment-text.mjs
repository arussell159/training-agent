// Like planned totals, fenced comments stay with the provider event and are
// ignored by the device workout parser. No app-only copy is needed for recovery.
const marker = "\n\n```training-agent-workout-comments-v1\n";
const block = /\n\n```training-agent-workout-comments-v1\n[^]*?\n```/g;
const renderedBlock = /\r?\n\r?\n\[Workout comments\]\r?\n[^]*?\r?\n\[\/Workout comments\]/g;
export function stripRenderedWorkoutComments(description) {
  return String(description || "").replace(renderedBlock, "");
}
export function renderedWorkoutComments(comments, newline = "\n") {
  if (!comments.length) return "";
  // Quote every body line so an athlete's comment can never become a device
  // interval instruction, even when it contains dashes or code fences.
  const rows = comments.map((item) =>
    [
      `${item.type === "pre" ? "Pre-workout" : "Post-activity"} · ${item.created_at}`,
      ...item.body.split(/\r?\n/).map((line) => `> ${line.replaceAll("`", "ˋ")}`),
    ].join(newline)
  );
  return `${newline}${newline}[Workout comments]${newline}${rows.join(newline + newline)}${newline}[/Workout comments]`;
}
export function readWorkoutCommentText(description, workoutId, strict = false) {
  const text = String(description || ""),
    index = text.indexOf(marker);
  if (index < 0) return [];
  try {
    const comments = JSON.parse(text.slice(index + marker.length).split("\n```")[0]);
    if (
      !Array.isArray(comments) ||
      comments.length > 100 ||
      comments.some(
        (item) =>
          !item ||
          !/^[a-z0-9:_-]{1,200}$/i.test(item.id || "") ||
          !["pre", "post"].includes(item.type) ||
          typeof item.body !== "string" ||
          !item.body.trim() ||
          item.body.length > 2000 ||
          !Number.isFinite(Date.parse(item.created_at))
      )
    )
      throw Error("Invalid comments");
    return comments.map((item) => ({ ...item, workout_id: workoutId }));
  } catch {
    if (strict)
      throw Object.assign(
        Error(
          "Saved Intervals.icu comments could not be read. Reload before saving; your draft is retained."
        ),
        { status: 502 }
      );
    return [];
  }
}
export function stripWorkoutCommentText(description) {
  return stripRenderedWorkoutComments(String(description || "").replace(block, ""));
}
export function withWorkoutCommentText(description, comments) {
  const text = stripWorkoutCommentText(description);
  if (!comments.length) return text;
  const rows = comments.map(({ id, type, body, created_at }) => ({ id, type, body, created_at }));
  return `${text}${marker}${JSON.stringify(rows)}\n\`\`\``;
}
