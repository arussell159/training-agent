export type ActivityEffortTarget = {
  activityId: string
  sport: "Ride" | "Run" | "Swim"
  kind: "power" | "pace"
  durationSeconds: number | null
  distanceMeters: number | null
  value: number
  startSeconds?: number
  endSeconds?: number
}

export const ACTIVITY_EFFORT_OPEN_EVENT = "app-activity-open"
export const ACTIVITY_EFFORT_SELECTION_EVENT =
  "activity-effort-selection-changed"
const PARAM = "effort"
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

export function normalizeActivityEffortTarget(
  value: unknown
): ActivityEffortTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const target = value as Record<string, unknown>
  if (
    typeof target.activityId !== "string" ||
    !/^i?[1-9]\d{0,19}$/.test(target.activityId) ||
    !["Ride", "Run", "Swim"].includes(target.sport as string) ||
    !finite(target.value) ||
    target.value < 0 ||
    (target.sport === "Ride"
      ? target.kind !== "power"
      : target.kind !== "pace" || target.value === 0)
  )
    return null
  const power = target.kind === "power"
  if (
    power
      ? !finite(target.durationSeconds) ||
        !Number.isSafeInteger(target.durationSeconds) ||
        target.durationSeconds <= 0 ||
        target.durationSeconds > 86400 ||
        target.distanceMeters != null
      : !finite(target.distanceMeters) ||
        target.distanceMeters <= 0 ||
        target.distanceMeters > 100000 ||
        target.durationSeconds != null
  )
    return null
  const normalized: ActivityEffortTarget = {
    activityId: target.activityId,
    sport: target.sport as ActivityEffortTarget["sport"],
    kind: target.kind as ActivityEffortTarget["kind"],
    durationSeconds: power ? (target.durationSeconds as number) : null,
    distanceMeters: power ? null : (target.distanceMeters as number),
    value: target.value,
  }
  if (target.startSeconds != null || target.endSeconds != null) {
    if (
      !finite(target.startSeconds) ||
      !finite(target.endSeconds) ||
      target.startSeconds < 0 ||
      target.endSeconds <= target.startSeconds
    )
      return null
    normalized.startSeconds = target.startSeconds
    normalized.endSeconds = target.endSeconds
  }
  return normalized
}

/** The target is separate from provider workouts and survives reload/Back in the URL. */
export function readActivityEffortTarget(
  search: string,
  activityId?: string
): ActivityEffortTarget | null {
  const params = new URLSearchParams(search)
  const encoded = params.get(PARAM)
  if (!encoded || encoded.length > 2048) return null
  try {
    const target = normalizeActivityEffortTarget(JSON.parse(encoded))
    return target &&
      params.get("workout") === `activity:${target.activityId}` &&
      (!activityId || target.activityId === activityId)
      ? target
      : null
  } catch {
    return null
  }
}

export function activityEffortRoute(
  target: ActivityEffortTarget,
  href: string
) {
  const checked = normalizeActivityEffortTarget(target)
  if (!checked) throw Error("Choose a recorded activity effort.")
  const url = new URL(href)
  url.searchParams.set("workout", `activity:${checked.activityId}`)
  url.searchParams.set(PARAM, JSON.stringify(checked))
  return `${url.pathname}${url.search}${url.hash}`
}

export function clearActivityEffortParams(url: URL) {
  url.searchParams.delete(PARAM)
}

export function openActivityEffort(target: ActivityEffortTarget) {
  const checked = normalizeActivityEffortTarget(target)
  if (!checked) return false
  window.dispatchEvent(
    new CustomEvent(ACTIVITY_EFFORT_OPEN_EVENT, { detail: checked })
  )
  return true
}

export function activityEffortPlotRange(
  range: [number, number] | null,
  duration: number
): [number, number] | null {
  const [start, end] = range ?? []
  return finite(start) &&
    finite(end) &&
    finite(duration) &&
    start >= 0 &&
    end > start &&
    end <= duration
    ? [start, end]
    : null
}

export type VerifiedActivityEffort = {
  range: [number, number] | null
  reason: string
}

/** Raw provider times/indices never become chart coordinates in the browser. */
export function verifiedActivityEffort(
  value: unknown,
  target: ActivityEffortTarget
): VerifiedActivityEffort {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("The selected effort response is incomplete.")
  const body = value as Record<string, unknown>
  if (
    typeof body.available !== "boolean" ||
    body.activity_id !== target.activityId ||
    body.type !== target.sport
  )
    throw Error("The selected effort does not match this recording.")
  if (!body.available)
    return {
      range: null,
      reason:
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.slice(0, 300)
          : "Exact recorded bounds are unavailable for this effort.",
    }
  const power = target.kind === "power"
  const expected = power ? target.durationSeconds! : target.distanceMeters!
  const actual = power ? body.duration_seconds : body.distance_meters
  const anchorTolerance = power ? 1e-6 : target.sport === "Swim" ? 0.5 : 0.01
  if (
    !finite(actual) ||
    Math.abs(actual - expected) > anchorTolerance ||
    !finite(body.value) ||
    Math.abs(body.value - target.value) >
      Math.max(1e-6, Math.abs(target.value) * 1e-6) ||
    !finite(body.chart_start_seconds) ||
    !finite(body.chart_end_seconds) ||
    body.chart_start_seconds < 0 ||
    body.chart_end_seconds <= body.chart_start_seconds
  )
    throw Error("Exact bounds for the selected effort could not be verified.")
  return {
    range: [body.chart_start_seconds, body.chart_end_seconds],
    reason: "",
  }
}
