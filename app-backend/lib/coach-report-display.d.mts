export type CoachReportKind = "pre_workout" | "post_workout" | "weekly" | "block";
export type CoachReportFilter = "all" | CoachReportKind;
export type DisplayReport = {
  kind: CoachReportKind;
  title: string;
  sport?: string | null;
  startDate: string;
  endDate: string;
};
export const REPORT_FILTERS: ReadonlyArray<{ value: CoachReportFilter; label: string }>;
export function filterCoachReports<T extends DisplayReport>(reports: T[], filter?: CoachReportFilter, query?: string): T[];
export function reportDisplayTitle(report: DisplayReport): string;
export function reportPeriodLabel(report: DisplayReport): string;
export function groupWorkoutReportsByWeek<T extends DisplayReport & { generatedAt?: string }>(reports: T[]): Array<{ startDate: string; label: string; reports: T[] }>;
