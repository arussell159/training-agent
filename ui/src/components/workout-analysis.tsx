import { METERS_PER_100_YARDS, recordedSwimYards } from "../../../app-backend/lib/swim-units.mjs"
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import { RotateCcw, Sun } from "lucide-react"

import { DesktopWorkoutRouteMap } from "@/components/desktop-workout-route-map"
import { MobileWorkoutSignals } from "@/components/mobile-workout-signals"
import { WorkoutMapSplits } from "@/components/workout-map-splits"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { apiFetch } from "@/lib/api-client"
import { distanceSplits } from "@/lib/distance-splits"
import { segmentStatistics, type RecordedPoint } from "@/lib/segment-statistics"
import type { PlannedWorkout, WorkoutSummaryValues } from "@/lib/training-context"

type Point = RecordedPoint
type Lap = { id:string; label:string; start:number; end:number; power:number|null; heartRate:number|null; distance:number|null; kind:string; speed?:number|null }
export type DfaStatistics = { average:number|null; minimum:number|null; maximum:number|null; averageArtifacts:number|null; artifactCoveragePercent:number|null; validPercent:number|null; validSeconds:number }
type Analysis = { dfa?:DfaStatistics|null; version?:number; points:Point[]; laps:Lap[]; intervals:Lap[]; duration:number }
type Segment = { id:string; label:string; start:number; end:number; kind:"lap"|"split"|"climb"|"descent"|"effort"; distance?:number|null; color?:string }
type RangeStats = ReturnType<typeof rangeStatistics>
type PeakEffort = Segment & { seconds:number; watts:number; stats:RangeStats }

const cache = new Map<string,Analysis>()
const effortDurations = [5,10,30,60,120,300,600,1200,1800,3600,10800]
const finite = (value:unknown): value is number => typeof value === "number" && Number.isFinite(value)
const clock = (seconds:number) => {
  const value=Math.max(0,Math.round(seconds)),hours=Math.floor(value/3600),minutes=Math.floor((value%3600)/60),remainder=value%60
  return hours?`${hours}:${String(minutes).padStart(2,"0")}:${String(remainder).padStart(2,"0")}`:`${minutes}:${String(remainder).padStart(2,"0")}`
}
const effortLabel=(seconds:number)=>seconds<60?`${seconds} secs`:seconds<3600?`${seconds/60} min${seconds===60?"":"s"}`:`${seconds/3600} hour${seconds===3600?"":"s"}`
const pace=(seconds:number)=>seconds>0&&Number.isFinite(seconds)?clock(seconds):"—"

function rangeStatistics(points:Point[],start:number,end:number){
  const averages=segmentStatistics(points,start,end)
  const selected=points.filter(point=>point.time>=start&&point.time<=end)
  const values=(key:keyof Point)=>selected.map(point=>point[key]).filter(finite)
  const firstDistance=selected.find(point=>finite(point.distance))?.distance
  const lastDistance=selected.findLast(point=>finite(point.distance))?.distance
  const elevations=values("elevation")
  let gain=0,loss=0,work=0
  for(let index=0;index<selected.length-1;index+=1){
    const point=selected[index],next=selected[index+1],elapsed=Math.max(0,Math.min(10,next.time-point.time))
    if(finite(point.power))work+=point.power*elapsed
    if(finite(point.elevation)&&finite(next.elevation)){const change=next.elevation-point.elevation;if(change>0)gain+=change;else loss-=change}
  }
  const maximum=(key:keyof Point)=>{const entries=values(key);return entries.length?Math.max(...entries):null}
  const minimum=(key:keyof Point)=>{const entries=values(key);return entries.length?Math.min(...entries):null}
  const distance=finite(firstDistance)&&finite(lastDistance)?Math.max(0,lastDistance-firstDistance):null
  const elevationChange=elevations.length?elevations.at(-1)!-elevations[0]:null
  return {...averages,start,end,distance,maxPower:maximum("power"),minHeartRate:minimum("heartRate"),maxHeartRate:maximum("heartRate"),maxSpeed:maximum("speed"),maxCadence:maximum("cadence"),elevationAverage:elevations.length?elevations.reduce((sum,value)=>sum+value,0)/elevations.length:null,elevationGain:gain,elevationLoss:loss,elevationChange,grade:distance&&elevationChange!=null?elevationChange/distance*100:null,workKj:work/1000}
}

function powerIntegral(points:Point[]){
  const energy=new Array(points.length).fill(0),coverage=new Array(points.length).fill(0)
  for(let index=1;index<points.length;index+=1){const elapsed=Math.max(0,points[index].time-points[index-1].time),usable=elapsed<=10&&finite(points[index-1].power);energy[index]=energy[index-1]+(usable?points[index-1].power!*elapsed:0);coverage[index]=coverage[index-1]+(usable?elapsed:0)}
  const at=(time:number,values:number[],metric:"power"|"coverage")=>{let low=0,high=points.length-1;while(low<high){const middle=Math.ceil((low+high)/2);if(points[middle].time<=time)low=middle;else high=middle-1}const point=points[low],elapsed=Math.max(0,Math.min(10,time-point.time));if(!finite(point.power))return values[low];return values[low]+(metric==="power"?point.power*elapsed:elapsed)}
  return {energy,coverage,at}
}

