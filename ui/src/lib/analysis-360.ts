import type { RecordedPoint } from "./segment-statistics.ts"
import {
  recordedChartSegments,
  recordedDistanceAxis,
} from "./workout-chart-axis.ts"
import {
  recordedSignalValue as sourceSignalValue,
  recordedSignals as sourceSignals,
  recordedSignalInfo as sourceSignalInfo,
  formatRecordedSignal as sourceSignalFormat,
  type RecordedSignal as SourceSignal,
} from "./workout-signal-statistics.ts"

export type AnalysisSignal = SourceSignal | "torque" | "efficiency"
type RecordedSignal = AnalysisSignal
const recordedSignals: AnalysisSignal[] = [
  ...sourceSignals,
  "torque",
  "efficiency",
]
export function analysisSignalValue(
  point: RecordedPoint,
  key: AnalysisSignal,
  sport: string
): number | null {
  if (key === "torque")
    return /bike|ride|cycl/i.test(sport) &&
      finite(point.power) &&
      point.power >= 0 &&
      finite(point.cadence) &&
      point.cadence > 0
      ? point.power / ((point.cadence * Math.PI * 2) / 60)
      : null
  if (key === "efficiency")
    return finite(point.power) &&
      point.power >= 0 &&
      finite(point.heartRate) &&
      point.heartRate > 0
      ? point.power / point.heartRate
      : null
  return sourceSignalValue(point, key, sport)
}
export function analysisSignalInfo(key: AnalysisSignal, sport: string) {
  return key === "torque"
    ? { label: "Torque", unit: "Nm", color: "#4356db", digits: 1 }
    : key === "efficiency"
      ? { label: "Power:HR", unit: "W/bpm", color: "#11a9a1", digits: 2 }
      : sourceSignalInfo(key, sport)
}
export function formatAnalysisSignal(
  value: number | null | undefined,
  key: AnalysisSignal,
  sport: string
) {
  if (key !== "torque" && key !== "efficiency")
    return sourceSignalFormat(value, key, sport)
  return finite(value)
    ? value.toLocaleString("en-US", {
        maximumFractionDigits: analysisSignalInfo(key, sport).digits,
      })
    : "—"
}
export function analysisSignalStatistics(
  points: RecordedPoint[],
  start: number,
  end: number,
  sport: string
) {
  const result: Array<{
    key: AnalysisSignal
    minimum: number | null
    average: number | null
    maximum: number | null
  }> = []
  for (const key of recordedSignals) {
    if (!points.some((point) => analysisSignalValue(point, key, sport) != null))
      continue
    let minimum = Infinity,
      maximum = -Infinity,
      sum = 0,
      weight = 0
    for (let index = 0; index < points.length; index++) {
      const point = points[index],
        value = analysisSignalValue(point, key, sport),
        next = points[index + 1]
      if (value == null) continue
      const elapsed =
        next && next.time - point.time <= 10.000001
          ? Math.max(0, Math.min(end, next.time) - Math.max(start, point.time))
          : 0
      if (elapsed > 0 || (point.time >= start && point.time <= end)) {
        minimum = Math.min(minimum, value)
        maximum = Math.max(maximum, value)
      }
      if (elapsed > 0) {
        sum += (key === "pace" ? point.speed! : value) * elapsed
        weight += elapsed
      }
    }
    result.push({
      key,
      minimum: finite(minimum) ? minimum : null,
      maximum: finite(maximum) ? maximum : null,
      average: weight
        ? key === "pace"
          ? (/swim/i.test(sport) ? 91.44 : 1609.344) / (sum / weight)
          : sum / weight
        : null,
    })
  }
  return result
}

export type AnalysisRange = [number, number]
export type AnalysisTile = {
  id: string
  kind: "multi" | "single" | "stacked" | "map" | "laps" | "zones"
  name: string
  channels: RecordedSignal[]
  axis: "time" | "distance"
  zones: boolean
  height: number
}
export const MAX_ANALYSIS_TILES = 24

