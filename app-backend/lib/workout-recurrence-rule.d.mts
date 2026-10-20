export type WorkoutRecurrenceRule = {
  frequency: "daily" | "weekly"
  interval: number
  weekdays: number[]
  startDate: string
  end: { type: "count"; count: number } | { type: "until"; until: string }
}
export function normalizeRecurrenceRule(input: unknown): WorkoutRecurrenceRule
export function recurrenceDates(input: unknown): string[]
