import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react"
import { BarChart3, Clock3, Download, FileText, Heart, Loader2, Paperclip, Plus, Trash2, X, Zap } from "lucide-react"
import {
  readWorkoutLocalMetadata,
  saveWorkoutLocalMetadata,
  savedWorkoutEquipment,
  removeWorkoutLocalMetadata,
  normalizeWorkoutLocalMetadata,
  type WorkoutLocalMetadata,
} from "@/lib/workout-local-metadata"
import { clearWorkoutSaveDraft, readWorkoutSaveDraft, retainWorkoutSaveDraft } from "@/lib/workout-save-drafts"
import {
  loadWorkoutPersonal, saveWorkoutPersonal, uploadWorkoutAttachment, removeWorkoutAttachment, downloadWorkoutAttachment,
  type WorkoutPersonalSnapshot, type WorkoutAttachment,
} from "@/lib/workout-personal-client"
import "./desktop-workout-details.css"

export function useWorkoutPersonalFields(scope: string, id: string, initialValue?: WorkoutLocalMetadata, enabled = true) {
  const activeId = useRef(id)
  const [local] = useState(() => readWorkoutLocalMetadata(scope, id))
  const [recoveredDraft] = useState(() => readWorkoutSaveDraft<WorkoutLocalMetadata>(scope, id, "personal"))
  const recovered = recoveredDraft?.value
  const [saved, setSaved] = useState(local)
  const [value, setValue] = useState(() => normalizeWorkoutLocalMetadata(initialValue || recovered || local))
  const [snapshot, setSnapshot] = useState<WorkoutPersonalSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const ready = useRef<Promise<WorkoutPersonalSnapshot> | null>(null)
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    const beforeRead = snapshotRef.current?.value || local
    try {
      let result = await loadWorkoutPersonal(activeId.current, signal)
      if (result.migratedTo) {
        activeId.current = result.migratedTo
        result = await loadWorkoutPersonal(activeId.current, signal)
      }
      const meaningful = local.privateNotes || local.tags.length || local.equipment || !local.autoCalculate
      if (!result.exists && meaningful) result = await saveWorkoutPersonal(activeId.current, local, result.revision, { importOnly: true })
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      removeWorkoutLocalMetadata(scope, id)
      setSnapshot(result)
      snapshotRef.current = result
      setSaved(result.value)
      if (!recovered) setValue(current => Object.fromEntries(Object.entries(result.value).map(([key, remote]) => {
        const field = key as keyof WorkoutLocalMetadata
        return [key, JSON.stringify(current[field]) === JSON.stringify(beforeRead[field]) ? remote : current[field]]
      })) as WorkoutLocalMetadata)
      setError("")
      return result
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Personal fields could not be loaded.")
      throw reason
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [id, scope, local, recovered])
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    ready.current = load(controller.signal)
    void ready.current.catch(() => {})
    return () => controller.abort()
  }, [enabled, load])
  const ensureLoaded = async () => {
    if (snapshotRef.current) return snapshotRef.current
    try { if (ready.current) return await ready.current } catch { /* A fresh attempt may recover an interrupted load. */ }
    return load()
  }
  const accept = (result: WorkoutPersonalSnapshot) => {
    snapshotRef.current = result
    setSnapshot(result)
    setError("")
  }
  const attach = async (file: File) => {
    setBusy(true)
    setError("")
    try {
      await ensureLoaded()
      accept(await uploadWorkoutAttachment(activeId.current, file))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Attachment upload failed.")
      throw reason
    } finally { setBusy(false) }
  }
  return {
    value, setValue, loading: enabled && loading, busy, error,
    get id() { return activeId.current },
    attachments: snapshot?.attachments || [],
    equipmentOptions: snapshot?.equipmentOptions || savedWorkoutEquipment(scope),
    reload() { ready.current = load(); void ready.current.catch(() => {}) },
    async refresh() { ready.current = load(); await ready.current },
    attach,
    async removeAttachment(attachment: WorkoutAttachment) {
      setBusy(true)
      try { accept(await removeWorkoutAttachment(activeId.current, attachment.id)) }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Attachment removal failed."); throw reason }
      finally { setBusy(false) }
    },
    async downloadAttachment(attachment: WorkoutAttachment) {
      try { await downloadWorkoutAttachment(activeId.current, attachment) }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Attachment download failed."); throw reason }
    },
    dirty: JSON.stringify(value) !== JSON.stringify(saved),
    async save(targetId = activeId.current, requestedValue = value) {
      const edited = JSON.stringify(requestedValue) !== JSON.stringify(saved)
      setBusy(true)
      try {
        const source = await ensureLoaded()
        if (targetId === id && id.startsWith("draft:") && activeId.current !== id) targetId = activeId.current
        const sourceId = activeId.current
        const nextValue = edited || recovered ? requestedValue : source.value
        const changed = JSON.stringify(nextValue) !== JSON.stringify(source.value)
        const hasPersonalFields = Boolean(nextValue.privateNotes || nextValue.tags.length || nextValue.equipment || !nextValue.autoCalculate)
        if (!changed && targetId === sourceId) {
          if (recoveredDraft) clearWorkoutSaveDraft(scope, id, "personal", recoveredDraft.token)
          return
        }
        const token = retainWorkoutSaveDraft(scope, sourceId, "personal", nextValue)
        try { saveWorkoutLocalMetadata(scope, sourceId, nextValue) } catch { /* Recovery is also retained in memory. */ }
        const current = targetId === sourceId ? source : await loadWorkoutPersonal(targetId)
        if (targetId !== sourceId && !hasPersonalFields && !source.attachments.length) {
          activeId.current = targetId
          accept(current)
          setSaved(current.value)
          clearWorkoutSaveDraft(scope, sourceId, "personal", token)
          return
        }
        const result = await saveWorkoutPersonal(targetId, nextValue, current.revision, targetId !== sourceId && sourceId.startsWith("draft:") ? { migrateFrom: sourceId } : undefined)
        activeId.current = targetId
        accept(result)
        setSaved(result.value)
        removeWorkoutLocalMetadata(scope, sourceId)
        clearWorkoutSaveDraft(scope, sourceId, "personal", token)
        if (sourceId !== id && recoveredDraft) clearWorkoutSaveDraft(scope, id, "personal", recoveredDraft.token)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Personal fields could not be saved.")
        throw reason
      } finally { setBusy(false) }
    },
    discard() { clearWorkoutSaveDraft(scope, activeId.current, "personal"); setValue(saved) },
  }
}

