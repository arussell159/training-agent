export type ChartTagKind = "heartRate" | "power" | "cadence" | "velocity";
export const chartTagKinds: readonly ChartTagKind[];
export const chartTagNativeSports: readonly string[];
export function chartTagSportMatches(native: string, selected: string): boolean;
export function validChartTag(value: unknown): value is string;
export type ChartTagCatalog = {
  version: 1;
  source: "intervals-activity-tags";
  accountScope: string;
  revision: string;
  checkedAt: string;
  tags: string[];
};
export type TaggedCurveSelection = {
  kind: ChartTagKind;
  sport: string;
  nativeTypes: string[];
  start: string;
  end: string;
  tags: string[];
  tagScope: string;
  tagRevision: string;
};
export function parseChartTagFilter(input: Record<string, unknown>): {
  tags: string[];
  tagScope?: string;
  tagRevision?: string;
};
export function taggedCurveSelection(input: unknown, today: string): TaggedCurveSelection;
export const chartTagKindPolicy: Record<
  ChartTagKind,
  {
    unit: "bpm" | "W" | "rpm" | "m/s";
    unitPolicy: "native-bpm" | "native-watts" | "native-rpm" | "native-velocity-smooth";
    stream: string;
    ignore: string | null;
    part: string | null;
  }
>;
export function chartTagError(message?: string, status?: number, code?: string): never;
export type TaggedCurvePoint = {
  duration_seconds: number;
  value: number | null;
  activity_id: string;
  native_type: string;
  date: string;
  name: string | null;
  estimated: false;
  sourceTags: string[];
  start_index?: number;
  end_index?: number;
};
export type TaggedCurveCoverage = {
  status: "available-recordings" | "partial";
  inventoryRecords: number;
  matchedRecordings: number;
  unmatchedRecordings: number;
  unknownMembershipRecordings: number;
  eligibleRecordings: number;
  excludedWithoutStream: number;
  excludedIgnoredRecordings: number;
  fetchedRecordings: number;
  failedRecordings: number;
  missingRecordings: number;
  skippedForCap: number;
  unknownPoints: number;
  invalidInventoryRecords: number;
  conflictingRecordings: number;
};
export type TaggedCurveResult = {
  version: 2;
  kind: ChartTagKind;
  unit: "bpm" | "W" | "rpm" | "m/s";
  source: "intervals-tagged-activity-curves";
  unitPolicy: "native-bpm" | "native-watts" | "native-rpm" | "native-velocity-smooth";
  valuePolicy: "native-reported";
  tagsSupported: true;
  accountScope: string;
  catalogRevision: string;
  selection: { sport: string; nativeTypes: string[]; tags: string[]; tagMatch: "any" };
  window: { oldest: string; newest: string };
  points: TaggedCurvePoint[];
  coverage: TaggedCurveCoverage;
  warning: string;
};
