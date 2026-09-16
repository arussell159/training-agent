import {Bike,Footprints,Waves} from 'lucide-react'

export type AthleteZones={
  bike_ftp?:number|null
  run_threshold_pace?:string|null
  swim_css?:string|null
  threshold_hr?:number|null
}

export type ZoneHistoryEntry=AthleteZones&{recorded_at:string}

const colors=['bg-sky-300','bg-emerald-400','bg-amber-400','bg-orange-500','bg-rose-500']

function paceParts(value:string|null|undefined){
 const match=String(value || '').match(/(\d+):(\d{2})/)
 if(!match)return null
 const seconds=Number(match[1])*60+Number(match[2])
 const lower=String(value).toLowerCase()
 const unit=lower.includes('100')?(lower.includes('yd')?'/100 yd':'/100 m'):lower.includes('/mi')?'/mi':'/km'
 return seconds>0?{seconds,unit}:null
}

function clock(seconds:number,unit:string){
 const rounded=Math.max(1,Math.round(seconds))
 return `${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,'0')} ${unit}`
}

function rawClock(seconds:number,unit:string){
 const rounded=Math.max(1,Math.round(seconds))
 return `${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,'0')} min${unit}`
}

export function displayRunThreshold(value:string|null|undefined){
 const parsed=paceParts(value)
 if(!parsed)return value || null
 const seconds=parsed.unit==='/km'?parsed.seconds*1.609344:parsed.seconds
 return rawClock(seconds,'/mi')
}

export function displaySwimCss(value:string|null|undefined){
 const parsed=paceParts(value)
 if(!parsed)return value || null
 const seconds=parsed.unit==='/100 m'?parsed.seconds*.9144:parsed.seconds
 return rawClock(seconds,'/100 yd')
}

function paceZones(value:string){
 const parsed=paceParts(value)
 if(!parsed)return []
 const p=(fraction:number)=>clock(parsed.seconds/fraction,parsed.unit)
 return [
  {name:'Easy',range:`Slower than ${p(.8)}`},
  {name:'Aerobic',range:`${p(.89)} – ${p(.8)}`},
  {name:'Tempo',range:`${p(.95)} – ${p(.9)}`},
  {name:'Threshold',range:`${p(1)} – ${p(.95)}`},
  {name:'Fast',range:`Faster than ${clock(parsed.seconds,parsed.unit)}`},
 ]
}

function powerZones(ftp:number){
 const watts=(fraction:number)=>Math.round(ftp*fraction)
 return [
  {name:'Recovery',range:`Up to ${watts(.55)} W`},
  {name:'Endurance',range:`${watts(.55)+1}–${watts(.75)} W`},
  {name:'Tempo',range:`${watts(.75)+1}–${watts(.9)} W`},
  {name:'Threshold',range:`${watts(.9)+1}–${watts(1.05)} W`},
  {name:'Above threshold',range:`Over ${watts(1.05)} W`},
 ]
}

export function TrainingZonesDisplay({sport,zones}:{sport:string;zones?:AthleteZones|null}){
 const bike=/bike|ride/i.test(sport),swim=/swim/i.test(sport)
 const paceValue=swim?displaySwimCss(zones?.swim_css):displayRunThreshold(zones?.run_threshold_pace)
 const threshold=bike?(zones?.bike_ftp?`${zones.bike_ftp} W FTP`:null):paceValue?`${paceValue} ${swim?'CSS':'threshold'}`:null
 const rows=bike&&zones?.bike_ftp?powerZones(zones.bike_ftp):paceValue?paceZones(paceValue):[]
 if(!threshold||!rows.length)return <p className="py-5 text-sm text-muted-foreground">No threshold is available for this sport.</p>
 return <div className="space-y-3 py-2">
  <div className="flex items-center gap-2">
   {bike?<Bike className="size-4"/>:swim?<Waves className="size-4"/>:<Footprints className="size-4"/>}
   <div><p className="text-sm font-bold">{threshold}</p><p className="text-[11px] text-muted-foreground">Ranges relative to your saved threshold</p></div>
  </div>
  <div className="overflow-hidden rounded-lg border">
   {rows.map((row,index)=><div key={row.name} className="grid grid-cols-[5px_2.25rem_1fr_auto] items-center gap-2 border-b pr-3 text-xs last:border-b-0">
    <span className={`h-full min-h-11 ${colors[index]}`}/><span className="font-bold">Z{index+1}</span><span className="font-medium">{row.name}</span><span className="text-right tabular-nums text-muted-foreground">{row.range}</span>
   </div>)}
  </div>
 </div>
}

function compactDate(value:string){
 const date=new Date(value)
 return Number.isNaN(date.getTime())?value:date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
}

export function ThresholdHistory({history}:{history?:ZoneHistoryEntry[]}){
 const rows=[...(history || [])].filter(row=>row.recorded_at).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at))
 return <section className="space-y-3">
  <div><h3 className="text-sm font-semibold">Threshold history</h3><p className="text-xs text-muted-foreground">Saved when synced threshold values change.</p></div>
  {rows.length?<div className="overflow-hidden rounded-lg border">
   {rows.map((row,index)=><div key={`${row.recorded_at}-${index}`} className="border-b px-3 py-3 last:border-b-0">
    <p className="mb-2 text-[11px] font-medium text-muted-foreground">{compactDate(row.recorded_at)}</p>
    <div className="grid grid-cols-3 gap-2 text-xs">
     <div><span className="block text-muted-foreground">FTP</span><strong>{row.bike_ftp?`${row.bike_ftp} W`:'—'}</strong></div>
     <div><span className="block text-muted-foreground">Run</span><strong>{displayRunThreshold(row.run_threshold_pace) || '—'}</strong></div>
     <div><span className="block text-muted-foreground">CSS</span><strong>{displaySwimCss(row.swim_css) || '—'}</strong></div>
    </div>
   </div>)}
  </div>:<p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">No earlier threshold changes have been recorded yet.</p>}
 </section>
}
