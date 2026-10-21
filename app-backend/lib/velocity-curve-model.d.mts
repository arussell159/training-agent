export const velocityNativeSports: readonly string[];
export const VELOCITY_GRID_SECONDS: readonly number[];
export function velocitySourceMatches(native: string, selected: string): boolean;
export type VelocityCurveSelection = {
  kind: "velocity";
  sport: string;
  nativeTypes: string[];
  start: string;
  end: string;
};
export function velocityCurveSelection(input: unknown, today: string): VelocityCurveSelection;
export type VelocityCurvePoint = {
  duration_seconds: number;
  value: number | null;
  activity_id: string;
  native_type: string;
  date: string;
  name: string | null;
  estimated: false;
  start_index?: number;
  end_index?: number;
};
export type VelocityCurveResult = {
  version: 1;
  kind: "velocity";
  unit: "m/s";
  source: "intervals-activity-velocity-curves";
  unitPolicy: "native-velocity-smooth";
  valuePolicy: "native-reported";
  tagsSupported: false;
  selection: { sport: string; nativeTypes: string[] };
  window: { oldest: string; newest: string };
  points: VelocityCurvePoint[];
  coverage: {
    status: "available-recordings" | "partial";
    inventoryRecords: number;
    eligibleRecordings: number;
    fetchedRecordings: number;
    failedRecordings: number;
    missingRecordings: number;
    skippedForCap: number;
    excludedWithoutVelocity: number;
    excludedIgnoredRecordings: number;
    unknownPoints: number;
  };
  warning: string;
};
