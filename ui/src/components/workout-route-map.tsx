import {useEffect,useId,useMemo,useRef,useState} from 'react'
import {apiFetch} from '@/lib/api-client'
import type {PlannedWorkout} from '@/lib/training-context'

type Coordinate=[number,number]
export type TimedRoutePoint={time:number;latitude:number;longitude:number}

export function WorkoutRouteMap({workout,onAvailable,timedPoints,highlightRange,compact=false,topPadding=0}:{workout:PlannedWorkout;onAvailable?:(available:boolean)=>void;timedPoints?:TimedRoutePoint[];highlightRange?:[number,number]|null;compact?:boolean;topPadding?:number}){
 const id=workout.activity_id || (workout.id.startsWith('activity:')?workout.id.slice(9):null)
 const revision=(workout as PlannedWorkout & {activity_revision?:string}).activity_revision || ''
 const key=`${id}:${revision}`
 const [route,setRoute]=useState<{key:string;points:Coordinate[]}|null>(null)
 const fetched=useMemo(()=>route?.key===key?route.points:[],[route,key])
 const validTimedPoints=useMemo(()=>(timedPoints || []).filter(point=>Number.isFinite(point.time)&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=85&&Math.abs(point.longitude)<=180),[timedPoints])
 const usesTimedRoute=validTimedPoints.length>1
 const points=useMemo(()=>{
  if(usesTimedRoute)return validTimedPoints
  return fetched.map(([latitude,longitude],index)=>({time:index,latitude,longitude}))
 },[usesTimedRoute,validTimedPoints,fetched])
 const available=points.length>1
 const ref=useRef<HTMLDivElement>(null),pattern=useId().replace(/:/g,'')
 const [size,setSize]=useState({width:720,height:compact?280:320})
 useEffect(()=>{if(usesTimedRoute||!id)return;const controller=new AbortController();void apiFetch(`/api/activities/${encodeURIComponent(id)}/route?v=${encodeURIComponent(revision)}`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();return await r.json() as {points:Coordinate[]}}).then(d=>{if(!controller.signal.aborted)setRoute({key,points:(d.points || []).filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=85&&Math.abs(p[1])<=180)})}).catch(()=>{});return()=>controller.abort()},[id,revision,key,usesTimedRoute])
 useEffect(()=>{onAvailable?.(available)},[available,onAvailable])
 useEffect(()=>{if(!ref.current)return;const observer=new ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;if(width>0&&height>0)setSize({width,height})});observer.observe(ref.current);return()=>observer.disconnect()},[available])
 const layout=useMemo(()=>{
  if(points.length<2)return null
  let zoom=16,track:{x:number;y:number;time:number}[]=[],minX=0,maxX=0,minY=0,maxY=0
  for(;zoom>=0;zoom--){
   const world=256*2**zoom
   track=points.map(point=>{const sin=Math.sin(point.latitude*Math.PI/180);return {x:(point.longitude+180)/360*world,y:(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*world,time:point.time}})
   const origin=track[0].x;track=track.map(point=>({...point,x:point.x+Math.round((origin-point.x)/world)*world}))
   minX=Math.min(...track.map(p=>p.x));maxX=Math.max(...track.map(p=>p.x));minY=Math.min(...track.map(p=>p.y));maxY=Math.max(...track.map(p=>p.y))
   if(maxX-minX<size.width-80&&maxY-minY<size.height-80-topPadding)break
  }
  zoom=Math.max(0,zoom)
  const left=(minX+maxX)/2-size.width/2,top=(minY+maxY)/2-(40+topPadding+(size.height-40))/2
  track=track.map(point=>({...point,x:point.x-left,y:point.y-top}))
  const tiles=[];for(let x=Math.floor(left/256);x<=Math.floor((left+size.width)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+size.height)/256);y++)if(y>=0&&y<2**zoom)tiles.push({x,y,urlX:((x%2**zoom)+2**zoom)%2**zoom})
  const path=(items:typeof track)=>items.map((point,index)=>`${index?'L':'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
  const highlighted=usesTimedRoute&&highlightRange?track.filter(point=>point.time>=highlightRange[0]&&point.time<=highlightRange[1]):[]
  const start=track[0],end=track[track.length-1],finish=Math.hypot(start.x-end.x,start.y-end.y)<26?{x:end.x+20,y:end.y-20}:end
  return {zoom,left,top,tiles,start,end,finish,path:path(track),highlightPath:highlighted.length>1?path(highlighted):''}
 },[points,size,highlightRange,usesTimedRoute,topPadding])
 if(!layout)return route==null&&!usesTimedRoute?<div className={`bg-[#d7edf4] ${compact?'h-[280px]':'h-[min(48svh,420px)] min-h-[300px] md:h-[390px]'}`} aria-hidden="true"/>:null
 return <div ref={ref} className={`relative overflow-hidden bg-[#eef2ed] ${compact?'h-[280px]':'h-[min(48svh,420px)] min-h-[300px] md:h-[390px]'}`} aria-label="Activity route">
  <svg viewBox={`0 0 ${size.width} ${size.height}`} className="block h-full w-full" role="img" aria-label={layout.highlightPath?'Recorded activity route with selected lap highlighted':'Recorded activity route with start and finish markers'}>
   <defs><pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="white"/><path d="M0 0h3v3H0zM3 3h3v3H3z" fill="#17242b"/></pattern></defs>
   {layout.tiles.map(t=><image key={`${key}-${layout.zoom}-${t.x}-${t.y}`} href={`https://tile.openstreetmap.org/${layout.zoom}/${t.urlX}/${t.y}.png`} x={t.x*256-layout.left} y={t.y*256-layout.top} width="256" height="256"/>)}
   <path d={layout.path} fill="none" stroke="white" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round"/><path d={layout.path} fill="none" stroke={layout.highlightPath?'#64748b':'#1677b8'} strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round"/>
   {layout.highlightPath&&<><path d={layout.highlightPath} fill="none" stroke="white" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round"/><path d={layout.highlightPath} fill="none" stroke="#f4511e" strokeWidth="5.5" strokeLinejoin="round" strokeLinecap="round"/></>}
   <circle cx={layout.start.x} cy={layout.start.y} r="8" fill="#65a30d" stroke="white" strokeWidth="3"/>
   {layout.finish!==layout.end&&<path d={`M${layout.end.x},${layout.end.y} L${layout.finish.x},${layout.finish.y}`} stroke="white" strokeWidth="3"/>}
   <circle cx={layout.finish.x} cy={layout.finish.y} r="9" fill={`url(#${pattern})`} stroke="white" strokeWidth="3"/>
  </svg>
  <div className="absolute right-0 bottom-0 bg-white/90 px-1.5 text-[9px] text-slate-700">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></div>
 </div>
}
