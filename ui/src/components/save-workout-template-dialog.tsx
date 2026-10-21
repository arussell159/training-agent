import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
import {
  workoutTemplateClient,
  workoutTemplateAttempt,
  type WorkoutTemplateAttempt,
  type WorkoutTemplateFolders,
  type WorkoutTemplateResult,
  type WorkoutTemplateInspection,
  type TemplateInspection,
} from "@/lib/workout-template-client"
import "./save-workout-template-dialog.css"

const message = (reason: unknown) =>
  reason instanceof Error
    ? reason.message
    : "The library save could not be confirmed. Recheck it before adding another template."
export function SaveWorkoutTemplateDialog({
  open,
  sourceWorkoutId,
  sourceRevision,
  workoutTitle,
  onOpenChange,
  onSaved,
  onResolved,
}: {
  open: boolean
  sourceWorkoutId: string
  sourceRevision: string
  workoutTitle: string
  onOpenChange: (open: boolean) => void
  onSaved?: (result: WorkoutTemplateResult) => void | Promise<void>
  onResolved?: (outcome: TemplateInspection) => void | Promise<void>
}) {
  const [folders, setFolders] = useState<WorkoutTemplateFolders | null>(null),
    [title, setTitle] = useState(workoutTitle),
    [folderId, setFolderId] = useState(""),
    [pending, setPending] = useState<WorkoutTemplateAttempt | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [saved, setSaved] = useState<WorkoutTemplateResult | null>(null)
  const [inspection, setInspection] =
      useState<WorkoutTemplateInspection | null>(null),
    [resolved, setResolved] = useState<TemplateInspection | null>(null),
    [accountChanged, setAccountChanged] = useState(false)
  const source = useRef({ id: sourceWorkoutId, revision: sourceRevision }),
    identity = useRef(""),
    catalogScope = useRef<string | null>(null),
    latestTitle = useRef(workoutTitle),
    titleInput = useRef<HTMLInputElement>(null),
    recheckButton = useRef<HTMLButtonElement>(null),
    locked = useRef(false),
    mounted = useRef(true)
  latestTitle.current = workoutTitle
  useEffect(() => {
    if (!pending || loading) return
    const frame = requestAnimationFrame(() => recheckButton.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [pending, loading])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!open) return
    const changed = () => {
      setAccountChanged(true)
      setError(
        "The signed-in library changed. Reopen the saved workout before starting another library save."
      )
    }
    for (const event of ["app-auth-required", "training-cache-reset"])
      window.addEventListener(event, changed)
    return () => {
      for (const event of ["app-auth-required", "training-cache-reset"])
        window.removeEventListener(event, changed)
    }
  }, [open])
  useEffect(() => {
    if (!open) {
      identity.current = ""
      return
    }
    const key = JSON.stringify([sourceWorkoutId, sourceRevision]),
      controller = new AbortController()
    if (identity.current !== key) {
      identity.current = key
      catalogScope.current = null
      source.current = { id: sourceWorkoutId, revision: sourceRevision }
      setTitle(latestTitle.current)
      setFolderId("")
      setPending(null)
      setSaved(null)
      setInspection(null)
      setResolved(null)
      setAccountChanged(false)
    }
    setLoading(true)
    setFolders(null)
    setError("")
    void workoutTemplateClient
      .folders(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        if (catalogScope.current && catalogScope.current !== value.accountScope)
          throw Error(
            "The library account changed. Reopen the saved workout before adding a template."
          )
        catalogScope.current = value.accountScope
        const retained = workoutTemplateClient.pending(value.accountScope)
        setFolders(value)
        setPending(retained)
        if (retained) {
          source.current = {
            id: retained.sourceWorkoutId,
            revision: retained.body.sourceRevision,
          }
          setTitle(retained.body.title)
          setFolderId(retained.body.folderId)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(message(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [open, sourceWorkoutId, sourceRevision, reload])
  const close = () => {
    if (locked.current || pending) {
      if (pending)
        setError(
          "This library save still needs confirmation. Recheck its retained identity before closing."
        )
      return
    }
    onOpenChange(false)
  }
  const finish = async (result: WorkoutTemplateResult) => {
    setSaved(result)
    if (onSaved) await onSaved(result)
    if (mounted.current) onOpenChange(false)
  }
  const save = async () => {
    if (
      locked.current ||
      loading ||
      saved ||
      resolved ||
      (!pending && accountChanged)
    )
      return
    if (!folders && !pending) return
    locked.current = true
    setBusy(true)
    setError("")
    const requestIdentity = identity.current
    let attempt = pending
    try {
      if (!attempt)
        attempt = workoutTemplateAttempt(
          folders!,
          source.current,
          folderId,
          title
        )
      const result = await workoutTemplateClient.save(attempt, !!pending)
      if (!mounted.current || identity.current !== requestIdentity) return
      setPending(null)
      await finish(result)
    } catch (reason) {
      if (!mounted.current || identity.current !== requestIdentity) return
      if (attempt) {
        try {
          setPending(workoutTemplateClient.pending(attempt.body.accountScope))
        } catch (storageError) {
          setPending(attempt)
          setError(message(storageError))
          return
        }
      }
      setError(message(reason))
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const review = async () => {
    if (!pending || locked.current) return
    locked.current = true
    setBusy(true)
    setError("")
    const requestIdentity = identity.current
    try {
      const value = await workoutTemplateClient.inspect(pending)
      if (mounted.current && identity.current === requestIdentity)
        setInspection(value)
    } catch (reason) {
      if (mounted.current && identity.current === requestIdentity)
        setError(message(reason))
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const resolve = async (closeAfter: boolean) => {
    if (!inspection || locked.current) return
    locked.current = true
    setBusy(true)
    setError("")
    try {
      const outcome = workoutTemplateClient.acknowledge(inspection)
      setPending(null)
      setInspection(null)
      if (closeAfter) {
        setResolved(outcome)
        if (onResolved) await onResolved(outcome)
        if (mounted.current) onOpenChange(false)
      }
    } catch (reason) {
      if (mounted.current) setError(message(reason))
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const refreshSaved = async () => {
    if ((!saved && !resolved) || locked.current) return
    locked.current = true
    setBusy(true)
    setError("")
    try {
      if (saved) await finish(saved)
      else {
        if (onResolved) await onResolved(resolved!)
        if (mounted.current) onOpenChange(false)
      }
    } catch (reason) {
      if (mounted.current) setError(message(reason))
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const selected = folders?.folders.find((folder) => folder.id === folderId)
  const canAdd =
    !!folders &&
    !folders.readOnly &&
    !!selected?.editable &&
    !!title.trim() &&
    title.length <= 128 &&
    !accountChanged
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else close()
      }}
    >
      <DialogContent
        className="swt-dialog"
        showCloseButton={false}
        initialFocus={() => titleInput.current}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "s"
          )
            event.preventDefault()
        }}
      >
        <DialogTitle>Add exercise to Workout Library</DialogTitle>
        <DialogDescription>
          Copies the last saved workout. Unsaved edits stay in your editor.
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <label>
            Workout Title
            <input
              ref={titleInput}
              aria-label="Workout Title"
              value={title}
              maxLength={128}
              required
              disabled={
                busy || !!pending || !!saved || !!resolved || accountChanged
              }
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Workout Library Folder
            <select
              aria-label="Workout Library Folder"
              required
              value={folderId}
              disabled={
                loading ||
                busy ||
                !!pending ||
                !!saved ||
                !!resolved ||
                accountChanged ||
                !!folders?.readOnly
              }
              onChange={(event) => setFolderId(event.target.value)}
            >
              <option value="">Select a folder</option>
              {pending && !selected && (
                <option value={pending.body.folderId}>
                  Previously selected folder
                </option>
              )}
              {folders?.folders.map((folder) => (
                <option
                  value={folder.id}
                  key={folder.id}
                  disabled={!folder.editable}
                >
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          {loading && <p role="status">Loading workout library folders…</p>}
          {folders?.readOnly && (
            <p role="alert">The workout library is read-only.</p>
          )}
          {folders && !folders.folders.length && (
            <p>
              No workout library folders are available. Create a folder in your
              connected workout library, then reload.
            </p>
          )}
          {pending && (
            <p role="status">
              A library save is awaiting confirmation. Its original title,
              folder and saved workout are retained.
            </p>
          )}
          {busy && <p role="status">Confirming library save…</p>}
          {saved && (
            <p role="status">
              The template was saved. Refresh the library view to finish.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {!pending && !saved && !resolved && (
            <button
              type="button"
              className="swt-reload"
              disabled={loading || busy || accountChanged}
              onClick={() => setReload((value) => value + 1)}
            >
              Reload workout library folders
            </button>
          )}
          {pending && (
            <button
              ref={recheckButton}
              type="button"
              disabled={loading || busy}
              onClick={() => void save()}
            >
              Recheck library save
            </button>
          )}
          {pending && (
            <button
              type="button"
              disabled={loading || busy}
              onClick={() => void review()}
            >
              Review saved library outcome
            </button>
          )}
          {inspection && (
            <section aria-label="Retained library outcome">
              <p>
                {inspection.outcome.status === "unconfirmed"
                  ? "This save is still unconfirmed. Its recovery identity is retained."
                  : inspection.outcome.status === "saved"
                    ? `Template saved: ${inspection.outcome.workout?.title}`
                    : inspection.outcome.status === "changed"
                      ? `The saved template has since changed: ${inspection.outcome.workout?.title}`
                      : inspection.outcome.status === "deleted"
                        ? "The saved template has since been deleted."
                        : "The provider rejected this save; no template was added."}
              </p>
              {inspection.outcome.status !== "unconfirmed" && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolve(true)}
                  >
                    Acknowledge outcome and close
                  </button>
                  <button
                    type="button"
                    disabled={busy || accountChanged}
                    onClick={() => void resolve(false)}
                  >
                    Review retained library draft
                  </button>
                </>
              )}
            </section>
          )}
          {(saved || resolved) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void refreshSaved()}
            >
              Refresh saved template
            </button>
          )}
          <footer>
            <button type="button" disabled={busy || !!pending} onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                loading || busy || !!pending || !!saved || !!resolved || !canAdd
              }
              aria-busy={busy}
            >
              Add
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  )
}
