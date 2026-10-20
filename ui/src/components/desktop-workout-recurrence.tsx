import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "./ui/popover"
import { Button } from "./ui/button"
import { randomId } from "@/lib/random-id"
import {
  applyWorkoutRecurrence, loadWorkoutRecurrence, recurrenceDraft,
  type WorkoutRecurrenceDraft, type WorkoutRecurrenceRule, type WorkoutRecurrenceSeries,
} from "@/lib/workout-recurrence"
import { recurrenceDates } from "../../../app-backend/lib/workout-recurrence-rule.mjs"
import "./desktop-workout-recurrence.css"

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const today = () => new Date().toLocaleDateString("en-CA")
const initialRule = (date: string): WorkoutRecurrenceRule => ({
  frequency: "weekly", interval: 1, startDate: /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today() ? date : today(),
  weekdays: [new Date(`${/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today()}T12:00:00Z`).getUTCDay()],
  end: { type: "until", until: new Date(Date.parse((/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today() ? date : today()) + "T12:00:00Z") + 7 * 86400000).toISOString().slice(0,10) },
})
const label = (rule?: WorkoutRecurrenceRule | null) => !rule ? "Does not repeat"
  : rule.frequency === "daily" ? rule.interval === 1 ? "Daily" : `Every ${rule.interval} days`
    : rule.interval === 1 ? "Weekly" : `Every ${rule.interval} weeks`

