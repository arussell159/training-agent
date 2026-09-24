import {useEffect,useMemo,useState} from 'react'

import {MapboxRouteMap,type MapRoutePoint} from '@/components/mapbox-route-map'
import {apiFetch} from '@/lib/api-client'
import type {PlannedWorkout} from '@/lib/training-context'

type Coordinate=[number,number]
export type TimedRoutePoint=MapRoutePoint

export function WorkoutRouteMap({workout,onAvailable,timedPoints,highlightRange,compact=false,topPadding=0,bottomPadding=0}:{workout:PlannedWorkout;onAvailable?:(available:boolean)=>void;timedPoints?:TimedRoutePoint[];highlightRange?:[number,number]|null;compact?:boolean;topPadding?:number;bottomPadding?:number}){
 const id=workout.activity_id || (workout.id.startsWith('activity:')?workout.id.slice(9):null)
 const revision=(workout as PlannedWorkout & {activity_revision?:string}).activity_revision || ''
 const key=`${id}:${revision}`
 const [route,setRoute]=useState<{key:string;points:Coordinate[]}|null>(null)
 const fetched=useMemo(()=>route?.key===key?route.points:[],[route,key])
 const validTimedPoints=useMemo(()=>(timedPoints || []).filter(point=>Number.isFinite(point.time)&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=85&&Math.abs(point.longitude)<=180),[timedPoints])
 const usesTimedRoute=validTimedPoints.length>1
 const points=useMemo<TimedRoutePoint[]>(()=>usesTimedRoute?validTimedPoints:fetched.map(([latitude,longitude],time)=>({time,latitude,longitude})),[usesTimedRoute,validTimedPoints,fetched])
 const available=points.length>1
 useEffect(()=>{if(usesTimedRoute||!id)return;const controller=new AbortController();void apiFetch(`/api/activities/${encodeURIComponent(id)}/route?v=${encodeURIComponent(revision)}`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();return await response.json() as {points:Coordinate[]}}).then(data=>{if(!controller.signal.aborted)setRoute({key,points:(data.points || []).filter(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=85&&Math.abs(point[1])<=180)})}).catch(()=>{});return()=>controller.abort()},[id,revision,key,usesTimedRoute])
 useEffect(()=>{onAvailable?.(available)},[available,onAvailable])
 if(!available)return route==null&&!usesTimedRoute?<div className={`bg-[#d7edf4] ${compact?'h-[280px]':'h-[min(48svh,420px)] min-h-[300px] md:h-[390px]'}`} aria-hidden="true"/>:null
 return <MapboxRouteMap points={points} highlightRange={highlightRange} interactive={false} topPadding={topPadding} bottomPadding={bottomPadding} className={`relative overflow-hidden bg-[#eef2ed] ${compact?'h-[280px]':'h-[min(48svh,420px)] min-h-[300px] md:h-[390px]'}`}/>
}
