import { useState } from "react"
import { Download, Upload } from "lucide-react"
import { apiFetch } from "@/lib/api-client"
import { revalidateTrainingContext, type PlannedWorkout } from "@/lib/training-context"
import type { WorkoutModel } from "../../../app-backend/lib/workout-editor-model.mjs"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"
import { Button } from "./ui/button"

function base64File(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("The file could not be read. Choose it again."))
    reader.onload = () => resolve(String(reader.result).split(",")[1])
    reader.readAsDataURL(file)
  })
}
function downloadFile(file: { name: string; type: string; data: string }) {
  const bytes = Uint8Array.from(atob(file.data), letter => letter.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }))
  const link = document.createElement("a")
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function useWorkoutFiles({ workout, model, onUploaded }: {
  workout?: PlannedWorkout
  model?: WorkoutModel | null
  onUploaded?: () => void
}) {
  const [mode, setMode] = useState<"upload" | "export" | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [format, setFormat] = useState("fit")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState("")
  const open = (next: "upload" | "export") => { setMode(next); setError(""); setDone(""); setFile(null) }
  const submit = async () => {
    if (busy || !mode) return
    setBusy(true); setError(""); setDone("")
    try {
      if (mode === "upload" && (!file || !/\.(fit|tcx|gpx)$/i.test(file.name) || file.size > 2 * 1024 * 1024))
        throw new Error("Choose a FIT, TCX or GPX file smaller than 2 MB.")
      const payload = mode === "upload"
        ? { name: file!.name, data: await base64File(file!), ...(/^event:\d+$/.test(workout?.id || "") ? { workoutId: workout!.id } : {}) }
        : { format, ...(model ? { model } : { workoutId: workout?.id }) }
      const response = await apiFetch(`/api/workout-files/${mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90_000),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "The file could not be processed.")
      if (mode === "export") { downloadFile(result); setMode(null) }
      else {
        if (result.verified !== true) throw new Error("The upload could not be verified. Retry the same file.")
        void revalidateTrainingContext().catch(() => {})
        setDone(`${result.activityIds.length === 1 ? "Activity" : "Activities"} uploaded and verified.${result.pairedWorkoutId ? " The recording is linked to this workout." : ""}`)
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The file could not be processed.") }
    finally { setBusy(false) }
  }
  return {
    upload: () => open("upload"),
    exportWorkout: () => open("export"),
    dialogs: <Dialog open={mode !== null} onOpenChange={open => { if (!open && !busy) setMode(null) }}>
      <DialogContent className="workout-file-dialog" showCloseButton={!busy}>
        <DialogTitle>{mode === "upload" ? "Upload activity" : "Export workout"}</DialogTitle>
        <DialogDescription>{mode === "upload"
          ? "Choose the recording from your watch or training device."
          : "Download the workout for your watch, bike computer or training app."}</DialogDescription>
        {mode === "upload" ? <>
          <input aria-label="Activity recording" type="file" accept=".fit,.tcx,.gpx" disabled={busy || Boolean(done)} onChange={event => { setFile(event.target.files?.[0] || null); setError("") }} />
          <p className="text-xs text-muted-foreground">FIT, TCX or GPX · Up to 2 MB. Re-uploading the same file will not create a duplicate.</p>
        </> : <label className="grid gap-2">File format
          <select aria-label="Workout export format" value={format} disabled={busy} onChange={event => setFormat(event.target.value)} className="rounded border p-2">
            <option value="fit">FIT — Training devices</option>
            <option value="zwo">ZWO — Zwift</option>
            <option value="mrc">MRC — Percent power</option>
            <option value="erg">ERG — Power targets</option>
            <option value="txt">Text — Workout prescription</option>
          </select>
        </label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {done && <p role="status">{done}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => { setMode(null); if (done) onUploaded?.() }}>{done ? "Done" : "Cancel"}</Button>
          {!done && <Button disabled={busy || (mode === "upload" && !file)} onClick={() => void submit()}>
            {mode === "upload" ? <Upload size={15} /> : <Download size={15} />}{busy ? "Processing…" : mode === "upload" ? "Upload" : "Download"}
          </Button>}
        </div>
      </DialogContent>
    </Dialog>,
  }
}
