export type RecordedAnalysisThresholds = {
  version: 1;
  source: "intervals-activity";
  ftp: number | null;
  powerZones: number[];
  thresholdPace: number | null;
  paceZones: number[];
};
export function recordedAnalysisThresholds(activity: unknown): RecordedAnalysisThresholds;
export function validRecordedAnalysisThresholds(value: unknown): value is RecordedAnalysisThresholds;
export function historicalAnalysisThresholds(summary: unknown): RecordedAnalysisThresholds | null;
