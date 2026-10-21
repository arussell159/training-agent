import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog"
import { randomId } from "@/lib/random-id"
import { trainingCacheScope } from "@/lib/training-context"
import { readPendingEventCreation, rememberPendingEventCreation, clearPendingEventCreation, type PendingEventCreation } from "@/lib/pending-event-creation"
import {
  raceEventTypeGroups,
  raceEventTypes,
  runningRaceDistances,
  raceAtpEventTypes,
  raceGoalDistanceUnits,
  emptyRaceGoals,
  validateRaceEventDetails,
  readRaceEvent,
  saveRaceEvent,
  type RaceEventDetails,
  type RaceEventRead,
  type RaceEventSaveResult,
} from "@/lib/race-event-details"
import "./desktop-event-dialog.css"

export function DesktopEventDialog({
  open,
  initialDate = "",
  eventId,
  initialEdit=false,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  initialDate?: string
  eventId?: string
  initialEdit?:boolean
  onOpenChange: (open: boolean) => void
  onSaved: (result: RaceEventSaveResult) => void | Promise<void>
}) {
  const [draft, setDraft] = useState<RaceEventDetails>({
    name: "",
    date: initialDate,
    priority: "",
    eventType: "",
    description: "",
  })
  const [loaded, setLoaded] = useState<RaceEventRead | null>(null)
  const [creationId, setCreationId] = useState(randomId)
  const [scope] = useState(trainingCacheScope)
  const [pending, setPending] = useState<PendingEventCreation | null>(null)
  const pendingRef = useRef<PendingEventCreation | null>(null)
  const [pendingBlocked, setPendingBlocked] = useState(false)
  const [restoredPending, setRestoredPending] = useState(false)
  const [recoveryRetry, setRecoveryRetry] = useState(0)
  const [loading, setLoading] = useState(Boolean(eventId))
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [replayEventId, setReplayEventId] = useState<string | null>(null)
  const [retainedDraft, setRetainedDraft] = useState(false)
  const [error, setError] = useState("")
  const [view, setView] = useState<"edit" | "summary">(
    eventId&&!initialEdit ? "summary" : "edit"
  )
  const [goalsOpen, setGoalsOpen] = useState(false)
  const [customGoal, setCustomGoal] = useState("")
  const description = useRef<HTMLDivElement>(null)
  const descriptionValue = useRef(draft.description)
  descriptionValue.current = draft.description
  const attachDescription = useCallback((node: HTMLDivElement | null) => {
    description.current = node
    // Dialog portals can mount after the recovery effects have run. Populate
    // the actual node when it appears, without resetting the caret on typing.
    if (node) node.textContent = descriptionValue.current
  }, [])
  const saving = useRef(false)
  const acceptPending = (value: PendingEventCreation | null) => {
    pendingRef.current = value
    setPending(value)
  }
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setError("")
    setUncertain(false)
    setReplayEventId(null)
    setRetainedDraft(false)
    acceptPending(null)
    setPendingBlocked(false)
    setRestoredPending(false)
    setLoaded(null)
    setLoading(Boolean(eventId))
    setCreationId(randomId())
    setView(eventId&&!initialEdit ? "summary" : "edit")
    setGoalsOpen(false)
    setCustomGoal("")
    const blank = {
      name: "",
      date: initialDate,
      priority: "" as const,
      eventType: "",
      description: "",
    }
    setDraft(blank)
    if (description.current) description.current.textContent = ""
    if (!eventId) {
      try {
        const retained = readPendingEventCreation(localStorage,scope)
        if (retained) {
          acceptPending(retained)
          setCreationId(retained.creationId)
          setDraft(retained.draft)
          setGoalsOpen(retained.goalsOpen)
          setCustomGoal(retained.customGoal)
          setReplayEventId(retained.replayEventId || null)
          setUncertain(!retained.replayEventId)
          setRestoredPending(true)
          if (description.current) description.current.textContent = retained.draft.description
        }
      } catch (reason) {
        setPendingBlocked(true)
        setError(reason instanceof Error ? reason.message : "The retained Event draft could not be loaded.")
      }
    }
    if (eventId)
      void readRaceEvent(eventId, controller.signal)
        .then((value) => {
          if (controller.signal.aborted) return
          setLoaded(value)
          setDraft({
            name: value.name,
            date: value.date,
            priority: value.priority,
            eventType: value.eventType,
            description: value.description,
            raceDistance: value.raceDistance,
            atpEventType: value.atpEventType,
            goals: value.goals,
          })
          if (description.current)
            description.current.textContent = value.description
        })
        .catch((reason) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error
                ? reason.message
                : "The event could not be loaded."
            )
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    return () => controller.abort()
  }, [open, eventId, initialDate, initialEdit, scope, recoveryRetry])
  useEffect(() => {
    if (!pending || !pendingRef.current || pending.creationId !== creationId) return
    const next = {...pendingRef.current,draft,customGoal,goalsOpen}
    try {
      rememberPendingEventCreation(localStorage,scope,next)
      pendingRef.current = next
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Event draft could not be retained. Keep this editor open and retry.")
    }
  },[draft,customGoal,goalsOpen,pending,creationId,scope])
  useLayoutEffect(() => {
    if (view === "edit" && description.current)
      description.current.textContent = draft.description
    // Populate on view/recovered-identity transitions; typing must not reset the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, pending?.creationId])
  const disabled =
    busy || loading || uncertain || pendingBlocked || trainingCacheScope() !== scope || Boolean(loaded && !loaded.editable) || Boolean(eventId && !loaded)
  const change = (patch: Partial<RaceEventDetails>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setError("")
  }
  const goals = draft.goals || emptyRaceGoals()
  const changeGoals = (patch: Partial<typeof goals>) =>
    change({ goals: { ...goals, ...patch } })
  const close = () => {
    if (saving.current) return
    try {
      if (pendingRef.current)
        rememberPendingEventCreation(localStorage,scope,{...pendingRef.current,draft,customGoal,goalsOpen})
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Event draft could not be retained. Keep this editor open and retry.")
    }
  }
  let valid = false
  try {
    validateRaceEventDetails(uncertain && !loaded && pending ? pending.submitted : draft)
    valid = true
  } catch {
    /* Incomplete drafts stay editable. */
  }
  const submit = async () => {
    if (saving.current || loading || pendingBlocked || replayEventId || (loaded && !loaded.editable) || (eventId && !loaded)) return
    if (trainingCacheScope() !== scope) {setError("Your account changed. Close this editor and reopen Event in the current account.");return}
    let entry: RaceEventDetails
    try {
      entry = !loaded && pendingRef.current ? pendingRef.current.submitted : validateRaceEventDetails(draft)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Check the event fields."
      )
      return
    }
    saving.current = true
    setBusy(true)
    setError("")
    const wasUncertain = uncertain
    let requestStarted = false
    try {
      if (!loaded) {
        const retained = pendingRef.current || {creationId,submitted:entry,draft,customGoal,goalsOpen}
        rememberPendingEventCreation(localStorage,scope,retained)
        acceptPending(retained)
      }
      requestStarted = true
      const result = await saveRaceEvent(
        entry,
        loaded ? { id: loaded.id, revision: loaded.revision } : { creationId }
      )
      setLoaded(result.event)
      setDraft(entry)
      setUncertain(false)
      setRetainedDraft(false)
      setRestoredPending(false)
      if (pendingRef.current) {
        if (clearPendingEventCreation(localStorage,scope,pendingRef.current.creationId)) acceptPending(null)
        else setError("Event saved. Reopen Event to finish clearing its retained recovery draft.")
      }
      try { await onSaved(result) }
      catch { setError("Event saved. Refresh the calendar to load its current state.") }
      setView("summary")
    } catch (reason) {
      const failure = reason as { status?: number; code?: string; eventId?: string }
      const status = failure?.status
      setUncertain(wasUncertain || (requestStarted && (!status || status >= 500 || status === 409)))
      if (status === 409 && failure.code === "EVENT_REPLAY_CHANGED" &&
        typeof failure.eventId === "string" && /^event:[1-9]\d*$/.test(failure.eventId)) {
        setUncertain(false)
        setReplayEventId(failure.eventId)
        if (pendingRef.current) {
          const retained = {...pendingRef.current,draft,customGoal,goalsOpen,replayEventId:failure.eventId}
          acceptPending(retained)
          try {rememberPendingEventCreation(localStorage,scope,retained)} catch { /* Close retries retention before dismissal. */ }
        }
      } else if (!loaded && requestStarted && !wasUncertain && status && status >= 400 && status < 500 && status !== 409 && pendingRef.current) {
        if (clearPendingEventCreation(localStorage,scope,pendingRef.current.creationId)) acceptPending(null)
        else setPendingBlocked(true)
      }
      setError(
        reason instanceof Error
          ? reason.message
          : "The event save could not be confirmed. Keep this draft and recheck."
      )
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const reloadExisting = async () => {
    if (!replayEventId || saving.current) return
    if (trainingCacheScope() !== scope) {setError("Your account changed. Close this editor and reopen Event in the current account.");return}
    saving.current = true
    setLoading(true)
    setError("")
    try {
      const current = await readRaceEvent(replayEventId)
      // Show authoritative current data without discarding the unsaved draft.
      // Reviewing that draft is an explicit action before a revisioned PUT.
      setLoaded(current)
      setReplayEventId(null)
      setRetainedDraft(true)
      setRestoredPending(false)
      setUncertain(false)
      setView("summary")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The existing Event could not be loaded. Your draft is retained.")
    } finally {
      saving.current = false
      setLoading(false)
    }
  }
  const discardRetainedDraft = () => {
    if (!loaded || saving.current) return
    if (pendingRef.current && !clearPendingEventCreation(localStorage,scope,pendingRef.current.creationId)) {
      setError("The retained draft could not be cleared. Keep this editor open and retry.")
      return
    }
    acceptPending(null)
    const {name,date,priority,eventType,description,raceDistance,atpEventType,goals} = loaded
    setDraft({name,date,priority,eventType,description,raceDistance,atpEventType,goals})
    setCustomGoal("")
    setRetainedDraft(false)
    setRestoredPending(false)
    setError("")
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close()
        else if (!saving.current) onOpenChange(true)
      }}
    >
      <DialogContent
        className="desktop-event-dialog"
        showCloseButton={!busy}
        aria-describedby={undefined}
      >
        <DialogTitle>
          {view === "summary"
            ? loaded?.name || "Event"
            : loaded
              ? "Edit Event"
              : "Add Event"}
        </DialogTitle>
        {loading && <p role="status">Loading event…</p>}
        {restoredPending && <p role="status">{replayEventId ? "Retained Event draft restored. Reload the existing Event before continuing." : "Unconfirmed Event draft restored. Recheck this save before creating another Event."}</p>}
        {retainedDraft && <p role="status">Current Event loaded. Your unsaved draft is retained; saving it updates this existing Event.</p>}
        {loaded && !loaded.metadataCurrent && !loaded.editable && <p role="status">This Event changed outside the app. Its saved details are retained, and editing is disabled until the mismatch is resolved.</p>}
        {view === "summary" ? (
          <section className="desktop-event-summary" aria-label="Event summary">
            {loaded && (
              <>
                <p>
                  {new Date(`${loaded.date}T12:00:00`).toLocaleDateString(
                    "en-US",
                    {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }
                  )}
                </p>
                <p>
                  {raceEventTypes[loaded.eventType]?.label}
                  {loaded.raceDistance
                    ? ` · ${runningRaceDistances.find(([value]) => value === loaded.raceDistance)?.[1] || ""}`
                    : ""}
                </p>
                <p className="desktop-event-countdown">
                  {Math.ceil(
                    (Date.parse(`${loaded.date}T00:00:00Z`) -
                      Date.parse(
                        `${new Date().toLocaleDateString("en-CA")}T00:00:00Z`
                      )) /
                      86400000
                  )}{" "}
                  days
                </p>
                {loaded.description && (
                  <>
                    <h3>Description</h3>
                    <p className="desktop-event-description">
                      {loaded.description}
                    </p>
                  </>
                )}
                {loaded.goals && (
                  <ul aria-label="Event goals">
                    {loaded.goals.time && <li>Time: {loaded.goals.time}</li>}
                    {loaded.goals.distance && (
                      <li>
                        Distance: {loaded.goals.distance}{" "}
                        {loaded.goals.distanceUnit}
                      </li>
                    )}
                    {loaded.goals.place && (
                      <li>
                        Place: {loaded.goals.place}
                        {Number(loaded.goals.place) % 100 >= 11 &&
                        Number(loaded.goals.place) % 100 <= 13
                          ? "th"
                          : (
                              { 1: "st", 2: "nd", 3: "rd" } as Record<
                                number,
                                string
                              >
                            )[Number(loaded.goals.place) % 10] || "th"}
                      </li>
                    )}
                    {loaded.goals.finish && <li>Finish Event</li>}
                    {loaded.goals.setPr && <li>Set a PR</li>}
                    {loaded.goals.custom.map((goal, index) => (
                      <li key={index}>{goal}</li>
                    ))}
                  </ul>
                )}
                <footer>
                  {retainedDraft && pending && <button type="button" onClick={discardRetainedDraft}>Discard retained draft</button>}
                  <button
                    type="button"
                    disabled={!loaded.editable}
                    onClick={() => {
                      setView("edit")
                      setGoalsOpen(
                        Boolean(
                          draft.goals &&
                          Object.values(draft.goals).some((value) =>
                            Array.isArray(value)
                              ? value.length
                              : value && value !== "mi"
                          )
                        )
                      )
                    }}
                  >
                    {retainedDraft ? "Review retained draft" : "Edit Event"}
                  </button>
                </footer>
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </section>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <fieldset disabled={disabled}>
              <label>
                Name
                <input
                  aria-label="Event name"
                  autoFocus
                  maxLength={150}
                  required
                  value={draft.name}
                  placeholder="Event Name"
                  onChange={(event) => change({ name: event.target.value })}
                />
              </label>
              <label>
                Date
                <input
                  aria-label="Event date"
                  type="date"
                  required
                  value={draft.date}
                  onChange={(event) => change({ date: event.target.value })}
                />
              </label>
              <label>
                Type
                <select
                  aria-label="Event type"
                  required
                  value={draft.eventType}
                  onChange={(event) => {
                    const next = event.target.value
                    change({
                      eventType: next,
                      raceDistance: next.startsWith("Running")
                        ? draft.raceDistance || ""
                        : "",
                      atpEventType: raceAtpEventTypes(next).some(
                        ([value]) => value === draft.atpEventType
                      )
                        ? draft.atpEventType
                        : "",
                    })
                  }}
                >
                  <option value="">Select Type</option>
                  {raceEventTypeGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {draft.eventType.startsWith("Running") && (
                <>
                  <label>
                    Distance
                    <select
                      aria-label="Event distance"
                      value={draft.raceDistance || ""}
                      onChange={(event) =>
                        change({ raceDistance: event.target.value })
                      }
                    >
                      {runningRaceDistances.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {draft.eventType && (
                <>
                  <label>
                    ATP Event Type
                    <select
                      aria-label="ATP event type"
                      value={draft.atpEventType || ""}
                      onChange={(event) =>
                        change({ atpEventType: event.target.value })
                      }
                    >
                      {raceAtpEventTypes(draft.eventType).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        )
                      )}
                    </select>
                  </label>
                  <label>
                    Priority
                    <select
                      aria-label="Event priority"
                      value={draft.priority}
                      onChange={(event) =>
                        change({
                          priority: event.target
                            .value as RaceEventDetails["priority"],
                        })
                      }
                    >
                      <option value="">Select Priority</option>
                      {["A", "B", "C"].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label>
                Description
                <div
                  ref={attachDescription}
                  role="textbox"
                  aria-label="Event description"
                  aria-multiline="true"
                  aria-disabled={disabled}
                  contentEditable={!disabled}
                  suppressContentEditableWarning
                  onInput={(event) =>
                    change({ description: event.currentTarget.innerText })
                  }
                  onPaste={(event) => {
                    event.preventDefault()
                    const selection = window.getSelection()
                    if (!selection?.rangeCount) return
                    const range = selection.getRangeAt(0)
                    if (
                      !description.current?.contains(
                        range.commonAncestorContainer
                      )
                    )
                      return
                    range.deleteContents()
                    const text = document.createTextNode(
                      event.clipboardData.getData("text/plain")
                    )
                    range.insertNode(text)
                    range.setStartAfter(text)
                    range.collapse(true)
                    selection.removeAllRanges()
                    selection.addRange(range)
                    change({ description: description.current.innerText })
                  }}
                />
              </label>
              <button
                className="desktop-event-add-goals"
                type="button"
                aria-expanded={goalsOpen}
                onClick={() => setGoalsOpen((value) => !value)}
              >
                {goalsOpen ? "Hide Goals" : "Add Goals"}
              </button>
              {goalsOpen && (
                <section
                  className="desktop-event-goals"
                  aria-label="Event goal editor"
                >
                  <label>
                    Time
                    <input
                      aria-label="Goal time"
                      placeholder="h:mm:ss"
                      value={goals.time}
                      onChange={(event) =>
                        changeGoals({ time: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Distance
                    <span className="desktop-event-goal-distance">
                      <input
                        aria-label="Goal distance"
                        inputMode="decimal"
                        value={goals.distance}
                        onChange={(event) =>
                          changeGoals({ distance: event.target.value })
                        }
                      />
                      <select
                        aria-label="Goal distance unit"
                        value={goals.distanceUnit}
                        onChange={(event) =>
                          changeGoals({ distanceUnit: event.target.value })
                        }
                      >
                        {raceGoalDistanceUnits.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>
                  <label>
                    Place
                    <input
                      aria-label="Goal place"
                      value={goals.place}
                      onChange={(event) =>
                        changeGoals({ place: event.target.value })
                      }
                      onBlur={() => {
                        const match = goals.place.match(
                          /^(?:top\s*)?([1-9]\d*)(?:st|nd|rd|th)?$/i
                        )
                        if (match) changeGoals({ place: match[1] })
                      }}
                    />
                  </label>
                  <label className="desktop-event-check">
                    <input
                      type="checkbox"
                      checked={goals.finish}
                      onChange={(event) =>
                        changeGoals({ finish: event.target.checked })
                      }
                    />
                    Finish Event
                  </label>
                  <label className="desktop-event-check">
                    <input
                      type="checkbox"
                      checked={goals.setPr}
                      onChange={(event) =>
                        changeGoals({ setPr: event.target.checked })
                      }
                    />
                    Set a PR
                  </label>
                  {goals.custom.map((goal, index) => (
                    <div className="desktop-event-custom-goal" key={index}>
                      <span>{goal}</span>
                      <button
                        type="button"
                        aria-label={`Remove custom goal ${index + 1}`}
                        onClick={() =>
                          changeGoals({
                            custom: goals.custom.filter((_, i) => i !== index),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <label>
                    Custom
                    <textarea
                      aria-label="Custom event goal"
                      maxLength={1000}
                      value={customGoal}
                      onChange={(event) => setCustomGoal(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!customGoal.trim() || goals.custom.length >= 30}
                    onClick={() => {
                      changeGoals({
                        custom: [...goals.custom, customGoal.trim()],
                      })
                      setCustomGoal("")
                    }}
                  >
                    Add custom goal
                  </button>
                </section>
              )}
            </fieldset>
            {error && <p role="alert">{error}</p>}
            <footer>
              {replayEventId && <button type="button" disabled={busy || loading} onClick={() => void reloadExisting()}>Reload existing Event</button>}
              {pendingBlocked && <button type="button" disabled={busy || loading} onClick={() => setRecoveryRetry(value=>value+1)}>Retry Event recovery</button>}
              <button type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  busy ||
                  loading ||
                  pendingBlocked || trainingCacheScope() !== scope ||
                  Boolean(replayEventId) ||
                  !valid ||
                  Boolean(loaded && !loaded.editable) || Boolean(eventId && !loaded)
                }
              >
                {busy ? "Saving…" : uncertain ? "Recheck save" : "Save"}
              </button>
            </footer>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
