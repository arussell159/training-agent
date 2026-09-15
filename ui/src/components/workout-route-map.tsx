import {useEffect,useState} from 'react'
import {apiFetch} from '@/lib/api-client'
import type {PlannedWorkout} from '@/lib/training-context'
import {ChevronDown,MapPin} from 'lucide-react'

type Coordinate=[number,number]
export function WorkoutRouteMap({workout}:{workout:PlannedWorkout}){
 const id=workout.activity_id || (workout.id.startsWith('activity:')?workout.id.slice(9):null)
 const [points,setPoints]=useState<Coordinate[]>([])
 useEffect(()=>{setPoints([]);if(!id || !window.matchMedia('(max-width: 767px)').matches)return;const controller=new AbortController();void apiFetch(`/api/activities/${encodeURIComponent(id)}/route`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();return await r.json() as {points:Coordinate[]}}).then(d=>{if(!controller.signal.aborted)setPoints(d.points)}).catch(()=>{});return()=>controller.abort()},[id])
 if(points.length<2)return null
 const project=([lat,lon]:Coordinate,z:number)=>{const size=256*2**z,sin=Math.sin(lat*Math.PI/180);return [(lon+180)/360*size,(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*size]}
 let zoom=16,projected=points.map(p=>project(p,zoom))
 while(zoom>0){const xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1]);if(Math.max(...xs)-Math.min(...xs)<320&&Math.max(...ys)-Math.min(...ys)<140)break;zoom--;projected=points.map(p=>project(p,zoom))}
 const xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1]),left=(Math.min(...xs)+Math.max(...xs))/2-180,top=(Math.min(...ys)+Math.max(...ys))/2-90
 const tiles=[];for(let x=Math.floor(left/256);x<=Math.floor((left+360)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+180)/256);y++)if(y>=0&&y<2**zoom)tiles.push({x,y})
 return <details open className="group overflow-hidden rounded-xl border bg-card md:hidden"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium"><MapPin className="size-4"/>Activity route<ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180"/></summary><div className="relative aspect-[2/1] overflow-hidden bg-muted"><svg viewBox="0 0 360 180" className="h-full w-full" role="img" aria-label="Recorded GPS activity route">{tiles.map(t=><image key={`${t.x}-${t.y}`} href={`https://tile.openstreetmap.org/${zoom}/${((t.x%2**zoom)+2**zoom)%2**zoom}/${t.y}.png`} x={t.x*256-left} y={t.y*256-top} width="256" height="256"/>)}<path d={projected.map((p,i)=>`${i?'L':'M'}${p[0]-left},${p[1]-top}`).join(' ')} fill="none" stroke="white" strokeWidth="5"/><path d={projected.map((p,i)=>`${i?'L':'M'}${p[0]-left},${p[1]-top}`).join(' ')} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinejoin="round"/><circle cx={projected[0][0]-left} cy={projected[0][1]-top} r="4" fill="#22c55e" stroke="white" strokeWidth="2"/></svg><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="absolute bottom-0 right-0 bg-white/90 px-1 text-[9px] text-slate-600">© OpenStreetMap contributors</a></div></details>
}
