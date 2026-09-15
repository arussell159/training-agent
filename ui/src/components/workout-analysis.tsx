import {useEffect, useState} from 'react'
import {apiFetch} from '@/lib/api-client'
import type {PlannedWorkout} from '@/lib/training-context'
import type {RecordedPoint} from '@/lib/segment-statistics'
import type {RecordedLap} from '@/lib/interval-signals'
import {Button} from '@/components/ui/button'
import {MobileWorkoutSignals} from '@/components/mobile-workout-signals'

type Analysis = {points:RecordedPoint[]; laps:RecordedLap[]; duration:number}
const cache = new Map<string, Analysis>()

export function WorkoutAnalysis({workout}:{workout:PlannedWorkout}) {
  const id = workout.activity_id || (workout.id.startsWith('activity:') ? workout.id.slice(9) : null)
  return id ? <ActivityGraph key={id} id={id} sport={workout.sport}/> : null
}

function ActivityGraph({id, sport}:{id:string; sport:string}) {
  const [data, setData] = useState<Analysis | null>(cache.get(id) || null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (cache.has(id)) return
    const controller = new AbortController()
    void apiFetch(`/api/activities/${encodeURIComponent(id)}/analysis`, {signal:controller.signal})
      .then(async response => {
        if (!response.ok) throw Error('The recording could not be loaded.')
        return await response.json() as Analysis
      }).then(recording => {
        if (controller.signal.aborted) return
        cache.set(id, recording)
        if (cache.size > 20) cache.delete(cache.keys().next().value!)
        setData(recording)
      }).catch(error => { if (error.name !== 'AbortError') setError(error.message) })
    return () => controller.abort()
  }, [id, retry])
  if (error) return <div role="alert" className="rounded-xl border p-4 text-sm">{error}<Button variant="outline" size="sm" className="ml-3" onClick={() => {setError(''); setRetry(value => value + 1)}}>Retry</Button></div>
  if (!data) return <div role="status" className="animate-pulse rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">Loading recorded signals and intervals…</div>
  if (!data.points.length) return <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No recorded signals are available.</div>
  // Selection highlights the interval, never changing the chart scale.
  return <MobileWorkoutSignals points={data.points} laps={data.laps} duration={data.duration} sport={sport}/>
}
