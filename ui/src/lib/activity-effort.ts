import { apiFetch } from "./api-client.ts"
import { deviceCacheScope } from "./device-cache.ts"
import { createSharedRequestCache } from "./shared-request-cache.ts"
import {
  normalizeActivityEffortTarget,
  verifiedActivityEffort,
  type ActivityEffortTarget,
} from "./activity-effort-navigation.ts"

const efforts = createSharedRequestCache(
  async (key, signal) => {
    const [, , revision, , target] = JSON.parse(key) as [
      string,
      number,
      string,
      number,
      ActivityEffortTarget,
    ]
    const query = new URLSearchParams({ type: target.sport, v: revision })
    query.set(
      target.kind === "power" ? "duration" : "distance",
      String(target.durationSeconds ?? target.distanceMeters)
    )
    const response = await apiFetch(
      `/api/activities/${encodeURIComponent(target.activityId)}/performance-effort?${query}`,
      { signal, cache: "no-store" }
    )
    if (!response.ok)
      throw Error("The selected effort could not be loaded. Please retry.")
    return verifiedActivityEffort(await response.json(), target)
  },
  { maxEntries: 20, maxWeight: 20, timeoutMs: 65000 }
)

for (const event of [
  "training-cache-reset",
  "device-cache-cleared",
  "app-auth-required",
])
  window.addEventListener(event, () => efforts.clear())

export function loadActivityEffort(
  target: ActivityEffortTarget,
  revision = "",
  signal?: AbortSignal,
  attempt = 0
) {
  const checked = normalizeActivityEffortTarget(target)
  if (!checked)
    return Promise.reject(Error("Choose a recorded activity effort."))
  // Short-lived, account-scoped sharing; retry does not reuse an unavailable result.
  const key = JSON.stringify([
    deviceCacheScope(),
    Math.floor(Date.now() / 300000),
    revision,
    attempt,
    checked,
  ])
  return efforts.get(key, signal)
}
