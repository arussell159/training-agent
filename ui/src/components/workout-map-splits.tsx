import { METERS_PER_100_YARDS } from "../../../app-backend/lib/swim-units.mjs"
import {useEffect,useMemo,useState} from 'react'
import {apiFetch} from '@/lib/api-client'
import type {PlannedWorkout} from '@/lib/training-context'
import {segmentStatistics,type RecordedPoint} from '@/lib/segment-statistics'
import {WorkoutTableCard} from '@/components/ui/workout-table-card'
import {useIsMobile} from '@/hooks/use-mobile'
import {DesktopWorkoutRouteMap} from '@/components/desktop-workout-route-map'

type Split={number:number;start:number;end:number;distance:number;pace:number;power:number|null}
type Analysis={points:RecordedPoint[]}

const clock=(seconds:number)=>{const value=Math.max(0,Math.round(seconds));return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`}

function timeAtDistance(points:RecordedPoint[],target:number){
 const first=points[0]
 if(target<=Number(first.distance))return first.time
 for(let index=1;index<points.length;index++){
  const previous=points[index-1],current=points[index],from=Number(previous.distance),to=Number(current.distance)
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<target)continue
  if(to<=from)return current.time
  return previous.time+(current.time-previous.time)*(target-from)/(to-from)
 }
 return points.at(-1)?.time ?? 0
}

export function WorkoutMapSplits({workout}:{workout:PlannedWorkout}){
 const mobile=useIsMobile()
 const id=workout.activity_id || (workout.id.startsWith('activity:')?workout.id.slice(9):null)
 const revision=(workout as PlannedWorkout & {activity_revision?:string}).activity_revision || ''
 const [analysis,setAnalysis]=useState<Analysis|null>(null)
 useEffect(()=>{if(!id)return;const controller=new AbortController();void apiFetch(`/api/activities/${encodeURIComponent(id)}/analysis?schema=5&v=${encodeURIComponent(revision)}`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();return await response.json() as Analysis}).then(value=>{if(!controller.signal.aborted)setAnalysis(value)}).catch(()=>{});return()=>controller.abort()},[id,revision])
 const sport=workout.sport.toLowerCase(),swim=sport.includes('swim'),bike=sport.includes('bike')||sport.includes('ride')
 const splitDistance=swim?METERS_PER_100_YARDS:bike?8046.72:1609.344
 const distancePoints=useMemo(()=>(analysis?.points || []).filter(point=>point.distance!=null&&Number.isFinite(point.distance)).sort((a,b)=>a.time-b.time),[analysis])
 const splits=useMemo(()=>{
  if(distancePoints.length<2)return []
  const startDistance=Number(distancePoints[0].distance),finishDistance=Number(distancePoints.at(-1)?.distance)
  if(!(finishDistance>startDistance))return []
  const values:Split[]=[]
  for(let from=startDistance,index=1;from<finishDistance-.5;from+=splitDistance,index++){
   const to=Math.min(finishDistance,from+splitDistance),distance=to-from,start=timeAtDistance(distancePoints,from),end=timeAtDistance(distancePoints,to)
   if(end>start&&distance>0)values.push({number:index,start,end,distance,pace:(end-start)*splitDistance/distance,power:segmentStatistics(analysis?.points || [],start,end).power})
  }
  return values
 },[analysis?.points,distancePoints,splitDistance])
 const routePoints=useMemo(()=>(analysis?.points || []).flatMap(point=>point.latitude!=null&&point.longitude!=null?[{time:point.time,latitude:point.latitude,longitude:point.longitude}]:[]),[analysis])
 const showPower=bike&&splits.some(split=>split.power!=null)
 const table=splits.length?<div className={mobile ? "data-table" : "max-h-[320px] overflow-y-auto"}><table className="w-full text-xs"><thead className="sticky top-0 bg-card"><tr className="border-b"><th className="label-cell px-4 py-2 text-left font-medium">Split</th><th className="numeric-cell px-4 py-2 text-right font-medium">Pace</th>{showPower&&<th className="numeric-cell px-4 py-2 text-right font-medium">Power</th>}</tr></thead><tbody>{splits.map(split=><tr key={split.number} className="border-b last:border-b-0"><td className="label-cell px-4 py-2.5 tabular-nums">{split.number}</td><td className="numeric-cell px-4 py-2.5 text-right font-medium tabular-nums">{clock(split.pace)} <span className="font-normal text-muted-foreground">/{bike?'5 mi':swim?'100 yd':'mi'}</span></td>{showPower&&<td className="numeric-cell px-4 py-2.5 text-right font-medium tabular-nums">{split.power!=null?`${Math.round(split.power)} W`:'—'}</td>}</tr>)}</tbody></table></div>:<p className="p-4 text-xs text-muted-foreground">Split data is not available for this recording.</p>
 if(!id)return null
 if(mobile)return <section aria-label="Workout splits and route"><WorkoutTableCard title="Splits" subtitle={bike?'5 miles per split':swim?'100 yards per split':'1 mile per split'}>{table}</WorkoutTableCard></section>
 return <section aria-label="Workout splits and route" className="overflow-hidden rounded-xl border bg-card shadow-sm">
  <div className={`grid ${swim?'':'md:grid-cols-[280px_minmax(0,1fr)]'}`}>
   <div className={swim?'':'border-b md:border-r md:border-b-0'}>
    <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Splits</h2><p className="mt-0.5 text-[10px] text-muted-foreground">{bike?'5 miles':swim?'100 yards':'1 mile'} per split</p></div>
    {table}
   </div>
   {!swim&&<div className="hidden min-w-0 md:block"><DesktopWorkoutRouteMap workout={workout} timedPoints={routePoints}/></div>}
  </div>
 </section>
}
