export function validReportDate(value: unknown): boolean;
export function shiftReportDate(value: string, days: number): string;
export function planReportBlocks<T extends { startDate: string; endDate: string; phase: string }>(
  plan: { weeks: T[] } | null | undefined
): Array<{ startDate: string; endDate: string; phase: string; weeks: T[] }>;
