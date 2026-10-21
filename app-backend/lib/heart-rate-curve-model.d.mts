export type HeartRateCurveSelection = {
  kind: "heartRate";
  sport: string;
  nativeTypes: string[];
  start: string;
  end: string;
};
export type HeartRateCurvePoint = {
  duration_seconds: number;
  value: number | null;
  activity_id: string | null;
  native_type: string | null;
  date: string | null;
  name: string | null;
  estimated: false;
  start_index?: number;
  end_index?: number;
};
export type HeartRateCurveResult = {
  version: 1;
  kind: "heartRate";
  unit: "bpm";
  source: "intervals-hr-curve";
  selection: { sport: string; nativeTypes: string[] };
  window: { oldest: string; newest: string };
  points: HeartRateCurvePoint[];
  coverage: {
    status: "native-aggregate" | "partial";
    inventoryRecords: number;
    verifiedPoints: number;
    unknownPoints: number;
    failedSelections: string[];
  };
  warning: string | null;
};
export const heartRateNativeSports: readonly string[];
export function heartRateCurveSelection(input: unknown, today: string): HeartRateCurveSelection;
export function heartRateSportMatches(native: string, selected: string): boolean;