export function WorkoutAttachments({ personal }: { personal: ReturnType<typeof useWorkoutPersonalFields> }) {
  const input = useRef<HTMLInputElement>(null)
  return <section className="desktop-workout-attachments" aria-label="Workout attachments">
    <div className="desktop-workout-description-heading">
      <h3>Description</h3>
      <button type="button" aria-label="Attach a file" title="Attach a file (up to 2 MB)" disabled={personal.busy || personal.loading} onClick={() => input.current?.click()}>
        {personal.busy ? <Loader2 size={17} className="animate-spin" /> : <Paperclip size={17} />}
      </button>
      <input ref={input} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.json,.gpx,.tcx,.fit,.docx,.xlsx" onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ""
        if (file) void personal.attach(file).catch(() => {})
      }} />
    </div>
    {personal.attachments.length > 0 && <ul className="desktop-workout-attachment-list">
      {personal.attachments.map(file => <li key={file.id}>
        <button type="button" className="desktop-workout-attachment-download" title={`Download ${file.name}`} onClick={() => void personal.downloadAttachment(file).catch(() => {})}><Download size={13} /><span>{file.name}</span><small>{Math.max(1, Math.round(file.size / 1024))} KB</small></button>
        <button type="button" aria-label={`Remove attachment ${file.name}`} title="Remove attachment" disabled={personal.busy} onClick={() => void personal.removeAttachment(file).catch(() => {})}><Trash2 size={13} /></button>
      </li>)}
    </ul>}
    {personal.error && <div className="desktop-workout-personal-error" role="alert">{personal.error}<button type="button" onClick={personal.reload} disabled={personal.loading}>Reload personal fields</button></div>}
  </section>
}

