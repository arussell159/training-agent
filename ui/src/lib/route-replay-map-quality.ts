type ReplayMapQualityInput = {
  distance: number
  tourSeconds: number
  speed: number
  latitude: number
  width: number
  threeD: boolean
}

// Match the camera's ground coverage to actual replay travel. A fast long ride
// needs wider satellite coverage, rather than a fixed street-level tile chase.
export function replayMapQuality(input: ReplayMapQualityInput) {
  const distance = Number.isFinite(input.distance)
    ? Math.max(0, input.distance)
    : 0
  const duration =
    Number.isFinite(input.tourSeconds) && input.tourSeconds > 0
      ? input.tourSeconds
      : 60
  const speed =
    Number.isFinite(input.speed) && input.speed > 0 ? input.speed : 1
  const travelRate = Math.min(10_000_000, (distance / duration) * speed)
  const latitude = Number.isFinite(input.latitude)
    ? Math.max(-85, Math.min(85, input.latitude))
    : 0
  const width = Number.isFinite(input.width)
    ? Math.max(240, Math.min(2048, input.width))
    : 640
  const coverage = Math.max(
    input.threeD ? 1100 : 700,
    Math.min(1_000_000, travelRate * 2)
  )
  const zoom = Math.log2(
    (40_075_017 * Math.max(0.1, Math.cos((latitude * Math.PI) / 180)) * width) /
      (512 * coverage)
  )
  return {
    travelRate,
    zoom: Math.max(5, Math.min(distance > 30000 ? 14.5 : 15.5, zoom)),
    pitch: !input.threeD
      ? 0
      : travelRate > 20000
        ? 45
        : travelRate > 500
          ? 66
          : 74,
    // Fast flyovers use the tilted satellite plane while DEM detail catches up.
    // Re-enable real terrain when slowing down; 2D never downloads DEM tiles.
    terrain: input.threeD && travelRate <= 2500,
  }
}
