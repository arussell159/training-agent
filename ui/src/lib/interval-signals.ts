import {segmentStatistics, type RecordedPoint} from './segment-statistics.ts'

export type RecordedLap = {id:string; label:string; start:number; end:number; distance?:number|null; speed?:number|null}

export function formatSignalClock(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds))
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`
}

export function intervalSignals(points: RecordedPoint[], laps: RecordedLap[]) {
  return laps.filter(l => l.end > l.start).map(lap => {
    const averages = segmentStatistics(points, lap.start, lap.end)
    const speed = lap.speed ?? (lap.distance != null && lap.distance > 0 ? lap.distance / (lap.end - lap.start) : averages.speed)
    return {lap, point:{time:lap.start, distance:null, power:averages.power, heartRate:averages.heartRate, cadence:averages.cadence, speed} satisfies RecordedPoint}
  })
}

export function tooltipPosition(time: number, duration: number) {
  const percent = 10 + Math.max(0, Math.min(1, time / Math.max(1, duration))) * 86
  return `clamp(6rem, ${percent}%, calc(100% - 6rem))`
}
