import {segmentStatistics, type RecordedPoint} from './segment-statistics.ts'

export type RecordedLap = {id:string; label:string; start:number; end:number; distance?:number|null; speed?:number|null; elapsedDuration?:number|null}

export function lapDuration(lap: RecordedLap) {
  return lap.elapsedDuration != null && lap.elapsedDuration > 0
    ? lap.elapsedDuration
    : lap.end - lap.start
}

export function formatSignalClock(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds))
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`
}

export function intervalSignals(points: RecordedPoint[], laps: RecordedLap[]) {
  return laps.filter(l => l.end > l.start).map(lap => {
    const averages = segmentStatistics(points, lap.start, lap.end)
    // Prefer the recorded velocity stream, which follows the same SI-based
    // pace calculation used elsewhere. Intervals lap speeds can disagree when
    // swim pool units are interpreted differently by the source.
    const speed = averages.speed ?? lap.speed ?? (lap.distance != null && lap.distance > 0 ? lap.distance / (lap.end - lap.start) : null)
    return {lap, point:{time:lap.start, distance:null, power:averages.power, heartRate:averages.heartRate, cadence:averages.cadence, speed} satisfies RecordedPoint}
  })
}

export function tooltipPosition(time: number, duration: number) {
  const percent = 10 + Math.max(0, Math.min(1, time / Math.max(1, duration))) * 86
  return `clamp(6rem, ${percent}%, calc(100% - 6rem))`
}
