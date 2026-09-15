import {useEffect,useMemo,useRef,useState,type PointerEvent} from 'react'
import {apiFetch} from '@/lib/api-client'
import type {PlannedWorkout} from '@/lib/training-context'
import {Button} from '@/components/ui/button'
import {RotateCcw} from 'lucide-react'
import {segmentStatistics,type RecordedPoint} from '@/lib/segment-statistics'
import {MobileWorkoutSignals} from '@/components/mobile-workout-signals'

type Point=RecordedPoint
type Lap={id:string;label:string;start:number;end:number;power:number|null;heartRate:number|null;distance:number|null;kind:string;speed?:number|null}
type Analysis={points:Point[];laps:Lap[];intervals:Lap[];duration:number}
const cache=new Map<string,Analysis>()
const clock=(seconds:number)=>{const s=Math.max(0,Math.round(seconds));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
const pace=(seconds:number)=>seconds>0&&Number.isFinite(seconds)?clock(seconds):'—'
export function WorkoutAnalysis({workout}:{workout:PlannedWorkout}){
  const id=workout.activity_id || (workout.id.startsWith('activity:')?workout.id.slice(9):null)
  return id?<ActivityGraph key={id} id={id} sport={workout.sport}/>:null
}
function ActivityGraph({id,sport}:{id:string;sport:string}){
  const [data,setData]=useState<Analysis|null>(cache.get(id)||null),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  const [range,setRange]=useState<[number,number]|null>(null),[cursor,setCursor]=useState<number|null>(null),[selection,setSelection]=useState<[number,number]|null>(null),[selected,setSelected]=useState('')
  const gesture=useRef<{x:number;time:number;range:[number,number];overview:boolean;pan:boolean}|null>(null)
  useEffect(()=>{if(cache.has(id)){setData(cache.get(id)!);return}const controller=new AbortController();setError('');void apiFetch(`/api/activities/${encodeURIComponent(id)}/analysis`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('The recording could not be loaded.');return await r.json() as Analysis}).then(d=>{cache.set(id,d);if(cache.size>20)cache.delete(cache.keys().next().value!);if(!controller.signal.aborted)setData(d)}).catch(e=>{if(e.name!=='AbortError')setError(e.message)});return()=>controller.abort()},[id,retry])
  const duration=data?.duration||1,view=range||[0,duration],swim=sport.toLowerCase().includes('swim'),run=sport.toLowerCase().includes('run')
  const available=useMemo(()=>({power:data?.points.some(p=>p.power!=null),speed:data?.points.some(p=>p.speed!=null),heartRate:data?.points.some(p=>p.heartRate!=null),cadence:data?.points.some(p=>p.cadence!=null)}),[data])
  const primary=run||swim?'pace':'power'
  const paceDistance=swim?91.44:1609.344
  const value=(p:Point,key:string)=>key==='pace'?(p.speed!=null&&p.speed>0.15?paceDistance/p.speed:null):key==='speed'?(p.speed==null?null:p.speed*2.2369362920544):key==='power'?p.power:key==='cadence'?(p.cadence??null):p.heartRate
  const unit=(key:string)=>key==='power'?'W':key==='heartRate'?'bpm':key==='cadence'?(run?'spm':swim?'strokes/min':'rpm'):key==='pace'?(swim?'s/100y':'min/mi'):'mph'
  const label=(key:string)=>key==='heartRate'?'Heart rate':key[0].toUpperCase()+key.slice(1)
  const format=(v:number|null|undefined,key:string)=>v==null?'—':key==='pace'&&!swim?pace(v):String(Math.round(v))
  const tracks=[...(primary==='power'?available.power:available.speed)?[primary]:[],...(available.heartRate?['heartRate']:[]),...(available.cadence?['cadence']:[])]
  const visible=useMemo(()=>data?.points.filter(p=>p.time>=view[0]&&p.time<=view[1])||[],[data,view[0],view[1]])
  const nearest=cursor==null?null:visible.reduce<Point|null>((best,p)=>!best||Math.abs(p.time-cursor)<Math.abs(best.time-cursor)?p:best,null)
  const statsRange=selection?[Math.max(0,Math.min(...selection)),Math.min(duration,Math.max(...selection))]:view
  const averages=useMemo(()=>segmentStatistics(data?.points || [],statsRange[0],statsRange[1]),[data,statsRange[0],statsRange[1]])
  const focusSegment=(l:Lap)=>{const start=Math.max(0,l.start),end=Math.min(duration,l.end);if(end<=start)return;setRange([start,end]);setSelected(l.id)}
  const activeLap=nearest?data?.laps.find(l=>nearest.time>=l.start && nearest.time<l.end):data?.laps.find(l=>l.id===selected)
  const selectedLap=data?.laps.find(l=>l.id===selected)
  const averageSpeed=swim&&selectedLap?.speed!=null?selectedLap.speed:averages.speed
  useEffect(()=>{
    if(!selected || !range || !data)return
    const segment=data.laps.find(l=>l.id===selected)
    if(segment && (Math.abs(range[0]-Math.max(0,segment.start))>.5 || Math.abs(range[1]-Math.min(duration,segment.end))>.5))setSelected('')
  },[range,selected,data,duration])
  const x=(time:number,overview=false)=>52+(time-(overview?0:view[0]))/(overview?duration:Math.max(1,view[1]-view[0]))*900
  const timeAt=(e:PointerEvent<SVGSVGElement>,overview=false)=>{const b=e.currentTarget.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,((e.clientX-b.left)/b.width*980-52)/900));return (overview?0:view[0])+fraction*(overview?duration:view[1]-view[0])}
  const move=(e:PointerEvent<SVGSVGElement>,overview=false)=>{const t=timeAt(e,overview);setCursor(t);const g=gesture.current;if(!g)return;if(g.pan){const bounds=e.currentTarget.getBoundingClientRect(),delta=(g.overview?1:-1)*(e.clientX-g.x)/bounds.width*980/900*(g.overview?duration:g.range[1]-g.range[0]),width=g.range[1]-g.range[0],start=Math.max(0,Math.min(duration-width,g.range[0]+delta));setRange([start,start+width])}else setSelection([g.time,t])}
  const down=(e:PointerEvent<SVGSVGElement>,overview=false)=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);const t=timeAt(e,overview);const pan=Boolean(range)&&(!overview || t>=view[0]&&t<=view[1]);gesture.current={x:e.clientX,time:t,range:[view[0],view[1]],overview,pan};if(!pan)setSelection([t,t]);setSelected('')}
  const up=(e:PointerEvent<SVGSVGElement>)=>{const g=gesture.current;if(!g)return;const t=timeAt(e,g.overview);if(!g.pan&&Math.abs(e.clientX-g.x)>5&&Math.abs(t-g.time)>=2){setRange([Math.min(t,g.time),Math.max(t,g.time)])}gesture.current=null;setSelection(null);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}
  const reset=()=>{setRange(null);setSelected('');setSelection(null);setCursor(null)}
  if(error)return <div className="rounded-xl border p-4 text-sm">{error}<Button variant="outline" size="sm" className="ml-3" onClick={()=>setRetry(r=>r+1)}>Retry</Button></div>
  if(!data)return <div role="status" className="animate-pulse rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">Loading recorded signals and laps…</div>
  if(!data.points.length||!tracks.length)return <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No power, speed, or heart-rate stream is available in this recording.</div>
  const laps=data.laps,height=tracks.length*112+30
  return <><MobileWorkoutSignals points={data.points} laps={laps} duration={duration} sport={sport}/><section aria-label="Recorded workout analysis" className="hidden w-full min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm md:block">
    <div className="space-y-2 border-b bg-muted/10 py-3" aria-label="Recorded lap timeline">
      <div className="flex items-center justify-between px-4 text-xs"><span className="font-medium">{activeLap?.label || 'Workout laps'}</span><span className="text-muted-foreground">Click a lap to zoom</span></div>
      <div className="flex items-center"><div style={{marginLeft:`${52/980*100}%`,marginRight:`${28/980*100}%`}} className="relative h-8 flex-1 overflow-hidden rounded-md bg-muted/50">{laps.filter(l=>l.end>view[0]&&l.start<view[1]).map(l=><button key={l.id} aria-label={`Zoom to ${l.label}`} title={`${l.label} · ${clock(l.start)}–${clock(l.end)}`} aria-pressed={selected===l.id} onClick={()=>focusSegment(l)} style={{left:`${(Math.max(view[0],l.start)-view[0])/(view[1]-view[0])*100}%`,width:`${Math.max(0,Math.min(view[1],l.end)-Math.max(view[0],l.start))/(view[1]-view[0])*100}%`}} className={`absolute inset-y-1 overflow-hidden rounded-sm border border-background px-0.5 text-[10px] font-medium transition hover:z-10 hover:bg-sky-500 hover:text-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${selected===l.id || activeLap?.id===l.id?'z-10 bg-sky-600 text-white':'bg-slate-300 text-slate-800 dark:bg-slate-600 dark:text-slate-100'}`}>{(l.end-l.start)/(view[1]-view[0])>.045?laps.indexOf(l)+1:''}</button>)}{!laps.length&&<span className="px-2 text-[10px] leading-8 text-muted-foreground">Not recorded</span>}<div className="pointer-events-none absolute inset-y-0 rounded-sm border-x-2 border-sky-500 bg-sky-500/10" style={{left:`${(statsRange[0]-view[0])/(view[1]-view[0])*100}%`,width:`${(statsRange[1]-statsRange[0])/(view[1]-view[0])*100}%`}}/></div></div>
    </div>
    <div aria-label="Highlighted segment averages" className="border-b px-4 py-3"><div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{[
      {label:'Avg pace',value:averageSpeed!=null&&averageSpeed>0?format(paceDistance/averageSpeed,'pace'):'—',unit:unit('pace')},
      {label:'Avg speed',value:averages.speed==null?'—':(averages.speed*2.2369362920544).toFixed(1),unit:'mph'},
      {label:'Avg heart rate',value:averages.heartRate==null?'—':Math.round(averages.heartRate),unit:'bpm'},
      {label:'Avg power',value:averages.power==null?'—':Math.round(averages.power),unit:'W'},
      {label:'Avg cadence',value:averages.cadence==null?'—':Math.round(averages.cadence),unit:run?'spm':swim?'strokes/min':'rpm'},
    ].map(s=><div key={s.label} className="rounded-lg bg-muted/30 px-2.5 py-2"><p className="text-[10px] text-muted-foreground">{s.label}</p><p className="text-sm font-semibold tabular-nums">{s.value} <span className="text-[10px] font-normal text-muted-foreground">{s.unit}</span></p></div>)}</div></div>
    <div className="flex min-h-10 flex-wrap items-center gap-x-5 gap-y-1 bg-muted/20 px-4 py-2 text-xs tabular-nums">{tracks.map(key=><span key={key} style={{color:key==='heartRate'?'#e11d48':'#0284c7'}}>{label(key)} <strong>{format(nearest?value(nearest,key):null,key)}</strong> {unit(key)}</span>)}<Button size="sm" variant="outline" className="ml-auto h-8 rounded-lg bg-background text-xs shadow-sm" onClick={reset} disabled={!range} aria-label="Reset zoom to full workout"><RotateCcw className="size-3.5"/>Reset zoom</Button></div>
    <svg viewBox={`0 0 980 ${height}`} preserveAspectRatio="none" className={`block min-h-44 w-full touch-none select-none [&_text]:text-[25px] md:[&_text]:text-[11px] ${range?'cursor-grab active:cursor-grabbing':'cursor-crosshair'}`} role="img" aria-label="Recorded signals. Drag to zoom or pan. Use lap buttons to zoom and arrow keys to pan." tabIndex={0} onKeyDown={e=>{if(!range || !['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const width=range[1]-range[0],start=Math.max(0,Math.min(duration-width,range[0]+width*.1*(e.key==='ArrowRight'?1:-1)));setRange([start,start+width])}} onPointerDown={e=>down(e)} onPointerMove={e=>move(e)} onPointerUp={up} onPointerCancel={()=>{gesture.current=null;setSelection(null)}} onPointerLeave={()=>{if(!gesture.current)setCursor(null)}}>
      {tracks.map((key,lane)=>{const values=visible.map(p=>value(p,key)).filter((v):v is number=>v!=null),min=key==='pace'?Math.min(...values):0,max=values.length?Math.max(...values):1,span=Math.max(1,max-min),top=lane*112+10;const y=(v:number)=>top+86-(key==='pace'?max-v:v-min)/span*70;let d='',previous=false;const stride=Math.max(1,Math.floor(visible.length/1800));for(let i=0;i<visible.length;i+=stride){const p=visible[i],v=value(p,key);if(v==null){previous=false;continue}d+=`${previous?'L':'M'}${x(p.time).toFixed(1)},${y(v).toFixed(1)} `;previous=true}return <g key={key}><rect x="52" y={top} width="900" height="94" fill={key==='heartRate'?'#e11d48':'#0284c7'} fillOpacity=".035" rx="6"/>{[0,.5,1].map(f=><g key={f}><line x1="52" x2="952" y1={top+86-f*70} y2={top+86-f*70} stroke="currentColor" opacity=".08"/><text x="44" y={top+90-f*70} textAnchor="end" fontSize="11" fill="currentColor" opacity=".6">{format(key==='pace'?max-f*span:min+f*span,key)}</text></g>)}<text x="60" y={top+14} fontSize="11" fill={key==='heartRate'?'#e11d48':'#0284c7'}>{label(key)} · {unit(key)}</text>{laps.filter(l=>l.start>=view[0]&&l.start<=view[1]).map(l=><line key={l.id} x1={x(l.start)} x2={x(l.start)} y1={top} y2={top+94} stroke="currentColor" opacity=".13" strokeDasharray="3 3"/>)}<path d={d} fill="none" stroke={key==='heartRate'?'#e11d48':'#0284c7'} strokeWidth="1.5" strokeLinejoin="round"/></g>})}
      {selection&&<rect x={Math.min(x(selection[0]),x(selection[1]))} y="0" width={Math.abs(x(selection[1])-x(selection[0]))} height={height-25} fill="#0284c7" fillOpacity=".15" stroke="#0284c7"/>}
      {nearest&&<line x1={x(nearest.time)} x2={x(nearest.time)} y1="0" y2={height-25} stroke="currentColor" opacity=".4" strokeDasharray="3 3"/>}
      {Array.from({length:6},(_,i)=>view[0]+(view[1]-view[0])*i/5).map(t=><text key={t} x={x(t)} y={height-5} fontSize="11" textAnchor="middle" fill="currentColor" opacity=".6">{clock(t)}</text>)}
    </svg>
    <div className="border-t bg-muted/10 py-3"><svg viewBox="0 0 980 44" className={`block h-14 w-full touch-none ${range?'cursor-grab active:cursor-grabbing':'cursor-crosshair'}`} aria-label="Select a time range from the full workout overview" onPointerDown={e=>down(e,true)} onPointerMove={e=>move(e,true)} onPointerUp={up} onPointerCancel={()=>{gesture.current=null;setSelection(null)}}><rect x="52" width="900" height="40" rx="5" fill="currentColor" opacity=".05"/><path d={data.points.filter((_,i)=>i%Math.max(1,Math.floor(data.points.length/800))===0).map((p,i)=>`${i?'L':'M'}${x(p.time,true)},${38-Math.min(1,(p.power??p.heartRate??0)/(available.power?500:200))*32}`).join(' ')} stroke="#0284c7" fill="none" strokeWidth="1"/><rect x={x(selection&&gesture.current?.overview?Math.min(...selection):view[0],true)} width={Math.max(1,x(selection&&gesture.current?.overview?Math.max(...selection):view[1],true)-x(selection&&gesture.current?.overview?Math.min(...selection):view[0],true))} height="40" fill="#0284c7" fillOpacity=".12" stroke="#0284c7" rx="4"/></svg></div>
  </section></>
}
