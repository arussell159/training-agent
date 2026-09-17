import type { Target, WorkoutModel } from "./workout-editor-model.mjs";
import type { SportZoneSettings } from "./workout-editor-zones.mjs";
export function parseDurationInput(text: string): number | null;
export function durationClock(value: number): string;
export function editorUnits(sport: string): {
  kind: "power" | "pace";
  target: string;
  label: string;
  distance: string;
  distanceLabel: string;
};
export function editorTarget(
  target: Target,
  sport: string,
  settings?: SportZoneSettings[],
  thresholds?: WorkoutModel["thresholds"]
): Target | null;
