import { apiFetch, apiSessionRevision } from "./api-client"
import { deviceCacheScope } from "./device-cache"
import { randomId } from "./random-id"
import { readWorkoutCommits, transactWorkoutCommits, type CommitInput, type CommitLedger, type LocalCommit, type LocalWorkout, type ConflictResolutionBody } from "./workout-commit-store"
import type { PlannedWorkout, TrainingContext } from "./training-context"
import { workoutTotals } from "../../../app-backend/lib/workout-editor-model.mjs"

type ServerCommit = { workoutId: string; providerWorkoutId?: string; revision: string; syncStatus: "pending" | "synced" | "failed"; syncError?: string; workout: PlannedWorkout; model: CommitInput["model"]; deleted?: boolean; syncedAt?: string | number; externalConflict?: unknown }
const ledgers = new Map<string, CommitLedger>()
let running = false, timer: ReturnType<typeof setTimeout> | undefined, started = false
const active = () => apiSessionRevision() !== null && deviceCacheScope() !== "initial"
const resolutionPending = (ledger: CommitLedger, id: string) => Object.values(ledger.resolutions || {}).some(item => item.workoutId === id && item.state === "local")
const publish = (scope: string, ledger: CommitLedger) => {
  const previous = ledgers.get(scope), changed = JSON.stringify(previous?.workouts) !== JSON.stringify(ledger.workouts)
  const synced = Object.values(ledger.workouts).filter(row => row.state === "synced" && previous?.workouts[row.workoutId]?.state !== "synced" && previous?.workouts[row.workoutId])
  ledgers.set(scope, ledger)
  if (changed && typeof window !== "undefined") {
    channel?.postMessage(scope)
    window.dispatchEvent(new CustomEvent("workout-commits-updated", { detail: { synced } }))
    for (const row of Object.values(ledger.workouts)) {
      if (!previous?.workouts[row.workoutId]) {
        if (row.state === "local") window.dispatchEvent(new CustomEvent("training-write-feedback", { detail: { operation: `commit:${row.workoutId}`, workoutId: row.workoutId, state: "queued", title: "Saved on this device; sync pending", description: "The workout and its changes are retained on this device." } }))
        continue
      }
      if (previous.workouts[row.workoutId].state === row.state) continue
      if (row.state === "synced" || row.state === "failed") window.dispatchEvent(new CustomEvent("training-write-feedback", { detail: { operation: `commit:${row.workoutId}`, workoutId: row.workoutId, state: row.state === "synced" ? "success" : "error", title: row.state === "synced" ? "Synced to Intervals.icu" : "Workout saved; sync needs attention", error: row.error, description: row.state === "failed" ? row.error || "Open the workout to review the retained changes and retry." : undefined } }))
    }
  }
}
const channel = typeof BroadcastChannel !== "undefined" && typeof document !== "undefined" ? new BroadcastChannel("workout-commits-v1") : null
channel?.addEventListener("message", () => { void restoreWorkoutCommits().then(() => schedule(0)) })
function schedule(delay = 1500) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = undefined; void resumeWorkoutCommits() }, delay)
}
function projected(id: string, input: CommitInput, previous?: PlannedWorkout): PlannedWorkout {
  const model = input.model, totals = workoutTotals(model), description = input.description ?? model.notes
  const priorValues = previous?.workout_summary?.planned
  const planned = { ...priorValues, ...(input.values || {}), ...(input.values?.duration_seconds === undefined && (input.values === undefined || priorValues?.duration_seconds == null) && !totals.unknownTime ? { duration_seconds: totals.seconds } : {}), ...(input.values?.distance_meters === undefined && priorValues?.distance_meters == null && !totals.unknownDistance && totals.distance > 0 ? {distance_meters:/swim/i.test(model.sport) ? totals.distance / .9144 : totals.distance} : {}) }
  const actual = input.completedValues ? {...previous?.workout_summary?.completed,...input.completedValues} : previous?.workout_summary?.completed || null
  const paired = id.startsWith("activity:") && previous?.activity_id === id.slice(9) && !previous.id.startsWith("activity:")
  const activityEdit = id.startsWith("activity:")
  // Planned and recorded dates/sports are independent on a linked workout.
  // Keep the actual in its recorded week while immediately moving its target.
  // Recording identity/status survives missing measurements. A null summary
  // does not turn a linked recording into a movable planned-only workout.
  const recorded = Boolean(previous?.activity_id || previous?.id.startsWith("activity:") || previous?.status === "completed")
  const date = !activityEdit && recorded && previous?.workout_date ? previous.workout_date : model.date
  return { ...previous, id:paired ? previous.id : id, sport: model.sport, title: model.name, workout_date: date, planned_workout_date: activityEdit ? previous?.planned_workout_date : model.date, date, day: "", duration: "", status: actual || activityEdit ? "completed" : previous?.status || "upcoming", ...(activityEdit ? {activity_id:id.slice(9),activity_type:model.sport} : {provider_type:model.sport,...(recorded ? {activity_type:previous?.activity_type || previous?.provider_type || previous?.sport} : {})}), goal: description, details: description, editable_description: description, editor_model: paired ? previous.editor_model : structuredClone(model), workout_summary: { planned: activityEdit ? previous?.workout_summary?.planned || null : planned, completed: actual }, plannedDurationMinutes: (planned.duration_seconds || 0) / 60 }
}
export async function restoreWorkoutCommits() {
  if (!active()) return
  const scope = deviceCacheScope()
  try { const ledger = await readWorkoutCommits(scope); if (scope === deviceCacheScope()) publish(scope, ledger) } catch { /* The editor reports storage failure when a save is attempted. */ }
}
/** Called only by explicit Save. A resolved promise means local transaction completion;
 * backend acceptance and provider acknowledgement are separate fields. */
