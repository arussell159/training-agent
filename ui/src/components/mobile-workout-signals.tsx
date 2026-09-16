import {useMemo,useState,type PointerEvent} from 'react'
import type {RecordedPoint} from '@/lib/segment-statistics'
import {formatSignalClock,intervalSignals,tooltipPosition} from '@/lib/interval-signals'
import {WorkoutLapChart} from '@/components/workout-lap-chart'

type Lap={id:string;label:string;start:number;end:number;distance?:number|null;speed?:number|null}
export function MobileWorkoutSignals({points,laps,duration,sport}:{points:RecordedPoint[];laps:Lap[];duration:number;sport:string}){
 const [time,setTime]=useState<number|null>(null),[lap,setLap]=useState<Lap|null>(null)
 const swim=/swim/i.test(sport),run=/run/i.test(sport)
 const primary=run||swim?'pace':'power'
 const intervals=useMemo(()=>intervalSignals(points,laps),[points,laps])
 const value=(p:RecordedPoint,key:string)=>key==='pace'?(p.speed!=null&&p.speed>.15?(swim?91.44:1609.344)/p.speed:null):key==='power'?p.power:key==='heartRate'?p.heartRate:p.cadence
 const tracks=[primary,'heartRate','cadence'].filter(key=>points.some(p=>value(p,key)!=null))
 const label=(key:string)=>key==='heartRate'?'Heart rate':key==='pace'?'Pace':key==='power'?'Power':swim?'Stroke rate':'Cadence'
 const unit=(key:string)=>key==='pace'?(swim?'min/100 yd':'min/mi'):key==='power'?'W':key==='heartRate'?'bpm':run?'spm':swim?'strokes/min':'rpm'
 const clock=formatSignalClock
 const format=(v:number|null|undefined,key:string)=>v==null?'—':key==='pace'?clock(v):Math.round(v).toLocaleString()
 const nearest=time==null?null:points.reduce<RecordedPoint|null>((best,p)=>!best||Math.abs(p.time-time)<Math.abs(best.time-time)?p:best,null)
 const interval=intervals.find(i=>lap?i.lap.id===lap.id:time!=null&&time>=i.lap.start&&time<i.lap.end)
 const averagePoint=interval?.point
 const move=(e:PointerEvent<SVGSVGElement>)=>{if(!e.isPrimary)return;setLap(null);const b=e.currentTarget.getBoundingClientRect();setTime(Math.max(0,Math.min(duration,((e.clientX-b.left)/b.width*400-40)/344*duration)))}
 const x=(t:number)=>40+t/Math.max(1,duration)*344
 return <section className="mx-auto w-full max-w-2xl space-y-5" aria-label="Recorded workout graphs">
  <WorkoutLapChart points={points} laps={laps} sport={sport} selected={lap} onSelect={selected=>{setLap(selected);setTime(selected.start)}}/>
  <div className="hidden md:block"><p className="mb-2 text-xs font-medium text-muted-foreground">{lap?.label || (swim?'Swim intervals':'Laps')}</p><div className="relative h-8" style={{marginLeft:'10%',marginRight:'4%'}}>{laps.map((l,i)=><button key={l.id} title={l.label} aria-label={`Highlight ${l.label}`} aria-pressed={lap?.id===l.id} onClick={()=>{setLap(l);setTime(l.start)}} style={{left:`${Math.max(0,l.start)/Math.max(1,duration)*100}%`,width:`${Math.max(0,Math.min(duration,l.end)-Math.max(0,l.start))/Math.max(1,duration)*100}%`}} className={`absolute inset-y-0 overflow-hidden rounded border border-background text-[10px] ${lap?.id===l.id?'bg-sky-500 text-white':'bg-slate-200 text-slate-700'}`}>{swim&&l.distance?Math.round(l.distance/.9144):i+1}</button>)}</div></div>
  {tracks.map(key=>{
   const samples=points.filter((_,i)=>i%Math.max(1,Math.floor(points.length/800))===0)
   const plateau=swim&&(key==='pace'||key==='cadence')
   const values=(plateau?intervals.map(i=>i.point):points).map(p=>value(p,key)).filter((v):v is number=>v!=null)
   if(!values.length)return null
   const lo=key==='pace'?Math.min(...values)*.85:0,hi=Math.max(lo+1,...values)*1.08
   const y=(v:number)=>key==='pace'?40+(v-lo)/(hi-lo)*160:200-(v-lo)/(hi-lo)*160
   let line='',area='',first=0,last=0,open=false
   const fillParts:string[]=[]
   if(plateau){for(const i of intervals){const v=value(i.point,key);if(v==null)continue;const start=x(i.lap.start),end=x(Math.min(duration,i.lap.end));line+=`M${start},${y(v)} L${end},${y(v)} `;fillParts.push(`M${start},200 L${start},${y(v)} L${end},${y(v)} L${end},200 Z`)}}
   else {for(const p of samples){const v=value(p,key);if(v==null){if(open)fillParts.push(`${area} L${last},200 L${first},200 Z`);open=false;continue}const px=x(p.time);line+=`${open?'L':'M'}${px},${y(v)} `;if(!open){area=`M${px},${y(v)} `;first=px}else area+=`L${px},${y(v)} `;last=px;open=true}
   if(open)fillParts.push(`${area} L${last},200 L${first},200 Z`)}
   const inspected=lap?averagePoint:plateau?averagePoint:nearest
   const inspectedValue=inspected?value(inspected,key):null
   const color=key==='heartRate'?'#f43f5e':'#26bcec'
   return <div key={key} className="relative"><h3 className="mb-1 text-base font-semibold">{label(key)}</h3>
    {time!=null&&<div role="status" style={{left:tooltipPosition(time,duration),transform:'translateX(-50%)'}} className="pointer-events-none absolute top-7 z-[999] w-44 rounded-lg border bg-white px-3 py-2 text-xs text-slate-900 shadow-lg"><p className="mb-1 truncate text-slate-500">{interval&&(lap||plateau)?`${interval.lap.label} · Average`:clock(time)}</p><strong>{format(inspectedValue,key)} {unit(key)}</strong>{key==='pace'&&interval&&<p className="mt-1">Interval duration {clock(interval.lap.end-interval.lap.start)}</p>}</div>}
    <svg viewBox="0 0 400 232" className="block h-auto w-full touch-pan-y select-none" role="img" aria-label={`${label(key)} over the full workout. Slide your finger to inspect values.`} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);move(e)}} onPointerMove={e=>{if(e.pointerType==='mouse'||e.buttons)move(e)}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}}>
     {[0,.25,.5,.75,1].map(f=><g key={f}><line x1="40" x2="384" y1={40+160*f} y2={40+160*f} stroke="currentColor" opacity=".12"/><text x="35" y={44+160*f} textAnchor="end" fontSize="10" fill="currentColor" opacity=".6">{format(key==='pace'?lo+f*(hi-lo):hi-f*(hi-lo),key)}</text><line x1={40+344*f} x2={40+344*f} y1="40" y2="200" stroke="currentColor" opacity=".08"/><text x={40+344*f} y="222" textAnchor="middle" fontSize="10" fill="currentColor" opacity=".6">{clock(duration*f)}</text></g>)}
     {lap&&<rect x={x(Math.max(0,lap.start))} width={Math.max(0,x(Math.min(duration,lap.end))-x(Math.max(0,lap.start)))} y="40" height="160" fill="#94a3b8" opacity=".15"/>}
     {swim&&laps.map(l=><line key={l.id} x1={x(l.start)} x2={x(l.start)} y1="40" y2="200" stroke="currentColor" opacity=".18" strokeDasharray="3 3"/>)}
     <path d={fillParts.join(' ')} fill={color} fillOpacity=".65"/><path d={line} stroke={color} strokeWidth="1.2" fill="none"/>
     {time!=null&&<g><line x1={x(time)} x2={x(time)} y1="40" y2="200" stroke="#475569" strokeDasharray="3 3"/>{inspectedValue!=null&&<circle cx={x(time)} cy={y(inspectedValue)} r="4" fill="white" stroke={color} strokeWidth="2"/>}</g>}
    </svg>
   </div>
  })}
 </section>
}
