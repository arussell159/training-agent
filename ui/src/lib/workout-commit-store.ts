import type { PlannedWorkout, WorkoutSummaryValues } from "./training-context"
import type { WorkoutModel } from "../../../app-backend/lib/workout-editor-model.mjs"

export type CommitInput = { model: WorkoutModel; revision?: string; creationId?: string; reconcileOnly?: boolean; values?: Partial<WorkoutSummaryValues>; time?: string; description?: string; descriptionMode?: "manual"; comment?: string; commentId?: string; personal?: import("./workout-local-metadata").WorkoutLocalMetadata; recurrence?: import("./workout-recurrence").WorkoutRecurrenceDraft | null; comments?: {id:string;body:string}[]; zoneSettings?: import("../../../app-backend/lib/workout-editor-zones.mjs").SportZoneSettings[]; personalId?: string }
export type LocalCommit = {
  operationId: string; workoutId: string; action: "create" | "edit" | "delete" | "move"
  input: CommitInput; baseEvent?: Record<string, unknown>; sequence: number
  backendRevision?: string; state: "local" | "pending" | "synced" | "failed" | "superseded"
  error?: string; attempts: number; nextAttempt: number; acceptedAt: number
  delivery?: { operationId: string; workoutId: string; action: LocalCommit["action"]; input: CommitInput; baseEvent?: Record<string, unknown> }
}
export type LocalWorkout = { workoutId: string; workout: PlannedWorkout; input: CommitInput; sequence: number; revision: string; state: LocalCommit["state"]; deleted?: boolean; providerWorkoutId?: string; error?: string; syncedAt?: number; externalConflict?: unknown }
export type ConflictResolutionBody = { operationId: string; expectedRevision: string; candidateRevision: string; choice: "local" | "provider" }
export type LocalConflictResolution = { workoutId: string; expectedSequence: number; body: ConflictResolutionBody; localSnapshot: LocalWorkout; review?: unknown; state: "local" | "confirmed" | "failed"; attempts: number; nextAttempt: number; acceptedAt: number; error?: string; backendRevision?: string }
export type CommitLedger = { sequence: number; workouts: Record<string, LocalWorkout>; operations: LocalCommit[]; resolutions?: Record<string, LocalConflictResolution> }
const empty = (): CommitLedger => ({ sequence: 0, workouts: {}, operations: [] })
let database: Promise<IDBDatabase> | undefined
function open() {
  if (database) return database
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("training-agent-workout-commits-v1", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("ledgers")
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined }; resolve(request.result) }
    request.onerror = () => { database = undefined; reject(request.error || Error("Workout storage is unavailable.")) }
    request.onblocked = () => { database = undefined; reject(Error("Close older app tabs to upgrade workout storage.")) }
  })
  database = attempt
  void attempt.catch(() => { if (database === attempt) database = undefined })
  return attempt
}
/** The revision, full editor model and delivery intent commit in ONE IDB transaction.
 * Success means transaction.oncomplete, never a request's onsuccess. */
export async function transactWorkoutCommits<T>(scope: string, change: (ledger: CommitLedger) => T): Promise<{ value: T; ledger: CommitLedger }> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("ledgers", "readwrite", { durability: "strict" })
    const store = tx.objectStore("ledgers"), request = store.get(scope)
    let result: { value: T; ledger: CommitLedger }
    let failure: unknown
    request.onsuccess = () => {
      try {
        const ledger: CommitLedger = request.result || empty()
        result = { value: change(ledger), ledger }
        store.put(ledger, scope)
      } catch (error) { failure = error; tx.abort() }
    }
    tx.oncomplete = () => resolve(result)
    tx.onabort = tx.onerror = () => reject(failure || tx.error || Error("Workout storage failed. Your edits remain in the editor."))
  })
}
export async function readWorkoutCommits(scope: string): Promise<CommitLedger> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("ledgers"), request = tx.objectStore("ledgers").get(scope)
    request.onsuccess = () => resolve(request.result || empty())
    request.onerror = () => reject(request.error)
  })
}
