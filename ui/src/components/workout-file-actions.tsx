import { useRef, useState } from "react"
import { Download, Upload } from "lucide-react"
import { apiFetch } from "@/lib/api-client"
import {
  revalidateTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"
import type { WorkoutModel } from "../../../app-backend/lib/workout-editor-model.mjs"
import { expandSteps } from "../../../app-backend/lib/workout-editor-model.mjs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
import { Button } from "./ui/button"

function base64File(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () =>
      reject(new Error("The file could not be read. Choose it again."))
    reader.onload = () => resolve(String(reader.result).split(",")[1])
    reader.readAsDataURL(file)
  })
}
function downloadFile(file: { name: string; type: string; data: string }) {
  const bytes = Uint8Array.from(atob(file.data), (letter) =>
    letter.charCodeAt(0)
  )
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }))
  const link = document.createElement("a")
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function useWorkoutFiles({
  workout,
  workoutId,
  model,
  presentation,
  onUploaded,
}: {
  workout?: PlannedWorkout
  workoutId?: string
  model?: WorkoutModel | null
  presentation?: "strength"
  onUploaded?: () => void
}) {
  const [mode, setMode] = useState<"upload" | "export" | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [format, setFormat] = useState("fit")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState("")
  const fileInput = useRef<HTMLInputElement>(null)
  const requestActive = useRef(false)
  const linkedWorkoutId = workoutId ?? workout?.id
  const strengthUpload = presentation === "strength" && mode === "upload"
  const currentModel = model || workout?.editor_model
  let rpeTargets = false
  try {
    rpeTargets = Boolean(
      currentModel &&
      expandSteps(currentModel.steps).some(
        ({ step }) => step.target.kind === "rpe"
      )
    )
  } catch {
    /* Invalid drafts are rejected by export validation. */
  }
  const noSteps = currentModel
    ? !currentModel.steps.length
    : Boolean(workout?.unstructured)
  const textOnly =
    noSteps &&
    (currentModel
      ? currentModel.unstructured === true
      : Boolean(workout?.unstructured))
  const emptyBuilder = noSteps && !textOnly
  const open = (next: "upload" | "export") => {
    if (requestActive.current) return
    setMode(next)
    setError("")
    setDone("")
    setFile(null)
    if (next === "export") setFormat(textOnly || rpeTargets ? "txt" : "fit")
  }
  const submit = async () => {
    if (
      requestActive.current ||
      busy ||
      !mode ||
      (mode === "export" &&
        (emptyBuilder || ((textOnly || rpeTargets) && format !== "txt")))
    )
      return
    requestActive.current = true
    setBusy(true)
    setError("")
    setDone("")
    try {
      if (
        mode === "upload" &&
        (!file ||
          file.size === 0 ||
          !/\.(fit|tcx|gpx)$/i.test(file.name) ||
          file.size > 2 * 1024 * 1024)
      )
        throw new Error("Choose a FIT, TCX or GPX file smaller than 2 MB.")
      const payload =
        mode === "upload"
          ? {
              name: file!.name,
              data: await base64File(file!),
              ...(/^event:[1-9]\d*$/.test(linkedWorkoutId || "")
                ? { workoutId: linkedWorkoutId }
                : {}),
            }
          : { format, ...(model ? { model } : { workoutId: workout?.id }) }
      const response = await apiFetch(`/api/workout-files/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90_000),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || "The file could not be processed.")
      if (mode === "export") {
        downloadFile(result)
        setMode(null)
      } else {
        if (
          result.verified !== true ||
          !Array.isArray(result.activityIds) ||
          result.activityIds.length === 0 ||
          result.activityIds.length > 100 ||
          result.activityIds.some(
            (id: unknown) => typeof id !== "string" || !/^i?[1-9]\d*$/.test(id)
          ) ||
          new Set(result.activityIds).size !== result.activityIds.length ||
          result.pairedWorkoutId !==
            (/^event:[1-9]\d*$/.test(linkedWorkoutId || "")
              ? linkedWorkoutId
              : null)
        )
          throw new Error(
            "The upload could not be verified. Retry the same file."
          )
        void revalidateTrainingContext().catch(() => {})
        setDone(
          `${result.activityIds.length === 1 ? "Activity" : "Activities"} uploaded and verified.${result.pairedWorkoutId ? " The recording is linked to this workout." : ""}`
        )
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The file could not be processed."
      )
    } finally {
      requestActive.current = false
      setBusy(false)
    }
  }
  return {
    busy,
    upload: () => open("upload"),
    exportWorkout: () => open("export"),
    dialogs: (
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setMode(null)
        }}
      >
        <DialogContent
          className={`workout-file-dialog ${strengthUpload ? "dsb-device-file-dialog" : ""}`}
          showCloseButton={!busy}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <DialogTitle>
            {strengthUpload
              ? "Upload Device File"
              : mode === "upload"
                ? "Upload activity"
                : "Export workout"}
          </DialogTitle>
          <DialogDescription>
            {mode === "upload"
              ? "Choose the recording from your watch or training device."
              : rpeTargets
                ? "Numeric RPE stays in the workout text. Device formats cannot preserve these effort targets."
                : textOnly
                  ? "This workout has no intervals. Download its text, or add intervals to create a device workout."
                  : emptyBuilder
                    ? "Add at least one interval before exporting this builder draft."
                    : "Download the workout for your watch, bike computer or training app."}
          </DialogDescription>
          {mode === "upload" ? (
            <>
              {strengthUpload && (
                <div
                  className="dsb-device-file-drop"
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (!busy && !done) event.dataTransfer.dropEffect = "copy"
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (busy || done) return
                    if (event.dataTransfer.files.length !== 1) {
                      setError("Choose one recording at a time.")
                      return
                    }
                    setFile(event.dataTransfer.files[0])
                    setError("")
                  }}
                >
                  <Button
                    variant="ghost"
                    disabled={busy || Boolean(done)}
                    onClick={() => fileInput.current?.click()}
                  >
                    Browse for a file
                  </Button>
                  <strong>or drag and drop here</strong>
                  <span>.fit, .gpx, .tcx file</span>
                  {file && <span>{file.name}</span>}
                </div>
              )}
              <input
                ref={fileInput}
                className={strengthUpload ? "sr-only" : undefined}
                aria-label="Activity recording"
                type="file"
                accept=".fit,.tcx,.gpx"
                disabled={busy || Boolean(done)}
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null)
                  setError("")
                }}
              />
              <p className="text-xs text-muted-foreground">
                FIT, TCX or GPX · Up to 2 MB. Re-uploading the same file will
                not create a duplicate.
              </p>
            </>
          ) : (
            <label className="grid gap-2">
              File format
              <select
                aria-label="Workout export format"
                value={format}
                disabled={busy}
                onChange={(event) => setFormat(event.target.value)}
                className="rounded border p-2"
              >
                <option value="fit" disabled={noSteps || rpeTargets}>
                  FIT — Training devices
                </option>
                <option value="zwo" disabled={noSteps || rpeTargets}>
                  ZWO — Zwift
                </option>
                <option value="mrc" disabled={noSteps || rpeTargets}>
                  MRC — Percent power
                </option>
                <option value="erg" disabled={noSteps || rpeTargets}>
                  ERG — Power targets
                </option>
                <option value="txt" disabled={emptyBuilder}>
                  Text — Workout prescription
                </option>
              </select>
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {done && <p role="status">{done}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setMode(null)
                if (done) onUploaded?.()
              }}
            >
              {done ? "Done" : "Cancel"}
            </Button>
            {!done && (
              <Button
                disabled={
                  busy ||
                  (mode === "upload" && !file) ||
                  (mode === "export" && emptyBuilder)
                }
                onClick={() => void submit()}
              >
                {mode === "upload" ? (
                  <Upload size={15} />
                ) : (
                  <Download size={15} />
                )}
                {busy
                  ? "Processing…"
                  : mode === "upload"
                    ? strengthUpload
                      ? "Upload Device File"
                      : "Upload"
                    : "Download"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    ),
  }
}
