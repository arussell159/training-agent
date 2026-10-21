import { validateRaceEventDetails, raceEventTypes, emptyRaceGoals, type RaceEventDetails } from "../../../app-backend/lib/race-event-details-model.mjs"

type CreationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
export type PendingEventCreation = {
  creationId: string
  submitted: RaceEventDetails
  draft: RaceEventDetails
  customGoal: string
  goalsOpen: boolean
  replayEventId?: string
}
const key = (scope: string) => {
  if (typeof scope !== "string" || !scope || scope === "initial") throw Error("Wait for your account calendar to load before saving an Event.")
  return `event-creation-pending:${JSON.stringify(scope)}`
}
const validDraft = (value: unknown): value is RaceEventDetails => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  const limits: Record<string, number> = {name:150,date:10,priority:1,eventType:80,description:12000,raceDistance:80,atpEventType:80}
  if (Object.keys(row).some(field => field !== "goals" && !Object.hasOwn(limits,field))) return false
  for (const field of ["name","date","priority","eventType","description"])
    if (typeof row[field] !== "string") return false
  for (const [field,limit] of Object.entries(limits))
    if (row[field] !== undefined && (typeof row[field] !== "string" || (row[field] as string).length > limit)) return false
  if (!["","A","B","C"].includes(row.priority as string) || (row.eventType && !Object.hasOwn(raceEventTypes,row.eventType as string))) return false
  if (row.goals !== undefined) {
    if (!row.goals || typeof row.goals !== "object" || Array.isArray(row.goals)) return false
    const goals = row.goals as Record<string,unknown>
    if (Object.keys(goals).some(field => !Object.hasOwn(emptyRaceGoals(),field))) return false
    for (const field of ["time","distance","distanceUnit","place"])
      if (typeof goals[field] !== "string" || (goals[field] as string).length > 100) return false
    if (typeof goals.finish !== "boolean" || typeof goals.setPr !== "boolean" || !Array.isArray(goals.custom) || goals.custom.length > 30 || goals.custom.some(item => typeof item !== "string" || item.length > 1000)) return false
  }
  return true
}
function checked(value: unknown): PendingEventCreation {
  const row = value as PendingEventCreation
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(field => !["creationId","submitted","draft","customGoal","goalsOpen","replayEventId"].includes(field)) ||
    typeof row.creationId !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(row.creationId) ||
    !validDraft(row.draft) || typeof row.customGoal !== "string" || row.customGoal.length > 1000 || typeof row.goalsOpen !== "boolean" ||
    (row.replayEventId !== undefined && (typeof row.replayEventId !== "string" || !/^event:[1-9]\d*$/.test(row.replayEventId))))
    throw Error("The retained Event draft could not be verified. Keep it and retry recovery before creating another Event.")
  validateRaceEventDetails(row.submitted)
  return structuredClone(row)
}
export function readPendingEventCreation(storage: CreationStorage, scope: string): PendingEventCreation | null {
  const name = key(scope)
  let raw: string | null
  try {raw = storage.getItem(name)}
  catch {throw Error("The retained Event draft could not be read. Retry recovery before sending another Event request.")}
  if (raw === null) return null
  try {
    if (raw.length > 100000) throw Error("Too large")
    const record = JSON.parse(raw)
    if (record?.version !== 1) throw Error("Unsupported version")
    return checked(record.input)
  } catch {
    throw Error("The retained Event draft could not be verified. Keep it and retry recovery before creating another Event.")
  }
}
export function rememberPendingEventCreation(storage: CreationStorage, scope: string, input: PendingEventCreation) {
  const next = checked(input), previous = readPendingEventCreation(storage,scope)
  if (previous && (previous.creationId !== next.creationId || JSON.stringify(previous.submitted) !== JSON.stringify(next.submitted)))
    throw Error("Another Event save still needs confirmation. Reopen Event to recover it before creating another Event.")
  const encoded = JSON.stringify({version:1,input:next})
  if (encoded.length > 100000) throw Error("The Event recovery draft is too large to retain. Shorten it before sending a new Event request.")
  try { storage.setItem(key(scope),encoded) }
  catch { throw Error("The Event recovery draft could not be retained. No new Event request was sent; keep this editor open and retry.") }
}
export function clearPendingEventCreation(storage: CreationStorage, scope: string, creationId: string): boolean {
  try {
    if (readPendingEventCreation(storage,scope)?.creationId !== creationId) return false
    storage.removeItem(key(scope))
    return true
  } catch { return false }
}
