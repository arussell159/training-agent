import { HeartPulse, Plus } from 'lucide-react'
import {useEffect,useState} from 'react'
import {apiFetch} from '@/lib/api-client'
import {Button} from '@/components/ui/button'
import {DndContext,PointerSensor,TouchSensor,useSensor,useSensors,closestCenter} from '@dnd-kit/core'
import {SortableContext,useSortable,rectSortingStrategy} from '@dnd-kit/sortable'
import {CSS} from '@dnd-kit/utilities'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts'
import {Tooltip,TooltipTrigger,TooltipContent,TooltipProvider} from '@/components/ui/tooltip'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

type Row = {date?:string; id?:string; timeStamp?:string; [key:string]:unknown}
type Metric = {label:string; value:string; numeric?:number; unit:string; source:string}

function metrics(row?:Row):Metric[] {
  if (!row) return []
  const result:Metric[] = []
  const details = Array.isArray(row.details) ? row.details as Array<{label:string; value:unknown; uploadClient?:string}> : []
  for (const d of details) {
    if (d.value == null) continue
    const hours = /sleep|awake/i.test(d.label) && !/score/i.test(d.label)
    const label = d.label === 'Pulse' ? 'Resting Heart Rate' : d.label === 'Time Awake' ? 'Total Time Awake' : d.label
    const numeric = typeof d.value === 'number' ? d.value : undefined
    const array = Array.isArray(d.value) ? d.value : null
    const value = numeric != null ? numeric.toFixed(hours ? 2 : Number.isInteger(numeric) ? 0 : 1)
      : array && /body battery/i.test(label) ? `Low ${array[0] ?? '—'} · High ${array[1] ?? '—'}`
      : array && /stress/i.test(label) ? `Avg. ${array[2] ?? '—'}` : String(d.value)
    result.push({label,value,numeric,unit:hours ? 'hrs' : /heart rate/i.test(label) ? 'bpm' : '',source:d.uploadClient || 'TrainingPeaks archive'})
  }
  const fields = [
    ['sleepSecs','Sleep Hours','hrs',3600],['restingHR','Resting Heart Rate','bpm',1],
    ['hrv','HRV','',1],['weight','Weight','kg',1],['spO2','Blood Oxygen','%',1],
    ['sleepScore','Sleep Score','',1],['stress','Stress Level','',1],['soreness','Soreness','',1],
    ['fatigue','Fatigue','',1],['motivation','Motivation','',1],
  ] as const
  for (const [key,label,unit,divisor] of fields) {
    const raw = row[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    const numeric = raw / divisor
    const metric = {label,unit,numeric,value:numeric.toFixed(divisor === 3600 ? 2 : Number.isInteger(numeric) ? 0 : 1),source:'Intervals.icu'}
    const index = result.findIndex(m => m.label === label)
    if (index >= 0) result[index] = metric
    else result.push(metric)
  }
  return result
}

export function DailyMetricsCard({date,rows,onOpen}:{date:string; rows:Row[]; onOpen:()=>void}) {
  const values = metrics(rows.find(r => r.date === date))
  const sleep = values.find(m => m.label === 'Sleep Hours')
  const hrv = values.find(m => m.label === 'HRV')
  if (!values.length) return null
  return <Card role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => {if(e.key === 'Enter' || e.key === ' ') {e.preventDefault();onOpen()}}}
    aria-label={`Metrics for ${date}`} className="cursor-pointer gap-1.5 rounded-md border-slate-200 bg-slate-50/70 px-2.5 py-2.5 shadow-none hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:bg-slate-800">
    <span className="flex items-center justify-between text-[11px] font-medium"><span className="flex items-center gap-1.5"><HeartPulse className="size-3.5 text-slate-500" />Metrics</span><Plus className="size-3.5 text-muted-foreground" aria-hidden="true" /></span>
    <span className="grid grid-cols-2 gap-2">
      <span className="min-w-0"><span className="block text-[10px] text-muted-foreground">Sleep time</span><span className="block text-xs font-medium">{sleep ? `${sleep.value} hrs` : '—'}</span></span>
      <span className="min-w-0"><span className="block text-[10px] text-muted-foreground">Overnight HRV</span><span className="block text-xs font-medium">{hrv ? `${hrv.value} ms` : '—'}</span></span>
    </span>
  </Card>
}

