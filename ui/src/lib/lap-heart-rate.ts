import type { RecordedPoint } from "./segment-statistics.ts"

type LapPosition = { start: number; end: number; left: number; width: number }

export function lapHeartRatePath(
  points: RecordedPoint[],
  positions: LapPosition[]
) {
  const samples: Array<{ x: number; hr: number } | null> = []
  let minimum = Infinity,
    maximum = -Infinity,
    previousEnd: number | null = null,
    previousTime: number | null = null
  for (const lap of positions) {
    if (lap.end <= lap.start) continue
    if (previousEnd == null || lap.start !== previousEnd) {
      samples.push(null)
      previousTime = null
    }
    previousEnd = lap.end
    // Recorded points are time ordered. Find the first sample within this lap.
    let low = 0,
      high = points.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (points[middle].time < lap.start) low = middle + 1
      else high = middle
    }
    if (low === points.length || points[low].time > lap.end) {
      samples.push(null)
      previousTime = null
    }
    for (let i = low; i < points.length && points[i].time <= lap.end; i++) {
      const point = points[i],
        hr = point.heartRate
      if (previousTime != null && point.time - previousTime > 30)
        samples.push(null)
      previousTime = point.time
      if (hr == null || !Number.isFinite(hr) || hr <= 0) {
        samples.push(null)
        continue
      }
      minimum = Math.min(minimum, hr)
      maximum = Math.max(maximum, hr)
      samples.push({
        x:
          lap.left +
          ((point.time - lap.start) / (lap.end - lap.start)) * lap.width,
        hr,
      })
    }
  }
  if (!Number.isFinite(minimum)) return ""
  const low = Math.max(0, minimum - 5),
    high = Math.max(low + 20, maximum + 5)
  let path = "",
    connected = false
  for (const sample of samples) {
    if (!sample) {
      connected = false
      continue
    }
    const y = 190 - ((sample.hr - low) / (high - low)) * 170
    path += `${connected ? "L" : "M"}${sample.x.toFixed(2)},${y.toFixed(2)} `
    connected = true
  }
  return path.trim()
}
