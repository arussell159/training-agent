// Validate recorded data before it reaches a chart or a durable device cache.
// Missing measurements are legitimate; malformed shapes and non-finite values are not.
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)
const optionalNumbers = (value: Record<string, unknown>, keys: readonly string[]) =>
  keys.every((key) => value[key] == null || finite(value[key]))

const summaryNumbers = [
  "elapsed_time_seconds", "elapsed_speed", "min_hr", "min_speed", "min_power",
  "max_power", "average_cadence", "min_cadence", "max_cadence", "duration_seconds",
  "duration_minutes", "distance_meters", "average_speed", "max_speed", "calories",
  "elevation_gain", "elevation_loss", "tss", "normalized_power", "intensity_factor",
  "work_kj", "average_power", "average_hr", "max_hr", "temperature_c",
  "humidity_percent", "latitude", "longitude",
] as const
const pointNumbers = [
  "power", "heartRate", "speed", "distance", "cadence", "elevation",
  "latitude", "longitude", "dfaA1", "dfaArtifacts",
] as const
const lapNumbers = ["power", "heartRate", "distance", "speed", "elapsedDuration"] as const
const dfaNumbers = [
  "average", "minimum", "maximum", "averageArtifacts", "artifactCoveragePercent", "validPercent",
] as const

export function validActivitySummary(value: unknown): boolean {
  return record(value) && value.error == null && optionalNumbers(value, summaryNumbers)
}

const validLap = (value: unknown) =>
  record(value) &&
  typeof value.id === "string" && typeof value.label === "string" &&
  finite(value.start) && finite(value.end) &&
  (value.kind == null || typeof value.kind === "string") &&
  optionalNumbers(value, lapNumbers)
const validSwimLength = (value: unknown) =>
  record(value) && finite(value.start) && finite(value.end) &&
  optionalNumbers(value, ["seconds", "distance"])

export function validActivityAnalysis(value: unknown): boolean {
  if (!record(value) || !finite(value.duration) || value.duration < 0 ||
    !Array.isArray(value.points) || !Array.isArray(value.laps) || !Array.isArray(value.intervals)) return false
  let previous = -Infinity
  for (const point of value.points) {
    if (!record(point) || !finite(point.time) || point.time < 0 || point.time < previous ||
      !optionalNumbers(point, pointNumbers)) return false
    previous = point.time
  }
  return value.laps.every(validLap) && value.intervals.every(validLap) &&
    (value.version == null || finite(value.version)) &&
    (value.dfa == null || (record(value.dfa) && finite(value.dfa.validSeconds) &&
      optionalNumbers(value.dfa, dfaNumbers))) &&
    (value.swimLengths === undefined || (Array.isArray(value.swimLengths) && value.swimLengths.every(validSwimLength)))
}

export function validActivityRoute(value: unknown): boolean {
  // The loader filters individual bad coordinates, preserving the usable route.
  return record(value) && Array.isArray(value.points)
}

export function validActivityPayload(path: string, value: unknown): boolean {
  let route: string
  try {
    const url = new URL(path, "http://local")
    route = url.searchParams.get("__api_route") || url.pathname
  } catch { return false }
  const kind = route.match(/^(?:\/api\/)?activities\/[^/?]+\/(summary|analysis|route)$/)?.[1]
  if (kind === "summary") return validActivitySummary(value)
  if (kind === "analysis") return validActivityAnalysis(value)
  if (kind === "route") return validActivityRoute(value)
  return true
}
