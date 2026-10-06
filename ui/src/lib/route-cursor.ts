export type RouteCursorPoint = {
  time: number
  latitude: number
  longitude: number
}

type RecordedLocation = {
  time: number
  latitude?: number | null
  longitude?: number | null
}

export function isRouteCursorPoint(
  point: RecordedLocation | null | undefined
): point is RouteCursorPoint {
  return Boolean(
    point &&
    Number.isFinite(point.time) &&
    typeof point.latitude === "number" &&
    Number.isFinite(point.latitude) &&
    Math.abs(point.latitude) <= 85 &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.longitude) <= 180
  )
}

export function createRouteCursorIndex(
  points: readonly RecordedLocation[]
): RouteCursorPoint[] {
  return points
    .filter(isRouteCursorPoint)
    .map(({ time, latitude, longitude }) => ({ time, latitude, longitude }))
    .sort((a, b) => a.time - b.time)
}

// The index is built once per recording. Pointer movement only does a binary
// search; it does not scan the recording, rebuild the map, or fetch more data.
export function nearestRouteCursorPoint(
  points: readonly RouteCursorPoint[],
  time: number | null
): RouteCursorPoint | null {
  if (time == null || !Number.isFinite(time) || !points.length) return null
  let low = 0
  let high = points.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (points[middle].time < time) low = middle + 1
    else high = middle
  }
  if (!low) return points[0]
  if (low === points.length) return points[low - 1]
  const before = points[low - 1]
  const after = points[low]
  return time - before.time <= after.time - time ? before : after
}
