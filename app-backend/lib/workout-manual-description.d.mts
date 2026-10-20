import type { WorkoutModel } from "./workout-editor-model.mjs";
export function readManualWorkoutDescription(
  event:
    | {
        description?: unknown;
        workout_doc?: { steps?: unknown[] } | null;
        [key: string]: unknown;
      }
    | null
    | undefined,
  originalModel?: WorkoutModel | null
): string;
export function hasManualWorkoutDescription(description: unknown): boolean;
export function withManualWorkoutDescription(description: string, nativeSuffix?: string): string;
export function serializeManualWorkout(model: WorkoutModel, description: string): string;