export function canAddAnalysisTile(
  tiles: AnalysisTile[],
  kind: AnalysisTile["kind"]
) {
  return (
    tiles.length < MAX_ANALYSIS_TILES &&
    (!["map", "laps"].includes(kind) ||
      !tiles.some((tile) => tile.kind === kind))
  )
}

/** Undo must preserve the same constraints as adding and restoring a workspace. */
export function restoreAnalysisTile(
  tiles: AnalysisTile[],
  removed: { tile: AnalysisTile; index: number }
) {
  if (
    tiles.some((tile) => tile.id === removed.tile.id) ||
    !canAddAnalysisTile(tiles, removed.tile.kind)
  )
    return tiles
  const next = [...tiles]
  next.splice(
    Math.max(0, Math.min(next.length, removed.index)),
    0,
    removed.tile
  )
  return next
}
export type AnalysisLap = {
  id: string
  label: string
  start: number
  end: number
  source: "Device" | "Detected Interval" | "User" | "Detected Climb"
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

export function analysisSelection(
  first: number,
  last: number,
  duration: number
): AnalysisRange | null {
  if (![first, last, duration].every(finite) || duration <= 0) return null
  const start = Math.max(0, Math.min(duration, first, last)),
    end = Math.min(duration, Math.max(first, last))
  return end - start >= 1 ? [start, end] : null
}

export function defaultAnalysisTiles(
  channels: RecordedSignal[]
): AnalysisTile[] {
  const has = (keys: RecordedSignal[]) =>
    keys.filter((key) => channels.includes(key))
  const primary = channels.includes("power")
    ? "power"
    : channels.includes("pace")
      ? "pace"
      : channels[0]
  return [
    {
      id: "multi",
      kind: "multi",
      name: "Multi-Channel",
      channels: has([
        primary,
        "heartRate",
        "elevation",
        primary === "pace" ? "cadence" : "speed",
      ]),
      height: 160,
    },
    {
      id: "heart",
      kind: "single",
      name: channels.includes("heartRate") ? "Heart Rate" : "Cadence",
      channels: has([channels.includes("heartRate") ? "heartRate" : "cadence"]),
      height: 160,
    },
    {
      id: "stacked",
      kind: "stacked",
      name: "Stacked-Channels",
      channels: has([
        primary,
        primary === "pace" ? "cadence" : "speed",
        "heartRate",
        "elevation",
      ]),
      height: 480,
    },
    { id: "map", kind: "map", name: "Map", channels: [], height: 320 },
    { id: "laps", kind: "laps", name: "Laps", channels: [], height: 340 },
  ]
    .filter(
      (tile) =>
        !["multi", "single", "stacked"].includes(tile.kind) ||
        tile.channels.length
    )
    .map((tile) => ({
      ...tile,
      kind: tile.kind as AnalysisTile["kind"],
      axis: "time",
      zones: true,
    }))
}

export function validAnalysisTiles(
  value: unknown,
  available: RecordedSignal[],
  { preserveUnavailable = false } = {}
): AnalysisTile[] | null {
  if (!Array.isArray(value) || value.length > MAX_ANALYSIS_TILES) return null
  const ids = new Set<string>(),
    unique = new Set<string>()
  const tiles: AnalysisTile[] = []
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      ids.has(item.id) ||
      !["multi", "single", "stacked", "map", "laps", "zones"].includes(
        item.kind
      )
    )
      return null
    if (["map", "laps"].includes(item.kind) && unique.has(item.kind))
      return null
    ids.add(item.id)
    unique.add(item.kind)
    const channels = Array.isArray(item.channels)
      ? [
          ...new Set<RecordedSignal>(
            item.channels.filter(
              (key: RecordedSignal) =>
                recordedSignals.includes(key) &&
                (preserveUnavailable || available.includes(key))
            )
          ),
        ]
      : []
    tiles.push({
      id: item.id,
      kind: item.kind,
      name:
        typeof item.name === "string" && item.name.trim()
          ? item.name.slice(0, 128)
          : "Chart",
      channels,
      axis: item.axis === "distance" ? "distance" : "time",
      zones: item.zones === true,
      height: finite(item.height)
        ? Math.max(160, Math.min(900, item.height))
        : 200,
    })
  }
  return tiles
}

