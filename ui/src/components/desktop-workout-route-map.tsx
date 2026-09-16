import {useEffect,useMemo,useState} from 'react'
import {CircleMarker,MapContainer,Polyline,TileLayer,useMap} from 'react-leaflet'
import type {LatLngBoundsExpression,LatLngExpression} from 'leaflet'
import 'leaflet/dist/leaflet.css'

import {apiFetch} from '@/lib/api-client'
import type {PlannedWorkout} from '@/lib/training-context'
import type {TimedRoutePoint} from '@/components/workout-route-map'

type Coordinate=[number,number]

function FitRoute({points}:{points:LatLngExpression[]}){
 const map=useMap()
 useEffect(()=>{
  if(points.length<2)return
  map.fitBounds(points as LatLngBoundsExpression,{padding:[30,30],animate:false})
  window.setTimeout(()=>map.invalidateSize(),0)
 },[map,points])
 return null
}

export function DesktopWorkoutRouteMap({workout,timedPoints}:{workout:PlannedWorkout;timedPoints?:TimedRoutePoint[]}){
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
 const route=useMemo<LatLngExpression[]>(()=>validTimed.length>1?validTimed.map(point=>[point.latitude,point.longitude]):fallback,[validTimed,fallback])
 if(route.length<2)return <div className="flex h-[320px] items-center justify-center bg-muted/25 text-xs text-muted-foreground">Loading route…</div>
 const start=route[0],finish=route.at(-1)!
 return <div className="relative h-[320px] min-w-0 overflow-hidden bg-[#eef2ed]">
  <MapContainer center={start} zoom={13} className="h-full w-full" zoomControl attributionControl scrollWheelZoom>
   <TileLayer attribution={'&copy; OpenStreetMap contributors &copy; CARTO'} url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" maxZoom={20}/>
   <FitRoute points={route}/>
   <Polyline positions={route} pathOptions={{color:'#ffffff',weight:8,opacity:.95,lineCap:'round',lineJoin:'round'}}/>
   <Polyline positions={route} pathOptions={{color:'#1677b8',weight:4,opacity:1,lineCap:'round',lineJoin:'round'}}/>
   <CircleMarker center={start} radius={7} pathOptions={{color:'#ffffff',weight:3,fillColor:'#65a30d',fillOpacity:1}}/>
   <CircleMarker center={finish} radius={7} pathOptions={{color:'#ffffff',weight:3,fillColor:'#111827',fillOpacity:1}}/>
  </MapContainer>
 </div>
}