export function WorkoutRecurrenceControl({
  workoutId, date, disabled = false, draft, onDraftChange,
}: {
  workoutId?: string
  date: string
  disabled?: boolean
  draft?: WorkoutRecurrenceDraft | null
  onDraftChange?: (draft: WorkoutRecurrenceDraft | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [series, setSeries] = useState<WorkoutRecurrenceSeries | null>(null)
  const [rule, setRule] = useState<WorkoutRecurrenceRule>(() => draft?.rule || initialRule(date))
  const [requestDraft, setRequestDraft] = useState<WorkoutRecurrenceDraft | null>(null)
  const [requestAction, setRequestAction] = useState<"schedule" | "cancel">("schedule")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [repeatEnabled, setRepeatEnabled] = useState(Boolean(draft))
  const loadGeneration = useRef(0)
  const saved = Boolean(workoutId && /^event:[1-9]\d*$/.test(workoutId) && !onDraftChange)
  const activeRule = draft?.rule || (series?.status !== "cancelled" ? series?.rule : null)
  useEffect(() => {
    if (!saved || !workoutId) return
    const controller = new AbortController()
    const generation = ++loadGeneration.current
    void loadWorkoutRecurrence(workoutId, controller.signal).then(value => {
      if (loadGeneration.current === generation) setSeries(value)
    }).catch(reason => {
      if (!controller.signal.aborted && loadGeneration.current === generation) setError(reason instanceof Error ? reason.message : "The repeat schedule could not be loaded.")
    })
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; series: WorkoutRecurrenceSeries }>).detail
      setSeries(current => detail.id === workoutId || detail.series.id === current?.id ? detail.series : current)
    }
    window.addEventListener("workout-recurrence-updated", update)
    return () => { controller.abort(); window.removeEventListener("workout-recurrence-updated", update) }
  }, [saved, workoutId])
  let dates: string[] = [], validation = ""
  try { dates = recurrenceDates(rule) } catch (reason) { validation = reason instanceof Error ? reason.message : "Check the repeat schedule." }
  const show = async () => {
    setOpen(true); setNotice("")
    setRule(draft?.rule || activeRule || initialRule(date))
    setRepeatEnabled(Boolean(activeRule))
    if (!saved || !workoutId) { setError(""); return }
    const generation = ++loadGeneration.current
    setLoading(true)
    try {
      const latest = await loadWorkoutRecurrence(workoutId)
      if (generation !== loadGeneration.current) return
      setSeries(latest); setError("")
      setRepeatEnabled(Boolean(latest && latest.status !== "cancelled"))
      if (latest && latest.status !== "cancelled") {
        setRule(latest.rule)
        setRequestDraft(latest.pendingOperationId ? recurrenceDraft(latest) : null)
        setRequestAction(latest.pendingAction || "schedule")
      }
    } catch (reason) { if (generation === loadGeneration.current) setError(reason instanceof Error ? reason.message : "The repeat schedule could not be loaded.") }
    finally { if (generation === loadGeneration.current) setLoading(false) }
  }
  const save = async (cancel = false) => {
    if (cancel && !activeRule && !series && !requestDraft) { setOpen(false); return }
    if (!saved || !workoutId) {
      onDraftChange?.(cancel ? null : { operationId: draft?.operationId || randomId(), rule })
      setOpen(false)
      return
    }
    const pending = requestDraft || (series?.pendingOperationId ? recurrenceDraft(series) : {
      operationId: randomId(), rule, revision: series?.revision,
    })
    const action = series?.pendingAction || (requestDraft ? requestAction : cancel ? "cancel" : "schedule")
    loadGeneration.current++
    setRequestDraft(pending); setRequestAction(action); setBusy(true); setError("")
    try {
      const result = await applyWorkoutRecurrence(workoutId, pending, {
        cancel: action === "cancel",
        onProgress: setSeries,
      })
      setSeries(result); setRequestDraft(null)
      setNotice(result.status === "cancelled"
        ? "Future repeats removed. The original workout and any completed or individually changed workouts were kept."
        : `${result.occurrences.filter(item => item.state === "scheduled").length} repeats scheduled.${result.protectedCount ? ` ${result.protectedCount} individually changed or completed workouts were kept.` : ""}`)
      setOpen(false)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The repeat request could not be confirmed.") }
    finally { setBusy(false) }
  }
  const pending = Boolean(series?.pendingOperationId || requestDraft)
  return <Popover open={open} onOpenChange={value => { if (!busy) { if (value) void show(); else setOpen(false) } }}>
    <PopoverTrigger render={<button className="workout-recurrence-trigger" type="button" disabled={disabled} aria-label="Workout recurrence" />}>
      {pending ? "Repeats pending" : label(activeRule)}<ChevronDown size={12} aria-hidden="true" />
    </PopoverTrigger>
      <PopoverContent className="workout-recurrence-dialog" align="start" sideOffset={12}>
        <PopoverTitle>Recurrence settings</PopoverTitle>
        <PopoverDescription className="sr-only">Schedule and manage repeating workouts.</PopoverDescription>
        {loading ? <p role="status">Loading repeat schedule…</p> : <>
          <label className="workout-recurrence-toggle"><input role="switch" type="checkbox" aria-label="Repeat this item" checked={repeatEnabled} disabled={busy || pending} onChange={event => setRepeatEnabled(event.target.checked)} /><span>Repeat this item.</span></label>
          <p className="workout-recurrence-summary">{repeatEnabled ? `${label(rule)}${rule.frequency === "weekly" ? ` on ${rule.weekdays.map(value => weekdays[value]).join(", ")}` : ""}${rule.end.type === "until" ? ` until ${new Date(rule.end.until + "T12:00:00Z").toLocaleDateString("en-US",{month:"long",day:"numeric",timeZone:"UTC"})}` : ` for ${rule.end.count} occurrences`}` : "Does not repeat"}</p>
          <fieldset disabled={busy || pending || !repeatEnabled} className="workout-recurrence-fields">
            {rule.frequency === "weekly" && <div className="workout-recurrence-weekday-section"><span>Repeat on</span><div className="workout-recurrence-weekdays" role="group" aria-label="Repeat weekdays">
              {[1,2,3,4,5,6,0].map(value => <label key={value} title={weekdays[value]}><input aria-label={weekdays[value]} type="checkbox" checked={rule.weekdays.includes(value)} onChange={event => setRule({ ...rule, weekdays: event.target.checked ? [...rule.weekdays, value] : rule.weekdays.filter(day => day !== value) })}/><span>{weekdays[value].slice(0,1)}</span></label>)}
            </div></div>}
            <label>Repeat every<div className="workout-recurrence-line"><input aria-label="Repeat interval" type="number" min={1} max={12} value={rule.interval} onChange={event => setRule({ ...rule, interval: Number(event.target.value) })} /><select aria-label="Repeat frequency" value={rule.frequency} onChange={event => setRule({ ...rule, frequency: event.target.value as WorkoutRecurrenceRule["frequency"] })}>
              <option value="daily">day</option><option value="weekly">week</option>
            </select></div></label>
            <label>Starts<input type="date" aria-label="Repeat first date" min={today()} value={rule.startDate} onChange={event => setRule({ ...rule, startDate: event.target.value })} /></label>
            <label>Ends<div className="workout-recurrence-line"><select aria-label="Repeat end condition" value={rule.end.type} onChange={event => setRule({ ...rule, end: event.target.value === "count" ? { type: "count", count: 4 } : { type: "until", until: new Date(Date.parse(rule.startDate + "T12:00:00Z") + 28 * 86400000).toISOString().slice(0,10) } })}>
              <option value="until">Date</option><option value="count">After</option>
            </select>
            {rule.end.type === "count" ? <><input type="number" aria-label="Repeat occurrences" min={2} max={52} value={rule.end.count} onChange={event => setRule({ ...rule, end: { type: "count", count: Number(event.target.value) } })}/><span>occurrences</span></>
              : <input type="date" aria-label="Repeat last date" min={rule.startDate} value={rule.end.until} onChange={event => setRule({ ...rule, end: { type: "until", until: event.target.value } })}/>}</div></label>
          </fieldset>
          {!pending && repeatEnabled && <div className="workout-recurrence-preview">{validation ? <p role="alert">{validation}</p> : <>
            <strong>{dates.length} occurrences</strong><p>{dates.slice(0,4).join(" · ")}{dates.length > 4 ? ` · … ${dates.at(-1)}` : ""}</p>
            <p>Completed or individually changed workouts are kept when future repeats change.</p>
          </>}</div>}
          {series?.remaining ? <p role="status">{series.remaining} changes remaining.</p> : null}
          {error && <p role="alert" className="workout-recurrence-error">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          <div className="workout-recurrence-actions">
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy || (!pending && repeatEnabled && Boolean(validation))} onClick={() => void save(!repeatEnabled)}>{busy ? "Saving…" : pending ? "Recheck remaining" : "Done"}</Button>
          </div>
        </>}
      </PopoverContent>
  </Popover>
}