export async function acceptWorkoutCommit(id: string | null, input: CommitInput, previous?: PlannedWorkout, action?: LocalCommit["action"], baseEvent?: Record<string, unknown>) {
  if (!active()) throw Error("Load the connected account before saving a workout.")
  const scope = deviceCacheScope(), session = apiSessionRevision()
  const workoutId = id || `app:${input.creationId || randomId()}`, operationId = randomId()
  const { value, ledger } = await transactWorkoutCommits(scope, ledger => {
    if (resolutionPending(ledger,workoutId)) throw Error("Your reviewed choice is saved on this device and is still awaiting confirmation. These unsaved edits remain in the editor; reopen it after the choice is confirmed before saving again.")
    const current = ledger.workouts[workoutId], sequence = ++ledger.sequence
    if (current && input.revision !== current.revision && input.revision !== `local:${current.sequence}`)
      throw Error("This workout changed in another tab. Reopen it before saving; your unsaved edits are retained.")
    const priorOperations = ledger.operations.filter(op => op.workoutId === workoutId)
    const neverAccepted = current && priorOperations.length > 0 && priorOperations.every(op => !op.backendRevision && ["failed", "superseded"].includes(op.state))
    for (const older of priorOperations) {
      // Unsent edits and definite handoff rejections can be replaced. Keep an
      // attempted ambiguous delivery and the create that establishes identity.
      if ((["edit", "edit-activity"].includes(older.action) && !older.input.comment?.trim() && !older.input.completedValues && older.state === "local" && !older.delivery) || (older.state === "failed" && !older.backendRevision)) older.state = "superseded"
    }
    const operation: LocalCommit = { operationId, workoutId, action: action || (id?.startsWith("activity:") ? "edit-activity" : id && (!neverAccepted || !id.startsWith("app:")) ? "edit" : "create"), input: structuredClone(input), ...(baseEvent ? {baseEvent:structuredClone(baseEvent)} : {}), sequence, state: "local", attempts: 0, nextAttempt: 0, acceptedAt: Date.now() }
    const workout = projected(workoutId, input, current?.workout || previous)
    const row: LocalWorkout = { workoutId, workout, input: structuredClone(input), sequence, revision: `local:${sequence}`, state: "local", deleted: action === "delete", providerWorkoutId: current?.providerWorkoutId }
    // Never remove an intent that might have reached the backend. Idempotency
    // identity remains stable through reload, timeout and competing tabs.
    // Bound completed receipts while preserving every unfinished operation.
    ledger.operations = ledger.operations.filter(item => item.state !== "synced" || Date.now() - item.acceptedAt < 86400000)
    ledger.operations.push(operation)
    ledger.workouts[workoutId] = row
    return row
  }).catch(reason => { throw Object.assign(reason instanceof Error ? reason : Error("Workout storage failed. Your edits remain in the editor."), {status:409,code:"LOCAL_SAVE_FAILED"}) })
  if (session !== apiSessionRevision() || scope !== deviceCacheScope()) throw Error("The connected account changed. The original account's save is retained.")
  publish(scope, ledger); channel?.postMessage(scope); schedule(0)
  return { workout: value.workout, revision: value.revision, accepted: true, verified: false, durableBoundary: "local" as const, syncStatus: "local" as const, context: undefined as TrainingContext | undefined, refreshWarning: "Saved on this device; sync pending." }
}
export function localCommittedWorkout(id: string) { return ledgers.get(deviceCacheScope())?.workouts[id] }
export function committedWorkouts() { return Object.values(ledgers.get(deviceCacheScope())?.workouts || {}) }
export function overlayWorkoutCommits<T extends TrainingContext>(context: T): T {
  const ledger = ledgers.get((context as T & { cache_scope?: string }).cache_scope || deviceCacheScope())
  if (!ledger) return context
  let history = context.history, planned = context.planned
  const today = new Intl.DateTimeFormat("en-CA", {timeZone:context.athlete.time_zone || "America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())
  for (const row of Object.values(ledger.workouts)) {
    // Synced sidecars retain the complete model for reopening. They must not
    // permanently mask future external changes once the provider snapshot catches up.
    const snapshot = context as T & {sync_started_at?:string;synced_at?:string}
    const snapshotTime = Date.parse(snapshot.sync_started_at || snapshot.synced_at || "")
    if (row.state === "synced" && (!row.syncedAt || (Number.isFinite(snapshotTime) ? snapshotTime >= row.syncedAt : Date.now() - row.syncedAt > 30000))) continue
    const ids = new Set([row.workoutId, row.providerWorkoutId, row.workout.id].filter(Boolean))
    history = history.filter(w => !("id" in w && ids.has(w.id as string)) && !("activity_id" in w && w.activity_id && ids.has(`activity:${w.activity_id}`)))
    planned = planned.filter(w => !ids.has(w.id) && !(w.activity_id && ids.has(`activity:${w.activity_id}`)))
    if (!row.deleted) {
      const workout = { ...row.workout, app_sync_status: row.state } as PlannedWorkout
      if (workout.workout_date! <= today) history = [...history, {...workout,workout_date:workout.workout_date!}]
      if (workout.workout_date! >= today) planned = [...planned, workout]
    }
  }
  return { ...context, history, planned }
}
export function committedEditorRead(id: string) {
  const row = localCommittedWorkout(id)
  if (!row || row.deleted) return null
  const latestComment = row.input.comment?.trim() ? [{id:row.input.commentId || `local:${row.sequence}`,body:row.input.comment.trim()}] : []
  const comments = [...new Map([...latestComment,...(row.input.comments || [])].map(comment=>[comment.id,comment])).values()]
  return { model: structuredClone(row.input.model), revision: row.revision, issues: [], warnings: row.externalConflict ? ["This workout changed in Intervals.icu. The app version is retained; review both versions before retrying."] : [], originalDescription: row.input.description ?? row.input.model.notes, reviewRequired: false, ambiguousSwim: false, scheduledTime: row.input.time || "", plannedValues: {...row.workout.workout_summary?.planned,...row.input.values}, completedEditableFields: row.input.completedEditableFields, completedValues: {...row.workout.workout_summary?.completed,...row.input.completedValues}, manualDescription: row.input.description ?? row.input.model.notes, comments, zoneSettings: row.input.zoneSettings }
}
const semanticModel = (model: CommitInput["model"]) => {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value==="object" ? Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>key!=="id"&&key!=="thresholds").sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])) : value
  return JSON.stringify(stable(model))
}
/** An authoritative new calendar snapshot may expose an external edit before
 * the backend's bounded read reconciliation finishes. Flag it for explicit review
 * without replacing either the accepted model or the observed candidate. */
