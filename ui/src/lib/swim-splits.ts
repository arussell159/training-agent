import { METERS_PER_100_YARDS } from "../../../app-backend/lib/swim-units.mjs"

type SwimSegment = { start: number; end: number; distance: number | null; seconds?: number }
export type SwimSplit = {
  number: number
  start: number
  end: number
  distance: number
  pace: number
  power: null
  estimated: boolean
}

export type SwimSplitAnalysis = { swimLengths?: SwimSegment[]; laps?: SwimSegment[] }

// Pool rests have no distance. Build splits from active length timer values,
// not timestamps on the cumulative distance stream (which include those rests).
export function swimSplits(analysis: SwimSplitAnalysis): SwimSplit[] {
  const valid = (segments: SwimSegment[] = []) => segments.filter(segment =>
    Number.isFinite(segment.distance) && Number(segment.distance) > 0 &&
    Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start &&
    Number.isFinite(segment.seconds ?? segment.end - segment.start) &&
    (segment.seconds ?? segment.end - segment.start) > 0
  ).sort((a, b) => a.start - b.start)
  const lengths = valid(analysis.swimLengths), laps = valid(analysis.laps)
  const total = (segments: SwimSegment[]) => segments.reduce((sum, segment) => sum + Number(segment.distance), 0)
  // Do not silently omit distance if an older archive only has some lengths.
  const completeLengths = lengths.length > 0 && (!laps.length || Math.abs(total(lengths) - total(laps)) < .5)
  const segments = completeLengths ? lengths : laps
  const splits: SwimSplit[] = []
  let distance = 0, seconds = 0, start = 0, end = 0, estimated = false
  const finish = () => {
    splits.push({ number: splits.length + 1, start, end, distance,
      pace: seconds * (METERS_PER_100_YARDS / distance), power: null, estimated })
    distance = 0; seconds = 0; estimated = false
  }
  for (const segment of segments) {
    const segmentDistance = Number(segment.distance)
    let consumed = 0
    while (consumed < segmentDistance - .0001) {
      const part = Math.min(segmentDistance - consumed, METERS_PER_100_YARDS - distance)
      if (!distance) start = segment.start + (segment.end - segment.start) * consumed / segmentDistance
      end = segment.start + (segment.end - segment.start) * (consumed + part) / segmentDistance
      seconds += (segment.seconds ?? segment.end - segment.start) * (part / segmentDistance)
      distance += part
      // Without an exact boundary, a partial length/lap can only be estimated.
      estimated ||= part < segmentDistance - .0001
      consumed += part
      if (distance >= METERS_PER_100_YARDS - .0001) finish()
    }
  }
  if (distance > .0001) finish()
  return splits
}
