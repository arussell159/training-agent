import type { StrengthParameter, StrengthBlock } from "./workout-strength-model.mjs";
export type StrengthMuscleGroup =
  | "None"
  | "Abs"
  | "Biceps"
  | "Calves"
  | "Chest"
  | "Forearms"
  | "Glute"
  | "Hamstrings"
  | "Lower Back"
  | "Quads"
  | "Shoulders"
  | "Triceps"
  | "Upper Back";
export type StrengthExerciseDefinition = {
  title: string;
  muscleGroup: StrengthMuscleGroup;
  instructions: string;
  videoUrl: string;
  parameters: StrengthParameter[];
};
export type StrengthLibraryExercise = StrengthExerciseDefinition & {
  id: string;
  revision: string;
  accountScope: string;
  owner: "me";
  editable: boolean;
  createdAt: string;
  updatedAt: string;
};
export const strengthMuscleGroups: StrengthMuscleGroup[];
export function strengthLibraryId(value: unknown): string;
export function strengthExerciseVideo(
  value: unknown
): { provider: "youtube" | "vimeo"; id: string; url: string; embedUrl: string } | null;
export function newStrengthExerciseDefinition(): StrengthExerciseDefinition;
export function validateStrengthExerciseDefinition(value: unknown): StrengthExerciseDefinition;
export function strengthLibraryExerciseBlock(value: StrengthLibraryExercise): StrengthBlock;
export function isStrengthLibraryExercise(value: unknown): value is StrengthLibraryExercise;