export async function observeWorkoutCommitContext(context: TrainingContext & {cache_scope?:string;version?:string}) {
  if(!active() || context.cache_scope && context.cache_scope!==deviceCacheScope())return
  const scope=deviceCacheScope(),session=apiSessionRevision()
  const snapshot=context as TrainingContext & {sync_started_at?:string;synced_at?:string;cached_ranges?:{start:string;end:string}[];display_range?:{start:string;end:string}}
  const snapshotTime=Date.parse(snapshot.sync_started_at || snapshot.synced_at || "")
  if(!Number.isFinite(snapshotTime))return
  const candidates=[...context.history,...context.planned].filter(workout=>"id" in workout) as PlannedWorkout[]
  const memory=ledgers.get(scope)
  if(!memory || !Object.values(memory.workouts).some(row=>row.state==="synced"&&!row.deleted&&row.syncedAt&&snapshotTime>=row.syncedAt))return
  const changes=new Map<string,{sequence:number;revision:string;externalConflict:unknown}>()
  for(const row of Object.values(memory.workouts)){
      if(row.state!=="synced"||row.deleted||!row.syncedAt||snapshotTime<row.syncedAt||resolutionPending(memory,row.workoutId))continue
      const candidate=candidates.find(workout=>workout.id===row.workoutId||workout.id===row.providerWorkoutId)
      const ranges=[...(snapshot.cached_ranges || []),...(snapshot.display_range?[snapshot.display_range]:[])]
      const missing=!candidate && ranges.some(range=>row.workout.workout_date!>=range.start&&row.workout.workout_date!<=range.end)
      const text=(value:unknown)=>typeof value==="string"?value.replaceAll("\r\n","\n").trim():null
      const changed=Boolean(candidate && candidate.status!=="completed" && (
        candidate.title!==undefined&&candidate.title!==row.workout.title ||
        candidate.workout_date!==undefined&&candidate.workout_date!==row.workout.workout_date ||
        candidate.editor_model&&semanticModel(candidate.editor_model)!==semanticModel(row.input.model) ||
        text(candidate.details)!==null&&text(row.workout.details)!==null&&text(candidate.details)!==text(row.workout.details)
      ))
      if(missing||changed){
        changes.set(row.workoutId,{sequence:row.sequence,revision:row.revision,externalConflict:missing?{deleted:true,observed:true,contextVersion:context.version}:{observed:true,workout:structuredClone(candidate),contextVersion:context.version}})
      }
  }
  if(!changes.size)return
  const updated=await transactWorkoutCommits(scope,state=>{
    for(const [id,change] of changes){
      const row=state.workouts[id]
      if(!row || row.state!=="synced" || row.sequence!==change.sequence || row.revision!==change.revision || resolutionPending(state,id))continue
      row.externalConflict=change.externalConflict
      row.state="failed";row.error="The refreshed calendar shows changes outside the app. Both versions are retained; review them before choosing which one to save."
    }
  })
  if(scope===deviceCacheScope()&&session===apiSessionRevision())publish(scope,updated.ledger)
}
/** The reviewed choice and exact retry identity are durable before any request.
 * Navigation/reload never has to recover an operation ID from component memory. */
