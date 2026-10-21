import { workoutSports, validateWorkout, expandSteps } from "./workout-editor-model.mjs";
export const workoutGeneratorIntensities = [
  "percentOfFtp",
  "percentOfMaxHr",
  "percentOfThresholdHr",
  "percentOfThresholdPace",
  "RPE",
];
export const workoutGeneratorLengths = ["duration", "distance"];
export const workoutGeneratorTargets = ["range", "target"];
export function validateWorkoutGeneratorInput(input) {
  const fail = (message) => {
    throw Object.assign(Error(message), { status: 400, code: "GENERATOR_INVALID_INPUT" });
  };
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        !["date", "sport", "variant", "intensity", "length", "target", "prompt"].includes(key)
    )
  )
    fail("Choose valid workout generator options.");
  const date = new Date(`${input.date}T12:00:00Z`);
  if (
    typeof input.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.date
  )
    fail("Choose a valid workout date.");
  if (!workoutSports.includes(input.sport)) fail("Choose a supported workout sport.");
  if (
    input.variant !== undefined &&
    (input.sport !== "Other" || !["brick", "day-off", "custom"].includes(input.variant))
  )
    fail("Choose a valid workout presentation category.");
  if (
    !workoutGeneratorIntensities.includes(input.intensity) ||
    !workoutGeneratorLengths.includes(input.length) ||
    !workoutGeneratorTargets.includes(input.target)
  )
    fail("Choose valid workout generator options.");
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 1000)
    fail("Describe a workout in 1–1,000 characters.");
  return { ...input, prompt: input.prompt.trim() };
}
export function isWorkoutGeneratorResult(value, input) {
  try {
    const expected = validateWorkoutGeneratorInput(input);
    const target = {
      percentOfFtp: ["power", "%ftp"],
      percentOfMaxHr: ["hr", "%hr"],
      percentOfThresholdHr: ["hr", "%lthr"],
      percentOfThresholdPace: ["pace", "%pace"],
      RPE: ["rpe", "rpe"],
    }[expected.intensity];
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) =>
        ["model", "warnings", "generated", "saved"].includes(key)
      ) &&
      value.generated === true &&
      value.saved === false &&
      Array.isArray(value.warnings) &&
      value.warnings.length <= 10 &&
      value.warnings.every((message) => typeof message === "string" && message.length <= 500) &&
      typeof value.model?.name === "string" &&
      value.model.name.trim().length > 0 &&
      Object.keys(value.model).every((key) =>
        [
          "version",
          "name",
          "sport",
          "date",
          "notes",
          "poolLength",
          "steps",
          "variant",
          "thresholds",
        ].includes(key)
      ) &&
      !value.model.unstructured &&
      value.model.steps?.length > 0 &&
      !validateWorkout(value.model).length &&
      expandSteps(value.model.steps).length <= 1000 &&
      expandSteps(value.model.steps).every(
        ({ step }) =>
          step.end.kind === (expected.length === "duration" ? "time" : "distance") &&
          (step.target.kind === "none"
            ? step.role === "rest"
            : step.target.kind === target[0] &&
              step.target.unit === target[1] &&
              step.target.mode === (expected.target === "range" ? "range" : "single"))
      ) &&
      value.model.date === expected.date &&
      value.model.sport === expected.sport &&
      value.model.variant === expected.variant
    );
  } catch {
    return false;
  }
}
