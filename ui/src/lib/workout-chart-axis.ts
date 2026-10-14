type DistancePoint = { time: number; distance: number }

/** Display smoothing never fills a missing measurement or changes the recorded statistics. */
export function smoothedChartValue<T extends { time: number }>(
  points: T[],
  index: number,
  seconds: number,
  read: (point: T) => number | null
) {
  const current = read(points[index])
  if (current == null || seconds <= 0) return current
  const half = seconds / 2
  let sum = current,
    count = 1
  for (const direction of [-1, 1]) {
    for (
      let offset = index + direction;
      offset >= 0 && offset < points.length;
      offset += direction
    ) {
      if (Math.abs(points[offset].time - points[index].time) > half) break
      const value = read(points[offset])
      if (value == null) break
      sum += value
      count++
    }
  }
  return sum / count
}

/** Zero-based signal scales keep small changes from appearing disproportionately large. */
export function recordedChartDomain(
  minimum: number,
  maximum: number,
  pace = false
) {
  const low = pace ? Math.max(0, minimum - 1) : Math.min(0, minimum)
  const high = Math.max(low + 1, maximum)
  const rawStep = (high - low) / 3
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const ratio = rawStep / magnitude
  const step =
    magnitude * (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10)
  return {
    minimum: Math.floor(low / step) * step,
    maximum: Math.ceil(high / step) * step,
  }
}

function interpolate(
  points: DistancePoint[],
  position: number,
  from: keyof DistancePoint,
  to: keyof DistancePoint
) {
  if (position <= points[0][from]) return points[0][to]
  if (position >= points.at(-1)![from]) return points.at(-1)![to]
  let left = 0,
    right = points.length - 1
  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2)
    if (points[middle][from] <= position) left = middle
    else right = middle
  }
  const a = points[left],
    b = points[right]
  const fraction = (position - a[from]) / (b[from] - a[from])
  return a[to] + fraction * (b[to] - a[to])
}

/** Distance mode is available only for a usable, monotonic recorded distance stream. */
export function recordedDistanceAxis(
  source: { time: number; distance?: number | null }[]
) {
  const points = source.filter(
    (point): point is DistancePoint =>
      Number.isFinite(point.time) &&
      typeof point.distance === "number" &&
      Number.isFinite(point.distance)
  )
  if (points.length < 2 || points.at(-1)!.distance <= points[0].distance)
    return null
  if (
    points.some(
      (point, index) =>
        index > 0 &&
        (point.time <= points[index - 1].time ||
          point.distance < points[index - 1].distance)
    )
  )
    return null
  return {
    start: points[0].distance,
    end: points.at(-1)!.distance,
    atTime: (time: number) => interpolate(points, time, "time", "distance"),
    atDistance: (distance: number) =>
      interpolate(points, distance, "distance", "time"),
  }
}