export async function resolveWorkoutConflict(id: string, expectedSequence: number | undefined, body: ConflictResolutionBody, review?: unknown) {
  if (!active()) throw Error("Sign in before saving a reviewed choice.")
  const scope = deviceCacheScope(), session = apiSessionRevision()
  const updated = await transactWorkoutCommits(scope,state=>{
    state.resolutions ||= {}
    const existing = state.resolutions[body.operationId]
    if (existing) {
      if (existing.workoutId !== id || existing.expectedSequence !== expectedSequence || JSON.stringify(existing.body) !== JSON.stringify(body)) throw Error("This reviewed choice identity is already bound to another decision.")
      if(existing.state==="failed")throw Error(existing.error || "The earlier reviewed choice was rejected. Refresh both versions before choosing again.")
      return existing
    }
    const row = state.workouts[id]
    if (!row || row.sequence !== expectedSequence || row.revision !== body.expectedRevision) throw Error("A newer edit was saved while this review was open. Reopen both versions; your edits are retained.")
    if (resolutionPending(state,id)) throw Error("Your earlier reviewed choice is still awaiting confirmation. It is retained on this device and will retry automatically.")
    if (state.operations.some(op=>op.workoutId===id && op.state==="local")) throw Error("A saved edit is still being delivered. Confirm that edit before choosing between versions.")
    const intent = {workoutId:id,expectedSequence:row.sequence,body:structuredClone(body),localSnapshot:structuredClone(row),...(review===undefined?{}:{review:structuredClone(review)}),state:"local" as const,attempts:0,nextAttempt:0,acceptedAt:Date.now()}
    state.resolutions[body.operationId]=intent
    row.state="local";row.error=undefined
    return intent
  })
  if (scope !== deviceCacheScope() || session !== apiSessionRevision()) throw Error("The connected account changed. The original account's reviewed choice is retained.")
  publish(scope,updated.ledger);schedule(0)
  return {accepted:true,durableBoundary:"local" as const,syncStatus:"pending" as const,operationId:updated.value.body.operationId,resolutionState:updated.value.state}
}