/** A covered second is required in its entirety; missing power and long gaps never become zero watts. */
export function recordedPowerSeconds(
  points: RecordedPoint[],
  start: number,
  end: number
) {
  const length = Math.min(172800, Math.max(0, Math.floor(end - start)))
  const sums = new Float64Array(length),
    coverage = new Float64Array(length)
  for (let index = 0; index < points.length - 1; index++) {
    const point = points[index],
      next = points[index + 1]
    if (
      !finite(point.power) ||
      point.power < 0 ||
      next.time <= point.time ||
      next.time - point.time > 10.000001
    )
      continue
    const left = Math.max(start, point.time),
      right = Math.min(end, next.time)
    for (
      let second = Math.max(0, Math.floor(left - start));
      second < Math.min(length, Math.ceil(right - start));
      second++
    ) {
      const weight = Math.max(
        0,
        Math.min(right, start + second + 1) - Math.max(left, start + second)
      )
      sums[second] += point.power * weight
      coverage[second] += weight
    }
  }
  return Array.from(sums, (sum, index) =>
    coverage[index] >= 0.999 ? sum / coverage[index] : null
  )
}

export function analysisRangeMetrics(
  points: RecordedPoint[],
  start: number,
  end: number,
  ftp?: number | null
) {
  const sums = { power: 0, heartRate: 0, cadence: 0, speed: 0 },
    weights = { ...sums }
  let gain = 0,
    loss = 0,
    moving = 0,
    speedCoverage = 0,
    elevationCoverage = 0
  for (let index = 0; index < points.length - 1; index++) {
    const point = points[index],
      next = points[index + 1],
      elapsed = next.time - point.time
    const weight = Math.max(
      0,
      Math.min(end, next.time) - Math.max(start, point.time)
    )
    if (elapsed <= 0 || elapsed > 10.000001 || !weight) continue
    for (const key of ["power", "heartRate", "cadence", "speed"] as const) {
      const value = point[key]
      if (finite(value) && value >= 0) {
        sums[key] += value * weight
        weights[key] += weight
      }
    }
    if (finite(point.speed)) {
      speedCoverage += weight
      if (point.speed > 0.15) moving += weight
    }
    if (finite(point.elevation) && finite(next.elevation)) {
      elevationCoverage += weight
      const delta = ((next.elevation - point.elevation) * weight) / elapsed
      if (delta > 0) gain += delta
      else loss -= delta
    }
  }
  const average = (key: keyof typeof sums) =>
    weights[key] ? sums[key] / weights[key] : null
  const seconds = recordedPowerSeconds(points, start, end)
  let total = 0,
    count = 0,
    rolling = 0,
    valid = 0
  for (let index = 0; index < seconds.length; index++) {
    if (seconds[index] != null) {
      rolling += seconds[index]!
      valid++
    }
    if (index >= 30 && seconds[index - 30] != null) {
      rolling -= seconds[index - 30]!
      valid--
    }
    if (index >= 29 && valid === 30) {
      total += (rolling / 30) ** 4
      count++
    }
  }
  const normalizedPower = count ? (total / count) ** 0.25 : null
  const intensity =
    normalizedPower != null && ftp && ftp > 0 ? normalizedPower / ftp : null
  const axis = recordedDistanceAxis(points),
    duration = Math.max(0, end - start)
  const first = points.find(
    (point) =>
      point.time >= start && point.time <= end && finite(point.elevation)
  )
  const last = points.findLast(
    (point) =>
      point.time >= start && point.time <= end && finite(point.elevation)
  )
  const distance = axis
    ? Math.max(0, axis.atTime(end) - axis.atTime(start))
    : null
  const power = average("power")
  return {
    duration,
    distance,
    power,
    heartRate: average("heartRate"),
    cadence: average("cadence"),
    speed: average("speed"),
    work: weights.power ? sums.power / 1000 : null,
    normalizedPower,
    intensity,
    tss: intensity == null ? null : (duration / 36) * intensity ** 2,
    variability:
      normalizedPower != null && power && power > 0
        ? normalizedPower / power
        : null,
    efficiency:
      normalizedPower != null && average("heartRate")
        ? normalizedPower / average("heartRate")!
        : null,
    gain: elevationCoverage ? gain : null,
    loss: elevationCoverage ? loss : null,
    grade:
      distance && first && last
        ? ((last.elevation! - first.elevation!) / distance) * 100
        : null,
    moving: speedCoverage ? moving : null,
  }
}

