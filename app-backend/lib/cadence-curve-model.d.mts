export const cadenceNativeSports: readonly string[];
export const CADENCE_GRID_SECONDS: readonly number[];
export function cadenceSourceMatches(native: string, selected: string): boolean;
export type CadenceCurveSelection = {
  kind: "cadence";
  sport: string;
  nativeTypes: string[];
  start: string;
  end: string;
};
export function cadenceCurveSelection(input: unknown, today: string): CadenceCurveSelection;
export type CadenceCurvePoint = {
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
export type CadenceCurveResult = {
  version: 1;
  kind: "cadence";
  unit: "rpm";
  source: "intervals-activity-cadence-curves";
  unitPolicy: "native-rpm";
  tagsSupported: false;
  selection: { sport: string; nativeTypes: string[] };
  window: { oldest: string; newest: string };
  points: CadenceCurvePoint[];
  coverage: {
    status: "available-recordings" | "partial";
    inventoryRecords: number;
    eligibleRecordings: number;
    fetchedRecordings: number;
    failedRecordings: number;
    missingRecordings: number;
    skippedForCap: number;
    excludedWithoutCadence: number;
    unknownPoints: number;
  };
  warning: string;
};