export function DailyMetricsDialog({date,rows,onClose}:{date:string|null; rows:Row[]; onClose:()=>void}) {
  if (!date) return null
  return <MetricsEditor key={date} date={date} rows={rows} onClose={onClose} />
}

function MetricsEditor({date,rows,onClose}:{date:string;rows:Row[];onClose:()=>void}) {
  const [layout,setLayout] = useState<{graphs:string[];cards:string[]}>({graphs:['HRV','Resting Heart Rate','Sleep Hours'],cards:[]})
  const [dirty,setDirty] = useState(false)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  const [loaded,setLoaded] = useState(false)
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}),useSensor(TouchSensor,{activationConstraint:{delay:250,tolerance:5}}))
  useEffect(()=>{let active=true; void apiFetch('/api/config').then(async r=>{if(!r.ok) throw new Error('Could not load saved layout');return r.json()}).then(c=>{if(!active)return;if(c.settingsError) throw new Error(c.settingsError);if(c.metricsLayout)setLayout(c.metricsLayout);setLoaded(true)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[])
  const values = metrics(rows.find(r => r.date === date))
  const ordered = [...values].sort((a,b)=>{const ai=layout.cards.indexOf(a.label),bi=layout.cards.indexOf(b.label);return (ai<0?999:ai)-(bi<0?999:bi)})
  const choices = [...new Set([...rows.flatMap(r=>metrics(r).filter(m=>m.numeric != null).map(m=>m.label)),...layout.graphs])]
  function move(label:string,target:string) {
    if(!loaded || label===target)return
    const order=[...new Set([...layout.cards,...ordered.map(m=>m.label)])]
    const from=order.indexOf(label),to=order.indexOf(target)
    if(from<0||to<0)return
    order.splice(from,1);order.splice(to,0,label)
    setLayout({...layout,cards:order});setDirty(true)
  }
  async function save() {
    setSaving(true);setError('')
    try {const r=await apiFetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({METRICS_LAYOUT:JSON.stringify(layout)})});const c=await r.json();if(!r.ok||c.settingsError)throw new Error(c.error||c.settingsError||'Save failed');setDirty(false)}catch(e){setError(e instanceof Error?e.message:'Save failed')}finally{setSaving(false)}
  }
  const first = new Date(`${date}T12:00:00`); first.setDate(first.getDate()-29)
  const start = `${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,'0')}-${String(first.getDate()).padStart(2,'0')}`
  const history = rows.filter(r => r.date && r.date >= start && r.date <= date).sort((a,b)=>String(a.date).localeCompare(String(b.date)))
  return <Dialog open onOpenChange={open => {if(!open && !saving && (!dirty || window.confirm('Discard unsaved layout changes?')))onClose()}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
    <DialogHeader><DialogTitle className="flex items-center gap-2"><HeartPulse className="size-5" />Daily metrics</DialogTitle>
      <DialogDescription>{new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</DialogDescription></DialogHeader>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!values.length ? <p className="py-8 text-center text-sm text-muted-foreground">No metrics recorded for this day. Missing values are not treated as zero.</p> : <>
      <div className="grid gap-3 md:grid-cols-3">{layout.graphs.map((label,graphIndex) => {
        const data = history.map((r,index) => {
          const numeric = metrics(r).find(m=>m.label === label)?.numeric
          const preceding = history.slice(Math.max(0,index-6),index+1).map(x=>metrics(x).find(m=>m.label === label)?.numeric).filter((v):v is number=>v != null)
          return {date:r.date,value:numeric ?? null,average:preceding.length ? preceding.reduce((a,b)=>a+b,0)/preceding.length : null}
        })
        return <Card key={graphIndex} className="gap-3 p-3"><select aria-label={`Graph ${graphIndex+1}`} disabled={!loaded || saving} value={label} className="w-full bg-transparent text-sm font-medium" onChange={e=>{const graphs=[...layout.graphs];graphs[graphIndex]=e.target.value;setLayout({...layout,graphs});setDirty(true)}}>{choices.map(choice=><option key={choice} value={choice}>{choice}</option>)}</select>{data.some(d=>d.value != null) ? <>
          <div className="h-36"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{left:-24,right:8}}><XAxis dataKey="date" tickFormatter={v=>String(v).slice(5)} fontSize={10} minTickGap={40}/><YAxis fontSize={10}/><ChartTooltip content={({active,payload,label:dateLabel})=>active && payload?.length ? <GraphHoverTooltip date={String(dateLabel)} entries={payload.map(item=>({name:String(item.name),value:typeof item.value==='number'?Math.round(item.value):String(item.value??'—'),color:item.color}))} /> : null}/><Bar dataKey="value" name={label} fill="#94a3b8"/><Line dataKey="average" name="Average" stroke="#0ea5e9" strokeWidth={2} dot={false} connectNulls={false}/></ComposedChart></ResponsiveContainer></div>
          </> : <p className="text-xs text-muted-foreground">No trend data</p>}</Card>
      })}</div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({active,over})=>{if(over)move(String(active.id),String(over.id))}}><SortableContext items={ordered.map(m=>m.label)} strategy={rectSortingStrategy}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{ordered.map((m,index)=><MetricTile key={m.label} metric={m} disabled={!loaded||saving} onMove={direction=>{const target=ordered[index+direction];if(target)move(m.label,target.label)}} />)}</div>
      </SortableContext></DndContext>
    </>}
    {dirty && <div className="sticky bottom-0 flex justify-end border-t bg-background py-3"><Button onClick={()=>void save()} disabled={saving}>{saving?'Saving…':'Save layout'}</Button></div>}
  </DialogContent></Dialog>
}

