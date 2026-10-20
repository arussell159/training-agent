import { apiFetch } from "./api-client"
import { rememberTrainingContext, revalidateTrainingContext, type TrainingContext } from "./training-context"
import { randomId } from "./random-id"
import type { WorkoutRecurrenceRule } from "../../../app-backend/lib/workout-recurrence-rule.mjs"
export type { WorkoutRecurrenceRule }
export type WorkoutRecurrenceDraft = {
  operationId: string
  rule: WorkoutRecurrenceRule
  revision?: number
  fromDate?: string
}
export type WorkoutRecurrenceSeries = {
  id: string
  sourceId: string
  rule: WorkoutRecurrenceRule
  revision: number
  status: "active" | "scheduling" | "cancelling" | "cancelled"
  pendingOperationId: string | null
  pendingAction: "schedule" | "cancel" | null
  pendingFromDate: string | null
  error: string | null
  remaining: number
  protectedCount: number
  occurrences: { date: string; workoutId: string | null; state: string }[]
}
type Receipt = {
  series: WorkoutRecurrenceSeries | null
  verified?: boolean
  context?: TrainingContext
  error?: string
  refreshWarning?: string
}
const route = (id: string) => `/api/workouts/${encodeURIComponent(id)}/recurrence`
export async function loadWorkoutRecurrence(id: string, signal?: AbortSignal) {
  const response = await apiFetch(route(id), { signal, cache: "no-store" })
  const result = await response.json() as Receipt
  if (!response.ok) throw new Error(result.error || "The repeat schedule could not be loaded.")
  return result.series
}
export async function applyWorkoutRecurrence(
  id: string,
  draft: WorkoutRecurrenceDraft,
  options: { cancel?: boolean; onProgress?: (series: WorkoutRecurrenceSeries) => void } = {}
) {
  for (let batch = 0; batch < 30; batch++) {
    const response = await apiFetch(route(id), {
      method: options.cancel ? "DELETE" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
      signal: AbortSignal.timeout(120_000),
    })
    const result = await response.json() as Receipt
    if (!response.ok || !result.series) throw new Error(result.error || "The repeat schedule could not be confirmed. Recheck this same request.")
    if (result.context) rememberTrainingContext(result.context, "full")
    options.onProgress?.(result.series)
    if (result.verified) {
      if (!result.context) void revalidateTrainingContext().catch(() => {})
      window.dispatchEvent(new CustomEvent("workout-recurrence-updated", { detail: { id, series: result.series } }))
      return result.series
    }
    if (result.series.error) throw new Error(result.series.error)
  }
  throw new Error("Some repeats are still pending. Recheck this same request to finish.")
}
export function recurrenceDraft(series: WorkoutRecurrenceSeries): WorkoutRecurrenceDraft {
  return {
    operationId: series.pendingOperationId || randomId(),
    rule: series.rule,
    revision: series.revision,
    ...(series.pendingFromDate ? { fromDate: series.pendingFromDate } : {}),
  }
}
