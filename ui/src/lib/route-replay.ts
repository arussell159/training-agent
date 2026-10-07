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

export const REPLAY_SPEED_OPTIONS = [0.5, 1, 2, 5, 10, 25, 50, 100] as const

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

/** Unwrap route headings before smoothing: averaging compass vectors cancels at U-turns. */
export function prepareReplayCamera(route: ReplayRoute) {
  const headings: number[] = []
  let anchor = replayFrame(route, 0)
  if (!anchor) return [0]
  let heading: number | null = null
  let turnDirection = 1
  for (let i = 0; i <= 1200; i++) {
    const frame = replayFrame(route, i / 1200)!
    if (metersBetween(anchor, frame) >= 3) {
      const next = replayBearing(anchor, frame)
      if (heading === null) {
        heading = next
        headings.fill(next)
      } else {
        let turn = longitudeDelta(heading, next)
        // Exactly reversed tracks have no preferred side. Keep a consistent turn direction.
        if (Math.abs(turn) > 179) turn = 180 * turnDirection
        else if (Math.abs(turn) > 3) turnDirection = Math.sign(turn)
        heading += turn
      }
      anchor = frame
    }
    headings.push(heading ?? 0)
  }
  return headings
}

/** Begin panning before a bend; widen the preview window at faster playback speeds. */
export function replayCameraBearing(
  headings: number[],
  progress: number,
  speed = 1,
  tourSeconds = 60
) {
  if (headings.length < 2) return headings[0] ?? 0
  const multiplier = finite(speed) && speed > 0 ? speed : 1
  const duration = finite(tourSeconds) && tourSeconds > 0 ? tourSeconds : 60
  const pace = Math.max(0.01, Math.min(10, (multiplier * 60) / duration))
  const radius = Math.max(
    1 / (headings.length - 1),
    Math.min(0.18, 0.04 * pace)
  )
  const center =
    Math.max(0, Math.min(1, finite(progress) ? progress : 0)) +
    Math.min(0.07, 0.012 * pace)
  const intervals = headings.length - 1
  let sum = 0,
    weights = 0
  for (
    let i = Math.floor((center - radius) * intervals);
    i <= Math.ceil((center + radius) * intervals);
    i++
  ) {
    const weight = Math.max(0, 1 - Math.abs(i / intervals - center) / radius)
    sum += headings[Math.max(0, Math.min(intervals, i))] * weight
    weights += weight
  }
  return weights ? sum / weights : headings[0]
}

/** A ride's length can add detail, but never turn the default preview into a long wait. */
export function replayTourSeconds(route: ReplayRoute) {
  const recordedSeconds =
    route.timed && finite(route.duration) ? Math.max(0, route.duration) : 0
  const distance = route.distances.at(-1)
  return Math.min(
    120,
    Math.max(
      60,
      recordedSeconds / 240,
      finite(distance) ? Math.max(0, distance) / 1500 : 0
    )
  )
}

/** Playback rates multiply the bounded tour, without changing recorded elapsed-time interpolation. */
export function advanceReplayProgress(
  progress: number,
  elapsedMs: number,
  tourSeconds: number,
  speed = 1
) {
  const current = Math.max(0, Math.min(1, finite(progress) ? progress : 0))
  if (
    !finite(elapsedMs) ||
    elapsedMs <= 0 ||
    !finite(tourSeconds) ||
    tourSeconds <= 0 ||
    !finite(speed) ||
    speed <= 0
  )
    return current
  return Math.min(1, current + ((elapsedMs / 1000) * speed) / tourSeconds)
}

export function replayDurationLabel(tourSeconds: number, speed = 1) {
  if (!finite(tourSeconds) || tourSeconds < 0 || !finite(speed) || speed <= 0)
    return "—"
  const duration = tourSeconds / speed
  if (!finite(duration)) return "—"
  if (duration < 10) return `${Number(duration.toFixed(1))}s`
  const seconds = Math.round(duration)
  const minutes = Math.floor(seconds / 60),
    remainder = seconds % 60
  return minutes
    ? `${minutes}m${remainder ? ` ${remainder}s` : ""}`
    : `${seconds}s`
}

/** One bounded, date-line-safe GPU route; no per-frame GeoJSON rebuilds. */
export function replayGeometry(route: ReplayRoute) {
  const stride = Math.max(1, Math.ceil((route.points.length - 1) / 6000))
  const coordinates: number[][] = [],
    indices: number[] = [],
    lengths: number[] = []
  const projectY = (lat: number) =>
    (Math.log(Math.tan(Math.PI / 4 + radians(lat) / 2)) * 180) / Math.PI
  let longitude = route.points[0]?.longitude ?? 0
  let previousY = 0,
    total = 0
  for (let i = 0; i < route.points.length; i++) {
    if (i)
      longitude += longitudeDelta(
        route.points[i - 1].longitude,
        route.points[i].longitude
      )
    if (i % stride !== 0 && i !== route.points.length - 1) continue
    const y = projectY(route.points[i].latitude)
    if (coordinates.length)
      total += Math.hypot(longitude - coordinates.at(-1)![0], y - previousY)
    coordinates.push([longitude, route.points[i].latitude])
    indices.push(i)
    lengths.push(total)
    previousY = y
  }
  return { coordinates, indices, lengths, total }
}

export function replayTrimProgress(
  route: ReplayRoute,
  geometry: ReturnType<typeof replayGeometry>,
  frame: NonNullable<ReturnType<typeof replayFrame>>
) {
  let lo = 0,
    hi = geometry.indices.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (geometry.indices[mid] <= frame.index) lo = mid
    else hi = mid
  }
  if (!geometry.total) return 0
  const start = route.distances[geometry.indices[lo]],
    end = route.distances[geometry.indices[hi]]
  const fraction =
    end > start
      ? Math.max(
          0,
          Math.min(1, (frame.geometryDistance - start) / (end - start))
        )
      : 1
  return (
    (geometry.lengths[lo] +
      (geometry.lengths[hi] - geometry.lengths[lo]) * fraction) /
    geometry.total
  )
}