export type PowerCurvePoint = {
  seconds: number
  watts: number
  start: number
  end: number
}
export function recordedPowerCurve(
  points: RecordedPoint[],
  duration: number
): PowerCurvePoint[] {
  const seconds = recordedPowerSeconds(points, 0, duration),
    sums = new Float64Array(seconds.length + 1),
    covered = new Uint32Array(seconds.length + 1)
  for (let index = 0; index < seconds.length; index++) {
    sums[index + 1] = sums[index] + (seconds[index] ?? 0)
    covered[index + 1] = covered[index] + (seconds[index] == null ? 0 : 1)
  }
  const durations = new Set<number>([
    1,
    2,
    3,
    4,
    5,
    10,
    15,
    20,
    30,
    60,
    120,
    180,
    300,
    600,
    1200,
    1800,
    3600,
    7200,
    Math.floor(duration),
  ])
  for (
    let value = 6;
    value <= Math.min(duration, seconds.length);
    value = Math.max(value + 1, Math.round(value * 1.1))
  )
    durations.add(value)
  return [...durations]
    .sort((a, b) => a - b)
    .flatMap((window) => {
      if (window < 1 || window > seconds.length) return []
      let best = -Infinity,
        start = 0
      for (let index = 0; index + window <= seconds.length; index++) {
        if (covered[index + window] - covered[index] !== window) continue
        const mean = (sums[index + window] - sums[index]) / window
        if (mean > best) {
          best = mean
          start = index
        }
      }
      return finite(best)
        ? [{ seconds: window, watts: best, start, end: start + window }]
        : []
    })
}

export function analysisZoneTimes(
  points: RecordedPoint[],
  key: "power" | "heartRate" | "speed",
  threshold: number,
  boundaries: number[],
  start: number,
  end: number
) {
  if (
    !finite(threshold) ||
    threshold <= 0 ||
    !boundaries.length ||
    boundaries.some(
      (high, index) => !finite(high) || high <= (boundaries[index - 1] ?? 0)
    )
  )
    return []
  const result = boundaries.map((high, index) => ({
    label: `Z${index + 1}`,
    low: index ? boundaries[index - 1] : 0,
    high,
    seconds: 0,
  }))
  for (let index = 0; index < points.length - 1; index++) {
    const point = points[index],
      next = points[index + 1],
      value = point[key]
    if (
      !finite(value) ||
      value < 0 ||
      next.time <= point.time ||
      next.time - point.time > 10.000001
    )
      continue
    const weight = Math.max(
      0,
      Math.min(end, next.time) - Math.max(start, point.time)
    )
    const zone = result.find((zone) => (value / threshold) * 100 <= zone.high)
    if (zone) zone.seconds += weight
  }
  return result
}

export function analysisCsv(rows: unknown[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = value == null ? "" : String(value)
          const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
          return `"${safe.replaceAll('"', '""')}"`
        })
        .join(",")
    )
    .join("\r\n")
}

/** Preserve each bucket's extrema, zeros and gaps instead of hiding short efforts with a stride. */
export function analysisSeriesSegments(
  points: RecordedPoint[],
  key: RecordedSignal,
  sport: string,
  start: number,
  end: number,
  limit = 1000
) {
  return recordedChartSegments(
    points,
    start,
    end,
    (point) => analysisSignalValue(point, key, sport),
    limit
  )
}
