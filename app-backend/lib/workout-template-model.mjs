const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const workoutTemplateScope = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const workoutTemplateOperation = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const workoutTemplateFolderId = (value) =>
  typeof value === "string" &&
  /^folder:[1-9]\d*$/.test(value) &&
  Number.isSafeInteger(Number(value.slice(7)));
export const workoutTemplateId = (value) =>
  typeof value === "string" && /^library:[1-9]\d*$/.test(value);
export function validateWorkoutTemplateInput(input) {
  const errors = [];
  if (
    !object(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "accountScope",
          "sourceRevision",
          "folderId",
          "folderRevision",
          "title",
          "operationId",
          "reconcileOnly",
        ].includes(key)
    )
  )
    return ["Enter a valid library save request."];
  if (!workoutTemplateScope(input.accountScope)) errors.push("Reload the library account.");
  if (!workoutTemplateScope(input.sourceRevision)) errors.push("Reload the saved workout.");
  if (!workoutTemplateFolderId(input.folderId) || !workoutTemplateScope(input.folderRevision))
    errors.push("Select a current workout library folder.");
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 128)
    errors.push("Enter a workout title of 1–128 characters.");
  if (!workoutTemplateOperation(input.operationId))
    errors.push("Retain a valid library save identity.");
  if (input.reconcileOnly !== undefined && typeof input.reconcileOnly !== "boolean")
    errors.push("Choose a valid save recheck.");
  return errors;
}
