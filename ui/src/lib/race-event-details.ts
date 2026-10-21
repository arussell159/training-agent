import { apiFetch } from "./api-client.ts"
import type { AnnualPlan } from "./annual-plan"
import type { TrainingContext } from "./training-context"
export {
  raceEventTypeGroups,
  raceEventTypes,
  validateRaceEventDetails,
  emptyRaceGoals,
  runningRaceDistances,
  runningAtpEventTypes,
  raceAtpEventTypes,
  raceGoalDistanceUnits,
} from "../../../app-backend/lib/race-event-details-model.mjs"
export type { RaceEventDetails } from "../../../app-backend/lib/race-event-details-model.mjs"
import type { RaceEventDetails } from "../../../app-backend/lib/race-event-details-model.mjs"

export type RaceEventRead = RaceEventDetails & {
  id: string
  revision: string
  editable: boolean
  metadataCurrent: boolean
}
export type RaceEventSaveResult = {
  event: RaceEventRead
  verified: true
  context?: TrainingContext | null
  plan?: AnnualPlan | null
}
export async function readRaceEvent(
  id: string,
  signal?: AbortSignal
): Promise<RaceEventRead> {
  const response = await apiFetch(
    `/api/race-events/${encodeURIComponent(id)}`,
    { signal }
  )
  const result = await response.json()
  if (!response.ok)
    throw Object.assign(
      Error(result.error || "The event could not be loaded."),
      { status: response.status }
    )
  if (
    !result.event ||
    result.event.id !== id ||
    !/^[a-f0-9]{64}$/.test(result.event.revision)
  )
    throw Error("The event response could not be verified.")
  return result.event
}
export async function saveRaceEvent(
  entry: RaceEventDetails,
  identity: { id: string; revision: string } | { creationId: string }
): Promise<RaceEventSaveResult> {
  const editing = "id" in identity
  const response = await apiFetch(
    editing
      ? `/api/race-events/${encodeURIComponent(identity.id)}`
      : "/api/race-events",
    {
      method: editing ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ...entry,
        ...(editing
          ? { revision: identity.revision }
          : { creationId: identity.creationId }),
      }),
    }
  )
  const result = await response.json()
  if (!response.ok)
    throw Object.assign(
      Error(result.error || "The event save could not be confirmed."),
      {
        status: response.status,
        ...(typeof result.code === "string" ? { code: result.code } : {}),
        ...(response.status === 409 && result.code === "EVENT_REPLAY_CHANGED" &&
          typeof result.eventId === "string" && /^event:[1-9]\d*$/.test(result.eventId)
          ? { eventId: result.eventId } : {}),
      }
    )
  if (
    result.verified !== true ||
    !result.event ||
    !/^event:[1-9]\d*$/.test(result.event.id) ||
    !/^[a-f0-9]{64}$/.test(result.event.revision)
  )
    throw Error(
      "The event save could not be verified. Keep this draft and recheck it."
    )
  return result
}
