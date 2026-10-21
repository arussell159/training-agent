import type { WorkoutModel } from "./workout-editor-model.mjs";
export type WorkoutGeneratorInput = {
  date: string;
  sport: string;
  variant?: WorkoutModel["variant"];
  intensity:
    | "percentOfFtp"
    | "percentOfMaxHr"
    | "percentOfThresholdHr"
    | "percentOfThresholdPace"
    | "RPE";
  length: "duration" | "distance";
  target: "range" | "target";
  prompt: string;
};
export type WorkoutGeneratorResult = {
  model: WorkoutModel;
  warnings: string[];
  generated: true;
  saved: false;
};
export const workoutGeneratorIntensities: WorkoutGeneratorInput["intensity"][];
export const workoutGeneratorLengths: WorkoutGeneratorInput["length"][];
export const workoutGeneratorTargets: WorkoutGeneratorInput["target"][];
export function validateWorkoutGeneratorInput(input: unknown): WorkoutGeneratorInput;
export function isWorkoutGeneratorResult(
  value: unknown,
  input: WorkoutGeneratorInput
): value is WorkoutGeneratorResult;