function applyResolutionReceipt(state: CommitLedger,id: string,sequence: number | undefined,result: ServerCommit & {input?:CommitInput}) {
  const row=state.workouts[id]
  if (!row || row.sequence!==sequence) throw Error("A newer local edit is retained. Reopen the workout to reconcile the confirmed review choice before saving again.")
  if (result.workoutId!==id || !/^app:\d+$/.test(result.revision) || !result.model || !Array.isArray(result.model.steps)) throw Error("The app could not confirm this resolution.")
  for(const op of state.operations)if(op.workoutId===id)op.state="superseded"
  row.revision=result.revision;row.state=result.syncStatus;row.error=result.syncError
  row.externalConflict=result.externalConflict || undefined;row.providerWorkoutId=result.providerWorkoutId;row.deleted=result.deleted
  row.input={...(result.input || row.input),model:result.model,revision:result.revision}
  row.workout=result.workout || row.workout
  row.syncedAt=typeof result.syncedAt==="number"?result.syncedAt:Date.parse(result.syncedAt || "") || undefined
}

async function deliverWorkoutResolutions(scope: string,session: ReturnType<typeof apiSessionRevision>) {
  const stillCurrent=()=>scope===deviceCacheScope() && session===apiSessionRevision()
  const ledger=await readWorkoutCommits(scope)
  const intents=Object.values(ledger.resolutions || {}).filter(intent=>intent.state==="local" && intent.nextAttempt<=Date.now())
  await Promise.allSettled(intents.map(async intent=>{
    if(!stillCurrent())return
    try {
      const response=await apiFetch(`/api/workout-commits/${encodeURIComponent(intent.workoutId)}/conflict`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(intent.body),signal:AbortSignal.timeout(15000)})
      const result=await response.json()
      if(!stillCurrent())return
      if(!response.ok){
        const retryAfter=response.headers.get("Retry-After"),retryAt=retryAfter?(/^\d+(?:\.\d+)?$/.test(retryAfter)?Date.now()+Number(retryAfter)*1000:Date.parse(retryAfter)):0
        throw Object.assign(Error(result.error || "The reviewed choice could not be confirmed."),{permanent:response.status>=400&&response.status<500&&![408,429].includes(response.status)&&result.code!=="WORKOUT_WRITE_BUSY",retryAt})
      }
      const updated=await transactWorkoutCommits(scope,state=>{
        const saved=state.resolutions?.[intent.body.operationId]
        if(!saved || saved.state!=="local")return
        applyResolutionReceipt(state,intent.workoutId,intent.expectedSequence,result)
        saved.state="confirmed";saved.error=undefined;saved.backendRevision=result.revision
      })
      publish(scope,updated.ledger)
    }catch(reason){
      if(!stillCurrent())return
      const updated=await transactWorkoutCommits(scope,state=>{
        const saved=state.resolutions?.[intent.body.operationId]
        if(!saved || saved.state!=="local")return
        saved.attempts++;saved.error=reason instanceof Error?reason.message:"The reviewed choice is retained and will retry."
        saved.nextAttempt=Math.max((reason as {retryAt?:number}).retryAt||0,Date.now()+Math.min(300000,1000*2**Math.min(saved.attempts,8))*(.75+Math.random()*.5))
        if((reason as {permanent?:boolean}).permanent){
          saved.state="failed"
          const row=state.workouts[intent.workoutId]
          if(row?.sequence===intent.expectedSequence){row.state="failed";row.error=saved.error}
        }
      })
      publish(scope,updated.ledger)
    }
  }))
}
async function processScope() {
  if (!active() || navigator.onLine === false) return
  const scope = deviceCacheScope(), session = apiSessionRevision()
  const stillCurrent = () => scope === deviceCacheScope() && session === apiSessionRevision()
  const ledger = await readWorkoutCommits(scope)
  if (stillCurrent()) publish(scope, ledger)
  const resolutionDelivery=deliverWorkoutResolutions(scope,session)
  const blocked = new Set<string>()
  for (const op of ledger.operations.filter(op => op.state === "local")) {
    if (!stillCurrent()) return
    if (blocked.has(op.workoutId)) continue
    if (resolutionPending(ledger,op.workoutId)) continue
    blocked.add(op.workoutId)
    if (op.nextAttempt > Date.now()) continue
    try {
      const prior = ledger.operations.filter(p => p.workoutId === op.workoutId && p.sequence < op.sequence && p.state !== "superseded").sort((a,b) => b.sequence-a.sequence)[0]
      if (prior && !prior.backendRevision) continue
      const prepared = await transactWorkoutCommits(scope, state => {
        if(resolutionPending(state,op.workoutId))throw Object.assign(Error("The reviewed choice is awaiting confirmation."),{resolutionPending:true})
        const saved = state.operations.find(item => item.operationId === op.operationId)
        if (!saved) throw Error("The retained save could not be found.")
        return saved.delivery ||= { operationId: op.operationId, workoutId: op.workoutId, action: op.action, input: { ...op.input, revision: prior?.backendRevision || op.input.revision }, ...(op.baseEvent && !prior?.backendRevision ? {baseEvent:op.baseEvent} : {}) }
      })
      const response = await apiFetch("/api/workout-commits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prepared.value), signal: AbortSignal.timeout(15000) })
      const result = await response.json()
      if (!stillCurrent()) return
      if (!response.ok || !result.accepted || result.workoutId !== op.workoutId || !/^app:\d+$/.test(result.revision)) {
        const retryAfter = response.headers.get("Retry-After"), retryAt = retryAfter ? (/^\d+$/.test(retryAfter) ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter)) : 0
        throw Object.assign(Error(result.error || "The app could not accept this workout."), { permanent: response.status >= 400 && response.status < 500 && ![408,429].includes(response.status), retryAt })
      }
      const updated = await transactWorkoutCommits(scope, state => {
        const saved = state.operations.find(item => item.operationId === op.operationId)
        if (!saved) return
        const revision = Number.isSafeInteger(result.operationRevision) ? `app:${result.operationRevision}` : result.revision
        saved.state = "pending"; saved.backendRevision = revision; saved.error = undefined
        const row = state.workouts[op.workoutId]
        if (row?.sequence === op.sequence) { row.revision = revision; row.state = "pending"; row.providerWorkoutId = result.providerWorkoutId }
      })
      publish(scope, updated.ledger)
    } catch (reason) {
      if (!stillCurrent()) return
      if((reason as {resolutionPending?:boolean}).resolutionPending)continue
      const updated = await transactWorkoutCommits(scope, state => {
        const saved = state.operations.find(item => item.operationId === op.operationId)
        if (!saved) return
        saved.attempts++; saved.error = reason instanceof Error ? reason.message : "Sync pending."
        saved.nextAttempt = Math.max((reason as { retryAt?: number }).retryAt || 0, Date.now() + Math.min(300000, 1000 * 2 ** Math.min(saved.attempts, 8)) * (.75 + Math.random() * .5))
        if ((reason as {permanent?: boolean}).permanent) {
          for (const queued of state.operations) if (queued.workoutId === op.workoutId && queued.state === "local") queued.state = "failed"
          const row = state.workouts[op.workoutId]
          if (row) { row.state = "failed"; row.error = `Saved on this device. ${saved.error}` }
        }
      })
      publish(scope, updated.ledger)
    }
  }
  await resolutionDelivery
  if (!stillCurrent()) return
  const pending = await readWorkoutCommits(scope)
  if (!Object.keys(pending.workouts).length) return
  try {
    const response = await apiFetch("/api/workout-commits", { signal: AbortSignal.timeout(15000) })
    if (!response.ok) return
    const result = await response.json() as {workouts: ServerCommit[]}
    if (!stillCurrent() || !Array.isArray(result.workouts)) return
    const updated = await transactWorkoutCommits(scope, state => {
      for (const remote of result.workouts) {
        const row = state.workouts[remote.workoutId]
        if(resolutionPending(state,remote.workoutId))continue
        if (!row || row.revision !== remote.revision) continue
        if((row.externalConflict as {observed?:boolean}|undefined)?.observed && !remote.externalConflict)continue
        if(row.state==="synced" && remote.syncStatus==="pending")continue
        row.state = remote.syncStatus; row.error = remote.syncError; row.providerWorkoutId = remote.providerWorkoutId; row.externalConflict = remote.externalConflict
        if (remote.syncStatus === "failed") for (const op of state.operations) if (op.workoutId === row.workoutId && op.state === "pending") op.state = "failed"
        if (remote.syncStatus === "synced") {
          row.syncedAt = (typeof remote.syncedAt === "number" ? remote.syncedAt : Date.parse(remote.syncedAt || "")) || Date.now()
          const paired = row.workoutId.startsWith("activity:") && !row.workout.id.startsWith("activity:")
          row.workout = { ...remote.workout, ...(paired ? {id:row.workout.id,editor_model:row.workout.editor_model,workout_summary:{completed:remote.workout.workout_summary?.completed || null,planned:row.workout.workout_summary?.planned || null}} : {editor_model:row.input.model}) }
          for (const op of state.operations) if (op.workoutId === row.workoutId && op.backendRevision && op.state!=="superseded") op.state = "synced"
        }
      }
    })
    publish(scope, updated.ledger)
  } catch { /* Persistent delivery resumes after reconnect. */ }
}
export async function retryWorkoutSynchronization(id: string) {
  if (!active()) throw Error("Sign in to retry synchronization.")
  const scope = deviceCacheScope(), session = apiSessionRevision(), row = localCommittedWorkout(id)
  const requireCurrentAccount = () => {
    if (scope !== deviceCacheScope() || session !== apiSessionRevision()) throw Error("The connected account changed. The original account's save is retained.")
  }
  if (!row) throw Error("Reopen the workout before retrying.")
  const ledger = await readWorkoutCommits(scope), latest = ledger.operations.find(op => op.sequence === row.sequence)
  requireCurrentAccount()
  if(resolutionPending(ledger,id))throw Error("Your reviewed choice is retained and will retry automatically. Confirm it before retrying workout synchronization.")
  if (latest?.backendRevision) {
    const response = await apiFetch(`/api/workout-commits/${encodeURIComponent(id)}/retry`, { method: "POST", signal: AbortSignal.timeout(15000) })
    requireCurrentAccount()
    if (!response.ok) { const error = await response.json(); throw Error(error.error || "Synchronization could not be retried.") }
  }
  const updated = await transactWorkoutCommits(scope, state => {
    const current = state.workouts[id]
    if (!current || current.sequence !== row.sequence) return
    current.state = latest?.backendRevision ? "pending" : "local"; current.error = undefined
    for (const op of state.operations) if (op.workoutId === id && op.state === "failed") { op.state = op.backendRevision ? "pending" : "local"; op.nextAttempt = 0 }
  })
  requireCurrentAccount()
  publish(scope, updated.ledger); schedule(0)
}
/** A reviewed conflict is accepted by the backend first. Never replace an edit
 * accepted on this device while the explicit resolution request was running. */
