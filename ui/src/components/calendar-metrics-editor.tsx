import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { EllipsisVertical, HeartPulse, Pencil, Plus, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
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
import {
  cachedTrainingContext,
  trainingCacheScope,
} from "@/lib/training-context"
import {
  applyMetricChanges,
  calendarMetricFields,
  calendarMetricsClient,
  CalendarMetricsError,
  clearPendingMetrics,
  createMetricsWrite,
  currentMetricTime,
  metricChanges,
  metricInputs,
  metricInputValue,
  metricsRecoveryStorage,
  readPendingMetrics,
  rememberPendingMetrics,
  type CalendarMetricKey,
  type CalendarMetricRow,
  type CalendarMetricsResult,
  type MetricInputs,
  type MetricsWrite,
} from "@/lib/calendar-metrics"
import "./calendar-metrics-editor.css"

const emptyInputs = (time = ""): MetricInputs =>
  Object.fromEntries(
    calendarMetricFields.map((field) => [field.key, { value: "", time }])
  ) as MetricInputs
const selectedKeys = (row: CalendarMetricRow) =>
  calendarMetricFields
    .filter((field) => row.entries[field.key].value != null)
    .map((field) => field.key)
const displayValue = (key: CalendarMetricKey, value: string) => {
  const field = calendarMetricFields.find((item) => item.key === key)!
  if (field.kind === "select") return value
  const numeric = Number(value)
  return Number.isFinite(numeric)
    ? key === "weight" || key === "muscleMass"
      ? numeric.toFixed(1)
      : numeric.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : value
}
const timeLabel = (time: string) => {
  if (!time) return "Time not recorded"
  const [hour, minute] = time.split(":").map(Number)
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`
}

export function CalendarMetricsEditor({
  date,
  onClose,
  onSaved,
  children,
  historyDirty = false,
  historyBusy = false,
}: {
  date: string
  onClose: () => void
  onSaved?: (result: CalendarMetricsResult) => void | Promise<void>
  children?: ReactNode
  historyDirty?: boolean
  historyBusy?: boolean
}) {
  const [scope] = useState(trainingCacheScope)
  const [timeZone] = useState(
    () => cachedTrainingContext().athlete.time_zone || "America/Chicago"
  )
  const [original, setOriginal] = useState<CalendarMetricRow | null>(null)
  const [inputs, setInputs] = useState<MetricInputs>(() => emptyInputs())
  const [staged, setStaged] = useState<CalendarMetricKey[]>([])
  const [note, setNote] = useState("")
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [loadVersion, setLoadVersion] = useState(0)
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("")
  const [conflict, setConflict] = useState(false),
    [uncertain, setUncertain] = useState(false)
  const [panelKeys, setPanelKeys] = useState<CalendarMetricKey[] | null>(null)
  const [panel, setPanel] = useState<MetricInputs>(() => emptyInputs())
  const panelSnapshot = useRef<MetricInputs>(emptyInputs())
  const [confirmation, setConfirmation] = useState<"close" | "reload" | null>(
    null
  )
  const [addMenu, setAddMenu] = useState(false)
  const attempt = useRef<MetricsWrite | null>(null)
  const saving = useRef(false),
    mounted = useRef(true)
  const dialog = useRef<HTMLDivElement>(null),
    panelRef = useRef<HTMLDivElement>(null)
  const loadRevision = useRef(0)
  const fieldsDisabled =
    loading || busy || uncertain || Boolean(original?.locked)

  const openPanel = (
    keys: CalendarMetricKey[],
    current = inputs,
    saved = original
  ) => {
    const values = emptyInputs(currentMetricTime(timeZone))
    for (const key of keys) {
      if (current[key].value !== "") values[key] = { ...current[key] }
      else if (saved?.entries[key].value != null)
        values[key] = {
          value: String(saved.entries[key].value),
          time: saved.entries[key].time || "",
        }
    }
    panelSnapshot.current = values
    setPanel(values)
    setPanelKeys(keys)
    setAddMenu(false)
    requestAnimationFrame(() =>
      panelRef.current
        ?.querySelector<HTMLInputElement | HTMLSelectElement>("input,select")
        ?.focus()
    )
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController(),
      revision = ++loadRevision.current
    setLoading(true)
    setError("")
    void calendarMetricsClient
      .read(date, controller.signal)
      .then((row) => {
        if (controller.signal.aborted || loadRevision.current !== revision)
          return
        let pending: MetricsWrite | null = null
        try {
          pending = readPendingMetrics(metricsRecoveryStorage, scope, date)
        } catch {
          /* The live draft remains available when local storage is blocked. */
        }
        attempt.current = pending
        const restored = pending
          ? applyMetricChanges(row, pending.changes, pending.note ?? row.note)
          : row
        const values = metricInputs(restored),
          keys = selectedKeys(restored)
        setOriginal(row)
        setInputs(values)
        setNote(restored.note)
        setStaged(keys)
        setUncertain(Boolean(pending))
        setConflict(false)
        setNotice(
          pending
            ? "An earlier metrics save needs confirmation. Recheck the retained request before making another change."
            : ""
        )
        if (!keys.length && !pending && !row.locked) {
          const fresh = emptyInputs(currentMetricTime(timeZone))
          panelSnapshot.current = fresh
          setPanel(fresh)
          setPanelKeys(calendarMetricFields.map((field) => field.key))
          requestAnimationFrame(() =>
            panelRef.current?.querySelector<HTMLInputElement>("input")?.focus()
          )
        } else setPanelKeys(null)
      })
      .catch((reason) => {
        if (!controller.signal.aborted && loadRevision.current === revision)
          setError(
            reason instanceof Error
              ? reason.message
              : "Metrics could not be loaded."
          )
      })
      .finally(() => {
        if (!controller.signal.aborted && loadRevision.current === revision)
          setLoading(false)
      })
    return () => controller.abort()
  }, [date, scope, loadVersion, timeZone])
  const changes = useMemo(() => {
    if (!original) return {}
    try {
      return metricChanges(original, inputs)
    } catch {
      return {}
    }
  }, [original, inputs])
  const dirty = Boolean(
    original && (Object.keys(changes).length || note !== original.note)
  )
  const panelDirty = Boolean(
    panelKeys?.some(
      (key) =>
        panel[key].value !== panelSnapshot.current[key].value ||
        (panel[key].value !== "" &&
          panel[key].time !== panelSnapshot.current[key].time)
    )
  )
  const hasUnsaved = dirty || panelDirty || historyDirty
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (busy || historyBusy || hasUnsaved || uncertain) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [busy, historyBusy, hasUnsaved, uncertain])
  const panelErrors: Partial<Record<CalendarMetricKey, string>> = {}
  let panelCount = 0
  for (const key of panelKeys || []) {
    if (!panel[key].value.trim()) continue
    try {
      if (metricInputValue(key, panel[key])?.value != null) panelCount++
    } catch (reason) {
      panelErrors[key] =
        reason instanceof Error ? reason.message : "Review this value."
    }
  }
  const requestClose = () => {
    if (saving.current || busy || historyBusy) return
    if (hasUnsaved || uncertain) setConfirmation("close")
    else onClose()
  }
  const requestReload = () => {
    if (busy || historyBusy || uncertain) return
    if (hasUnsaved) setConfirmation("reload")
    else setLoadVersion((value) => value + 1)
  }
  const stagePanel = () => {
    if (
      !panelKeys ||
      !panelCount ||
      Object.keys(panelErrors).length ||
      fieldsDisabled
    )
      return
    const next = { ...inputs },
      keys = new Set(staged)
    for (const key of panelKeys) {
      const value = metricInputValue(key, panel[key])
      if (value?.value == null) continue
      next[key] = { value: String(value.value), time: value.time || "" }
      keys.add(key)
    }
    setInputs(next)
    setStaged([...keys])
    setPanelKeys(null)
    setError("")
    setNotice("")
    requestAnimationFrame(() =>
      dialog.current
        ?.querySelector<HTMLButtonElement>("[data-metrics-add]")
        ?.focus()
    )
  }
  const removeMetric = (key: CalendarMetricKey) => {
    if (fieldsDisabled) return
    setInputs((current) => ({ ...current, [key]: { value: "", time: "" } }))
    setStaged((current) => current.filter((value) => value !== key))
    setError("")
    setNotice("")
  }
  const hasRecordedClear = Boolean(
    original &&
    Object.entries(changes).some(
      ([key, value]) =>
        value == null &&
        original.entries[key as CalendarMetricKey].value != null
    )
  )
  const canSave = Boolean(
    original &&
    !loading &&
    !busy &&
    !historyBusy &&
    (!original.locked || uncertain) &&
    !conflict &&
    (uncertain ||
      (dirty &&
        !panelKeys &&
        (staged.some((key) => inputs[key].value !== "") || hasRecordedClear)))
  )
  const save = async (close: boolean) => {
    if (!canSave || !original || saving.current || (close && historyDirty))
      return
    saving.current = true
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const input =
        attempt.current || createMetricsWrite(original, inputs, note)
      attempt.current = input
      try {
        rememberPendingMetrics(metricsRecoveryStorage, scope, input)
      } catch {
        /* The immutable request is still retained in memory. */
      }
      window.dispatchEvent(new Event("training-mutation-started"))
      const result = await calendarMetricsClient.write(input)
      if (!mounted.current) return
      clearPendingMetrics(metricsRecoveryStorage, scope, date)
      attempt.current = null
      setOriginal(result)
      setInputs(metricInputs(result))
      setStaged(selectedKeys(result))
      setNote(result.note)
      setUncertain(false)
      setConflict(false)
      setNotice("Metrics saved.")
      try {
        await onSaved?.(result)
      } catch {
        if (mounted.current)
          setNotice(
            "Metrics saved. Refresh the calendar to reload its current view."
          )
      }
      if (close && mounted.current) onClose()
    } catch (reason) {
      if (!mounted.current) return
      const failure = reason as CalendarMetricsError
      setError(
        failure.message || "Metrics could not be saved. Your draft is retained."
      )
      if (failure.uncertain) setUncertain(true)
      else {
        attempt.current = null
        clearPendingMetrics(metricsRecoveryStorage, scope, date)
        setUncertain(false)
        setConflict(
          failure.code === "METRICS_CONFLICT" ||
            failure.code === "METRICS_LOCKED"
        )
      }
    } finally {
      saving.current = false
      if (mounted.current) setBusy(false)
      window.dispatchEvent(new Event("training-mutation-settled"))
    }
  }
  const clearFields = calendarMetricFields.filter(
    (field) =>
      original?.entries[field.key].value != null &&
      !staged.includes(field.key) &&
      Object.hasOwn(changes, field.key)
  )
  const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose()
        }}
      >
        <DialogContent
          ref={dialog}
          showCloseButton={false}
          className="calendar-metrics-editor"
          initialFocus={() =>
            dialog.current?.querySelector<HTMLInputElement | HTMLSelectElement>(
              ".cme-add-fields input:not(:disabled), .cme-add-fields select:not(:disabled)"
            ) ||
            dialog.current?.querySelector<HTMLButtonElement>(
              "[data-metrics-close]"
            ) ||
            false
          }
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            const menu = (
              event.target as HTMLElement
            ).closest<HTMLDetailsElement>("details[open]")
            if (menu) {
              event.preventDefault()
              event.stopPropagation()
              menu.open = false
              menu.querySelector<HTMLElement>("summary")?.focus()
            }
          }}
        >
          <header className="cme-header">
            <HeartPulse size={21} />
            <DialogTitle>Metrics</DialogTitle>
            <span>{dateLabel}</span>
            <div className="cme-header-actions">
              <button
                type="button"
                disabled={!canSave}
                onClick={() => void save(false)}
              >
                {busy ? "Saving…" : uncertain ? "Recheck save" : "Save"}
              </button>
              <button
                type="button"
                disabled={!canSave || historyDirty}
                title={
                  historyDirty
                    ? "Save the history layout before closing."
                    : undefined
                }
                onClick={() => void save(true)}
              >
                {uncertain ? "Recheck & Close" : "Save & Close"}
              </button>
              <details>
                <summary aria-label="Metrics options">
                  <EllipsisVertical size={19} />
                </summary>
                <div>
                  <button
                    type="button"
                    disabled={busy || historyBusy || uncertain}
                    onClick={requestReload}
                  >
                    Reload saved values
                  </button>
                </div>
              </details>
              <button
                type="button"
                data-metrics-close
                aria-label="Close metrics editor"
                disabled={busy || historyBusy}
                onClick={requestClose}
              >
                <X size={20} />
              </button>
            </div>
          </header>
          {historyDirty && (
            <p className="cme-notice" role="status">
              History layout has unsaved changes. Use Save layout before Save
              &amp; Close.
            </p>
          )}
          <DialogDescription className="sr-only">
            Enter metrics for {dateLabel}. Times use {timeZone}. Add entered
            metrics to the draft, then save.
          </DialogDescription>
          {(error || notice || conflict || original?.locked) && (
            <div className="cme-notice">
              {error && <p role="alert">{error}</p>}
              {notice && <p role="status">{notice}</p>}
              {conflict && !error && (
                <p role="alert">
                  Saved metrics changed. Reload the latest values before saving
                  this retained draft.
                </p>
              )}
              {original?.locked && (
                <p role="status">
                  This day is locked by Intervals.icu. Its values cannot be
                  changed.
                </p>
              )}
              {(conflict || (!original && !loading)) && (
                <button type="button" disabled={busy} onClick={requestReload}>
                  {original ? "Reload latest values" : "Retry loading metrics"}
                </button>
              )}
            </div>
          )}
          <div className="cme-body">
            <section
              className="cme-entry-pane"
              aria-label="Daily metric entries"
            >
              {loading ? (
                <p role="status" className="cme-loading">
                  Loading saved metrics…
                </p>
              ) : (
                original && (
                  <>
                    {panelKeys ? (
                      <div className="cme-add-panel" ref={panelRef}>
                        <h2>
                          {panelKeys.length === calendarMetricFields.length
                            ? "Add All Metrics"
                            : `Add ${calendarMetricFields.find((field) => field.key === panelKeys[0])?.label}`}
                        </h2>
                        <div className="cme-add-fields">
                          {panelKeys.map((key) => {
                            const field = calendarMetricFields.find(
                              (item) => item.key === key
                            )!
                            return (
                              <div className="cme-add-field" key={key}>
                                <div
                                  className={`cme-value-field ${panel[key].value ? "cme-filled" : ""}`}
                                >
                                  <label htmlFor={`metric-${key}`}>
                                    {field.label}
                                  </label>
                                  {field.kind === "select" ? (
                                    <select
                                      id={`metric-${key}`}
                                      aria-label={field.label}
                                      disabled={fieldsDisabled}
                                      value={panel[key].value}
                                      onChange={(event) =>
                                        setPanel((current) => ({
                                          ...current,
                                          [key]: {
                                            ...current[key],
                                            value: event.target.value,
                                          },
                                        }))
                                      }
                                    >
                                      <option value="">
                                        Select {field.label}
                                      </option>
                                      {field.options?.map((option) => (
                                        <option key={option} value={option}>
                                          {option}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <>
                                      <input
                                        id={`metric-${key}`}
                                        aria-label={field.label}
                                        inputMode="decimal"
                                        type="text"
                                        disabled={fieldsDisabled}
                                        value={panel[key].value}
                                        onChange={(event) =>
                                          setPanel((current) => ({
                                            ...current,
                                            [key]: {
                                              ...current[key],
                                              value: event.target.value,
                                            },
                                          }))
                                        }
                                        aria-invalid={Boolean(panelErrors[key])}
                                      />
                                      <span>{field.unit}</span>
                                    </>
                                  )}
                                </div>
                                <input
                                  aria-label={`${field.label} time`}
                                  type="time"
                                  value={panel[key].time}
                                  disabled={fieldsDisabled}
                                  onChange={(event) =>
                                    setPanel((current) => ({
                                      ...current,
                                      [key]: {
                                        ...current[key],
                                        time: event.target.value,
                                      },
                                    }))
                                  }
                                />
                                {field.kind === "number" && (
                                  <small>
                                    Min {field.min} / Max {field.max}
                                  </small>
                                )}
                                {panelErrors[key] && (
                                  <p role="alert">{panelErrors[key]}</p>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        <footer>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setPanelKeys(null)
                              setPanel(emptyInputs())
                            }}
                          >
                            Close
                          </button>
                          <button
                            type="button"
                            disabled={
                              fieldsDisabled ||
                              !panelCount ||
                              Boolean(Object.keys(panelErrors).length)
                            }
                            onClick={stagePanel}
                          >
                            Add
                          </button>
                        </footer>
                      </div>
                    ) : (
                      <>
                        <div className="cme-add-actions">
                          <button
                            type="button"
                            data-metrics-add
                            disabled={fieldsDisabled}
                            aria-expanded={addMenu}
                            onClick={() => setAddMenu((value) => !value)}
                          >
                            <Plus size={16} />
                            Add Metrics
                          </button>
                          <button
                            type="button"
                            disabled={
                              fieldsDisabled ||
                              staged.length === calendarMetricFields.length
                            }
                            onClick={() =>
                              openPanel(
                                calendarMetricFields
                                  .filter(
                                    (field) => !staged.includes(field.key)
                                  )
                                  .map((field) => field.key)
                              )
                            }
                          >
                            Add All Metrics
                          </button>
                          {addMenu && (
                            <div
                              className="cme-add-menu"
                              aria-label="Available metrics"
                            >
                              {calendarMetricFields
                                .filter((field) => !staged.includes(field.key))
                                .map((field) => (
                                  <button
                                    type="button"
                                    key={field.key}
                                    onClick={() => openPanel([field.key])}
                                  >
                                    {field.label}
                                  </button>
                                ))}
                              {staged.length ===
                                calendarMetricFields.length && (
                                <p>All metrics are already added.</p>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="cme-metric-cards">
                          {staged.map((key) => {
                            const field = calendarMetricFields.find(
                              (item) => item.key === key
                            )!
                            return (
                              <section
                                key={key}
                                className="cme-metric-card"
                                aria-label={`${field.label} metric`}
                              >
                                <header>
                                  <h2>{field.label}</h2>
                                  <details>
                                    <summary
                                      aria-label={`${field.label} options`}
                                    >
                                      <EllipsisVertical size={18} />
                                    </summary>
                                    <div>
                                      <button
                                        type="button"
                                        disabled={fieldsDisabled}
                                        onClick={(event) => {
                                          event.currentTarget.closest<HTMLDetailsElement>(
                                            "details"
                                          )!.open = false
                                          openPanel([key])
                                        }}
                                      >
                                        <Pencil size={13} />
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        disabled={fieldsDisabled}
                                        onClick={() => removeMetric(key)}
                                      >
                                        {original.entries[key].value == null
                                          ? "Remove draft metric"
                                          : "Clear recorded value"}
                                      </button>
                                    </div>
                                  </details>
                                </header>
                                <button
                                  type="button"
                                  className="cme-card-value"
                                  disabled={fieldsDisabled}
                                  onClick={() => openPanel([key])}
                                >
                                  {displayValue(key, inputs[key].value)}
                                  <small>{field.unit}</small>
                                </button>
                                <p>{timeLabel(inputs[key].time)}</p>
                              </section>
                            )
                          })}
                        </div>
                        {!staged.length && (
                          <p className="cme-empty">
                            {hasRecordedClear
                              ? "Recorded values will be cleared when you save."
                              : "Add at least one metric to save this day."}
                          </p>
                        )}
                      </>
                    )}
                    {clearFields.length > 0 && (
                      <div className="cme-pending-clears">
                        {clearFields.map((field) => (
                          <p key={field.key}>
                            {field.label} will be cleared on Save.{" "}
                            <button
                              type="button"
                              disabled={fieldsDisabled}
                              onClick={() => {
                                setInputs((current) => ({
                                  ...current,
                                  [field.key]:
                                    metricInputs(original)[field.key],
                                }))
                                setStaged((current) => [...current, field.key])
                              }}
                            >
                              Undo
                            </button>
                          </p>
                        ))}
                      </div>
                    )}
                  </>
                )
              )}
            </section>
            <section
              className="cme-history-pane"
              aria-label="Metrics history and note"
            >
              {children}
              <section className="cme-note">
                <label htmlFor="calendar-metrics-note">Note</label>
                <textarea
                  id="calendar-metrics-note"
                  aria-label="Metrics note"
                  disabled={fieldsDisabled}
                  maxLength={8000}
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value)
                    setError("")
                    setNotice("")
                  }}
                />
                <small>{note.length}/8000</small>
              </section>
            </section>
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
              {confirmation === "reload"
                ? "Reload saved metrics?"
                : uncertain
                  ? "Close with an unconfirmed save?"
                  : "Discard unsaved changes?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === "reload"
                ? "Reloading replaces this local draft with the latest saved values. Keep editing to retain your current changes."
                : uncertain
                  ? "The save may already have reached Intervals.icu. Its exact recovery request will be retained so you can recheck it when you reopen this day."
                  : "Your unsaved metric entries, note or layout changes will be lost. Saved values remain unchanged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || historyBusy}
              onClick={() => {
                if (saving.current || busy || historyBusy) return
                const action = confirmation
                setConfirmation(null)
                if (action === "reload") {
                  clearPendingMetrics(metricsRecoveryStorage, scope, date)
                  attempt.current = null
                  setLoadVersion((value) => value + 1)
                } else onClose()
              }}
            >
              {confirmation === "reload"
                ? "Reload latest values"
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