/** The dialog scrolls; the description never creates a second scrollable area. */
export function WorkoutDescriptionInput(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    const resize = () => {
      input.style.height = "0px"
      input.style.height = `${Math.max(30, input.scrollHeight + 2)}px`
    }
    resize()
    const parent = input.parentElement!
    let width = parent.clientWidth
    const observer = new ResizeObserver(() => {
      if (parent.clientWidth === width) return
      width = parent.clientWidth
      resize()
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [props.value])
  return <textarea {...props} ref={ref} rows={1} wrap="soft" className={`desktop-description-input ${props.className || ""}`} />
}

export function WorkoutDetailNavigation() {
  const [selected, setSelected] = useState("Description")
  return (
    <nav className="desktop-workout-detail-navigation" aria-label="Workout sections">
      {[
        { label: "Description", Icon: FileText, selector: '[aria-label="Workout description"]' },
        { label: "Planned values", Icon: BarChart3, selector: '[aria-label="Planned and completed values"]' },
        { label: "Heart rate", Icon: Heart, selector: '[aria-label="Recorded minimum average maximum"]' },
        { label: "Training stress", Icon: Zap, selector: '[aria-label="Planned tss"]' },
        { label: "Duration", Icon: Clock3, selector: '[aria-label="Planned duration"]' },
      ].map(({ label, Icon, selector }) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={selected === label}
          onClick={(event) => {
            setSelected(label)
            const panel = event.currentTarget.closest(".desktop-workout-details-shell")
            const target = panel?.querySelector<HTMLElement>(selector)
            target?.scrollIntoView({ block: "nearest", inline: "nearest" })
            const input = target?.matches("input, textarea") ? target : target?.querySelector<HTMLElement>("input, textarea")
            input?.focus({ preventScroll: true })
          }}
        ><Icon size={17} aria-hidden="true" /></button>
      ))}
    </nav>
  )
}

export function WorkoutPersonalNotes({
  value, onChange, disabled = false,
}: {
  value: WorkoutLocalMetadata
  onChange: (value: WorkoutLocalMetadata) => void
  disabled?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [tag, setTag] = useState("")
  const add = () => {
    const next = tag.trim().slice(0, 60)
    if (next && !value.tags.includes(next)) onChange({ ...value, tags: [...value.tags, next].slice(0, 30) })
    setTag("")
    setAdding(false)
  }
  return (
    <>
      <section className="desktop-workout-private-notes">
        <h3>Private Notes</h3>
          <textarea
            aria-label="Private Notes"
            placeholder="Use this space for personal thoughts and observations — these notes won't be shared with anyone."
            maxLength={2000}
            value={value.privateNotes}
            disabled={disabled}
            onChange={event => onChange({ ...value, privateNotes: event.target.value })}
          />
        <span className="desktop-workout-character-count">{value.privateNotes.length} / 2000</span>
      </section>
      <section className="desktop-workout-tags">
        <h3>Tags<button type="button" aria-label="Add tag" title="Add tag" disabled={disabled || value.tags.length >= 30} onClick={() => setAdding(true)}><Plus size={17} /></button></h3>
        <div className="desktop-workout-tag-list">
          {value.tags.map(item => <span key={item}>{item}<button type="button" disabled={disabled} aria-label={`Remove tag ${item}`} onClick={() => onChange({ ...value, tags: value.tags.filter(existing => existing !== item) })}><X size={12} /></button></span>)}
        </div>
        {adding && <div className="desktop-workout-tag-entry">
          <input autoFocus aria-label="New tag" value={tag} maxLength={60} onChange={event => setTag(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add() } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAdding(false) } }} />
          <button type="button" onClick={add}>Add</button>
        </div>}
      </section>
    </>
  )
}

export function WorkoutEquipment({
  value, onChange, scope, sport, disabled = false, options: suppliedOptions,
}: {
  value: WorkoutLocalMetadata
  onChange: (value: WorkoutLocalMetadata) => void
  scope: string
  sport: string
  disabled?: boolean
  options?: string[]
}) {
  const id = useId()
  const [localOptions] = useState(() => savedWorkoutEquipment(scope))
  const options = suppliedOptions || localOptions
  const shoes = /run|walk/i.test(sport)
  return <section className="desktop-workout-equipment">
    <h3>Equipment</h3>
    <label>{shoes ? "Shoes" : /bike|ride/i.test(sport) ? "Bike" : "Equipment"}
      <input aria-label="Workout equipment" list={id} value={value.equipment} maxLength={100} placeholder={shoes ? "Select Shoe" : "Select Equipment"} disabled={disabled} onChange={event => onChange({ ...value, equipment: event.target.value })} />
    </label>
    <datalist id={id}>{options.map(name => <option key={name} value={name} />)}</datalist>
  </section>
}
