import type { RecordedPoint } from "./segment-statistics"

export type RecordedSignal =
  | "power"
  | "heartRate"
  | "cadence"
  | "speed"
  | "pace"
  | "elevation"
  | "dfaA1"
  | "dfaArtifacts"
export type SignalStatistics = {
  key: RecordedSignal
  minimum: number | null
  average: number | null
  maximum: number | null
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)
export const recordedSignals: RecordedSignal[] = [
  "power",
  "heartRate",
  "cadence",
  "speed",
  "pace",
  "elevation",
  "dfaA1",
  "dfaArtifacts",
]

export function recordedSignalValue(
  point: RecordedPoint,
  key: RecordedSignal,
  sport: string
): number | null {
  const raw = key === "pace" ? point.speed : point[key]
  if (!finite(raw)) return null
  if (key === "dfaA1" && (raw < 0.01 || (finite(point.dfaArtifacts) && point.dfaArtifacts > 5))) return null
  if (key === "dfaArtifacts" && raw < 0) return null
  if (key === "pace")
    return raw > 0.15 ? (/swim/i.test(sport) ? 91.44 : 1609.344) / raw : null
  if (key === "speed") return raw * 2.2369362920544
  if (key === "elevation") return raw / 0.3048
  return raw
}

export function recordedSignalInfo(key: RecordedSignal, sport: string) {
  const swim = /swim/i.test(sport),
    run = /run/i.test(sport)
  const info = {
    power: { label: "Power", unit: "W", color: "#e600df", digits: 0 },
    heartRate: {
      label: "Heart rate",
      unit: "bpm",
      color: "#ff5252",
      digits: 0,
    },
    cadence: {
      label: swim ? "Stroke rate" : "Cadence",
      unit: swim ? "strokes/min" : run ? "spm" : "rpm",
      color: "#ffb400",
      digits: 0,
    },
    speed: { label: "Speed", unit: "mph", color: "#009800", digits: 2 },
    pace: {
      label: "Pace",
      unit: swim ? "m:ss/100yds" : "min/mile",
      color: "#0284c7",
      digits: 0,
    },
    elevation: { label: "Elevation", unit: "ft", color: "#8d8d8d", digits: 0 },
    dfaA1: { label: "DFA α1", unit: "", color: "#0f766e", digits: 2 },
    dfaArtifacts: {
      label: "RR artifacts",
      unit: "%",
      color: "#9333ea",
      digits: 1,
    },
  }
  return info[key]
}

export function formatRecordedSignal(
  value: number | null | undefined,
  key: RecordedSignal,
  sport: string
): string {
  if (!finite(value)) return "—"
  if (key === "pace") {
    const seconds = Math.round(value)
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return "—"
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  }
  return value.toLocaleString("en-US", {
    maximumFractionDigits: recordedSignalInfo(key, sport).digits,
  })
}

/** Extrema include recorded zeros; means weight the actual covered time, never missing samples. */
export function recordedSignalStatistics(
  points: RecordedPoint[],
  start: number,
  end: number,
  sport: string
): SignalStatistics[] {
  return recordedSignals
    .filter((key) =>
      points.some((point) => recordedSignalValue(point, key, sport) != null)
    )
    .map((key) => {
      let minimum = Infinity,
        maximum = -Infinity,
        sum = 0,
        weight = 0,
        samples = 0,
        sampleSum = 0
      for (let index = 0; index < points.length; index++) {
        const point = points[index],
          value = recordedSignalValue(point, key, sport)
        if (value == null) continue
        const next = points[index + 1]
        const elapsed = next
          ? Math.max(0, Math.min(end, next.time) - Math.max(start, point.time))
          : 0
        if (elapsed > 0 || (point.time >= start && point.time <= end)) {
          minimum = Math.min(minimum, value)
          maximum = Math.max(maximum, value)
          samples++
          sampleSum += value
        }
        if (elapsed > 0) {
          // Pace is the inverse of covered moving speed, rather than a mean of inverse samples.
          sum += (key === "pace" ? point.speed! : value) * elapsed
          weight += elapsed
        }
      }
      const mean = weight > 0 ? sum / weight : null
      const average =
        mean != null
          ? key === "pace"
            ? (/swim/i.test(sport) ? 91.44 : 1609.344) / mean
            : mean
          : samples
            ? sampleSum / samples
            : null
      return {
        key,
        minimum: finite(minimum) ? minimum : null,
        average: finite(average) ? average : null,
        maximum: finite(maximum) ? maximum : null,
      }
    })
}
