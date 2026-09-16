import {useEffect,useId,useMemo,useRef,useState} from 'react'
import {apiFetch} from '@/lib/api-client'
import type {PlannedWorkout} from '@/lib/training-context'
type Coordinate=[number,number]
export function WorkoutRouteMap({workout,onAvailable}:{workout:PlannedWorkout;onAvailable?:(available:boolean)=>void}){
 const id=workout.activity_id || (workout.id.startsWith('activity:')?workout.id.slice(9):null)
 const revision=(workout as PlannedWorkout & {activity_revision?:string}).activity_revision || ''
 const key=`${id}:${revision}`
 const [route,setRoute]=useState<{key:string;points:Coordinate[]}|null>(null)
 const points=useMemo(()=>route?.key===key?route.points:[],[route,key])
 const ref=useRef<HTMLDivElement>(null),pattern=useId().replace(/:/g,'')
 const [size,setSize]=useState({width:360,height:320})
 useEffect(()=>{if(!id)return;const controller=new AbortController();void apiFetch(`/api/activities/${encodeURIComponent(id)}/route?v=${encodeURIComponent(revision)}`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();return await r.json() as {points:Coordinate[]}}).then(d=>{if(!controller.signal.aborted)setRoute({key,points:(d.points || []).filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=85&&Math.abs(p[1])<=180)})}).catch(()=>{});return()=>controller.abort()},[id,revision,key])
 useEffect(()=>{onAvailable?.(points.length>1)},[points,onAvailable])
 useEffect(()=>{if(!ref.current)return;const observer=new ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;if(width>0&&height>0)setSize({width,height})});observer.observe(ref.current);return()=>observer.disconnect()},[points.length>1])
 const layout=useMemo(()=>{
  if(points.length<2)return null
  let zoom=16,track:number[][]=[],minX=0,maxX=0,minY=0,maxY=0
  for(;zoom>=0;zoom--){
   const world=256*2**zoom
   track=points.map(([lat,lon])=>{const sin=Math.sin(lat*Math.PI/180);return [(lon+180)/360*world,(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*world]})
   const origin=track[0][0];track=track.map(([x,y])=>[x+Math.round((origin-x)/world)*world,y])
   minX=Math.min(...track.map(p=>p[0]));maxX=Math.max(...track.map(p=>p[0]));minY=Math.min(...track.map(p=>p[1]));maxY=Math.max(...track.map(p=>p[1]))
   if(maxX-minX<size.width-80&&maxY-minY<size.height-120)break
  }
  zoom=Math.max(0,zoom)
  const left=(minX+maxX)/2-size.width/2,top=(minY+maxY)/2-size.height/2
  track=track.map(([x,y])=>[x-left,y-top])
  const tiles=[];for(let x=Math.floor(left/256);x<=Math.floor((left+size.width)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+size.height)/256);y++)if(y>=0&&y<2**zoom)tiles.push({x,y,urlX:((x%2**zoom)+2**zoom)%2**zoom})
  const start=track[0],end=track[track.length-1],finish=Math.hypot(start[0]-end[0],start[1]-end[1])<26?[end[0]+20,end[1]-20]:end
  return {zoom,left,top,tiles,start,end,finish,path:track.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}
 },[points,size])
 if(!layout)return null
 return <div ref={ref} className="relative h-[min(48svh,420px)] min-h-[300px] overflow-hidden bg-[#dce9df] md:h-[390px]" aria-label="Activity route">
  <svg viewBox={`0 0 ${size.width} ${size.height}`} className="block h-full w-full" role="img" aria-label="Recorded activity route with start and finish markers">
   <defs><pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="white"/><path d="M0 0h3v3H0zM3 3h3v3H3z" fill="#17242b"/></pattern></defs>
   {layout.tiles.map(t=><image key={`${key}-${layout.zoom}-${t.x}-${t.y}`} href={`https://a.tile.opentopomap.org/${layout.zoom}/${t.urlX}/${t.y}.png`} x={t.x*256-layout.left} y={t.y*256-layout.top} width="256" height="256" onError={event=>{const image=event.currentTarget;if(image.dataset.fallback)return;image.dataset.fallback='true';image.setAttribute('href',`https://tile.openstreetmap.org/${layout.zoom}/${t.urlX}/${t.y}.png`)}}/>)}
   <path d={layout.path} fill="none" stroke="white" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round"/><path d={layout.path} fill="none" stroke="#fc641c" strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round"/>
   <circle cx={layout.start[0]} cy={layout.start[1]} r="9" fill="#79c943" stroke="white" strokeWidth="3"/>
   {layout.finish!==layout.end&&<path d={`M${layout.end} L${layout.finish}`} stroke="white" strokeWidth="3"/>}
   <circle cx={layout.finish[0]} cy={layout.finish[1]} r="10" fill={`url(#${pattern})`} stroke="white" strokeWidth="3"/>
  </svg>
  <div className="absolute right-0 bottom-8 bg-white/90 px-1.5 text-[9px] text-slate-700">Map data: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>, SRTM · <a href="https://services.opentopomap.org/about" target="_blank" rel="noreferrer">© OpenTopoMap (CC-BY-SA)</a></div>
 </div>
}
