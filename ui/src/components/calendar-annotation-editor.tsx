import { useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  CheckSquare,
  GripVertical,
  Plus,
  Pencil,
  Trash2,
  X,
} from "lucide-react"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import {CalendarEntryActions} from "./calendar-entry-actions"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog"
import { trainingCacheScope } from "@/lib/training-context"
import { randomId } from "@/lib/random-id"
import {
  annotationClient,
  annotationEntry,
  annotationProblem,
  annotationRecoveryKey,
  availabilityReasons,
  availabilitySports,
  clearAnnotationRecovery,
  createAnnotationAttempt,
  deleteAnnotationAttempt,
  findAnnotationCreationRecovery,
  newAnnotation,
  readAnnotationRecovery,
  rememberAnnotationRecovery,
  validAnnotationDate,
  type AnnotationAttempt,
  type AnnotationEntry,
  type AnnotationError,
  type AnnotationKind,
  type AnnotationResult,
  type CalendarAnnotation,
  type GoalItem,
} from "@/lib/calendar-annotations"
import "./calendar-annotation-editor.css"

function AnnotationDateField({
  label,
  ariaLabel = label,
  value,
  disabled,
  min,
  onChange,
}: {
  label: string
  ariaLabel?: string
  value: string
  disabled: boolean
  min?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="cae-field cae-date">
      {label}
      <span>
        {validAnnotationDate(value)
          ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            })
          : "Choose date"}
      </span>
      <input
        aria-label={ariaLabel}
        type="date"
        required
        value={value}
        min={min}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function AvailabilityDescription({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const field = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (field.current && field.current.innerText !== value)
      field.current.innerText = value
  }, [value])
  return (
    <div
      ref={field}
      role="textbox"
      aria-label="Description"
      aria-multiline="true"
      aria-disabled={disabled}
      contentEditable={disabled ? false : "plaintext-only"}
      suppressContentEditableWarning
      data-cy="availabilityDescriptionInputTextarea"
      onInput={(event) => {
        if (!disabled) onChange(event.currentTarget.innerText)
      }}
    />
  )
}

