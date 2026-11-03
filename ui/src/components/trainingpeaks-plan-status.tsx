import { useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { loadTrainingContext, type TrainingContext } from "@/lib/training-context"
import { Button } from "@/components/ui/button"

export function TrainingPeaksPlanStatus({context}: {context: TrainingContext}) {
  const [busy,setBusy] = useState(false), [message,setMessage] = useState("")
  const sync = context.planned_sync
  const refresh = async () => {
    setBusy(true);setMessage("")
    try {
      const response = await apiFetch("/api/trainingpeaks/planned",{method:"POST"})
      const result = await response.json()
      if(!response.ok || result.error)throw Error(result.error || "The saved plan could not refresh. Please try again.")
      await loadTrainingContext(true,"full",true)
      setMessage("TrainingPeaks plans refreshed.")
    } catch(error) {setMessage(error instanceof Error ? error.message : "Please try again.")}
    finally {setBusy(false)}
  }
  return <div className="sticky top-14 z-30 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-4 py-2 text-xs text-muted-foreground max-md:mt-14 md:top-[84px]">
    <p role={sync?.error ? "alert" : undefined}>{sync?.error || (sync?.lastSyncedAt ? `Plans from TrainingPeaks · Updated ${new Date(sync.lastSyncedAt).toLocaleString()}` : "Plans from TrainingPeaks")}</p>
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>{busy ? "Refreshing…" : "Refresh plans"}</Button>
    {message && <p role="status" className="w-full">{message}</p>}
  </div>
}
