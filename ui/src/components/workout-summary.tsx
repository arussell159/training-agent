import {formatDuration} from '@/lib/duration'
import type {PlannedWorkout,WorkoutSummaryValues} from '@/lib/training-context'
import {useEffect,useState} from 'react'
import {apiFetch} from '@/lib/api-client'
import {Button} from '@/components/ui/button'

export function WorkoutSummary({workout}:{workout:PlannedWorkout}){
 const swim=/swim/i.test(workout.sport),bike=/bike|ride/i.test(workout.sport)
 const data=workout.workout_summary
 const id=workout.activity_id || (workout.id.startsWith('activity:')?workout.id.slice(9):null)
 const [recorded,setRecorded]=useState<WorkoutSummaryValues|null>(null)
 const [loading,setLoading]=useState(Boolean(id)),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{
  setRecorded(null);setError('');setLoading(Boolean(id));if(!id)return
  const controller=new AbortController()
  void apiFetch(`/api/activities/${encodeURIComponent(id)}/summary`,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('Completed values could not be refreshed.')
   return await response.json() as WorkoutSummaryValues
  }).then(values=>{if(!controller.signal.aborted)setRecorded(values)}).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[id,retry])
 const planned=data?.planned,completed=recorded || data?.completed
 const number=(v:number|null|undefined,digits=0)=>v==null || !Number.isFinite(v)?'':v.toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits})
 const clock=(v:number|null|undefined)=>v==null?'':formatDuration(v/60)
 const pace=(v:number|null|undefined)=>{if(!(Number(v)>0))return '';const s=Math.round((swim?91.44:1609.344)/Number(v));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
 const rows:{label:string;unit:string;value:(v:WorkoutSummaryValues|undefined|null)=>string}[]=[
  {label:'Duration',unit:'',value:v=>clock(v?.duration_seconds)},
  {label:'Distance',unit:swim?'yds':'mi',value:v=>number(v?.distance_meters==null?null:v.distance_meters/(swim?.9144:1609.344),swim?0:2)},
  {label:bike?'Avg power':'Avg pace',unit:bike?'watts':swim?'sec/100y':'min/mi',value:v=>bike?number(v?.average_power):pace(v?.average_speed)},
  {label:'Calories',unit:'kcal',value:v=>number(v?.calories)},
  {label:'Gain',unit:'ft',value:v=>number(v?.elevation_gain==null?null:v.elevation_gain/.3048)},
  {label:'TSS',unit:'TSS',value:v=>number(v?.tss)},
  {label:'IF',unit:'IF',value:v=>number(v?.intensity_factor,2)},
  {label:'Loss',unit:'ft',value:v=>number(v?.elevation_loss==null?null:v.elevation_loss/.3048)},
  {label:'Work',unit:'kJ',value:v=>number(v?.work_kj,1)},
 ]

 const visible=rows.filter(row=>row.value(planned)!=='' || row.value(completed)!=='')
 const recordedRows=[
  {label:bike?'Power':'Pace',unit:bike?'W':swim?'min:sec/100y':'min/mi',values:bike?[number(completed?.min_power),number(completed?.average_power),number(completed?.max_power)]:[pace(completed?.max_speed),pace(completed?.average_speed),pace(completed?.min_speed)]},
  {label:'Heart rate',unit:'bpm',values:[number(completed?.min_hr),number(completed?.average_hr),number(completed?.max_hr)]},
  {label:'Cadence',unit:/run/i.test(workout.sport)?'spm':swim?'strokes/min':'rpm',values:[number(completed?.min_cadence),number(completed?.average_cadence),number(completed?.max_cadence)]}
 ].filter(row=>row.values.some(Boolean))
 const green=completed?'bg-emerald-500/10':''
 const heading=(label:string,unit:string)=><div className="flex flex-col items-start justify-center gap-0.5 whitespace-nowrap"><span className="text-xs font-medium">{label}</span>{unit&&<span className="text-[10px] text-muted-foreground">{unit}</span>}</div>
 return <section aria-label="Planned and completed" className="mx-auto w-full space-y-3 md:max-w-[440px]">
  {!!visible.length&&<div className="overflow-hidden rounded-xl border"><table className="w-full table-fixed text-xs">
   <colgroup><col className="w-[36%]"/><col className="w-[32%]"/><col className="w-[32%]"/></colgroup>
   <thead className="bg-muted/30"><tr><th className="px-3 py-3"/><th className="py-3 font-semibold">Planned</th><th className="py-3 font-semibold">Completed</th></tr></thead>
   <tbody>{visible.map(row=><tr key={row.label} className={green+' border-t border-border/50'}><th className="px-3 py-2 text-left font-normal">{heading(row.label,row.unit)}</th><td className="whitespace-nowrap px-1 py-2 text-center text-sm font-medium tabular-nums">{row.value(planned)}</td><td className="whitespace-nowrap px-1 py-2 text-center text-sm font-medium tabular-nums">{row.value(completed)}</td></tr>)}</tbody>
  </table></div>}
  {!!recordedRows.length&&<div className="overflow-hidden rounded-xl border"><table className="w-full table-fixed text-xs">
   <colgroup><col className="w-[36%]"/><col/><col/><col/></colgroup>
   <thead className="bg-muted/30"><tr><th className="px-3 py-3 text-left font-normal text-muted-foreground">Recorded</th>{['Min','Avg','Max'].map(label=><th key={label} className="py-3 font-medium">{label}</th>)}</tr></thead>
   <tbody>{recordedRows.map(row=><tr key={row.label} className={green+' border-t border-border/50'}><th className="px-3 py-2 text-left font-normal">{heading(row.label,row.unit)}</th>{row.values.map((v,i)=><td key={i} className="whitespace-nowrap px-1 py-2 text-center text-sm font-medium tabular-nums">{v}</td>)}</tr>)}</tbody>
  </table></div>}
  {loading&&<p role="status" className="text-xs text-muted-foreground">Refreshing completed values…</p>}
  {error&&<div role="status" className="flex items-center justify-between gap-2 text-xs text-muted-foreground">{error}<Button size="sm" variant="ghost" onClick={()=>setRetry(v=>v+1)}>Retry</Button></div>}
 </section>
}