function GoalRow({
  goal,
  index,
  disabled,
  onChange,
  onRemove,
  keyboardActive,
  onKeyboardStart,
  onKeyboardFinish,
  onKeyboardCancel,
  onKeyboardMove,
}: {
  goal: GoalItem
  index: number
  disabled: boolean
  onChange: (goal: GoalItem) => void
  onRemove: () => void
  keyboardActive: boolean
  onKeyboardStart: () => void
  onKeyboardFinish: () => void
  onKeyboardCancel: () => void
  onKeyboardMove: (direction: -1 | 1) => void
}) {
  const sortable = useSortable({ id: goal.id, disabled })
  return (
    <div
      ref={sortable.setNodeRef}
      className="cae-goal-row"
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging || keyboardActive ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        className="cae-goal-handle"
        ref={sortable.setActivatorNodeRef}
        aria-label={`Reorder goal ${index + 1}`}
        disabled={disabled}
        {...sortable.attributes}
        {...sortable.listeners}
        data-goal-grip={goal.id}
        aria-pressed={keyboardActive || sortable.isDragging}
        aria-describedby="calendar-goal-reorder-help"
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault()
            event.stopPropagation()
            if (keyboardActive) onKeyboardFinish()
            else onKeyboardStart()
          } else if (
            keyboardActive &&
            ["ArrowUp", "ArrowDown", "Escape"].includes(event.key)
          ) {
            event.preventDefault()
            event.stopPropagation()
            if (event.key === "Escape") onKeyboardCancel()
            else onKeyboardMove(event.key === "ArrowUp" ? -1 : 1)
          }
        }}
      >
        <GripVertical />
      </button>
      <input
        aria-label={`Complete goal ${index + 1}`}
        type="checkbox"
        checked={goal.completed}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...goal, completed: event.target.checked })
        }
      />
      <textarea
        aria-label={`Goal ${index + 1}`}
        placeholder="Add a new goal here"
        value={goal.text}
        disabled={disabled}
        rows={1}
        onChange={(event) => onChange({ ...goal, text: event.target.value })}
      />
      <button
        type="button"
        aria-label={`Remove goal ${index + 1}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <X />
      </button>
    </div>
  )
}

export function CalendarAnnotationEditor({
  kind,
  date,
  id,
  onClose,
  onSaved,
}: {
  kind: AnnotationKind
  date: string
  id?: string
  onClose: () => void
  onSaved: (result: AnnotationResult) => Promise<void> | void
}) {
  const [scope] = useState(trainingCacheScope)
  const [recoveryKey] = useState(() =>
    annotationRecoveryKey(scope, kind, id || date)
  )
  const [initial] = useState(() => newAnnotation(kind, date))
  const [entry, setEntry] = useState(initial),
    [baseline, setBaseline] = useState(initial)
  const [saved, setSaved] = useState<CalendarAnnotation | null>(null)
  const [loading, setLoading] = useState(Boolean(id)),
    [loadVersion, setLoadVersion] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("")
  const [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false)
  const [confirmation, setConfirmation] = useState<
    "close" | "reload" | "delete" | null
  >(null)
  const [sportsOpen, setSportsOpen] = useState(false)
  const [keyboardGoal, setKeyboardGoal] = useState<string | null>(null)
  const [reorderAnnouncement, setReorderAnnouncement] = useState("")
  const keyboardOrder = useRef<string[]>([])
  const attempt = useRef<AnnotationAttempt | null>(null),
    inFlight = useRef(false),
    mounted = useRef(true)
  const editor = useRef<HTMLDivElement>(null)
  const activeRecoveryKey = useRef(recoveryKey)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )
  const dirty = JSON.stringify(entry) !== JSON.stringify(baseline)
  const disabled =
    loading ||
    loadFailed ||
    busy ||
    uncertain ||
    Boolean(saved && !saved.editable)
  const problem = annotationProblem(entry)
  const canSave =
    !loading &&
    !busy &&
    !conflict &&
    (uncertain ||
      (!loadFailed &&
        (!saved || saved.editable) &&
        !problem &&
        (!saved || dirty)))
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(Boolean(id))
    setLoadFailed(false)
    setError("")
    void (async () => {
      let recovered = readAnnotationRecovery(recoveryKey)
      try {
        const row = id
          ? await annotationClient.read(id, controller.signal)
          : null
        if (controller.signal.aborted) return
        if (row && row.kind !== kind)
          throw new Error(
            "The saved calendar entry has a different type. Reopen its current card."
          )
        const found = row
          ? findAnnotationCreationRecovery(scope, kind, row.creationId)
          : null
        if (!recovered && found) {
          recovered = found.recovery
          activeRecoveryKey.current = found.key
        }
        const original = row ? annotationEntry(row) : initial
        setSaved(row)
        setBaseline(original)
        setEntry(recovered?.draft || original)
        attempt.current = recovered?.attempt || null
        setUncertain(Boolean(recovered))
        setConflict(false)
        setNotice(
          recovered
            ? "An earlier request needs confirmation. Recheck it before making another change."
            : ""
        )
      } catch (cause) {
        if (!controller.signal.aborted) {
          setLoadFailed(true)
          setError(
            cause instanceof Error
              ? cause.message
              : "The saved entry could not be loaded."
          )
          if (recovered) {
            setEntry(recovered.draft)
            attempt.current = recovered.attempt
            setUncertain(true)
            setNotice(
              "The saved row could not be loaded. Recheck the retained request to confirm its outcome."
            )
          }
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [id, kind, initial, recoveryKey, scope, loadVersion])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || uncertain || busy) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [dirty, uncertain, busy])
  useEffect(() => {
    if (!sportsOpen) return
    const dismiss = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".cae-sports")
      )
        setSportsOpen(false)
    }
    document.addEventListener("pointerdown", dismiss)
    return () => document.removeEventListener("pointerdown", dismiss)
  }, [sportsOpen])
  const close = () => {
    if (busy || inFlight.current) return
    if (dirty || uncertain) setConfirmation("close")
    else onClose()
  }
  const update = (change: Partial<AnnotationEntry>) => {
    if (!disabled) {
      setEntry((current) => ({ ...current, ...change }))
      setError("")
      setNotice("")
    }
  }
  const reload = () => {
    if (busy || uncertain) return
    if (dirty) setConfirmation("reload")
    else setLoadVersion((value) => value + 1)
  }
  const submit = async (closeAfter: boolean, deleting = false) => {
    if (
      inFlight.current ||
      busy ||
      loading ||
      (deleting ? !saved || !saved.editable || uncertain : !canSave)
    )
      return
    inFlight.current = true
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const request =
        attempt.current ||
        (deleting
          ? deleteAnnotationAttempt(saved!)
          : createAnnotationAttempt(entry, saved))
      attempt.current = request
      rememberAnnotationRecovery(activeRecoveryKey.current, {
        attempt: request,
        draft: entry,
      })
      window.dispatchEvent(new Event("training-mutation-started"))
      const result = await annotationClient.write(
        uncertain
          ? { ...request, body: { ...request.body, reconcileOnly: true } }
          : request
      )
      if (!mounted.current) return
      clearAnnotationRecovery(activeRecoveryKey.current)
      attempt.current = null
      setUncertain(false)
      setConflict(false)
      if (result.annotation) {
        setSaved(result.annotation)
        const committed = annotationEntry(result.annotation)
        setEntry(committed)
        setBaseline(committed)
      }
      setNotice(result.deleted ? "Entry deleted." : "Entry saved.")
      try {
        await onSaved(result)
      } catch {
        if (mounted.current)
          setNotice(
            "Entry saved. Refresh the calendar to reload its current view."
          )
      }
      if (mounted.current && (closeAfter || result.deleted)) onClose()
    } catch (cause) {
      if (!mounted.current) return
      const failure = cause as AnnotationError
      setError(
        failure.message ||
          "The calendar entry could not be saved. Your draft is retained."
      )
      if (failure.uncertain) setUncertain(true)
      else {
        clearAnnotationRecovery(activeRecoveryKey.current)
        attempt.current = null
        setUncertain(false)
        setConflict(failure.status === 409)
      }
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
      window.dispatchEvent(new Event("training-mutation-settled"))
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent
          ref={editor}
          fullscreen
          showCloseButton={false}
          className="calendar-annotation-editor"
          initialFocus={() =>
            editor.current?.querySelector<HTMLInputElement>(
              "input:not(:disabled)"
            ) ||
            editor.current?.querySelector<HTMLButtonElement>(
              "[data-entry-back]"
            ) ||
            false
          }
        >
          <header className="cae-heading">
            <button
              type="button"
              data-entry-back
              aria-label="Back to calendar"
              disabled={busy}
              onClick={close}
            >
              <ArrowLeft />
            </button>
            <DialogTitle>
              {kind === "goals"
                ? saved
                  ? "Edit Goals"
                  : "Add Goals"
                : "Availability"}
            </DialogTitle>
          </header>
          <DialogDescription className="sr-only">
            Edit this dated calendar entry. Save confirms persistence before
            returning to the calendar.
          </DialogDescription>
          <div className="cae-form">
            {loading && <p role="status">Loading saved entry…</p>}
            {(error || notice || conflict || (saved && !saved.editable)) && (
              <div className="cae-status">
                {error && <p role="alert">{error}</p>}
                {notice && <p role="status">{notice}</p>}
                {saved && !saved.editable && (
                  <p role="status">
                    This entry has changed at the provider and is read only.
                    Reload its current values before editing.
                  </p>
                )}
                {(conflict ||
                  (id && !saved && !loading) ||
                  (saved && !saved.editable)) && (
                  <button
                    type="button"
                    disabled={busy || uncertain}
                    onClick={reload}
                  >
                    Reload latest entry
                  </button>
                )}
              </div>
            )}
            {kind === "goals" ? (
              <>
                <label className="cae-field cae-goals-title">
                  List Title
                  <input
                    aria-label="List Title"
                    maxLength={150}
                    value={entry.title}
                    disabled={disabled}
                    onChange={(event) => update({ title: event.target.value })}
                  />
                </label>
                <AnnotationDateField
                  label="Date"
                  ariaLabel="Goals date"
                  value={entry.date}
                  disabled={disabled}
                  onChange={(date) => update({ date, endDate: date })}
                />
                <small className="cae-required">Required</small>
                <p id="calendar-goal-reorder-help" className="sr-only">
                  Press Space or Enter to start reordering. Use Up and Down
                  arrows, then Space or Enter to finish. Escape restores the
                  previous order.
                </p>
                <p className="sr-only" role="status" aria-live="polite">
                  {reorderAnnouncement}
                </p>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={() => setKeyboardGoal(null)}
                  onDragEnd={({ active, over }) => {
                    if (!disabled && over && active.id !== over.id)
                      update({
                        goals: arrayMove(
                          entry.goals,
                          entry.goals.findIndex(
                            (goal) => goal.id === active.id
                          ),
                          entry.goals.findIndex((goal) => goal.id === over.id)
                        ),
                      })
                  }}
                >
                  <SortableContext
                    items={entry.goals.map((goal) => goal.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="cae-goals">
                      {entry.goals.map((goal, index) => (
                        <GoalRow
                          key={goal.id}
                          goal={goal}
                          index={index}
                          disabled={disabled}
                          keyboardActive={keyboardGoal === goal.id}
                          onKeyboardStart={() => {
                            keyboardOrder.current = entry.goals.map(
                              (item) => item.id
                            )
                            setKeyboardGoal(goal.id)
                            setReorderAnnouncement(
                              `Picked up goal ${index + 1}. Use Up and Down arrows to change its position.`
                            )
                          }}
                          onKeyboardFinish={() => {
                            setKeyboardGoal(null)
                            setReorderAnnouncement(
                              `Goal placed at position ${index + 1}.`
                            )
                          }}
                          onKeyboardCancel={() => {
                            const byId = new Map(
                              entry.goals.map((item) => [item.id, item])
                            )
                            update({
                              goals: [
                                ...keyboardOrder.current.flatMap((id) =>
                                  byId.has(id) ? [byId.get(id)!] : []
                                ),
                                ...entry.goals.filter(
                                  (item) =>
                                    !keyboardOrder.current.includes(item.id)
                                ),
                              ],
                            })
                            setKeyboardGoal(null)
                            setReorderAnnouncement("Goal order restored.")
                          }}
                          onKeyboardMove={(direction) => {
                            const target = index + direction
                            if (target < 0 || target >= entry.goals.length) {
                              setReorderAnnouncement(
                                direction < 0
                                  ? "This is the first goal."
                                  : "This is the last goal."
                              )
                              return
                            }
                            update({
                              goals: arrayMove(entry.goals, index, target),
                            })
                            setReorderAnnouncement(
                              `Goal moved to position ${target + 1} of ${entry.goals.length}.`
                            )
                            requestAnimationFrame(() =>
                              editor.current
                                ?.querySelector<HTMLButtonElement>(
                                  `[data-goal-grip="${goal.id}"]`
                                )
                                ?.focus()
                            )
                          }}
                          onChange={(changed) =>
                            update({
                              goals: entry.goals.map((item) =>
                                item.id === goal.id ? changed : item
                              ),
                            })
                          }
                          onRemove={() =>
                            update({
                              goals: entry.goals.filter(
                                (item) => item.id !== goal.id
                              ),
                            })
                          }
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <button
                  className="cae-add-goal"
                  type="button"
                  disabled={disabled || entry.goals.length >= 100}
                  onClick={() => {
                    update({
                      goals: [
                        ...entry.goals,
                        { id: randomId(), text: "", completed: false },
                      ],
                    })
                    requestAnimationFrame(() =>
                      editor.current
                        ?.querySelector<HTMLTextAreaElement>(
                          `.cae-goal-row:last-child textarea`
                        )
                        ?.focus()
                    )
                  }}
                >
                  <Plus size={18} /> ADD NEW GOAL
                </button>
              </>
            ) : (
              <>
                <p className="cae-availability-heading">
                  Training Availability
                  <strong>
                    {entry.mode === "limited"
                      ? "Limited Availability"
                      : "Unavailable"}
                  </strong>
                </p>
                <div className="cae-dates">
                  <AnnotationDateField
                    label="Start Date"
                    value={entry.date}
                    disabled={disabled}
                    onChange={(date) => update({ date })}
                  />
                  <AnnotationDateField
                    label="End Date"
                    value={entry.endDate}
                    disabled={disabled}
                    min={entry.date}
                    onChange={(endDate) => update({ endDate })}
                  />
                </div>
                <fieldset className="cae-availability" disabled={disabled}>
                  <legend>Training Availability</legend>
                  <label>
                    <input
                      type="radio"
                      name="availability"
                      checked={entry.mode === "unavailable"}
                      onChange={() =>
                        update({ mode: "unavailable", title: "Unavailable" })
                      }
                    />
                    I am unable to train
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="availability"
                      checked={entry.mode === "limited"}
                      onChange={() =>
                        update({
                          mode: "limited",
                          title: "Limited Availability",
                        })
                      }
                    />
                    I have limited availability to train
                  </label>
                </fieldset>
                {entry.mode === "limited" && (
                  <div
                    className="cae-sports"
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && sportsOpen) {
                        event.preventDefault()
                        event.stopPropagation()
                        setSportsOpen(false)
                        event.currentTarget
                          .querySelector<HTMLButtonElement>("button")
                          ?.focus()
                      }
                    }}
                  >
                    <button
                      type="button"
                      aria-expanded={sportsOpen}
                      disabled={disabled}
                      onClick={() => setSportsOpen((value) => !value)}
                    >
                      Available Sport Types{" "}
                      {entry.sports.length ? `(${entry.sports.length})` : ""}
                    </button>
                    {entry.sports.length > 0 && (
                      <div className="cae-sport-chips">
                        {entry.sports.map((sport) => (
                          <span key={sport}>
                            {sport}
                            <button
                              type="button"
                              aria-label={`Remove ${sport}`}
                              disabled={disabled}
                              onClick={() =>
                                update({
                                  sports: entry.sports.filter(
                                    (item) => item !== sport
                                  ),
                                })
                              }
                            >
                              <X size={14} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <small>Required</small>
                    {sportsOpen && (
                      <div
                        className="cae-sport-options"
                        role="group"
                        aria-label="Available Sport Types"
                      >
                        {availabilitySports.map((sport) => (
                          <label key={sport}>
                            <input
                              type="checkbox"
                              checked={entry.sports.includes(sport)}
                              disabled={disabled}
                              onChange={(event) =>
                                update({
                                  sports: event.target.checked
                                    ? [...entry.sports, sport]
                                    : entry.sports.filter(
                                        (item) => item !== sport
                                      ),
                                })
                              }
                            />
                            {sport}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {entry.mode === "limited" &&
                  entry.sports.some(
                    (sport) => sport === "Brick" || sport === "Custom"
                  ) && (
                    <p className="cae-native-warning" role="status">
                      Intervals.icu cannot restrict availability to Brick or
                      Custom. Your exact selections are saved here; native
                      availability will allow all supported sports.
                    </p>
                  )}
                {saved?.nativeWarning && (
                  <p className="cae-native-warning" role="status">
                    {saved.nativeWarning}
                  </p>
                )}
                <label className="cae-reason">
                  Reason
                  <select
                    aria-label="Reason"
                    value={entry.reason}
                    disabled={disabled}
                    onChange={(event) => update({ reason: event.target.value })}
                  >
                    {availabilityReasons.map((reason) => (
                      <option key={reason}>{reason}</option>
                    ))}
                  </select>
                </label>
                <section className="cae-description">
                  <span>Description</span>
                  <AvailabilityDescription
                    value={entry.description}
                    disabled={disabled}
                    onChange={(value) => update({ description: value })}
                  />
                </section>
              </>
            )}
            {problem && dirty && (
              <p className="cae-validation" role="status">
                {problem}
              </p>
            )}
            <footer className="cae-footer">
              {saved && (
                <button
                  type="button"
                  className="cae-delete"
                  disabled={disabled}
                  onClick={() => setConfirmation("delete")}
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              )}
              <button type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="cae-save"
                disabled={!canSave}
                onClick={() => void submit(true)}
              >
                {busy ? "Saving…" : uncertain ? "Recheck request" : "Save"}
              </button>
            </footer>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === "delete"
                ? "Delete calendar entry?"
                : confirmation === "reload"
                  ? "Reload latest entry?"
                  : uncertain
                    ? "Close with an unconfirmed request?"
                    : "Discard unsaved changes?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === "delete"
                ? "This removes the saved entry from the calendar. Your workouts remain unchanged."
                : confirmation === "reload"
                  ? "Reloading replaces your local draft with the current saved entry."
                  : uncertain
                    ? "The request may already have reached the provider. Its exact recovery request will remain available when you reopen this entry."
                    : "Your unsaved changes will be lost."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                const action = confirmation
                setConfirmation(null)
                if (busy) return
                if (action === "delete") void submit(true, true)
                else if (action === "reload") {
                  clearAnnotationRecovery(activeRecoveryKey.current)
                  attempt.current = null
                  setLoadVersion((value) => value + 1)
                } else onClose()
              }}
            >
              {confirmation === "delete"
                ? "Delete entry"
                : confirmation === "reload"
                  ? "Reload entry"
                  : uncertain
                    ? "Close and keep recovery"
                    : "Discard draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function CalendarAnnotationCard({
  entry,
  onOpen,
  onSaved,
  onTransfer,
  disabled=false,
}: {
  entry: CalendarAnnotation
  onOpen: () => void
  onSaved: (result: AnnotationResult) => Promise<void> | void
  onTransfer?: (mode:"copy"|"cut")=>void
  disabled?:boolean
}) {
  const [open, setOpen] = useState(false),
    [confirmation, setConfirmation] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const key = annotationRecoveryKey(trainingCacheScope(), entry.kind, entry.id)
  const [pending, setPending] = useState(
    () => readAnnotationRecovery(key)?.attempt || null
  )
  const inFlight = useRef(false),
    openEditor = useRef(false)
  const remove = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError("")
    let request:ReturnType<typeof deleteAnnotationAttempt>|undefined
    let providerStarted=false
    try {
      request = pending || deleteAnnotationAttempt(entry)
      rememberAnnotationRecovery(key, {
        attempt: request,
        draft: annotationEntry(entry),
      },{requireStorage:true})
      window.dispatchEvent(new Event("training-mutation-started"))
      providerStarted=true
      const result = await annotationClient.write(
        pending
          ? { ...request, body: { ...request.body, reconcileOnly: true } }
          : request
      )
      clearAnnotationRecovery(key)
      setPending(null)
      try{await onSaved(result)}catch{setError("Entry deleted. Refresh the calendar to load its current state.")}
      setOpen(false)
      setConfirmation(false)
    } catch (cause) {
      const failure = cause as AnnotationError
      setError(failure.message || "The entry could not be deleted.")
      if (providerStarted&&(pending||failure.uncertain)&&request) setPending(request)
      else if(providerStarted) {
        clearAnnotationRecovery(key)
        setPending(null)
      }
    } finally {
      inFlight.current = false
      setBusy(false)
      if(providerStarted)window.dispatchEvent(new Event("training-mutation-settled"))
    }
  }
  const deleteConfirmation=<AlertDialog open={confirmation} onOpenChange={value=>{if(!busy)setConfirmation(value)}}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Are you sure you want to delete?</AlertDialogTitle><AlertDialogDescription>This cannot be undone!</AlertDialogDescription></AlertDialogHeader>
      {error&&<p role="alert">{error}</p>}
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event=>{event.preventDefault();void remove()}}>{busy?"Deleting…":pending?"Recheck request":"Delete"}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
  if (entry.kind === "availability")
    return (
      <>
        <div className="calendar-annotation-with-actions">
        <Popover
          open={open}
          onOpenChange={(value) => {
            if (!busy) setOpen(value)
          }}
          onOpenChangeComplete={(value) => {
            if (!value && openEditor.current) {
              openEditor.current = false
              onOpen()
            }
          }}
        >
          <PopoverTrigger
            className={`calendar-availability-ribbon ${entry.mode}`}
            aria-label={`View ${entry.mode === "limited" ? "Limited Availability" : "Unavailable"}`}
            onClick={() => {
              const recovered = readAnnotationRecovery(key)
              setPending(recovered?.attempt || null)
            }}
          >
            {entry.mode === "limited" ? "LIMITED" : "UNAVAILABLE"}
          </PopoverTrigger>
          <PopoverContent
            className="calendar-availability-popover"
            align="start"
          >
            <header>
              <button
                type="button"
                disabled={busy || Boolean(pending)}
                onClick={() => {
                  openEditor.current = true
                  setOpen(false)
                }}
              >
                <Pencil size={15} />
                <span className="sr-only">Edit availability</span>
              </button>
              <button
                type="button"
                disabled={busy || !entry.editable || Boolean(pending)}
                onClick={() => setConfirmation(true)}
              >
                <Trash2 size={15} />
                <span className="sr-only">Delete availability</span>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label="Close availability"
                onClick={() => setOpen(false)}
              >
                <X size={17} />
              </button>
            </header>
            <h2>
              {entry.mode === "limited"
                ? "Limited Availability"
                : "Unavailable"}
            </h2>
            <p>
              {[
                entry.date,
                ...(entry.date === entry.endDate ? [] : [entry.endDate]),
              ]
                .map((date) =>
                  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  })
                )
                .join(" – ")}
            </p>
            {entry.description && (
              <>
                <h3>Description</h3>
                <p>{entry.description}</p>
              </>
            )}
            {entry.mode === "limited" && (
              <>
                <h3>Available Sport Types</h3>
                <p>{entry.sports.join(", ")}</p>
              </>
            )}
            {entry.reason !== "None" && <p>Reason: {entry.reason}</p>}
            {entry.nativeWarning && (
              <p className="cae-native-warning">{entry.nativeWarning}</p>
            )}
            {error && <p role="alert">{error}</p>}
            {pending && (
              <>
                <p role="status">
                  An earlier request needs confirmation. Its original operation
                  is retained.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  Recheck request
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>
        {onTransfer&&<CalendarEntryActions title="Availability" disabled={disabled||busy||Boolean(pending)||!entry.editable||!entry.metadataCurrent} onTransfer={onTransfer}/>}
        </div>
        {deleteConfirmation}
      </>
    )
  return (
    <>
    <div className="calendar-annotation-with-actions">
    <button
      className={`calendar-annotation-card cae-card-${entry.kind}`}
      type="button"
      onClick={onOpen}
      aria-label={`Edit ${entry.kind === "goals" ? entry.title : "Availability"}`}
    >
      <span>
        <CheckSquare size={16} />
        {entry.kind === "goals"
          ? entry.title
          : entry.mode === "limited"
            ? "Limited Availability"
            : "Unavailable"}
      </span>
      {entry.kind === "goals" ? (
        <small>
          {entry.goals.filter((goal) => goal.completed).length}/
          {entry.goals.length} goals completed
        </small>
      ) : (
        <small>
          {entry.reason !== "None"
            ? entry.reason
            : entry.description ||
              (entry.mode === "limited"
                ? entry.sports.join(", ")
                : "Unable to train")}
        </small>
      )}
    </button>
    {onTransfer&&<CalendarEntryActions title={entry.title} disabled={disabled||busy||!entry.editable||!entry.metadataCurrent} editDisabled={Boolean(pending)} transferDisabled={Boolean(pending)} onTransfer={onTransfer} onEdit={onOpen} onDelete={()=>setConfirmation(true)}/>}
    </div>
    {deleteConfirmation}
    </>
  )
}
