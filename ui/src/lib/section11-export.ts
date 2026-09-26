import { apiFetch } from "@/lib/api-client"

const PENDING_EXPORT_KEY = "training-agent-section11-export-pending"

let inFlight: Promise<void> | null = null
let pendingInMemory = false

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

export function syncSection11Export(syncId?: string): Promise<void> {
  markSection11ExportPending()
  if (inFlight) return inFlight

  const query = new URLSearchParams({ section11Only: "1" })
  if (syncId) query.set("syncId", syncId)
  const operation = (async () => {
    const response = await apiFetch(`/api/sync?${query}`, { method: "POST" })
    const result = (await response.json()) as {
      section11Sync?: { status: string; error?: string }
      error?: string
    }
    if (!response.ok || result.section11Sync?.status !== "complete")
      throw Error(result.section11Sync?.error || result.error || "Section 11 export failed.")
    pendingInMemory = false
    try {
      localStorage.removeItem(PENDING_EXPORT_KEY)
    } catch {
      // The export itself succeeded even if local storage is unavailable.
    }
  })()
  inFlight = operation
  void operation.finally(() => {
    if (inFlight === operation) inFlight = null
  }).catch(() => {})
  return operation
}
