import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { apiFetch, apiSessionRevision } from "@/lib/api-client"
import { localCommittedWorkout, resolveWorkoutConflict } from "@/lib/workout-commits"
import { randomId } from "@/lib/random-id"
import { workoutOutline, type WorkoutModel } from "../../../app-backend/lib/workout-editor-model.mjs"

type Version = { deleted?: boolean; model?: WorkoutModel; description?: string; event?: Record<string, unknown>; plannedValues?: unknown; personal?: unknown; recurrence?: unknown; issues?: string[]; warnings?: string[] }
type Review = { workoutId: string; revision: string; candidateRevision: string; local: Version; provider: Version; canKeepLocal: boolean; canAcceptProvider: boolean }
type Resolution = { operationId: string; expectedRevision: string; candidateRevision: string; choice: "local" | "provider" }

function VersionDetails({ title, version }: { title: string; version: Version }) {
  const model = version.model
  return <section className="min-w-0 rounded border p-3">
    <h3 className="font-semibold">{title}</h3>
    {version.deleted ? <p className="mt-2">Deleted workout</p> : <>
      <p className="mt-2 font-medium">{model?.name || "Untitled workout"}</p>
      <p className="text-muted-foreground">{model?.sport} · {model?.date}</p>
      {model && <pre className="mt-3 whitespace-pre-wrap break-words text-xs font-sans">{workoutOutline(model)}</pre>}
      {(version.description || model?.notes) && <p className="mt-3 whitespace-pre-wrap break-words text-xs">{version.description || model?.notes}</p>}
      {version.issues?.map((issue, index) => <p key={index} className="mt-2 text-xs text-destructive">{String(issue)}</p>)}
      {version.warnings?.map((warning, index) => <p key={index} className="mt-2 text-xs text-muted-foreground">{String(warning)}</p>)}
      <details className="mt-3 text-xs"><summary className="cursor-pointer">All retained fields</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(version, null, 2)}</pre></details>
    </>}
  </section>
}

export default function WorkoutConflictDialog({ workoutId, onClose }: { workoutId: string; onClose: () => void }) {
  const [review, setReview] = useState<Review>(), [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState("")
  const attempt = useRef<Resolution | null>(null), sequence = useRef<number | undefined>(undefined)
  useEffect(() => {
    let current = true
    const session = apiSessionRevision()
    sequence.current = localCommittedWorkout(workoutId)?.sequence
    void apiFetch(`/api/workout-commits/${encodeURIComponent(workoutId)}/conflict`, { signal: AbortSignal.timeout(15000) }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw Error(data.error || "The versions could not be loaded. Reopen the workout and try again.")
      if (current && session === apiSessionRevision()) setReview(data)
    }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "The versions could not be loaded.") })
    return () => { current = false }
  }, [workoutId])
  async function resolve(choice: Resolution["choice"]) {
    if (!review || busy) return
    if (localCommittedWorkout(workoutId)?.sequence !== sequence.current) { setError("A newer edit was saved while this review was open. Close this review and open it again; your edits are retained."); return }
    const body = attempt.current ||= { operationId: randomId(), expectedRevision: review.revision, candidateRevision: review.candidateRevision, choice }
    if (body.choice !== choice) { setError("The previous choice may already have been accepted. Retry that choice to confirm its result."); return }
    setBusy(true); setError("")
    try {
      await resolveWorkoutConflict(workoutId, sequence.current, body, review)
      setDone("Your choice and both reviewed copies are saved on this device. Confirmation will continue in the background. Reopen the workout after confirmation to edit the chosen version.")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The result could not be confirmed. Retry the same choice.") }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" showCloseButton={!busy}>
      <DialogTitle>Review workout changes</DialogTitle>
      <DialogDescription>Intervals.icu changed after the app version was saved. Compare both versions before choosing. Both reviewed copies will be retained.</DialogDescription>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {done ? <><p role="status">{done}</p><Button onClick={onClose}>Done</Button></> : review ? <>
        <div className="grid gap-3 sm:grid-cols-2"><VersionDetails title="Saved in the app" version={review.local}/><VersionDetails title="Current Intervals.icu version" version={review.provider}/></div>
        {!review.canKeepLocal && <p className="text-xs">This app version cannot replace the current record. To retain a separate workout, duplicate the saved app version after reviewing.</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Decide later</Button><Button variant="outline" disabled={busy || !review.canAcceptProvider} onClick={() => void resolve("provider")}>Use Intervals.icu version</Button><Button disabled={busy || !review.canKeepLocal} onClick={() => void resolve("local")}>{busy ? "Saving choice…" : "Keep app version"}</Button></div>
      </> : !error && <p role="status">Loading both versions…</p>}
    </DialogContent>
  </Dialog>
}
