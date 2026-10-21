import type { WorkoutModel } from "./workout-editor-model.mjs";
export function simpleWorkoutModel(input: {
  name: string;
  sport: string;
  date: string;
  description?: string;
  unstructured?: boolean;
  variant?: WorkoutModel["variant"];
  values?: { duration_seconds?: number | null; distance_meters?: number | null };
}): WorkoutModel;
