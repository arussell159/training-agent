import { apiFetch, apiSessionRevision } from "./api-client"
import { deviceCacheScope } from "./device-cache"
import { createSharedRequestCache } from "./shared-request-cache"

// Writes retain their verified provider path and invalidate these read results.
const paths = new Set(["/api/coach/reports/catalog", "/api/workout-library", "/api/annual-plans", "/api/race-events"])
let readRevision = 0
const reads = createSharedRequestCache<unknown>(async (key, signal) => {
  const [session, , path, revision] = JSON.parse(key) as [number, string, string, number]
  // A read started after a write must not join an older transport still used
  // by another view. This header distinguishes local sharing generations.
  const response = await apiFetch(path, { signal, cache: "no-store", headers: {"X-App-Read-Revision": String(revision)} })
  const value = await response.json()
  if (session !== apiSessionRevision()) throw Error("Your session has ended.")
  if (!response.ok) throw Error(value?.error || "Unable to load this page. Please retry.")
  const collection = path.endsWith("catalog") ? "reports" : path.endsWith("workout-library") ? "workouts" : path.endsWith("annual-plans") ? "plans" : "events"
  if (!value || !Array.isArray(value[collection])) throw Error("The page returned incomplete data. Please retry.")
  return value
}, { maxEntries: 8, ttlMs: 30_000, timeoutMs: 22_000 })
function key(path: string) {
  if (!paths.has(path)) throw Error("This workspace read is not supported.")
  const session = apiSessionRevision()
  if (session == null) throw Error("Sign in to your app to continue.")
  return JSON.stringify([session, deviceCacheScope(), path, readRevision])
}
export function loadWorkspaceRead<T>(path: string, signal?: AbortSignal, force=false): Promise<T> {
  if(force){readRevision++;reads.invalidate()}
  return reads.get(key(path), signal) as Promise<T>
}
export function prefetchWorkspacePage(page: string) {
  const path = ({ Coach: "/api/coach/reports/catalog", Library: "/api/workout-library", "Annual Plan": "/api/annual-plans", Settings: "/api/race-events" } as Record<string, string>)[page]
  if (path && apiSessionRevision() != null) void loadWorkspaceRead(path).catch(() => {})
}
if (typeof window !== "undefined") {
  for (const event of ["training-cache-reset", "device-cache-cleared", "app-auth-required"])
    window.addEventListener(event, () => { readRevision++; reads.clear(); delete (window as Window & { __workspaceStartupRequests?: unknown }).__workspaceStartupRequests })
  for (const event of ["training-context-updated", "training-mutation-started", "annual-plan-updated"])
    window.addEventListener(event, () => {
      readRevision++
      reads.invalidate()
      if (event !== "training-context-updated") delete (window as Window & { __workspaceStartupRequests?: unknown }).__workspaceStartupRequests
    })
}
