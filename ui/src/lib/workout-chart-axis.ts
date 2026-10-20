type DistancePoint = { time: number; distance: number }

export type ChartSample = { time: number; value: number | null }

/** Interpolate display boundaries only between adjacent, valid recorded samples. */
export function recordedChartWindow<T extends { time: number }>(
  points: T[],
  start: number,
  end: number,
  read: (point: T, index: number) => number | null
): ChartSample[] {
  if (
    !points.length ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  )
    return []
  const lowerBound = (time: number) => {
    let left = 0,
      right = points.length
    while (left < right) {
      const middle = Math.floor((left + right) / 2)
      if (points[middle].time < time) left = middle + 1
      else right = middle
    }
    return left
  }
  const valueAt = (index: number) => {
    const value = read(points[index], index)
    return value != null && Number.isFinite(value) ? value : null
  }
  const boundary = (time: number, index: number): ChartSample => {
    if (points[index]?.time === time) return { time, value: valueAt(index) }
    const before = points[index - 1],
      after = points[index]
    if (
      !before ||
      !after ||
      after.time <= before.time ||
      after.time - before.time > 10.000001
    )
      return { time, value: null }
    const a = valueAt(index - 1),
      b = valueAt(index)
    return {
      time,
      value:
        a == null || b == null
          ? null
          : a + ((b - a) * (time - before.time)) / (after.time - before.time),
    }
  }
  const first = lowerBound(start),
    last = lowerBound(end)
  const result = [boundary(start, first)]
  for (let index = first; index < last; index++) {
    if (points[index].time > start)
      result.push({ time: points[index].time, value: valueAt(index) })
  }
  result.push(boundary(end, last))
  return result
}

/** Keep gaps, endpoints and bucket extrema when reducing a displayed signal. */
export function recordedChartSegments<T extends { time: number }>(
  points: T[],
  start: number,
  end: number,
  read: (point: T, index: number) => number | null,
  limit = 1000
) {
  type Segment = Array<{ time: number; value: number }>
  const segments: Segment[] = []
  let current: Segment = [],
    previous: number | null = null
  for (const point of recordedChartWindow(points, start, end, read)) {
    if (
      point.value == null ||
      (previous != null && point.time - previous > 10.000001)
    ) {
      if (current.length) segments.push(current)
      current = []
    }
    if (point.value != null)
      current.push({ time: point.time, value: point.value })
    previous = point.time
  }
  if (current.length) segments.push(current)
  return segments.map((segment) => {
    if (segment.length <= limit) return segment
    const size = Math.max(
      1,
      Math.ceil((segment.length * 4) / Math.max(4, limit))
    )
    const sampled: Segment = []
    for (let first = 0; first < segment.length; first += size) {
      const last = Math.min(segment.length - 1, first + size - 1)
      let minimum = first,
        maximum = first
      for (let index = first + 1; index <= last; index++) {
        if (segment[index].value < segment[minimum].value) minimum = index
        if (segment[index].value > segment[maximum].value) maximum = index
      }
      for (const index of [...new Set([first, minimum, maximum, last])].sort(
        (a, b) => a - b
      ))
        sampled.push(segment[index])
    }
    return sampled
  })
}

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

/** A partial split ends at the recorded distance, never at the next nominal marker. */
export function recordedSplitEndpointLabel(
  axis: ReturnType<typeof recordedDistanceAxis>,
  end: number
) {
  if (!axis || !Number.isFinite(end)) return "—"
  const miles = Math.max(0, axis.atTime(end) - axis.start) / 1609.344
  return `${Number(miles.toFixed(2))} mi`
}
