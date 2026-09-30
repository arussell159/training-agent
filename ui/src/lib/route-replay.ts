export type ReplayPoint = {
  time: number
  latitude: number
  longitude: number
  distance?: number | null
  elevation?: number | null
  speed?: number | null
}

export type ReplayRoute = {
  points: ReplayPoint[]
  distances: number[]
  duration: number
  timed: boolean
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)
const radians = (value: number) => (value * Math.PI) / 180
export const longitudeDelta = (from: number, to: number) =>
  ((((to - from) % 360) + 540) % 360) - 180

function metersBetween(a: ReplayPoint, b: ReplayPoint) {
  const lat = radians(b.latitude - a.latitude)
  const lon = radians(longitudeDelta(a.longitude, b.longitude))
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(lon / 2) ** 2
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}

/** Geometry-only routes use distance as the playback clock, never fabricated timestamps. */
export function prepareReplayRoute(
  input: ReplayPoint[],
  timed: boolean
): ReplayRoute {
  const points: ReplayPoint[] = []
  for (const point of input) {
    if (
      !finite(point.latitude) ||
      !finite(point.longitude) ||
      Math.abs(point.latitude) > 85 ||
      Math.abs(point.longitude) > 180
    )
      continue
    if (
      timed &&
      (!finite(point.time) ||
        (points.length > 0 && point.time <= points.at(-1)!.time))
    )
      continue
    points.push({ ...point })
  }
  const distances = points.map(() => 0)
  for (let i = 1; i < points.length; i++)
    distances[i] = distances[i - 1] + metersBetween(points[i - 1], points[i])
  const start = points[0]?.time ?? 0
  const hasRecordedDistance =
    timed &&
    points.every(
      (point, i) =>
        finite(point.distance) &&
        point.distance >= 0 &&
        (i === 0 || point.distance >= points[i - 1].distance!)
    )
  const startDistance = points[0]?.distance ?? 0
  for (let i = 0; i < points.length; i++) {
    points[i].time = timed ? points[i].time - start : distances[i]
    points[i].distance = hasRecordedDistance
      ? points[i].distance! - startDistance
      : distances[i]
    if (!timed) {
      points[i].speed = null
      points[i].elevation = null
    }
  }
  return { points, distances, duration: points.at(-1)?.time ?? 0, timed }
}

function interpolate(
  a: number | null | undefined,
  b: number | null | undefined,
  t: number
) {
  if (t === 0) return finite(a) ? a : null
  if (t === 1) return finite(b) ? b : null
  return finite(a) && finite(b) ? a + (b - a) * t : null
}

export function replayFrame(route: ReplayRoute, progress: number) {
  if (route.points.length < 2) return null
  const time =
    route.duration * Math.max(0, Math.min(1, finite(progress) ? progress : 0))
  let lo = 0,
    hi = route.points.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (route.points[mid].time <= time) lo = mid
    else hi = mid
  }
  const a = route.points[lo],
    b = route.points[hi]
  const fraction = b.time > a.time ? (time - a.time) / (b.time - a.time) : 1
  return {
    time,
    index: lo,
    latitude: a.latitude + (b.latitude - a.latitude) * fraction,
    longitude:
      a.longitude + longitudeDelta(a.longitude, b.longitude) * fraction,
    distance: interpolate(a.distance, b.distance, fraction),
    elevation: interpolate(a.elevation, b.elevation, fraction),
    speed: interpolate(a.speed, b.speed, fraction),
    geometryDistance:
      route.distances[lo] +
      (route.distances[hi] - route.distances[lo]) * fraction,
  }
}

export function replayBearing(
  a: Pick<ReplayPoint, "latitude" | "longitude">,
  b: Pick<ReplayPoint, "latitude" | "longitude">
) {
  const d = radians(longitudeDelta(a.longitude, b.longitude)),
    lat1 = radians(a.latitude),
    lat2 = radians(b.latitude)
  return (
    (Math.atan2(
      Math.sin(d) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(d)
    ) *
      180) /
    Math.PI
  )
}
