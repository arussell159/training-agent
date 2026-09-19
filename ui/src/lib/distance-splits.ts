import { segmentStatistics, type RecordedPoint } from "./segment-statistics.ts"

export type DistanceSplit = {
  number: number
  start: number
  end: number
  distance: number
  pace: number
  power: number | null
  heartRate: number | null
  elevation: number | null
  estimated?: boolean
}

function boundary(points: RecordedPoint[], distance: number) {
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1],
      current = points[index]
    const from = previous.distance!,
      to = current.distance!
    if (to < distance || to <= from) continue
    const fraction = Math.max(0, Math.min(1, (distance - from) / (to - from)))
    return {
      time: previous.time + (current.time - previous.time) * fraction,
      elevation:
        previous.elevation != null &&
        current.elevation != null &&
        Number.isFinite(previous.elevation) &&
        Number.isFinite(current.elevation)
          ? previous.elevation +
            (current.elevation - previous.elevation) * fraction
          : null,
    }
  }
  return {
    time: points.at(-1)!.time,
    elevation: points.at(-1)!.elevation ?? null,
  }
}

export function distanceSplits(
  recording: RecordedPoint[],
  splitDistance: number
): DistanceSplit[] {
  if (!Number.isFinite(splitDistance) || splitDistance <= 0) return []
  const points = recording
    .filter(
      (point) =>
        point.distance != null &&
        Number.isFinite(point.distance) &&
        Number.isFinite(point.time)
    )
    .sort((a, b) => a.time - b.time)
  if (points.length < 2) return []
  const first = points[0].distance!,
    finish = points.at(-1)!.distance!
  const splits: DistanceSplit[] = []
  for (let from = first; from < finish - 0.5; from += splitDistance) {
    const to = Math.min(finish, from + splitDistance)
    const start = boundary(points, from),
      end = boundary(points, to)
    if (end.time <= start.time) continue
    const stats = segmentStatistics(recording, start.time, end.time)
    splits.push({
      number: splits.length + 1,
      start: start.time,
      end: end.time,
      distance: to - from,
      pace: ((end.time - start.time) * splitDistance) / (to - from),
      power: stats.power,
      heartRate: stats.heartRate,
      elevation:
        start.elevation != null && end.elevation != null
          ? end.elevation - start.elevation
          : null,
    })
  }
  return splits
}
