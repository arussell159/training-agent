import { apiFetch } from "@/lib/api-client"

const PENDING_EXPORT_KEY = "training-agent-section11-export-pending"

let pendingInMemory = false

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
  pendingInMemory = true
  try {
    localStorage.setItem(PENDING_EXPORT_KEY, "1")
  } catch {
    // The current page can still finish the export without persistent storage.
  }
}

export async function waitForSection11Export(
  initial: Section11Sync
): Promise<void> {
  markSection11ExportPending()
  let result = initial
  const deadline = Date.now() + 6 * 60_000
  while (result.status === "queued" || result.status === "running") {
    if (Date.now() >= deadline)
      throw Error(
        "GitHub sync is taking longer than expected. Refresh to check again."
      )
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const query = initial.revision ? `?revision=${initial.revision}` : ""
    const response = await apiFetch(`/api/section11-sync${query}`)
    if (!response.ok)
      throw Error("Unable to check GitHub sync. Refresh to check again.")
    result = (await response.json()) as Section11Sync
  }
  if (result.status !== "complete")
    throw Error(result.error || "GitHub export did not complete.")
  pendingInMemory = false
  try {
    localStorage.removeItem(PENDING_EXPORT_KEY)
  } catch {
    /* The export succeeded even if storage is unavailable. */
  }
}

// Kept for pending exports from an older page and explicit retry requests.
export async function syncSection11Export(syncId?: string): Promise<void> {
  markSection11ExportPending()
  const query = new URLSearchParams({ section11Only: "1" })
  if (syncId) query.set("syncId", syncId)
  const response = await apiFetch(`/api/sync?${query}`, { method: "POST" })
  const result = (await response.json()) as {
    section11Sync?: Section11Sync
    error?: string
  }
  if (!response.ok || !result.section11Sync)
    throw Error(result.error || "GitHub export could not start.")
  await waitForSection11Export(result.section11Sync)
}
