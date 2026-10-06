import { apiFetch } from "./api-client"
import { deviceCacheScope } from "./device-cache"
import { createSharedRequestCache } from "./shared-request-cache"
import type { WorkoutRecordedAnalysis } from "../components/workout-analysis"

const keyFor = (id: string, revision: string) =>
  JSON.stringify([deviceCacheScope(), id, revision])
const recordings = createSharedRequestCache<WorkoutRecordedAnalysis>(
  async (key, signal) => {
    const [, id, revision] = JSON.parse(key) as string[]
    const response = await apiFetch(
      `/api/activities/${encodeURIComponent(id)}/analysis?schema=8&v=${encodeURIComponent(revision)}`,
      { signal }
    )
    if (!response.ok)
      throw new Error("The recording could not be loaded. Please retry.")
    const data = (await response.json()) as WorkoutRecordedAnalysis
    if (!Array.isArray(data.points))
      throw new Error("The recording is incomplete. Please retry.")
    return data
  },
  { maxWeight: 100000, weight: (data) => data.points.length }
)

const routes = createSharedRequestCache<[number, number][]>(
  async (key, signal) => {
    const [, id, revision] = JSON.parse(key) as string[]
    const response = await apiFetch(
      `/api/activities/${encodeURIComponent(id)}/route?schema=2&v=${encodeURIComponent(revision)}`,
      { signal }
    )
    if (!response.ok) throw new Error("The route could not be loaded.")
    const data = await response.json()
    if (!Array.isArray(data.points)) throw new Error("The route is incomplete.")
    return data.points.filter(
      (point: unknown): point is [number, number] =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every(Number.isFinite) &&
        Math.abs(point[0]) <= 85 &&
        Math.abs(point[1]) <= 180
    )
  },
  { maxWeight: 250000, weight: (points) => points.length, timeoutMs: 15000 }
)

for (const event of [
  "training-cache-reset",
  "device-cache-cleared",
  "app-auth-required",
])
  window.addEventListener(event, () => {
    recordings.clear()
    routes.clear()
  })
export const cachedActivityRoute = (id: string, revision = "") =>
  routes.peek(keyFor(id, revision))
export const loadActivityRoute = (
  id: string,
  revision = "",
  signal?: AbortSignal
) => routes.get(keyFor(id, revision), signal)
export const cachedActivityAnalysis = (id: string, revision = "") =>
  recordings.peek(keyFor(id, revision))
export const loadActivityAnalysis = (
  id: string,
  revision = "",
  signal?: AbortSignal
) => recordings.get(keyFor(id, revision), signal)

export function prefetchWorkoutRecording(workout: {id:string;activity_id?:string|null;activity_revision?:string}) {
  const id=workout.activity_id || (workout.id.startsWith('activity:')?workout.id.slice(9):null)
  if(!id)return
  void loadActivityRoute(id,workout.activity_revision).catch(()=>{})
  void loadActivityAnalysis(id,workout.activity_revision).catch(()=>{})
  void import('../components/workout-analysis').catch(()=>{})
  void import('../components/mapbox-route-map-canvas').then(module=>module.prewarmRouteMap()).catch(()=>{})
}