export async function applyWorkoutConflictResolution(id: string, sequence: number | undefined, result: ServerCommit & { input?: CommitInput }) {
  if (!active()) throw Error("Sign in to see the saved resolution.")
  const scope = deviceCacheScope()
  const updated = await transactWorkoutCommits(scope, state => {
    applyResolutionReceipt(state,id,sequence,result)
  })
  publish(scope, updated.ledger); schedule(0)
}
export async function resumeWorkoutCommits() {
  if (running || !active()) return
  running = true
  try {
    // Web Locks serialize delivery across tabs. Server operation identities and
    // CAS remain authoritative where the browser lacks Web Locks support.
    if (navigator.locks) await navigator.locks.request(`workout-delivery:${deviceCacheScope()}`, { ifAvailable: true }, lock => lock ? processScope() : Promise.resolve())
    else await processScope()
  } catch { /* Storage/network failure is retained and retried. */ }
  finally {
    running = false
    const ledger = ledgers.get(deviceCacheScope())
    if (navigator.onLine !== false && (ledger?.operations.some(op => ["local", "pending"].includes(op.state)) || Object.values(ledger?.workouts || {}).some(row => row.state === "pending") || Object.values(ledger?.resolutions || {}).some(intent=>intent.state==="local"))) schedule()
  }
}
export function startWorkoutCommitRecovery() {
  if (started || typeof window === "undefined" || typeof document === "undefined") return
  started = true
  const resume = () => { void restoreWorkoutCommits().then(() => schedule(0)) }
  let restoredScope = ""
  const contextVersions=new Map<string,string>(),contextChecks=new Map<string,number>(),deferredChecks=new Map<string,ReturnType<typeof setTimeout>>()
  for (const name of ["online", "pageshow"]) window.addEventListener(name, resume)
  window.addEventListener("training-context-updated", event => {
    if(!active())return
    const scope=deviceCacheScope()
    if(restoredScope!==scope){restoredScope=scope;resume();return}
    const detail=(event as CustomEvent<{version?:string;cache_scope?:string}>).detail
    if(detail?.cache_scope && detail.cache_scope!==scope)return
    if(detail && "athlete" in detail)void observeWorkoutCommitContext(detail as unknown as TrainingContext).catch(()=>{})
    const version=detail?.version
    if(version && contextVersions.get(scope)===version)return
    if(Date.now()-(contextChecks.get(scope)||0)<30000){
      if(!deferredChecks.has(scope))deferredChecks.set(scope,setTimeout(()=>{
        deferredChecks.delete(scope)
        if(active()&&deviceCacheScope()===scope){contextChecks.set(scope,Date.now());if(version)contextVersions.set(scope,version);resume()}
      },30000-(Date.now()-(contextChecks.get(scope)||0))))
      return
    }
    if(version)contextVersions.set(scope,version)
    contextChecks.set(scope,Date.now());resume()
    // A status request starts backend reconciliation after responding. One
    // bounded catch-up sees its result without a permanent idle polling loop.
    setTimeout(()=>{if(active()&&deviceCacheScope()===scope)resume()},2500)
  })
  document.addEventListener("visibilitychange", () => { if (!document.hidden) resume() })
  resume()
}
