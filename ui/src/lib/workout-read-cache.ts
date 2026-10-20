import { apiFetch } from "./api-client"
import { deviceCacheScope } from "./device-cache"
import { createSharedRequestCache } from "./shared-request-cache"
import { validatedTrainingWorkout } from "./training-context-validation"
import { validatedLibraryWorkout } from "./training-context-validation"
import { loadWorkspaceRead } from "./workspace-reads"
import { cachedTrainingContext, type PlannedWorkout } from "./training-context"
import type { ImportResult } from "../../../app-backend/lib/workout-editor-model.mjs"
import type { SportZoneSettings } from "../../../app-backend/lib/workout-editor-zones.mjs"
import type { WorkoutSummaryValues } from "./training-context"

export type WorkoutEditorRead = ImportResult & { revision: string; scheduledTime: string; zoneSettings?: SportZoneSettings[]; zoneError?: string; isNew?: boolean; plannedValues?: Partial<WorkoutSummaryValues>; initialComment?: string; comments?: { id: string; body: string }[]; descriptionOverride?: string; manualDescription?: string }

export type WorkoutComment = { id: string; body: string; workout_id: string; type?: string; comment_type?: string; created_at: string }
type PlannedValues = { revision: string; workout: PlannedWorkout }
type Comments = { comments: WorkoutComment[]; needsSync?: boolean }
const key = (id: string) => JSON.stringify([deviceCacheScope(), id, (cachedTrainingContext() as { version?: string }).version || ""])
const planned = createSharedRequestCache<PlannedValues>(async (cacheKey, signal) => {
  const [, id] = JSON.parse(cacheKey) as string[]
  const response = await apiFetch(`/api/workouts/${encodeURIComponent(id)}/planned-values`, { signal })
  const data = await response.json()
  if (!response.ok || !data.revision || data.workout?.id !== id) throw Error(data.error || "Planned values could not be loaded.")
  return { revision: data.revision, workout: validatedTrainingWorkout(data.workout) }
}, { maxEntries: 12, ttlMs: 15_000 })
const comments = createSharedRequestCache<Comments>(async (cacheKey, signal) => {
  const [, id] = JSON.parse(cacheKey) as string[]
  const response = await apiFetch(`/api/comments?${new URLSearchParams({ workoutId: id })}`, { signal })
  const data = await response.json()
  if (!response.ok || !Array.isArray(data.comments) || data.comments.some((item: WorkoutComment) => !item || typeof item.id !== "string" || typeof item.body !== "string" || item.workout_id !== id)) throw Error(data.error || "Comments could not be loaded.")
  return data as Comments
}, { maxEntries: 12, ttlMs: 15_000 })
export const cachedWorkoutValues = (id: string) => planned.peek(key(id))
export const loadWorkoutValues = (id: string, signal?: AbortSignal) => planned.get(key(id), signal)
export const loadWorkoutComments = (id: string, signal?: AbortSignal) => comments.get(key(id), signal)
const editors = createSharedRequestCache<WorkoutEditorRead>(async (cacheKey, signal) => {
  const [, url] = JSON.parse(cacheKey) as string[]
  const response = await apiFetch(url, { signal })
  const data = await response.json()
  if (!response.ok || !data.revision || !data.model || !Array.isArray(data.model.steps)) throw Error(data.error || "Could not load the workout")
  return data as WorkoutEditorRead
}, { maxEntries: 8, ttlMs: 15_000 })
export function loadWorkoutEditor(url: string, signal?: AbortSignal, force = false) { if (force) editors.invalidate(); return editors.get(key(url), signal) }
export function clearWorkoutReads() { planned.invalidate(); comments.invalidate(); editors.invalidate() }
export async function loadLibraryWorkout(id:string,signal?:AbortSignal,force=false) {
  if(!/^library:[1-9]\d*$/.test(id))throw Error("Choose a saved library workout.")
  const data=await loadWorkspaceRead<{workouts:PlannedWorkout[]}>("/api/workout-library",signal,force)
  const workout=data.workouts.find(row=>row.id===id)
  return workout?validatedLibraryWorkout(workout):null
}
export function prefetchWorkoutValues(workout: PlannedWorkout) {
  if (workout.app_pending_operation) return Promise.resolve([])
  const requests: Promise<unknown>[] = []
  if (/^event:[1-9]\d*$/.test(workout.id) && workout.status !== "completed") requests.push(loadWorkoutValues(workout.id))
  if (/^(event:[1-9]\d*|activity:i?\d+)$/.test(workout.id)) requests.push(loadWorkoutComments(workout.id))
  return Promise.allSettled(requests)
}
if (typeof window !== "undefined") {
  for (const event of ["training-cache-reset", "device-cache-cleared", "app-auth-required"]) window.addEventListener(event, () => { planned.clear(); comments.clear(); editors.clear() })
  for (const event of ["training-mutation-started", "workout-editor-saved", "workout-description-updated"]) window.addEventListener(event, clearWorkoutReads)
}