function MetricTile({metric:m,disabled,onMove}:{metric:Metric;disabled:boolean;onMove:(direction:number)=>void}) {
  const {setNodeRef,attributes,listeners,transform,transition,isDragging}=useSortable({id:m.label,disabled})
  return <Card ref={setNodeRef} {...attributes} {...listeners} aria-label={m.label} onKeyDown={e=>{if(e.altKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();onMove(e.key==='ArrowLeft'?-1:1)}}} style={{transform:CSS.Transform.toString(transform),transition}} className={`gap-2 p-4 ${isDragging?'relative z-10 opacity-60':''}`}><h3 className="text-sm font-medium">{m.label}</h3><p className="text-2xl font-semibold tracking-tight">{m.value} <span className="text-xs font-normal text-muted-foreground">{m.unit}</span></p></Card>
}

function GraphHoverTooltip({date,entries}:{date:string;entries:Array<{name:string;value:number|string;color?:string}>}) {
  return <TooltipProvider><Tooltip open><TooltipTrigger render={<span className="block size-px" aria-hidden="true" />} /><TooltipContent className="border border-slate-200 bg-white px-3 py-2 text-slate-950 shadow-md" arrowClassName="bg-white fill-white"><div className="min-w-32 space-y-1.5"><p className="text-[11px] text-slate-500">{date}</p>{entries.map(entry=><div key={entry.name} className="flex items-center gap-2 text-xs"><span className="size-2 rounded-full" style={{backgroundColor:entry.color}} /><span className="flex-1">{entry.name}</span><span className="font-semibold tabular-nums">{entry.value}</span></div>)}</div></TooltipContent></Tooltip></TooltipProvider>
}