function peakPowerEfforts(points:Point[],duration:number):PeakEffort[]{
  if(points.length<2||!points.some(point=>finite(point.power)))return []
  const integral=powerIntegral(points)
  return effortDurations.flatMap(seconds=>{
    if(seconds>duration)return []
    let best:{start:number;watts:number}|null=null
    for(const point of points){const start=point.time,end=start+seconds;if(end>duration)break;const energy=integral.at(end,integral.energy,"power")-integral.at(start,integral.energy,"power"),coverage=integral.at(end,integral.coverage,"coverage")-integral.at(start,integral.coverage,"coverage");if(coverage<seconds*.9)continue;const watts=energy/coverage;if(!best||watts>best.watts)best={start,watts}}
    if(!best)return []
    const end=best.start+seconds
    return [{id:`effort-${seconds}`,label:effortLabel(seconds),start:best.start,end,seconds,watts:best.watts,kind:"effort" as const,color:"#a21caf",stats:rangeStatistics(points,best.start,end)}]
  })
}

function elevationSegments(points:Point[]):Segment[]{
  const source=points.filter(point=>finite(point.elevation)&&finite(point.distance))
  if(source.length<8)return []
  const reduced=source.filter((point,index)=>index===0||index===source.length-1||point.time-source[Math.max(0,index-1)].time>=5||index%5===0)
  const smooth=reduced.map((point,index)=>{const nearby=reduced.slice(Math.max(0,index-2),index+3).map(entry=>entry.elevation!);return {...point,smoothed:nearby.reduce((sum,value)=>sum+value,0)/nearby.length}})
  const candidates:Array<{start:number;end:number;direction:1|-1}>=[]
  let anchor=0,extreme=0,direction:0|1|-1=0
  for(let index=1;index<smooth.length;index+=1){
    const change=smooth[index].smoothed-smooth[anchor].smoothed
    if(!direction&&Math.abs(change)>=5){direction=change>0?1:-1;extreme=index;continue}
    if(direction===1){if(smooth[index].smoothed>=smooth[extreme].smoothed)extreme=index;else if(smooth[extreme].smoothed-smooth[index].smoothed>=5){candidates.push({start:anchor,end:extreme,direction});anchor=extreme;extreme=index;direction=0}}
    else if(direction===-1){if(smooth[index].smoothed<=smooth[extreme].smoothed)extreme=index;else if(smooth[index].smoothed-smooth[extreme].smoothed>=5){candidates.push({start:anchor,end:extreme,direction});anchor=extreme;extreme=index;direction=0}}
  }
  if(direction)candidates.push({start:anchor,end:extreme,direction})
  let climbs=0,descents=0
  return candidates.flatMap(candidate=>{const start=smooth[candidate.start],end=smooth[candidate.end],elapsed=end.time-start.time,distance=end.distance!-start.distance!,elevation=end.smoothed-start.smoothed,grade=distance>0?elevation/distance*100:0;if(elapsed<45||distance<200||Math.abs(elevation)<10||Math.abs(grade)<.8)return [];const climb=candidate.direction===1;if(climb)climbs+=1;else descents+=1;return [{id:`${climb?"climb":"descent"}-${climb?climbs:descents}`,label:`${climb?"Climb":"Descent"} ${climb?climbs:descents}`,start:start.time,end:end.time,distance,kind:climb?"climb" as const:"descent" as const,color:climb?"#ea580c":"#0284c7"}]})
}

function TimelineRow({label,segments,duration,selected,onSelect,onHover}:{label:string;segments:Segment[];duration:number;selected:string;onSelect:(segment:Segment)=>void;onHover:(segment:Segment|null)=>void}){
  if(!segments.length)return null
  return <div className="grid grid-cols-[12.6%_75.2%_12.2%] items-center"><span className="pr-3 text-right text-[11px] text-muted-foreground">{label}</span><div className="relative h-5 overflow-hidden rounded-sm bg-muted/40">{segments.map(segment=><button key={segment.id} type="button" aria-label={`Show ${segment.label}`} aria-pressed={selected===segment.id} title={`${segment.label} · ${clock(segment.start)}–${clock(segment.end)}`} className={`absolute inset-y-0.5 min-w-1 rounded-[2px] border border-background/80 transition hover:brightness-90 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring ${selected===segment.id?"z-10 ring-2 ring-foreground/50 ring-inset":""}`} style={{left:`${segment.start/duration*100}%`,width:`${Math.max(.35,(segment.end-segment.start)/duration*100)}%`,backgroundColor:segment.color||"#cbd5e1"}} onMouseEnter={()=>onHover(segment)} onMouseLeave={()=>onHover(null)} onFocus={()=>onHover(segment)} onBlur={()=>onHover(null)} onClick={()=>onSelect(segment)}/>)}</div><span aria-hidden="true"/></div>
}

function DistanceAxis({labels}:{labels:string[]}){
  return <div className="grid h-5 grid-cols-[12.6%_75.2%_12.2%] items-start"><span aria-hidden="true"/><div className="flex justify-between pt-0.5 text-[10px] font-normal leading-none tabular-nums text-muted-foreground">{labels.map((label,index)=><span key={`${label}-${index}`}>{label}</span>)}</div><span aria-hidden="true"/></div>
}

