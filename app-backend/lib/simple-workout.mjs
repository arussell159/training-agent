import { newStep, validateWorkout } from "./workout-editor-model.mjs";
import { validatePlannedValues } from "./planned-workout-values.mjs";

// A simple session has no intensity prescription. Its duration/distance still
// has a native device step, so it can follow the same verified export path.
export function simpleWorkoutModel({ name, sport, date, description = "", values = {} }) {
  validatePlannedValues(values);
  const duration = values.duration_seconds;
  const distance = values.distance_meters;
  if (!(duration > 0) && !(distance > 0))
    throw Error("Enter a duration or distance, or build a workout.");
  const step = {
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
    steps: [step],
  };
  const errors = validateWorkout(model);
  if (errors.length) throw Error(errors.join(". "));
  return model;
}
