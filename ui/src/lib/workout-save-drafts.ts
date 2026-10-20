import { randomId } from "./random-id.ts"

type SavedDraft<T> = { token: string; value: T }
const memory = new Map<string, SavedDraft<unknown> | null>()
const key = (scope: string, id: string, section: string) =>
  `workout-save-draft:${JSON.stringify([scope, id, section])}`

// A closed popup no longer owns the write. Keep the attempted inputs until
// provider confirmation, including when browser storage is unavailable.
export function readWorkoutSaveDraft<T>(scope: string, id: string, section: string, valid: (value: T) => boolean = () => true) {
  const name = key(scope, id, section)
  if (memory.has(name)) {
    const record = memory.get(name) as SavedDraft<T> | null
    return record && valid(record.value) ? record : undefined
  }
  try {
    const record = JSON.parse(localStorage.getItem(name) || "null")
    if (record && typeof record.token === "string" && record.value && typeof record.value === "object" && valid(record.value))
      return record as SavedDraft<T>
  } catch { /* Use this session's fallback. */ }
  return undefined
}

export function retainWorkoutSaveDraft<T>(scope: string, id: string, section: string, value: T) {
  const name = key(scope, id, section), record = { token: randomId(), value }
  memory.set(name, record)
  try { localStorage.setItem(name, JSON.stringify(record)) } catch { /* Retained in memory. */ }
  return record.token
}

export function clearWorkoutSaveDraft(scope: string, id: string, section: string, token?: string) {
  const name = key(scope, id, section)
  if (token && readWorkoutSaveDraft(scope, id, section)?.token !== token) return
  memory.delete(name)
  try { localStorage.removeItem(name) } catch { memory.set(name,null) }
}

export type PlannedSaveDraft = {
  values: Partial<import("./training-context").WorkoutSummaryValues>
  metadata: { name?: string; date?: string; time?: string }
}

export const validPlannedSaveDraft = (value: PlannedSaveDraft) => Boolean(
  value?.values && !Array.isArray(value.values) && typeof value.values === "object" &&
  Object.values(value.values).every(item => item === null || (typeof item === "number" && Number.isFinite(item) && item >= 0)) &&
  value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) &&
  Object.entries(value.metadata).every(([name,item]) => ["name","date","time"].includes(name) && typeof item === "string")
)
export type TextSaveDraft = { description?: string; comment: string; creationId: string }
export const validTextSaveDraft = (value: TextSaveDraft) => Boolean(value && typeof value.comment === "string" && value.comment.length <= 2000 && typeof value.creationId === "string" && (value.description == null || typeof value.description === "string"))