function SummaryGroup({title,values}:{title:string;values:Array<[string,string|null]>}){
  const visible=values.filter((entry):entry is [string,string]=>Boolean(entry[1]))
  if(!visible.length)return null
  return <div className="min-w-0 px-4 py-3"><h3 className="text-xs font-semibold">{title}</h3><dl className="mt-1.5 space-y-1 text-[11px]">{visible.map(([label,value])=><div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>)}</dl></div>
}

export function WorkoutAnalysis({workout,onLapSelection}:{workout:PlannedWorkout;onLapSelection?:(range:[number,number]|null)=>void}){
  const id=workout.activity_id||(workout.id.startsWith("activity:")?workout.id.slice(9):null),revision=(workout as PlannedWorkout&{activity_revision?:string}).activity_revision||""
  return id?<ActivityGraph key={id+revision} id={id} revision={revision} workout={workout} summary={workout.workout_summary?.completed} onLapSelection={onLapSelection}/>:null
}

function ActivityGraph({id,revision,workout,summary,onLapSelection}:{id:string;revision:string;workout:PlannedWorkout;summary?:WorkoutSummaryValues|null;onLapSelection?:(range:[number,number]|null)=>void}){
  const sport=workout.sport,cacheKey=id+revision
  const [data,setData]=useState<Analysis|null>(cache.get(cacheKey)||null),[error,setError]=useState(""),[retry,setRetry]=useState(0),[totals,setTotals]=useState<WorkoutSummaryValues|null>(summary||null)
  const [range,setRange]=useState<[number,number]|null>(null),[cursor,setCursor]=useState<number|null>(null),[selection,setSelection]=useState<[number,number]|null>(null),[selected,setSelected]=useState(""),[hovered,setHovered]=useState<Segment|null>(null),[openEffort,setOpenEffort]=useState("")
  const gesture=useRef<{x:number;time:number;range:[number,number];overview:boolean;pan:boolean}|null>(null),effortCloseTimer=useRef<ReturnType<typeof setTimeout>|null>(null),suppressedEffort=useRef("")
  useEffect(()=>{const controller=new AbortController();void apiFetch(`/api/activities/${encodeURIComponent(id)}/summary?v=${encodeURIComponent(revision)}&schema=2`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();return await response.json() as WorkoutSummaryValues}).then(values=>{if(!controller.signal.aborted)setTotals({...summary,...values})}).catch(()=>{});return()=>controller.abort()},[id,revision,summary])
  useEffect(()=>{if(cache.has(cacheKey)){setData(cache.get(cacheKey)!);return}const controller=new AbortController();setError("");void apiFetch(`/api/activities/${encodeURIComponent(id)}/analysis?schema=7&v=${encodeURIComponent(revision)}`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error("The recording could not be loaded.");return await response.json() as Analysis}).then(value=>{cache.set(cacheKey,value);if(cache.size>20)cache.delete(cache.keys().next().value!);if(!controller.signal.aborted)setData(value)}).catch(reason=>{if(reason.name!=="AbortError")setError(reason.message)});return()=>controller.abort()},[id,retry,revision,cacheKey])
  const duration=data?.duration||1,view:[number,number]=range||[0,duration],swim=sport.toLowerCase().includes("swim"),run=sport.toLowerCase().includes("run"),bike=/bike|ride|cycl/i.test(sport)
  const available=useMemo(()=>({elevation:Boolean(data?.points.some(point=>point.elevation!=null)),power:Boolean(data?.points.some(point=>point.power!=null)),speed:Boolean(data?.points.some(point=>point.speed!=null)),heartRate:Boolean(data?.points.some(point=>point.heartRate!=null)),cadence:Boolean(data?.points.some(point=>point.cadence!=null))}),[data])
  const paceDistance=swim?METERS_PER_100_YARDS:1609.344
  const signalTracks=[...(available.speed?[run||swim?"pace":"speed"]:[]),...(available.power?["power"]:[]),...(available.heartRate?["heartRate"]:[]),...(available.cadence?["cadence"]:[])]
  const colors:Record<string,string>={pace:"#0284c7",speed:"#0284c7",power:"#6d28d9",heartRate:"#dc2626",cadence:"#c026d3"}
  const value=(point:Point,key:string)=>key==="elevation"?(point.elevation==null?null:point.elevation*3.280839895):key==="pace"?(point.speed!=null&&point.speed>.15?paceDistance/point.speed:null):key==="speed"?(point.speed==null?null:point.speed*2.2369362920544):key==="power"?point.power:key==="cadence"?(point.cadence??null):point.heartRate
  const unit=(key:string)=>key==="elevation"?"ft":key==="power"?"W":key==="heartRate"?"bpm":key==="cadence"?(run?"spm":swim?"strokes/min":"rpm"):key==="pace"?(swim?"/100 yd":"/mi"):"mph"
  const label=(key:string)=>key==="heartRate"?"Heart rate":key[0].toUpperCase()+key.slice(1)
  const format=(entry:number|null|undefined,key:string)=>entry==null?"—":key==="pace"?pace(entry):String(Math.round(entry))
  const viewStart=view[0],viewEnd=view[1]
  const visible=useMemo(()=>data?.points.filter(point=>point.time>=viewStart&&point.time<=viewEnd)||[],[data,viewStart,viewEnd])
  const nearest=cursor==null?null:visible.reduce<Point|null>((best,point)=>!best||Math.abs(point.time-cursor)<Math.abs(best.time-cursor)?point:best,null)
  const activeStats=useMemo(()=>rangeStatistics(data?.points||[],viewStart,viewEnd),[data,viewStart,viewEnd]),wholeStats=useMemo(()=>rangeStatistics(data?.points||[],0,duration),[data,duration])
  const peaks=useMemo(()=>peakPowerEfforts(data?.points||[],duration),[data,duration]),terrain=useMemo(()=>elevationSegments(data?.points||[]),[data])
  const splitDistance=bike?8046.72:1609.344
  const splits=useMemo<Segment[]>(()=>swim?[]:distanceSplits(data?.points||[],splitDistance).map(split=>({id:`split-${split.number}`,label:bike?`${split.number*5} mi`:`${split.number} mi`,start:split.start,end:split.end,distance:split.distance,kind:"split",color:"#cbd5e1"})),[bike,data,splitDistance,swim])
  const laps:Segment[]=(data?.laps||[]).map(lap=>({...lap,kind:"lap",color:"#94a3b8"}))
  const routePoints=useMemo(()=>(data?.points||[]).flatMap(point=>point.latitude!=null&&point.longitude!=null?[{time:point.time,latitude:point.latitude,longitude:point.longitude}]:[]),[data])
  const selectedSegment=[...laps,...splits,...terrain,...peaks].find(segment=>segment.id===selected)
  const highlight=hovered||selectedSegment||(range?{start:range[0],end:range[1]}:null)
  useEffect(()=>onLapSelection?.(range),[range,onLapSelection])
  const selectSegment=(segment:Segment)=>{const start=Math.max(0,segment.start),end=Math.min(duration,segment.end);if(end<=start)return;setRange([start,end]);setSelected(segment.id);setSelection(null);setCursor(null)}
  const reset=()=>{setRange(null);setSelected("");setHovered(null);setSelection(null);setCursor(null);setOpenEffort("")}
  const showEffort=(id:string)=>{if(suppressedEffort.current===id)return;if(effortCloseTimer.current)clearTimeout(effortCloseTimer.current);effortCloseTimer.current=null;setOpenEffort(id)}
  const scheduleEffortClose=()=>{if(effortCloseTimer.current)clearTimeout(effortCloseTimer.current);effortCloseTimer.current=setTimeout(()=>{suppressedEffort.current="";setOpenEffort("")},140)}
  const plotLeft=136,plotWidth=812,plotRight=plotLeft+plotWidth
  const x=(time:number,overview=false)=>plotLeft+(time-(overview?0:view[0]))/(overview?duration:Math.max(1,view[1]-view[0]))*plotWidth
  const timeAt=(event:PointerEvent<SVGSVGElement>,overview=false)=>{const bounds=event.currentTarget.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,((event.clientX-bounds.left)/bounds.width*1080-plotLeft)/plotWidth));return (overview?0:view[0])+fraction*(overview?duration:view[1]-view[0])}
  const move=(event:PointerEvent<SVGSVGElement>,overview=false)=>{const time=timeAt(event,overview);setCursor(time);const active=gesture.current;if(!active)return;if(active.pan){const bounds=event.currentTarget.getBoundingClientRect(),delta=(active.overview?1:-1)*(event.clientX-active.x)/bounds.width*1080/plotWidth*(active.overview?duration:active.range[1]-active.range[0]),width=active.range[1]-active.range[0],start=Math.max(0,Math.min(duration-width,active.range[0]+delta));setRange([start,start+width])}else setSelection([active.time,time])}
  const down=(event:PointerEvent<SVGSVGElement>,overview=false)=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);const time=timeAt(event,overview),pan=overview&&Boolean(range)&&time>=view[0]&&time<=view[1];gesture.current={x:event.clientX,time,range:[view[0],view[1]],overview,pan};if(!pan)setSelection([time,time]);setSelected("")}
  const up=(event:PointerEvent<SVGSVGElement>)=>{const active=gesture.current;if(!active)return;const time=timeAt(event,active.overview);if(!active.pan&&Math.abs(event.clientX-active.x)>5&&Math.abs(time-active.time)>=2)setRange([Math.min(time,active.time),Math.max(time,active.time)]);gesture.current=null;setSelection(null);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}
  if(error)return <div className="border p-4 text-sm">{error}<Button variant="outline" size="sm" className="ml-3" onClick={()=>setRetry(value=>value+1)}>Retry</Button></div>
  if(!data)return <div role="status" className="animate-pulse border bg-muted/30 p-8 text-center text-sm text-muted-foreground">Loading recorded signals and laps…</div>
  if(!data.points.length||(!signalTracks.length&&!data.dfa))return <div className="border border-dashed p-5 text-sm text-muted-foreground">No recorded signal stream is available for this activity.</div>
  const laneHeight=70,height=signalTracks.length*laneHeight+8,activeDuration=viewEnd-viewStart,activeDistance=activeStats.distance,activeElevation=activeStats.elevationChange
  const summaryGroups:Array<{title:string;values:Array<[string,string|null]>}>=[
    {title:"Active",values:[["Time",clock(range?activeDuration:totals?.duration_seconds??activeDuration)],["Distance",activeDistance!=null?(swim?`${Math.round(recordedSwimYards(activeDistance)).toLocaleString()} yd`:`${(activeDistance/1609.344).toFixed(2)} mi`):totals?.distance_meters!=null?`${(totals.distance_meters/1609.344).toFixed(2)} mi`:null],[run||swim?"Avg pace":"Avg speed",activeStats.speed!=null&&activeStats.speed>0?(run||swim?`${pace(paceDistance/activeStats.speed)} ${unit("pace")}`:`${(activeStats.speed*2.236936).toFixed(1)} mph`):null]]},
    {title:"Power",values:[["Average",activeStats.power!=null?`${Math.round(activeStats.power)} W`:null],["Normalized",!range&&totals?.normalized_power!=null?`${Math.round(totals.normalized_power)} W`:null],["Maximum",activeStats.maxPower!=null?`${Math.round(activeStats.maxPower)} W`:null]]},
    {title:"Load & energy",values:[["Work",`${Math.round(range?activeStats.workKj:totals?.work_kj??activeStats.workKj)} kJ`],["Training load",!range&&totals?.tss!=null?`${Math.round(totals.tss)} TSS`:null],["Intensity",!range&&totals?.intensity_factor!=null?`${Math.round(totals.intensity_factor*100)}%`:null]]},
    {title:"Elevation",values:[["Gain",`${Math.round((range?activeStats.elevationGain:totals?.elevation_gain??activeStats.elevationGain)/.3048)} ft`],["Loss",`${Math.round((range?activeStats.elevationLoss:totals?.elevation_loss??activeStats.elevationLoss)/.3048)} ft`],["Net",activeElevation!=null?`${activeElevation>=0?"+":""}${Math.round(activeElevation/.3048)} ft`:null]]},
    {title:"Heart rate & cadence",values:[["Avg HR",activeStats.heartRate!=null?`${Math.round(activeStats.heartRate)} bpm`:null],["Max HR",activeStats.maxHeartRate!=null?`${Math.round(activeStats.maxHeartRate)} bpm`:null],["Avg cadence",activeStats.cadence!=null?`${Math.round(activeStats.cadence)} ${unit("cadence")}`:null]]},
  ]
  const elevationProfile=data.points.map((point,index)=>{const nearby=data.points.slice(Math.max(0,index-3),index+4).map(entry=>value(entry,"elevation")).filter(finite);return {...point,smoothedElevation:nearby.length?nearby.reduce((sum,entry)=>sum+entry,0)/nearby.length:null}})
  const elevationValues=elevationProfile.map(point=>point.smoothedElevation).filter(finite),elevationMin=Math.min(...elevationValues),elevationMax=Math.max(...elevationValues),elevationSpan=Math.max(1,elevationMax-elevationMin),elevationY=(entry:number)=>92-(entry-elevationMin)/elevationSpan*66
  let fullElevationPath="",previousElevation=false
  for(const point of elevationProfile){if(point.smoothedElevation==null){previousElevation=false;continue}fullElevationPath+=`${previousElevation?"L":"M"}${x(point.time,true).toFixed(1)},${elevationY(point.smoothedElevation).toFixed(1)} `;previousElevation=true}
  const distancePoints=data.points.filter(point=>finite(point.distance)),firstRecordedDistance=distancePoints[0]?.distance??0
  const axisLabels=(start:number,end:number)=>Array.from({length:6},(_,index)=>{
    const time=start+(end-start)*index/5,point=distancePoints.reduce<Point|null>((best,entry)=>!best||Math.abs(entry.time-time)<Math.abs(best.time-time)?entry:best,null)
    if(!point||!finite(point.distance))return "—"
    const meters=Math.max(0,point.distance-firstRecordedDistance)
    return swim?`${Math.round(recordedSwimYards(meters)).toLocaleString()} yd`:`${(meters/1609.344).toFixed(index===0?0:1)} mi`
  })
  const overviewDistanceLabels=axisLabels(0,duration),viewDistanceLabels=axisLabels(viewStart,viewEnd)
  const overviewDistance=totals?.distance_meters??wholeStats.distance,overviewSpeed=totals?.average_speed??wholeStats.speed
  const overviewPrimary=[
    {label:"Distance",value:overviewDistance!=null?(swim?`${Math.round(recordedSwimYards(overviewDistance)).toLocaleString()} yd`:`${(overviewDistance/1609.344).toFixed(2)} mi`):"—"},
    {label:"Moving time",value:clock(totals?.duration_seconds??duration)},
    {label:run||swim?"Pace":"Avg speed",value:overviewSpeed!=null&&overviewSpeed>0?(run||swim?`${pace(paceDistance/overviewSpeed)} ${unit("pace")}`:`${(overviewSpeed*2.236936).toFixed(1)} mph`):"—"},
    {label:"Training load",value:totals?.tss!=null?String(Math.round(totals.tss)):"—"},
  ]
  const overviewDetails=[
    {label:"Elevation",value:`${Math.round((totals?.elevation_gain??wholeStats.elevationGain)/.3048).toLocaleString()} ft`},
    {label:"Calories",value:totals?.calories!=null?Math.round(totals.calories).toLocaleString():null},
    {label:"Elapsed time",value:totals?.elapsed_time_seconds!=null?clock(totals.elapsed_time_seconds):null},
  ]
  const overviewConditions=[
    {label:"Temperature",value:totals?.temperature_c!=null?`${Math.round(totals.temperature_c*9/5+32)}°F`:null},
    {label:"Humidity",value:totals?.humidity_percent!=null?`${Math.round(totals.humidity_percent)}%`:null},
  ].filter((metric):metric is {label:string;value:string}=>metric.value!=null)
  const trackMetrics=signalTracks.map((key,lane)=>{const values=visible.map(point=>value(point,key)).filter((entry):entry is number=>entry!=null),rawMin=Math.min(...values),rawMax=Math.max(...values),padding=Math.max((rawMax-rawMin)*.08,key==="pace"?1:.5),min=rawMin-padding,max=rawMax+padding,span=Math.max(1,max-min),top=lane*laneHeight+4,graphBottom=top+58,average=key==="pace"?(activeStats.speed?paceDistance/activeStats.speed:null):key==="speed"?(activeStats.speed!=null?activeStats.speed*2.2369362920544:null):key==="power"?activeStats.power:key==="heartRate"?activeStats.heartRate:activeStats.cadence,peak=key==="pace"?rawMin:rawMax,live=nearest?value(nearest,key):null;return {key,rawMin,rawMax,min,max,span,top,graphBottom,average,peak,live}})
  return <>
    <div className="space-y-5 md:hidden"><MobileWorkoutSignals points={data.points} laps={data.laps} duration={duration} sport={sport} summary={totals} dfa={data.dfa} onLapSelect={lap=>setSelected(lap?.id||"")} afterLaps={<WorkoutMapSplits workout={workout} analysis={data}/>}/></div>
    <section aria-label="Recorded workout analysis" className="workout-analysis-desktop hidden min-w-0 space-y-3 md:block">
      <section className={`grid overflow-hidden rounded-xl border bg-card ${routePoints.length>1?"lg:grid-cols-2":"grid-cols-1"}`} aria-label="Workout overview">
        {routePoints.length>1&&<div className="min-w-0 border-b lg:border-r lg:border-b-0" aria-label="Activity route map"><DesktopWorkoutRouteMap workout={workout} timedPoints={routePoints} compact/></div>}
        <div className="flex min-h-[240px] min-w-0 flex-col p-4">
          <div className="grid grid-cols-4 border-b pb-3">{overviewPrimary.map(metric=><div key={metric.label} className="min-w-0 pr-3 last:pr-0"><p className="truncate text-2xl font-normal leading-none tabular-nums">{metric.value}</p><p className="mt-1 truncate text-[10px] font-normal text-muted-foreground">{metric.label}</p></div>)}</div>
          <dl className="grid grid-cols-2 gap-x-8 border-b py-2.5 text-xs">{overviewDetails.map(metric=><div key={metric.label} className="flex min-w-0 items-center justify-between gap-3 py-0.5"><dt>{metric.label}</dt><dd className="truncate font-medium tabular-nums">{metric.value??"—"}</dd></div>)}</dl>
          {overviewConditions.length>0&&<div className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-2 border-b py-2.5"><Sun className="size-7 stroke-[1.5]" aria-hidden="true"/><div><p className="text-xs">Recorded conditions</p><dl className="mt-0.5 grid grid-cols-2 gap-x-8 text-xs">{overviewConditions.map(metric=><div key={metric.label} className="flex justify-between gap-3"><dt>{metric.label}</dt><dd className="tabular-nums">{metric.value}</dd></div>)}</dl></div></div>}
          {workout.device_name&&<div className="mt-auto pt-3 text-xs">{workout.device_name}</div>}
        </div>
      </section>
      <div className={`grid min-w-0 gap-4 ${peaks.length?"grid-cols-[210px_minmax(0,1fr)]":"grid-cols-1"}`}>
        {peaks.length>0&&<aside className="sticky top-20 min-w-0 self-start rounded-xl border bg-card" aria-label="Peak power efforts"><div className="border-b px-4 py-3"><h2 className="text-sm font-medium">Peak power</h2><p className="mt-0.5 text-[10px] text-muted-foreground">Hover for details</p></div><div className="py-1">{peaks.map(effort=><Popover key={effort.id} open={openEffort===effort.id} onOpenChange={open=>open?showEffort(effort.id):setOpenEffort("")}><PopoverTrigger render={<button type="button" onMouseEnter={()=>showEffort(effort.id)} onMouseLeave={scheduleEffortClose} onFocus={()=>showEffort(effort.id)} onBlur={scheduleEffortClose} className={`flex min-h-9 w-full items-center justify-between gap-3 px-4 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected===effort.id?"bg-muted":""}`}/>}><span>{effort.label}</span><span className="tabular-nums">{Math.round(effort.watts)} W</span></PopoverTrigger><PopoverContent side="right" align="start" role="button" tabIndex={0} aria-label={`Show ${effort.label} peak power on charts`} onMouseEnter={()=>showEffort(effort.id)} onMouseLeave={scheduleEffortClose} onPointerDown={event=>{event.preventDefault();event.stopPropagation();suppressedEffort.current=effort.id;selectSegment(effort);setOpenEffort("")}} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();suppressedEffort.current=effort.id;selectSegment(effort);setOpenEffort("")}}} className="w-80 cursor-pointer gap-0 overflow-hidden p-0"><div className="bg-[#9f2b10] px-4 py-3 text-white"><p className="text-sm font-medium">Peak power: {effort.label}</p><p className="mt-0.5 text-xs text-white/75">Starts at {clock(effort.start)}</p></div><div className="h-14 bg-gradient-to-t from-fuchsia-200 to-transparent px-4 pt-3 text-center text-2xl text-fuchsia-900 tabular-nums">{Math.round(effort.watts)} <span className="text-xs">W</span></div><div className="grid grid-cols-2 gap-x-2 p-2"><SummaryGroup title="Power" values={[["Max",effort.stats.maxPower!=null?`${Math.round(effort.stats.maxPower)} W`:null],["Average",`${Math.round(effort.watts)} W`],["Work",`${Math.round(effort.stats.workKj)} kJ`]]}/><SummaryGroup title="Heart rate" values={[["Lowest",effort.stats.minHeartRate!=null?`${Math.round(effort.stats.minHeartRate)} bpm`:null],["Highest",effort.stats.maxHeartRate!=null?`${Math.round(effort.stats.maxHeartRate)} bpm`:null],["Average",effort.stats.heartRate!=null?`${Math.round(effort.stats.heartRate)} bpm`:null]]}/><SummaryGroup title="Speed" values={[["Maximum",effort.stats.maxSpeed!=null?`${(effort.stats.maxSpeed*2.236936).toFixed(1)} mph`:null],["Average",effort.stats.speed!=null?`${(effort.stats.speed*2.236936).toFixed(1)} mph`:null],["Distance",effort.stats.distance!=null?`${(effort.stats.distance/1609.344).toFixed(2)} mi`:null]]}/><SummaryGroup title="Elevation" values={[["Average",effort.stats.elevationAverage!=null?`${Math.round(effort.stats.elevationAverage/.3048)} ft`:null],["Net",effort.stats.elevationChange!=null?`${effort.stats.elevationChange>=0?"+":""}${Math.round(effort.stats.elevationChange/.3048)} ft`:null],["Grade",effort.stats.grade!=null?`${effort.stats.grade.toFixed(1)}%`:null]]}/></div><div className="border-t bg-muted/30 px-4 py-2 text-center text-[11px] text-muted-foreground">Click to show this effort on the charts</div></PopoverContent></Popover>)}</div></aside>}
        <div className="min-w-0">
          <section className="overflow-hidden rounded-xl border bg-card" aria-label="Workout charts and selected-range summary">
          <div className="flex h-9 items-center justify-between gap-3 border-b bg-muted/15 px-3 text-[10px]"><span className="min-w-0 truncate">{range?<><span className="font-medium">{selectedSegment?.label||"Selected range"}</span><span className="text-muted-foreground"> · {clock(viewStart)}–{clock(viewEnd)}</span></>:<span className="text-muted-foreground">Full workout</span>}</span><Button size="sm" variant="ghost" className="h-7 shrink-0 text-[10px]" onClick={reset} disabled={!range}><RotateCcw className="size-3"/>Reset</Button></div>
          {available.elevation&&<><div className="relative border-b" aria-label="Elevation, laps and splits">
            <div className="relative"><div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-[12.6%] flex-col justify-center px-3 text-[11px] font-normal"><span>Elevation</span><span className="mt-2 text-[9px] font-normal text-muted-foreground">Max <span className="ml-1 text-[11px] font-normal text-foreground">{Math.round(elevationMax)} ft</span></span><span className="mt-1 text-[9px] font-normal text-muted-foreground">Min <span className="ml-1 text-[11px] font-normal text-foreground">{Math.round(elevationMin)} ft</span></span></div><svg viewBox="0 0 1080 100" preserveAspectRatio="none" className="block h-24 w-full cursor-crosshair touch-none select-none" role="img" aria-label="Smoothed full workout elevation profile with active range highlighted" onPointerDown={event=>down(event,true)} onPointerMove={event=>move(event,true)} onPointerUp={up} onPointerCancel={()=>{gesture.current=null;setSelection(null)}} onPointerLeave={()=>{if(!gesture.current)setCursor(null)}}><rect x={plotLeft} y="14" width={plotWidth} height="78" fill="#cbd5e1" fillOpacity=".08"/>{[0,.5,1].map(fraction=><line key={fraction} x1={plotLeft} x2={plotRight} y1={92-fraction*66} y2={92-fraction*66} stroke="currentColor" opacity=".07"/>)}{fullElevationPath&&<path d={`${fullElevationPath}L${plotRight},92 L${plotLeft},92 Z`} fill="#cbd5e1" fillOpacity="1"/>}{highlight&&<rect x={x(highlight.start,true)} y="14" width={Math.max(2,x(highlight.end,true)-x(highlight.start,true))} height="78" fill="#64748b" fillOpacity=".2"/>}{selection&&<rect x={Math.min(x(selection[0],true),x(selection[1],true))} y="14" width={Math.abs(x(selection[1],true)-x(selection[0],true))} height="78" fill="#64748b" fillOpacity=".14"/>}</svg></div>
            <DistanceAxis labels={overviewDistanceLabels}/>
            <div className="mt-2 space-y-1.5 pb-2 pt-3"><TimelineRow label="Laps" segments={laps} duration={duration} selected={selected} onSelect={selectSegment} onHover={setHovered}/><TimelineRow label="Splits" segments={splits} duration={duration} selected={selected} onSelect={selectSegment} onHover={setHovered}/><TimelineRow label="Terrain" segments={terrain} duration={duration} selected={selected} onSelect={selectSegment} onHover={setHovered}/></div></div></>}
          <div className="grid divide-x border-b md:grid-cols-3 xl:grid-cols-5" aria-label="Selected-range summary">{summaryGroups.map(group=><SummaryGroup key={group.title} title={group.title} values={group.values}/>)}</div>
          {!!signalTracks.length&&<div aria-label="Recorded signal graphs">
            <DistanceAxis labels={viewDistanceLabels}/>
            <div className="relative">
              <svg viewBox={`0 0 1080 ${height}`} preserveAspectRatio="none" className="block w-full cursor-crosshair touch-none select-none" style={{height}} role="img" aria-label="Recorded signals. Hover for live values, drag to zoom, or use arrow keys to pan." tabIndex={0} onKeyDown={event=>{if(!range||!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();const width=range[1]-range[0],start=Math.max(0,Math.min(duration-width,range[0]+width*.1*(event.key==="ArrowRight"?1:-1)));setRange([start,start+width])}} onPointerDown={event=>down(event)} onPointerMove={event=>move(event)} onPointerUp={up} onPointerCancel={()=>{gesture.current=null;setSelection(null)}} onPointerLeave={()=>{if(!gesture.current)setCursor(null)}}>
                {trackMetrics.map(metric=>{const {key,top,graphBottom,min,max,span}=metric,y=(entry:number)=>graphBottom-(key==="pace"?max-entry:entry-min)/span*48;let path="",previous=false;const stride=Math.max(1,Math.floor(visible.length/1800));for(let index=0;index<visible.length;index+=stride){const point=visible[index],entry=value(point,key);if(entry==null){previous=false;continue}path+=`${previous?"L":"M"}${x(point.time).toFixed(1)},${y(entry).toFixed(1)} `;previous=true}return <g key={key}><rect x={plotLeft} y={top} width={plotWidth} height="62" fill={colors[key]} fillOpacity=".022"/>{[0,.5,1].map(fraction=><line key={fraction} x1={plotLeft} x2={plotRight} y1={graphBottom-fraction*48} y2={graphBottom-fraction*48} stroke="currentColor" opacity=".07"/>)}{laps.filter(lap=>lap.start>=view[0]&&lap.start<=view[1]).map(lap=><line key={lap.id} x1={x(lap.start)} x2={x(lap.start)} y1={top} y2={top+62} stroke="currentColor" opacity=".1" strokeDasharray="3 3"/>)}<path d={path} fill="none" stroke={colors[key]} strokeWidth="1.5" strokeLinejoin="round"/></g>})}
                {selection&&<rect x={Math.min(x(selection[0]),x(selection[1]))} y="0" width={Math.abs(x(selection[1])-x(selection[0]))} height={height} fill="currentColor" fillOpacity=".055"/>}{nearest&&<line x1={x(nearest.time)} x2={x(nearest.time)} y1="0" y2={height} stroke="currentColor" opacity=".4" strokeDasharray="3 3"/>}
              </svg>
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">{trackMetrics.map(metric=><div key={metric.key} className="absolute inset-x-0 grid grid-cols-[12.6%_75.2%_12.2%] font-normal" style={{top:metric.top,height:62}}><div className="flex flex-col justify-center px-3 text-[11px]"><span className="text-xs font-normal">{label(metric.key)}</span><span className="mt-1 text-muted-foreground">Avg <span className="ml-1 text-foreground tabular-nums">{format(metric.average,metric.key)}</span></span><span className="text-muted-foreground">Max <span className="ml-1 text-foreground tabular-nums">{format(metric.peak,metric.key)}</span></span></div><span/><div className="flex flex-col items-center justify-center font-normal"><span className="text-base font-normal tabular-nums">{format(metric.live,metric.key)}</span><span className="text-[9px] font-normal text-muted-foreground">{unit(metric.key)}</span></div></div>)}</div>
            </div>
            {range&&<div className="border-t px-4 py-1" aria-label="Pan selected chart range"><svg viewBox="0 0 1080 22" preserveAspectRatio="none" className="block h-6 w-full cursor-grab touch-none active:cursor-grabbing" role="slider" aria-label="Drag the selected range to pan across the workout" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(view[0])} aria-valuetext={`${clock(view[0])} to ${clock(view[1])}`} onPointerDown={event=>down(event,true)} onPointerMove={event=>move(event,true)} onPointerUp={up} onPointerCancel={()=>{gesture.current=null;setSelection(null)}}><rect x={plotLeft} y="8" width={plotWidth} height="6" rx="3" fill="currentColor" opacity=".08"/><rect x={x(view[0],true)} y="5" width={Math.max(8,x(view[1],true)-x(view[0],true))} height="12" rx="3" fill="#64748b" fillOpacity=".35" stroke="#475569" strokeWidth="1"/></svg></div>}
          </div>}
          </section>
        </div>
      </div>
    </section>
  </>
}
