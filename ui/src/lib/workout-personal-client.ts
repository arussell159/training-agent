import { apiFetch } from "./api-client.ts"
import { withRequestDeadline } from "./request-deadline.ts"
import type { WorkoutLocalMetadata } from "./workout-local-metadata"

export type WorkoutAttachment = { id: string; name: string; type: string; size: number; createdAt: string }
export type WorkoutPersonalSnapshot = {
  value: WorkoutLocalMetadata
  revision: number
  attachments: WorkoutAttachment[]
  equipmentOptions?: string[]
  exists: boolean
  migratedTo?: string
}
const path = (id: string) => `/api/workouts/${encodeURIComponent(id)}/personal`
const REQUEST_TIMEOUT_MS = 30_000
async function json<T>(url: string, options?: RequestInit): Promise<T> {
  return withRequestDeadline(async (signal) => {
    const response = await apiFetch(url, { cache: "no-store", ...options, signal })
    const result = await response.json()
    if (!response.ok) throw Object.assign(new Error(result.error || "Workout personal fields could not be saved."), { status: response.status, code: result.code })
    return result
  }, REQUEST_TIMEOUT_MS, options?.signal ?? undefined, "Workout personal fields took too long to sync. Your draft is retained. Try saving again.")
}
export const loadWorkoutPersonal = (id: string, signal?: AbortSignal) =>
  json<WorkoutPersonalSnapshot>(path(id), { signal })
export const saveWorkoutPersonal = (id: string, value: WorkoutLocalMetadata, revision: number, options?: { migrateFrom?: string; importOnly?: boolean }) =>
  json<WorkoutPersonalSnapshot>(path(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value, revision, ...options }) })
export async function uploadWorkoutAttachment(id: string, file: File) {
  if (!file.size || file.size > 2 * 1024 * 1024) throw new Error("Choose a nonempty attachment up to 2 MB.")
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("The attachment could not be read."))
    reader.onload = () => resolve(String(reader.result).split(",")[1])
    reader.readAsDataURL(file)
  })
  return json<WorkoutPersonalSnapshot>(`${path(id)}/attachments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, data }) })
}
export const removeWorkoutAttachment = (id: string, attachmentId: string) =>
  json<WorkoutPersonalSnapshot>(`${path(id)}/attachments/${attachmentId}`, { method: "DELETE", headers: { "Content-Type": "application/json" } })
export async function downloadWorkoutAttachment(id: string, attachment: WorkoutAttachment) {
  const blob = await withRequestDeadline(async (signal) => {
    const response = await apiFetch(`${path(id)}/attachments/${attachment.id}`, { cache: "no-store", signal })
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      throw new Error(result.error || "The attachment could not be downloaded.")
    }
    return response.blob()
  }, REQUEST_TIMEOUT_MS, undefined, "The attachment took too long to download. Please try again.")
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = attachment.name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
