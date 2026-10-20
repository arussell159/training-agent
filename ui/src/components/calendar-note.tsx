import { useEffect, useRef, useState } from "react"
import {
  EllipsisVertical,
  FileText,
  Copy,
  Trash2,
  Pencil,
  Scissors,
} from "lucide-react"
import { apiFetch } from "@/lib/api-client"
import { randomId } from "@/lib/random-id"
import {
  changeWorkout,
  saveCalendarNote,
  trainingCacheScope,
  type PlannedWorkout,
} from "@/lib/training-context"
import { confirmWithFramework7 } from "@/lib/framework7-confirm"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function CalendarNoteCard({
  workout,
  onOpen,
  onAction,
  disabled,
}: {
  workout: PlannedWorkout
  onOpen: () => void
  onAction: (action: "copy" | "cut" | "delete") => void
  disabled: boolean
}) {
  const openAfterMenu = useRef(false)
  disabled = disabled || Boolean(workout.app_pending_operation)
  return (
    <div
      role="button"
      tabIndex={0}
      className="calendar-note-card"
      data-calendar-note="true"
      onClick={() => {
        if (!disabled) onOpen()
      }}
      onKeyDown={(event) => {
        if (
          !disabled &&
          event.target === event.currentTarget &&
          ["Enter", " "].includes(event.key)
        ) {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="size-4 shrink-0 text-slate-500" />
        </div>
        <div
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <DropdownMenu
            onOpenChangeComplete={(open) => {
              if (!open && openAfterMenu.current) {
                openAfterMenu.current = false
                onOpen()
              }
            }}
          >
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="calendar-note-options -my-1 -mr-1"
                  disabled={disabled}
                  aria-label={`Options for ${workout.title}`}
                />
              }
            >
              <EllipsisVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="calendar-context-menu">
              <DropdownMenuItem
                disabled={disabled}
                onClick={() => {
                  openAfterMenu.current = true
                }}
              >
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={disabled}
                onClick={() => onAction("cut")}
              >
                <Scissors />
                Cut
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction("copy")}>
                <Copy />
                Copy
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onAction("delete")}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <strong className="calendar-note-title block min-w-0 text-xs font-normal break-words">
        {workout.title}
      </strong>
      {(workout.details || workout.goal) && (
        <p className="mt-2 line-clamp-4 text-xs text-muted-foreground">
          {workout.details || workout.goal}
        </p>
      )}
    </div>
  )
}

export function CalendarNoteEditor({
  date,
  workout,
  onClose,
}: {
  date: string
  workout?: PlannedWorkout
  onClose: () => void
}) {
  const draftKey = `calendar-note-draft:${trainingCacheScope()}:${workout?.id || date}`
  const [initial] = useState(() => {
    if (!workout)
      try {
        const saved = JSON.parse(localStorage.getItem(draftKey) || "null")
        if (
          saved &&
          typeof saved.name === "string" &&
          typeof saved.description === "string" &&
          typeof saved.creationId === "string" &&
          typeof saved.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(saved.date)
        )
          return saved as {
            name: string
            description: string
            date: string
            creationId: string
            attempted: boolean
          }
      } catch {
        /* Draft storage is optional. */
      }
    return {
      name: workout?.title || "Note",
      description: workout?.goal || "",
      date,
      creationId: randomId(),
      attempted: false,
    }
  })
  const [name, setName] = useState(initial.name),
    [description, setDescription] = useState(initial.description),
    [day, setDay] = useState(initial.date)
  const [revision, setRevision] = useState("")
  const [attempted, setAttempted] = useState(Boolean(initial.attempted))
  const [loading, setLoading] = useState(Boolean(workout)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const saving = useRef(false)
  useEffect(() => {
    if (!workout) return
    const controller = new AbortController()
    void apiFetch(`/api/calendar/notes/${encodeURIComponent(workout.id)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok)
          throw new Error(data.error || "Could not load the note.")
        if (
          typeof data.name !== "string" ||
          typeof data.description !== "string" ||
          typeof data.date !== "string" ||
          typeof data.revision !== "string"
        )
          throw new Error(
            "The note response is incomplete. Reopen it to retry."
          )
        if (!controller.signal.aborted) {
          setName(data.name)
          setDescription(data.description)
          setDay(data.date)
          setRevision(data.revision)
          setLoading(false)
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message)
      })
    return () => controller.abort()
  }, [workout])

  const save = async () => {
    if (saving.current || loading || !name.trim()) return
    saving.current = true
    setBusy(true)
    setError("")
    if (!workout) {
      setAttempted(true)
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            name,
            description,
            date: day,
            creationId: initial.creationId,
            attempted: true,
          })
        )
      } catch {
        /* Keep the in-memory attempt. */
      }
    }
    try {
      await saveCalendarNote({
        id: workout?.id,
        name,
        description,
        date: day,
        revision,
        creationId: initial.creationId,
        reconcileOnly: attempted,
      })
      try {
        localStorage.removeItem(draftKey)
      } catch {
        /* Optional storage. */
      }
      onClose()
    } catch (cause) {
      const failure = cause as Error & { status?: number }
      if (failure.status && failure.status >= 400 && failure.status < 500) {
        setAttempted(false)
        try {
          localStorage.removeItem(draftKey)
        } catch {
          /* Optional storage. */
        }
      }
      setError(
        failure.message ||
          "The note could not be saved. Your draft is retained."
      )
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const remove = async () => {
    if (
      !workout ||
      busy ||
      !(await confirmWithFramework7(
        "Delete note?",
        `Delete “${name}” from your Intervals.icu calendar?`
      ))
    )
      return
    setBusy(true)
    setError("")
    try {
      await changeWorkout(workout.id, "delete")
      onClose()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The note could not be deleted."
      )
      setBusy(false)
    }
  }
  const locked = busy || loading || (!workout && attempted)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{workout ? "Edit Note" : "Add Note"}</DialogTitle>
          <DialogDescription>
            Save this note to your Intervals.icu calendar.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
          className="grid gap-4"
        >
          <label className="grid gap-1.5">
            Title
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              required
              disabled={locked}
              autoFocus
            />
          </label>
          <label className="grid gap-1.5">
            Date
            <Input
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              required
              disabled={locked}
            />
          </label>
          <label className="grid gap-1.5">
            Note
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={12000}
              rows={6}
              disabled={locked}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            {workout && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void remove()}
                disabled={busy || loading}
              >
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || loading || !name.trim()}>
              {busy
                ? "Saving…"
                : attempted && !workout
                  ? "Recheck save"
                  : "Save Note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
