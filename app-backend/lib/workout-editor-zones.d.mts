import type { Target } from "./workout-editor-model.mjs";
export type SportZoneSettings = {
  types?: string[];
  type?: string;
  ftp?: number;
  threshold_pace?: number;
  power_zones?: number[];
  pace_zones?: number[];
  power_zone_names?: string[];
  pace_zone_names?: string[];
};
export function sportZoneSettings(
  settings: SportZoneSettings[],
  sport: string
): SportZoneSettings | undefined;
export function workoutZoneOptions(
  settings: SportZoneSettings[],
  sport: string,
  preferredUnit?: string
): { id: string; label: string; target: Target }[];
