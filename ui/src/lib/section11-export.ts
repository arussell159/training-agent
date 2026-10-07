import { apiFetch } from "@/lib/api-client"
import { withRequestDeadline, waitForRequestDelay } from "./request-deadline"

const PENDING_EXPORT_KEY = "training-agent-section11-export-pending"

let pendingInMemory = false
let exportRevision = 0
let pendingGeneration = 0
const exportRequests = new Set<AbortController>()
if (typeof window !== "undefined")
  for (const event of ["training-cache-reset", "app-auth-required"])
    window.addEventListener(event, () => {
      exportRevision++
      pendingGeneration++
      for (const controller of exportRequests)
        controller.abort(new DOMException("Session changed", "AbortError"))
      exportRequests.clear()
      pendingInMemory = false
      try {
        localStorage.removeItem(PENDING_EXPORT_KEY)
      } catch {
        /* Storage is optional. */
      }
    })

export type Section11Sync = {
  status: "idle" | "queued" | "running" | "complete" | "failed"
  revision?: number
  commit?: string
  error?: string
}

export function section11ExportPending() {
  if (pendingInMemory) return true
  try {
    return localStorage.getItem(PENDING_EXPORT_KEY) === "1"
  } catch {
    return false
  }
}

export function markSection11ExportPending() {
  const generation = ++pendingGeneration
  pendingInMemory = true
  try {
    localStorage.setItem(PENDING_EXPORT_KEY, "1")
  } catch {
    // The current page can still finish the export without persistent storage.
  }
  return generation
}

export function waitForSection11Export(initial: Section11Sync): Promise<void> {
  return waitForExport(initial, markSection11ExportPending())
}

async function waitForExport(
  initial: Section11Sync,
  generation: number
): Promise<void> {
  const controller = new AbortController(),
    revision = exportRevision
  exportRequests.add(controller)
  return withRequestDeadline(
    async (signal) => {
      let result = initial
      while (result?.status === "queued" || result?.status === "running") {
        await waitForRequestDelay(2000, signal)
        const query = initial.revision ? `?revision=${initial.revision}` : ""
        result = await withRequestDeadline(
          async (requestSignal) => {
            const response = await apiFetch(`/api/section11-sync${query}`, {
              signal: requestSignal,
            })
            if (!response.ok)
              throw Error(
                "Unable to check GitHub sync. Refresh to check again."
              )
            return (await response.json()) as Section11Sync
          },
          15_000,
          signal
        )
      }
      if (result?.status !== "complete")
        throw Error(
          typeof result?.error === "string"
            ? result.error
            : "GitHub export did not complete."
        )
      signal.throwIfAborted()
      if (revision !== exportRevision)
        throw new DOMException("Session changed", "AbortError")
      if (generation !== pendingGeneration) return
      pendingInMemory = false
      try {
        localStorage.removeItem(PENDING_EXPORT_KEY)
      } catch {
        /* The export succeeded even if storage is unavailable. */
      }
    },
    6 * 60_000,
    controller.signal,
    "GitHub sync is taking longer than expected. Refresh to check again."
  ).finally(() => exportRequests.delete(controller))
}

// Kept for pending exports from an older page and explicit retry requests.
export async function syncSection11Export(syncId?: string): Promise<void> {
  const generation = markSection11ExportPending()
  const controller = new AbortController(),
    revision = exportRevision
  exportRequests.add(controller)
  const query = new URLSearchParams({ section11Only: "1" })
  if (syncId) query.set("syncId", syncId)
  try {
    const result = await withRequestDeadline(
      async (signal) => {
        const response = await apiFetch(`/api/sync?${query}`, {
          method: "POST",
          signal,
        })
        const result = (await response.json()) as {
          section11Sync?: Section11Sync
          error?: string
        }
        if (!response.ok || !result?.section11Sync)
          throw Error(
            typeof result?.error === "string"
              ? result.error
              : "GitHub export could not start."
          )
        return result.section11Sync
      },
      20_000,
      controller.signal
    )
    controller.signal.throwIfAborted()
    if (revision !== exportRevision)
      throw new DOMException("Session changed", "AbortError")
    await waitForExport(result, generation)
  } finally {
    exportRequests.delete(controller)
  }
}
