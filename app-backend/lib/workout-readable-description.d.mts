import type { WorkoutModel } from "./workout-editor-model.mjs";
import type { SportZoneSettings } from "./workout-editor-zones.mjs";
export function formatWorkoutDescription(
  model: WorkoutModel,
  settings?: SportZoneSettings[]
): string;
export function eventWorkoutDescription(
  event: Record<string, unknown>,
  settings?: SportZoneSettings[]
): string | null;
export function appWorkoutDescription(
  workout: {
    app_description_version?: number;
    details?: string;
    editor_model?: WorkoutModel;
    raw?: Record<string, unknown>;
    sport?: string;
    title?: string;
    workout_date?: string;
    status?: string;
    structure?: string | null;
  },
  settings?: SportZoneSettings[]
): string | null;
