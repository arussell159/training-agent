import {useEffect,useMemo,useState} from 'react'

import {MapboxRouteMap} from '@/components/mapbox-route-map'
import {apiFetch} from '@/lib/api-client'
import type {PlannedWorkout} from '@/lib/training-context'
import type {TimedRoutePoint} from '@/components/workout-route-map'

type Coordinate=[number,number]

export function DesktopWorkoutRouteMap({workout,timedPoints,compact=false}:{workout:PlannedWorkout;timedPoints?:TimedRoutePoint[];compact?:boolean}){
 const id=workout.activity_id || (workout.id.startsWith('activity:')?workout.id.slice(9):null)
 const revision=(workout as PlannedWorkout & {activity_revision?:string}).activity_revision || ''
 const [fallback,setFallback]=useState<Coordinate[]>([])
 const validTimed=useMemo(()=>(timedPoints || []).filter(point=>Number.isFinite(point.time)&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=85&&Math.abs(point.longitude)<=180),[timedPoints])
 useEffect(()=>{
  if(validTimed.length>1||!id)return
  const controller=new AbortController()
  void apiFetch(`/api/activities/${encodeURIComponent(id)}/route?v=${encodeURIComponent(revision)}`,{signal:controller.signal})
   .then(async response=>{if(!response.ok)throw Error();return await response.json() as {points:Coordinate[]}})
   .then(data=>{if(!controller.signal.aborted)setFallback((data.points || []).filter(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=85&&Math.abs(point[1])<=180))})
   .catch(()=>{})
  return()=>controller.abort()
 },[id,revision,validTimed.length])
 const route=useMemo(()=>validTimed.length>1?validTimed:fallback.map(([latitude,longitude],time)=>({time,latitude,longitude})),[validTimed,fallback])
 if(route.length<2)return <div className={`flex items-center justify-center bg-muted/25 text-xs text-muted-foreground ${compact?'h-[300px] lg:h-full lg:min-h-[300px]':'h-[320px]'}`}>Loading route…</div>
 return <MapboxRouteMap points={route} className={`relative isolate z-0 min-w-0 overflow-hidden bg-[#eef2ed] ${compact?'h-[300px] lg:h-full lg:min-h-[300px]':'h-[320px]'}`}/>
}
