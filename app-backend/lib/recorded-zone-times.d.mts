export type RecordedZoneTimes = {
  basis: "power" | "speed" | "gap-speed";
  unit: "%ftp" | "%threshold-speed";
  boundaries_percent: number[];
  seconds: number[];
  /** Historical watts for power, metres/second for speed; never current settings. */
  threshold: number | null;
};
export function validRecordedZoneTimes(value: unknown): value is RecordedZoneTimes;
export function recordedZoneTimes(
  activity: unknown,
  kind: "power" | "pace"
): RecordedZoneTimes | null;
