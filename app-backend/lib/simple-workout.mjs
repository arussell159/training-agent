import { newStep, validateWorkout } from "./workout-editor-model.mjs";
import { validatePlannedValues } from "./planned-workout-values.mjs";

// Positive simple-session targets retain their untargeted native step. A blank
// or explicitly freeform plan has no executable device intervals at all.
export function simpleWorkoutModel({
  name,
  sport,
  date,
  description = "",
  values = {},
  unstructured = false,
  variant,
}) {
  validatePlannedValues(values);
  const duration = values.duration_seconds;
  const distance = values.distance_meters;
  if (typeof unstructured !== "boolean") throw Error("Choose a valid workout structure mode.");
  const freeform = unstructured || (!(duration > 0) && !(distance > 0));
  const step = freeform
    ? null
    : {
        ...newStep(sport),
        label: "Session",
        target: { kind: "none" },
        end:
          duration > 0
            ? { kind: "time", value: duration, unit: "s" }
            : { kind: "distance", value: distance, unit: /swim/i.test(sport) ? "yd" : "m" },
      };
  const model = {
    version: 1,
    name,
    sport,
    date,
    notes: description,
    poolLength: sport === "Swim" ? "25y" : "",
    steps: freeform ? [] : [step],
    ...(freeform ? { unstructured: true } : {}),
    ...(variant !== undefined ? { variant } : {}),
  };
  const errors = validateWorkout(model);
  if (errors.length) throw Error(errors.join(". "));
  return model;
}
