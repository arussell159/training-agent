export type CalendarMetricKey =
  | "weight"
  | "sleepHours"
  | "sleepQuality"
  | "fatigue"
  | "soreness"
  | "stress"
  | "yesterdayTraining"
  | "overallFeeling"
  | "restingHR"
  | "muscleMass"
  | "bodyFat"
  | "deepSleepHours"
  | "remSleepHours"
  | "hrv";
export type CalendarMetricEntry = {
  value: number | string | null;
  time: string | null;
  source: "manual" | "intervals" | "unavailable";
};
export type CalendarMetricRow = {
  date: string;
  revision: string;
  entries: Record<CalendarMetricKey, CalendarMetricEntry>;
  note: string;
  recordExists: boolean;
  providerUpdated: string | null;
  source: "intervals";
  locked: boolean;
  verified?: boolean;
  replayed?: boolean;
};
export type CalendarMetricChange = { value: number | string | null; time: string | null } | null;
export const calendarMetricFields: Array<{
  key: CalendarMetricKey;
  label: string;
  kind: "number" | "select";
  unit: string;
  min?: number;
  max?: number;
  step?: "any" | number;
  options?: string[];
}>;
export function isCalendarMetricsEntries(
  value: unknown
): value is Record<CalendarMetricKey, CalendarMetricEntry>;
