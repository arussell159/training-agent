import type { PlannedWorkout } from "../../ui/src/lib/training-context";
export type WorkoutTemplateFolder = {
  id: string;
  name: string;
  revision: string;
  editable: boolean;
};
export type WorkoutTemplateFolders = {
  accountScope: string;
  readOnly: boolean;
  folders: WorkoutTemplateFolder[];
};
export type WorkoutTemplateInput = {
  accountScope: string;
  sourceRevision: string;
  folderId: string;
  folderRevision: string;
  title: string;
  operationId: string;
  reconcileOnly?: boolean;
};
export type WorkoutTemplateIntent = {
  sourceWorkoutId: string;
  sourceRevision: string;
  folderId: string;
  folderRevision: string;
  title: string;
};
export type WorkoutTemplateResult = {
  accountScope: string;
  operationId: string;
  verified: true;
  workoutId: string;
  workout: PlannedWorkout;
  intent: WorkoutTemplateIntent;
};
export type WorkoutTemplateInspection = {
  accountScope: string;
  operationId: string;
  status: "saved" | "changed" | "deleted" | "unconfirmed" | "rejected";
  workoutId: string | null;
  workout: PlannedWorkout | null;
  intent: WorkoutTemplateIntent;
};
export function workoutTemplateScope(value: unknown): value is string;
export function workoutTemplateOperation(value: unknown): value is string;
export function workoutTemplateFolderId(value: unknown): value is string;
export function workoutTemplateId(value: unknown): value is string;
export function validateWorkoutTemplateInput(input: unknown): string[];
