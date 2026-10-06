import { ChartSkeleton } from "@/components/loading-layouts"
import { METERS_PER_100_YARDS, recordedSwimYards } from "../../../app-backend/lib/swim-units.mjs"
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import { Sun, Watch } from "lucide-react"
import "./workout-analysis.css"

import { DesktopWorkoutRouteMap } from "@/components/desktop-workout-route-map"
import { MapboxRouteMap } from "@/components/mapbox-route-map"
import { MobileWorkoutSignals } from "@/components/mobile-workout-signals"
import { WorkoutMapSplits } from "@/components/workout-map-splits"
import { Button } from "@/components/ui/button"
import { cachedActivityAnalysis, loadActivityAnalysis, cachedActivitySummary, loadActivitySummary } from "@/lib/activity-analysis"
import { useIsMobile } from "@/hooks/use-mobile"
import { distanceSplits } from "@/lib/distance-splits"
import { formatDuration, formatPace } from "@/lib/duration"
import { segmentStatistics, type RecordedPoint } from "@/lib/segment-statistics"
import { intervalSignals } from "@/lib/interval-signals"
import { createRouteCursorIndex, nearestRouteCursorPoint } from "@/lib/route-cursor"
import type { PlannedWorkout, WorkoutSummaryValues } from "@/lib/training-context"
import { structuredWorkoutProfile } from "@/lib/workout-structure"
import { chartSegments } from "../../../app-backend/lib/workout-editor-model.mjs"

type Point = RecordedPoint
type Lap = { id:string; label:string; start:number; end:number; power:number|null; heartRate:number|null; distance:number|null; kind:string; speed?:number|null }
export type DfaStatistics = { average:number|null; minimum:number|null; maximum:number|null; averageArtifacts:number|null; artifactCoveragePercent:number|null; validPercent:number|null; validSeconds:number }
type Analysis = { dfa?:DfaStatistics|null; version?:number; points:Point[]; laps:Lap[]; intervals:Lap[]; duration:number }
export type WorkoutRecordedAnalysis = Analysis
export type WorkoutComparisonStats = {
  selected:boolean
  start:number
  end:number
  distance:number|null
  speed:number|null
  power:number|null
  heartRate:number|null
  cadence:number|null
}
type Segment = { id:string; label:string; start:number; end:number; kind:"lap"|"split"|"climb"|"descent"|"effort"; distance?:number|null; color?:string }
type RangeStats = ReturnType<typeof rangeStatistics>
type PeakEffort = Segment & { seconds:number; value:number; metric:"pace"|"power"; stats:RangeStats }

const cypressCenter: [number, number] = [-95.69, 29.97]
const noRoutePoints: {time:number;latitude:number;longitude:number}[] = []

function plannedProfileOverlay(workout: PlannedWorkout) {
  if (workout.editor_model) {
    const segments = chartSegments(workout.editor_model).segments
    const total = segments.reduce((sum, segment) => sum + segment.width, 0)
    const peak = Math.max(0.001, ...segments.flatMap((segment) => [segment.start, segment.end]))
    if (!total) return []
    let position = 0
    return segments.flatMap((segment) => {
      const start = { position: position / total, intensity: Math.max(0, segment.start) / peak }
      position += segment.width
      return [start, { position: position / total, intensity: Math.max(0, segment.end) / peak }]
    })
  }
  const profile = structuredWorkoutProfile(workout.structure)
  const total = profile.at(-1)?.position || 0
  return total
    ? profile.map((point) => ({ position: point.position / total, intensity: point.intensity / 100 }))
    : []
}
const effortDurations = [5,10,30,60,120,300,600,1200,1800,3600,10800]
const finite = (value:unknown): value is number => typeof value === "number" && Number.isFinite(value)
const clock = (seconds:number) => {
  const value=Math.max(0,Math.round(seconds)),hours=Math.floor(value/3600),minutes=Math.floor((value%3600)/60),remainder=value%60
  return hours?`${hours}:${String(minutes).padStart(2,"0")}:${String(remainder).padStart(2,"0")}`:`${minutes}:${String(remainder).padStart(2,"0")}`
}
const durationClock = (seconds:number) => formatDuration(seconds / 60)
const effortLabel=(seconds:number)=>seconds<60?`${seconds} secs`:seconds<3600?`${seconds/60} min${seconds===60?"":"s"}`:`${seconds/3600} hour${seconds===3600?"":"s"}`
const pace=(seconds:number)=>seconds>0&&Number.isFinite(seconds)?formatPace(seconds):"—"
const workoutDate=(workout:PlannedWorkout)=>{
  const value=workout.workout_date||workout.date
  const date=new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})
}
const workoutTime=(workout:PlannedWorkout)=>{
  const value=workout.recorded_start_local||workout.scheduled_start_at
  if(!value)return null
  const date=new Date(value)
  return Number.isNaN(date.getTime())?null:date.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})
}

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
  const maximum=(key:keyof Point)=>{const entries=values(key);return entries.length?entries.reduce((a,b)=>Math.max(a,b),-Infinity):null}
  const minimum=(key:keyof Point)=>{const entries=values(key);return entries.length?entries.reduce((a,b)=>Math.min(a,b),Infinity):null}
  const distance=finite(firstDistance)&&finite(lastDistance)?Math.max(0,lastDistance-firstDistance):null
  const elevationChange=elevations.length?elevations.at(-1)!-elevations[0]:null
  return {...averages,start,end,distance,maxPower:maximum("power"),minHeartRate:minimum("heartRate"),maxHeartRate:maximum("heartRate"),maxSpeed:maximum("speed"),maxCadence:maximum("cadence"),elevationAverage:elevations.length?elevations.reduce((sum,value)=>sum+value,0)/elevations.length:null,elevationGain:gain,elevationLoss:loss,elevationChange,grade:distance&&elevationChange!=null?elevationChange/distance*100:null,workKj:work/1000}
}

function signalIntegral(points: Point[], key: "power" | "speed") {
  const totals = new Array(points.length).fill(0),
    coverage = new Array(points.length).fill(0)
  const usable = (point: Point) =>
    finite(point[key]) && (key !== "speed" || point.speed! > 0.15)
  for (let index = 1; index < points.length; index += 1) {
    const elapsed = Math.max(0, points[index].time - points[index - 1].time),
      valid = elapsed <= 10 && usable(points[index - 1])
    totals[index] =
      totals[index - 1] + (valid ? points[index - 1][key]! * elapsed : 0)
    coverage[index] = coverage[index - 1] + (valid ? elapsed : 0)
  }
  const at = (time: number, values: number[], kind: "value" | "coverage") => {
    let low = 0,
      high = points.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (points[middle].time <= time) low = middle
      else high = middle - 1
    }
    const point = points[low],
      elapsed = Math.max(0, Math.min(10, time - point.time))
    if (!usable(point)) return values[low]
    return values[low] + (kind === "value" ? point[key]! * elapsed : elapsed)
  }
  return { totals, coverage, at }
}

function peakEfforts(
  points: Point[],
  duration: number,
  metric: "pace" | "power",
  paceDistance: number
): PeakEffort[] {
  const key = metric === "pace" ? "speed" : "power"
  if (
    points.length < 2 ||
    !points.some(
      (point) => finite(point[key]) && (key !== "speed" || point.speed! > 0.15)
    )
  )
    return []
  const integral = signalIntegral(points, key)
  return effortDurations.flatMap((seconds) => {
    if (seconds > duration) return [] as PeakEffort[]
    let best: { start: number; average: number } | null = null
    for (const point of points) {
      const start = point.time,
        end = start + seconds
      if (end > duration) break
      const total =
          integral.at(end, integral.totals, "value") -
          integral.at(start, integral.totals, "value"),
        coverage =
          integral.at(end, integral.coverage, "coverage") -
          integral.at(start, integral.coverage, "coverage")
      if (coverage < seconds * 0.9) continue
      const average = total / coverage
      if (!best || average > best.average) best = { start, average }
    }
    if (!best) return []
    const end = best.start + seconds
    return [
      {
        id: `effort-${seconds}`,
        label: effortLabel(seconds),
        start: best.start,
        end,
        seconds,
        value: metric === "pace" ? paceDistance / best.average : best.average,
        metric,
        kind: "effort" as const,
        color: "#a21caf",
        stats: rangeStatistics(points, best.start, end),
      },
    ]
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
  return <div className="analysis-timeline-row grid grid-cols-[12.6%_75.2%_12.2%] items-center"><span className="analysis-timeline-label pr-3 text-right text-[11px] text-muted-foreground">{label}</span><div className="analysis-timeline-track relative h-5 overflow-hidden rounded-sm bg-muted/40">{segments.map(segment=><button key={segment.id} type="button" aria-label={`Show ${segment.label}`} aria-pressed={selected===segment.id} title={`${segment.label} · ${clock(segment.start)}–${clock(segment.end)}`} className={`analysis-timeline-segment absolute inset-y-0.5 min-w-1 rounded-[2px] border border-background/80 transition hover:brightness-90 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring ${selected===segment.id?"z-10 ring-2 ring-foreground/50 ring-inset":""}`} style={{left:`${segment.start/duration*100}%`,width:`${Math.max(.35,(segment.end-segment.start)/duration*100)}%`,backgroundColor:segment.color||"#cbd5e1"}} onMouseEnter={()=>onHover(segment)} onMouseLeave={()=>onHover(null)} onFocus={()=>onHover(segment)} onBlur={()=>onHover(null)} onClick={()=>onSelect(segment)}>{(segment.end-segment.start)/duration>.035&&<span aria-hidden="true">{segment.kind==="lap"?segment.label.replace(/^Lap\s+/i,""):segment.kind==="split"?segment.label:null}</span>}</button>)}</div><span aria-hidden="true"/></div>
}

function DistanceAxis({labels,fullWidth=false}:{labels:string[];fullWidth?:boolean}){
  return fullWidth
    ? <div className="flex h-5 justify-between px-3 pt-0.5 text-[10px] font-normal leading-none tabular-nums text-muted-foreground">{labels.map((label,index)=><span key={`${label}-${index}`}>{label}</span>)}</div>
    : <div className="analysis-distance-axis grid h-5 grid-cols-[12.6%_75.2%_12.2%] items-start"><span aria-hidden="true"/><div className="flex justify-between pt-0.5 text-[10px] font-normal leading-none tabular-nums text-muted-foreground">{labels.map((label,index)=><span key={`${label}-${index}`}>{label}</span>)}</div><span aria-hidden="true"/></div>
}

type OverviewMetric = { label: string; value: string | null }

function OverviewSummary({workout,primary,details=[],conditions=[]}:{workout:PlannedWorkout;primary:OverviewMetric[];details?:OverviewMetric[];conditions?:OverviewMetric[]}){
  return <div className="analysis-overview-content">
    <div className="analysis-overview-heading">
      <div className="analysis-overview-eyebrow"><span className="analysis-status"><span aria-hidden="true"/>Completed</span><span>{workout.sport}</span></div>
      <h2>{workout.title}</h2>
      <p className="analysis-overview-date">{workoutDate(workout)}{workoutTime(workout)&&<><span aria-hidden="true"> · </span><span className="tabular-nums">{workoutTime(workout)}</span></>}</p>
    </div>
    <dl className="analysis-primary-metrics">{primary.map(metric=>{
      const match=metric.value?.match(/^(.*?)\s+(mi|yd|mph|\/mi|\/100 yd)$/)
      return <div key={metric.label}><dt>{metric.label}</dt><dd>{match?<>{match[1]}<span className="analysis-metric-unit"> {match[2]}</span></>:metric.value??"—"}{metric.label==="Training load"&&metric.value!=="—"&&<span className="analysis-metric-unit"> TSS</span>}</dd></div>
    })}</dl>
    {details.length>0&&<dl className="analysis-overview-details">{details.map(metric=><div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value??"—"}{metric.label==="Calories"&&metric.value&&<span className="analysis-detail-unit"> kcal</span>}</dd></div>)}</dl>}
    {(conditions.length>0||workout.device_name)&&<div className="analysis-recording-meta">
      {conditions.length>0&&<div className="analysis-conditions"><Sun aria-hidden="true"/><dl aria-label="Recorded conditions">{conditions.map(metric=><div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl></div>}
      {workout.device_name&&<div className="analysis-device"><Watch aria-hidden="true"/><span>{workout.device_name}</span></div>}
    </div>}
  </div>
}

export function WorkoutAnalysis({workout,onLapSelection,analysisOverride,comparisonMode=false,onComparisonStats}:{workout:PlannedWorkout;onLapSelection?:(range:[number,number]|null)=>void;analysisOverride?:Analysis;comparisonMode?:boolean;onComparisonStats?:(id:string,stats:WorkoutComparisonStats|null)=>void}){
  const id=workout.activity_id||(workout.id.startsWith("activity:")?workout.id.slice(9):null),revision=(workout as PlannedWorkout&{activity_revision?:string}).activity_revision||""
  return id||analysisOverride?<ActivityGraph key={(id||workout.id)+revision} id={id||workout.id} revision={revision} workout={workout} summary={workout.workout_summary?.completed} onLapSelection={onLapSelection} analysisOverride={analysisOverride} comparisonMode={comparisonMode} onComparisonStats={onComparisonStats}/>:null
}

function ActivityGraph({id,revision,workout,summary,onLapSelection,analysisOverride,comparisonMode,onComparisonStats}:{id:string;revision:string;workout:PlannedWorkout;summary?:WorkoutSummaryValues|null;onLapSelection?:(range:[number,number]|null)=>void;analysisOverride?:Analysis;comparisonMode:boolean;onComparisonStats?:(id:string,stats:WorkoutComparisonStats|null)=>void}){
  const mobile = useIsMobile()
  const sport=workout.sport
  const [data,setData]=useState<Analysis|null>(analysisOverride||cachedActivityAnalysis(id,revision)||null),[error,setError]=useState(""),[retry,setRetry]=useState(0),[totals,setTotals]=useState<WorkoutSummaryValues|null>(()=>cachedActivitySummary(id,revision)||summary||null)
  const [range,setRange]=useState<[number,number]|null>(null),[cursor,setCursor]=useState<number|null>(null),[selection,setSelection]=useState<[number,number]|null>(null),[selected,setSelected]=useState(""),[hovered,setHovered]=useState<Segment|null>(null)
  const [hiddenTracks,setHiddenTracks]=useState<string[]>([])
  const gesture=useRef<{x:number;time:number;range:[number,number];overview:boolean;pan:boolean}|null>(null)
  const draggedChart=useRef(false)
  useEffect(()=>{if(analysisOverride)return;const controller=new AbortController();void loadActivitySummary(id,revision,controller.signal).then(values=>{if(!controller.signal.aborted)setTotals({...summary,...values})}).catch(()=>{});return()=>controller.abort()},[id,revision,summary,analysisOverride])
  useEffect(()=>{if(analysisOverride){setData(analysisOverride);return}const controller=new AbortController();setError("");void loadActivityAnalysis(id,revision,controller.signal).then(value=>{if(!controller.signal.aborted)setData(value)}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message)});return()=>controller.abort()},[id,retry,revision,analysisOverride])
  const duration=data?.duration||1,view:[number,number]=range||[0,duration],swim=sport.toLowerCase().includes("swim"),run=sport.toLowerCase().includes("run"),bike=/bike|ride|cycl/i.test(sport)
  const available=useMemo(()=>({elevation:Boolean(data?.points.some(point=>point.elevation!=null)),power:Boolean(data?.points.some(point=>point.power!=null)),speed:Boolean(data?.points.some(point=>point.speed!=null)),heartRate:Boolean(data?.points.some(point=>point.heartRate!=null)),cadence:Boolean(data?.points.some(point=>point.cadence!=null))}),[data])
  const paceDistance=swim?METERS_PER_100_YARDS:1609.344
  const allSignalTracks=[...(available.speed?[run||swim?"pace":"speed"]:[]),...(available.power?["power"]:[]),...(available.heartRate?["heartRate"]:[]),...(available.cadence?["cadence"]:[])]
  const signalTracks=allSignalTracks.filter(key=>!comparisonMode||!hiddenTracks.includes(key))
  const colors:Record<string,string>={pace:"#0284c7",speed:"#0284c7",power:"#6d28d9",heartRate:"#dc2626",cadence:"#c026d3"}
  const value=(point:Point,key:string)=>key==="elevation"?(point.elevation==null?null:point.elevation*3.280839895):key==="pace"?(point.speed!=null&&point.speed>.15?paceDistance/point.speed:null):key==="speed"?(point.speed==null?null:point.speed*2.2369362920544):key==="power"?point.power:key==="cadence"?(point.cadence??null):point.heartRate
  const unit=(key:string)=>key==="elevation"?"ft":key==="power"?"W":key==="heartRate"?"bpm":key==="cadence"?(run?"spm":swim?"strokes/min":"rpm"):key==="pace"?(swim?"/100 yd":"/mi"):"mph"
  const label=(key:string)=>key==="heartRate"?"Heart rate":key[0].toUpperCase()+key.slice(1)
  const format=(entry:number|null|undefined,key:string)=>entry==null?"—":key==="pace"?pace(entry):String(Math.round(entry))
  const viewStart=view[0],viewEnd=view[1]
  const visible=useMemo(()=>data?.points.filter(point=>point.time>=viewStart&&point.time<=viewEnd)||[],[data,viewStart,viewEnd])
  const nearest=cursor==null?null:visible.reduce<Point|null>((best,point)=>!best||Math.abs(point.time-cursor)<Math.abs(best.time-cursor)?point:best,null)
  const activeStats=useMemo(()=>rangeStatistics(data?.points||[],viewStart,viewEnd),[data,viewStart,viewEnd]),wholeStats=useMemo(()=>rangeStatistics(data?.points||[],0,duration),[data,duration])
  const effortMetric = run || swim ? "pace" : "power"
  const peaks = useMemo(
      () =>
        mobile ? [] : peakEfforts(data?.points || [], duration, effortMetric, paceDistance),
      [mobile, data, duration, effortMetric, paceDistance]
    ),
    terrain = useMemo(() => mobile ? [] : elevationSegments(data?.points || []), [mobile, data])
  const plannedOverlay=useMemo(()=>plannedProfileOverlay(workout),[workout])
  const splitDistance=bike?8046.72:1609.344
  const splits=useMemo<Segment[]>(()=>swim?[]:distanceSplits(data?.points||[],splitDistance).map(split=>({id:`split-${split.number}`,label:bike?`${split.number*5} mi`:`${split.number} mi`,start:split.start,end:split.end,distance:split.distance,kind:"split",color:"#cbd5e1"})),[bike,data,splitDistance,swim])
  const laps:Segment[]=(data?.laps||[]).map(lap=>({...lap,kind:"lap",color:"#94a3b8"}))
  const swimIntervals=useMemo(()=>swim?intervalSignals(data?.points||[],data?.laps||[]):[],[data,swim])
  const routePoints=useMemo(()=>createRouteCursorIndex(data?.points||[]),[data])
  const routeCursorPoint=nearestRouteCursorPoint(routePoints,cursor)
  const selectedSegment=[...laps,...splits,...terrain,...peaks].find(segment=>segment.id===selected)
  const highlight=selection?{start:Math.min(...selection),end:Math.max(...selection)}:hovered||selectedSegment||(range?{start:range[0],end:range[1]}:null)
  const graphHover=hovered&&hovered.end>viewStart&&hovered.start<viewEnd?{start:Math.max(viewStart,hovered.start),end:Math.min(viewEnd,hovered.end)}:null
  useEffect(()=>onLapSelection?.(range),[range,onLapSelection])
  const comparisonStart=selection?Math.min(selection[0],selection[1]):hovered?.start??range?.[0]??null
  const comparisonEnd=selection?Math.max(selection[0],selection[1]):hovered?.end??range?.[1]??null
  useEffect(()=>{
    if(!comparisonMode||!onComparisonStats)return
    if(!data){onComparisonStats(workout.id,null);return}
    const selected=comparisonStart!=null&&comparisonEnd!=null&&comparisonEnd-comparisonStart>=2
    const start=selected?comparisonStart:0,end=selected?comparisonEnd:duration
    const stats=rangeStatistics(data.points,start,end)
    onComparisonStats(workout.id,{selected,start,end,distance:stats.distance,speed:stats.speed,power:stats.power,heartRate:stats.heartRate,cadence:stats.cadence})
  },[comparisonMode,onComparisonStats,workout.id,data,duration,comparisonStart,comparisonEnd])
  const selectSegment=(segment:Segment)=>{const start=Math.max(0,segment.start),end=Math.min(duration,segment.end);if(end<=start)return;setRange([start,end]);setSelected(segment.id);setSelection(null);setCursor(null)}
  const reset=()=>{setRange(null);setSelected("");setHovered(null);setSelection(null);setCursor(null)}
  const resetFromChartClick=()=>{if(draggedChart.current){draggedChart.current=false;return}reset()}
  const plotLeft=comparisonMode?12:136,plotWidth=comparisonMode?1056:812,plotRight=plotLeft+plotWidth
  const x=(time:number,overview=false)=>plotLeft+(time-(overview?0:view[0]))/(overview?duration:Math.max(1,view[1]-view[0]))*plotWidth
  const timeAt=(event:PointerEvent<SVGSVGElement>,overview=false)=>{const bounds=event.currentTarget.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,((event.clientX-bounds.left)/bounds.width*1080-plotLeft)/plotWidth));return (overview?0:view[0])+fraction*(overview?duration:view[1]-view[0])}
  const move=(event:PointerEvent<SVGSVGElement>,overview=false)=>{const time=timeAt(event,overview);setCursor(time);const active=gesture.current;if(!active)return;if(active.pan){const bounds=event.currentTarget.getBoundingClientRect(),delta=(active.overview?1:-1)*(event.clientX-active.x)/bounds.width*1080/plotWidth*(active.overview?duration:active.range[1]-active.range[0]),width=active.range[1]-active.range[0],start=Math.max(0,Math.min(duration-width,active.range[0]+delta));setRange([start,start+width])}else setSelection([active.time,time])}
  const down=(event:PointerEvent<SVGSVGElement>,overview=false)=>{if(event.button!==0)return;draggedChart.current=false;event.currentTarget.setPointerCapture(event.pointerId);const time=timeAt(event,overview),pan=overview&&Boolean(range)&&time>=view[0]&&time<=view[1];gesture.current={x:event.clientX,time,range:[view[0],view[1]],overview,pan};if(!pan)setSelection([time,time]);setSelected("")}
  const up=(event:PointerEvent<SVGSVGElement>)=>{const active=gesture.current;if(!active)return;const time=timeAt(event,active.overview),moved=Math.abs(event.clientX-active.x)>5;if(moved){draggedChart.current=true;window.setTimeout(()=>{draggedChart.current=false},0)}if(!active.pan&&moved&&Math.abs(time-active.time)>=2)setRange([Math.min(time,active.time),Math.max(time,active.time)]);gesture.current=null;setSelection(null);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}
  if(error)return <div className="border p-4 text-sm">{error}<Button variant="outline" size="sm" className="ml-3" onClick={()=>setRetry(value=>value+1)}>Retry</Button></div>
  if(!data){
    if(mobile||comparisonMode)return <ChartSkeleton className="border" />
    return <><section aria-label="Recorded workout analysis" className="workout-analysis-desktop hidden min-w-0 space-y-3 md:block">
      <section className="analysis-overview analysis-overview-with-map grid lg:grid-cols-2" aria-label="Workout overview">
        <div className="analysis-route min-w-0 border-b lg:border-r lg:border-b-0" aria-label="Activity route map"><DesktopWorkoutRouteMap workout={workout} compact/></div>
        <OverviewSummary workout={workout} primary={[
          {label:"Distance",value:totals?.distance_meters!=null?swim?`${Math.round(recordedSwimYards(totals.distance_meters)).toLocaleString()} yd`:`${(totals.distance_meters/1609.344).toFixed(2)} mi`:"—"},
          {label:"Moving time",value:totals?.duration_seconds!=null?durationClock(totals.duration_seconds):"—"},
          {label:run||swim?"Pace":"Avg speed",value:totals?.average_speed?run||swim?`${pace(paceDistance/totals.average_speed)} ${unit("pace")}`:`${(totals.average_speed*2.236936).toFixed(1)} mph`:"—"},
          {label:"Training load",value:totals?.tss!=null?String(Math.round(totals.tss)):"—"},
        ]}/>
      </section>
      <ChartSkeleton className="rounded-xl border"/>
    </section></>
  }
  if(!data.points.length||(!allSignalTracks.length&&!data.dfa))return <div className="border border-dashed p-5 text-sm text-muted-foreground">No recorded signal stream is available for this activity.</div>
  if(mobile)return <MobileWorkoutSignals points={data.points} laps={data.laps} duration={duration} sport={sport} summary={totals} dfa={data.dfa} onLapSelect={lap=>setSelected(lap?.id||"")} afterLaps={<WorkoutMapSplits workout={workout} analysis={data}/>}/>
  const laneHeight=92,height=comparisonMode?176:signalTracks.length*laneHeight+8,graphHeight=comparisonMode?142:58
  const elevationProfile=data.points.map((point,index)=>{const nearby=data.points.slice(Math.max(0,index-3),index+4).map(entry=>value(entry,"elevation")).filter(finite);return {...point,smoothedElevation:nearby.length?nearby.reduce((sum,entry)=>sum+entry,0)/nearby.length:null}})
  const elevationValues=elevationProfile.map(point=>point.smoothedElevation).filter(finite),elevationMin=elevationValues.reduce((a,b)=>Math.min(a,b),Infinity),elevationMax=elevationValues.reduce((a,b)=>Math.max(a,b),-Infinity),elevationSpan=Math.max(1,elevationMax-elevationMin),elevationY=(entry:number)=>92-(entry-elevationMin)/elevationSpan*66
  let fullElevationPath="",previousElevation=false
  for(const point of elevationProfile){if(point.smoothedElevation==null){previousElevation=false;continue}fullElevationPath+=`${previousElevation?"L":"M"}${x(point.time,true).toFixed(1)},${elevationY(point.smoothedElevation).toFixed(1)} `;previousElevation=true}
  const plannedProfilePath=plannedOverlay.map(point=>`${point.position===0?"M":"L"}${(plotLeft+point.position*plotWidth).toFixed(1)},${(92-(.12+point.intensity*.76)*66).toFixed(1)}`).join(" ")
  const plannedProfileFill=plannedProfilePath?`${plannedProfilePath} L${plotRight},92 L${plotLeft},92 Z`:""
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
    {label:"Moving time",value:durationClock(totals?.duration_seconds??duration)},
    {label:run||swim?"Pace":"Avg speed",value:overviewSpeed!=null&&overviewSpeed>0?(run||swim?`${pace(paceDistance/overviewSpeed)} ${unit("pace")}`:`${(overviewSpeed*2.236936).toFixed(1)} mph`):"—"},
    {label:"Training load",value:totals?.tss!=null?String(Math.round(totals.tss)):"—"},
  ]
  const overviewDetails=[
    {label:"Elevation gain",value:`${Math.round((totals?.elevation_gain??wholeStats.elevationGain)/.3048).toLocaleString()} ft`},
    {label:"Calories",value:totals?.calories!=null?Math.round(totals.calories).toLocaleString():null},
    {label:"Elapsed time",value:totals?.elapsed_time_seconds!=null?durationClock(totals.elapsed_time_seconds):null},
    ...((run||swim)?[{label:"Elapsed pace",value:totals?.elapsed_speed!=null&&totals.elapsed_speed>0?`${pace(paceDistance/totals.elapsed_speed)} ${unit("pace")}`:null}]:[]),
  ]
  const overviewConditions=[
    {label:"Temperature",value:totals?.temperature_c!=null?`${Math.round(totals.temperature_c*9/5+32)}°F`:null},
    {label:"Humidity",value:totals?.humidity_percent!=null?`${Math.round(totals.humidity_percent)}%`:null},
  ].filter((metric):metric is {label:string;value:string}=>metric.value!=null)
  const trackMetrics=signalTracks.map((key,lane)=>{
    const intervalValues=swim&&(key==="pace"||key==="cadence")
      ? swimIntervals.filter(interval=>interval.lap.end>viewStart&&interval.lap.start<viewEnd).map(interval=>value(interval.point,key)).filter((entry):entry is number=>entry!=null)
      : []
    const lapAveraged=intervalValues.length>0
    const values=lapAveraged?intervalValues:visible.map(point=>value(point,key)).filter((entry):entry is number=>entry!=null)
    const rawMin=values.reduce((a,b)=>Math.min(a,b),Infinity),rawMax=values.reduce((a,b)=>Math.max(a,b),-Infinity),padding=Math.max((rawMax-rawMin)*.08,key==="pace"?1:.5),min=rawMin-padding,max=rawMax+padding,span=Math.max(1,max-min),top=comparisonMode?12:lane*laneHeight+8,graphBottom=comparisonMode?height-12:top+72
    const average=key==="pace"?(activeStats.speed?paceDistance/activeStats.speed:null):key==="speed"?(activeStats.speed!=null?activeStats.speed*2.2369362920544:null):key==="power"?activeStats.power:key==="heartRate"?activeStats.heartRate:activeStats.cadence
    const livePoint=lapAveraged?swimIntervals.find(interval=>cursor!=null&&cursor>=interval.lap.start&&cursor<=interval.lap.end)?.point:nearest
    return {key,rawMin,rawMax,min,max,span,top,graphBottom,average,peak:key==="pace"?rawMin:rawMax,live:livePoint?value(livePoint,key):null,lapAveraged}
  })
  return <>
    <section aria-label="Recorded workout analysis" className={`workout-analysis-desktop hidden min-w-0 space-y-3 md:block ${comparisonMode?"workout-analysis-comparison":""}`}>
      {!comparisonMode&&<section className={`analysis-overview grid ${routePoints.length>1||swim?"analysis-overview-with-map lg:grid-cols-2":"grid-cols-1"}`} aria-label="Workout overview">
        {routePoints.length>1
          ? <div className="analysis-route min-w-0 border-b lg:border-r lg:border-b-0" aria-label="Activity route map"><DesktopWorkoutRouteMap workout={workout} timedPoints={routePoints} highlightRange={highlight?[highlight.start,highlight.end]:null} cursorPoint={routeCursorPoint} compact/></div>
          : swim
            ? <div className="analysis-route relative min-w-0 border-b lg:border-r lg:border-b-0" aria-label="Approximate pool workout area"><MapboxRouteMap points={noRoutePoints} center={cypressCenter} interactive={false} className="relative min-h-[300px] w-full bg-muted/25 lg:h-full"/><span className="pointer-events-none absolute top-3 left-3 rounded-md border bg-background/90 px-2.5 py-1.5 text-xs font-medium shadow-sm">Cypress, Texas · approximate area</span></div>
            : null}
        <OverviewSummary workout={workout} primary={overviewPrimary} details={overviewDetails} conditions={overviewConditions}/>
      </section>}
      <div className={comparisonMode?"min-w-0":"analysis-area min-w-0"}>
      <div className={`analysis-workspace grid min-w-0 gap-4 ${!comparisonMode&&peaks.length?"analysis-workspace-with-sidebar grid-cols-[168px_minmax(0,1fr)]":"grid-cols-1"}`}>
        {!comparisonMode&&peaks.length>0&&<aside className="analysis-sidebar relative min-w-0" aria-label={`Peak ${effortMetric} efforts`}><div className="analysis-sidebar-scroll">
          <div className="analysis-peaks min-w-0">
          <div className="border-b px-4 py-3"><h2 className="text-sm font-medium">Peak {effortMetric}</h2><p className="mt-0.5 text-[10px] text-muted-foreground">Hover to preview · click to zoom</p></div>
          <div className="py-1">{peaks.map(effort=><button key={effort.id} type="button" aria-pressed={selected===effort.id} onPointerEnter={()=>setHovered(effort)} onPointerLeave={()=>setHovered(current=>current?.id===effort.id?null:current)} onFocus={()=>setHovered(effort)} onBlur={()=>setHovered(current=>current?.id===effort.id?null:current)} onClick={()=>selectSegment(effort)} className={`flex min-h-9 w-full items-center justify-between gap-3 px-4 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected===effort.id?"bg-muted":""}`}><span>{effort.label}</span><span className="tabular-nums">{effort.metric==="pace"?`${pace(effort.value)} ${unit("pace")}`:`${Math.round(effort.value)} W`}</span></button>)}</div>
        </div>
        </div></aside>}
        <div className="min-w-0">
          <section className={comparisonMode?"min-w-0":"analysis-charts min-w-0"} aria-label="Workout charts and selected-range summary">
          {!comparisonMode&&<div className="analysis-chart-heading"><p className={range?"analysis-range-active":""}>{range?<><span>{selectedSegment?.label||"Selected range"}</span><span> · {clock(viewStart)}–{clock(viewEnd)}</span></>:<>Full workout <span aria-hidden="true">·</span> {clock(duration)}</>}</p><p className="analysis-chart-help">Hover to inspect <span aria-hidden="true">·</span> Drag to zoom <span aria-hidden="true">·</span> Click to reset</p></div>}
          {comparisonMode&&<div className="flex flex-wrap gap-2 border-b px-3 py-2" aria-label="Show or hide recorded signals">{allSignalTracks.map(key=><Button key={key} variant={hiddenTracks.includes(key)?"ghost":"outline"} size="sm" aria-pressed={!hiddenTracks.includes(key)} onClick={()=>setHiddenTracks(current=>current.includes(key)?current.filter(item=>item!==key):[...current,key])} className="gap-2"><span className="size-2.5 rounded-full" style={{backgroundColor:colors[key]}}/>{label(key)}{cursor!=null&&!hiddenTracks.includes(key)&&<span className="tabular-nums text-muted-foreground">{format(trackMetrics.find(metric=>metric.key===key)?.live,key)}</span>}</Button>)}</div>}
          {!comparisonMode&&available.elevation&&<><div className="relative border-b" aria-label="Elevation, laps and splits">
            <div className="relative"><div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-[12.6%] flex-col justify-center px-3 text-[11px] font-normal"><span>Elevation</span><span className="mt-2 text-[9px] font-normal text-muted-foreground">Max <span className="ml-1 text-[11px] font-normal text-foreground">{Math.round(elevationMax)} ft</span></span><span className="mt-1 text-[9px] font-normal text-muted-foreground">Min <span className="ml-1 text-[11px] font-normal text-foreground">{Math.round(elevationMin)} ft</span></span></div><svg viewBox="0 0 1080 100" preserveAspectRatio="none" className="block h-24 w-full cursor-crosshair touch-none select-none" role="img" aria-label="Smoothed full workout elevation profile. Click to reset zoom." onClick={resetFromChartClick} onPointerDown={event=>down(event,true)} onPointerMove={event=>move(event,true)} onPointerUp={up} onPointerCancel={()=>{gesture.current=null;setSelection(null)}} onPointerLeave={()=>{if(!gesture.current)setCursor(null)}}><rect x={plotLeft} y="14" width={plotWidth} height="78" fill="#cbd5e1" fillOpacity=".08"/>{[0,.5,1].map(fraction=><line key={fraction} x1={plotLeft} x2={plotRight} y1={92-fraction*66} y2={92-fraction*66} stroke="currentColor" opacity=".07"/>)}{fullElevationPath&&<path d={`${fullElevationPath}L${plotRight},92 L${plotLeft},92 Z`} fill="#94a3b8" fillOpacity=".5" stroke="#64748b" strokeWidth="1.5" strokeLinejoin="round"/>}{highlight&&<rect x={x(highlight.start,true)} y="14" width={Math.max(2,x(highlight.end,true)-x(highlight.start,true))} height="78" fill="#64748b" fillOpacity=".2"/>}{selection&&<rect x={Math.min(x(selection[0],true),x(selection[1],true))} y="14" width={Math.abs(x(selection[1],true)-x(selection[0],true))} height="78" fill="#64748b" fillOpacity=".14"/>}</svg></div>
            {plannedProfilePath&&<svg viewBox="0 0 1080 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-0 z-10 block h-24 w-full" aria-hidden="true"><path d={plannedProfileFill} fill="#38bdf8" fillOpacity=".035"/><path d={plannedProfilePath} fill="none" stroke="#0284c7" strokeWidth="2.5" strokeOpacity=".3" strokeLinejoin="round"/></svg>}
            <DistanceAxis labels={overviewDistanceLabels}/>
            <div className="analysis-timelines mt-2 space-y-1.5 pb-2 pt-3"><TimelineRow label="Laps" segments={laps} duration={duration} selected={selected} onSelect={selectSegment} onHover={setHovered}/><TimelineRow label="Splits" segments={splits} duration={duration} selected={selected} onSelect={selectSegment} onHover={setHovered}/><TimelineRow label="Terrain" segments={terrain} duration={duration} selected={selected} onSelect={selectSegment} onHover={setHovered}/>{terrain.length>0&&<div className="analysis-terrain-key" aria-label="Terrain legend"><span><i aria-hidden="true" style={{backgroundColor:"#ea580c"}}/>Climb</span><span><i aria-hidden="true" style={{backgroundColor:"#0284c7"}}/>Descent</span></div>}</div></div></>}
          {comparisonMode&&allSignalTracks.length>0&&!signalTracks.length&&<p className="p-6 text-center text-sm text-muted-foreground">Select a signal above to show its graph.</p>}
          {!!signalTracks.length&&<div aria-label="Recorded signal graphs">
            <DistanceAxis labels={viewDistanceLabels} fullWidth={comparisonMode}/>
            <div className={comparisonMode?"relative":"analysis-signal-plot relative"}>
              <svg viewBox={`0 0 1080 ${height}`} preserveAspectRatio="none" className={`block w-full cursor-crosshair touch-none select-none ${comparisonMode?"":"analysis-signal-svg"}`} style={{height}} role="img" aria-label="Recorded signals. Hover for live values, drag to zoom, click to reset, or use arrow keys to pan." tabIndex={0} onClick={resetFromChartClick} onKeyDown={event=>{if(!range||!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();const width=range[1]-range[0],start=Math.max(0,Math.min(duration-width,range[0]+width*.1*(event.key==="ArrowRight"?1:-1)));setRange([start,start+width])}} onPointerDown={event=>down(event)} onPointerMove={event=>move(event)} onPointerUp={up} onPointerCancel={()=>{gesture.current=null;setSelection(null)}} onPointerLeave={()=>{if(!gesture.current)setCursor(null)}}>
                {trackMetrics.map(metric=>{
                  const {key,top,graphBottom,min,max,span}=metric
                  const y=(entry:number)=>graphBottom-(key==="pace"?max-entry:entry-min)/span*graphHeight
                  let path=""
                  if(metric.lapAveraged){
                    for(const interval of swimIntervals){
                      const start=Math.max(viewStart,interval.lap.start),end=Math.min(viewEnd,interval.lap.end),entry=value(interval.point,key)
                      if(end<=start||entry==null)continue
                      path+=`M${x(start).toFixed(1)},${y(entry).toFixed(1)} L${x(end).toFixed(1)},${y(entry).toFixed(1)} `
                    }
                  }else{
                    let previous=false
                    const stride=Math.max(1,Math.floor(visible.length/1800))
                    for(let index=0;index<visible.length;index+=stride){
                      const point=visible[index],entry=value(point,key)
                      if(entry==null){previous=false;continue}
                      path+=`${previous?"L":"M"}${x(point.time).toFixed(1)},${y(entry).toFixed(1)} `
                      previous=true
                    }
                  }
                  return <g key={key}>{!comparisonMode&&<rect x={plotLeft} y={top} width={plotWidth} height="76" fill={colors[key]} fillOpacity=".022"/>}{(!comparisonMode||metric===trackMetrics[0])&&[0,.5,1].map(fraction=><line key={fraction} x1={plotLeft} x2={plotRight} y1={graphBottom-fraction*graphHeight} y2={graphBottom-fraction*graphHeight} stroke="currentColor" opacity=".07"/>)}{(!comparisonMode||metric===trackMetrics[0])&&laps.filter(lap=>lap.start>=view[0]&&lap.start<=view[1]).map(lap=><line key={lap.id} x1={x(lap.start)} x2={x(lap.start)} y1={top} y2={comparisonMode?height-12:top+76} stroke="currentColor" opacity=".1" strokeDasharray="3 3"/>)}<path d={path} fill="none" stroke={colors[key]} strokeWidth={comparisonMode?2:1.85} strokeLinejoin="round"/></g>
                })}
                {graphHover&&<rect x={x(graphHover.start)} y="0" width={Math.max(2,x(graphHover.end)-x(graphHover.start))} height={height} fill="#64748b" fillOpacity=".14"/>}{selection&&<rect x={Math.min(x(selection[0]),x(selection[1]))} y="0" width={Math.abs(x(selection[1])-x(selection[0]))} height={height} fill="currentColor" fillOpacity=".055"/>}{nearest&&<line x1={x(nearest.time)} x2={x(nearest.time)} y1="0" y2={height} stroke="currentColor" opacity=".4" strokeDasharray="3 3"/>}
              </svg>
              {!comparisonMode&&<div className="pointer-events-none absolute inset-0" aria-hidden="true">{trackMetrics.map(metric=><div key={metric.key} className="absolute inset-x-0 grid grid-cols-[12.6%_75.2%_12.2%] font-normal" style={{top:`${metric.top/height*100}%`,height:`${76/height*100}%`}}><div className="analysis-signal-label flex flex-col justify-center px-3 text-[11px]" style={{borderLeftColor:colors[metric.key]}}><span className="text-xs font-normal">{label(metric.key)}</span><span className="analysis-signal-summary"><span>Avg <span className="analysis-signal-value">{format(metric.average,metric.key)}</span></span><span>Max <span className="analysis-signal-value">{format(metric.peak,metric.key)}</span></span></span></div><span/><div className="analysis-signal-readout flex flex-col items-center justify-center font-normal"><span className="analysis-cursor-label">At cursor</span><span className="analysis-live-value tabular-nums">{format(metric.live,metric.key)}<span className="analysis-live-unit"> {unit(metric.key)}</span></span></div></div>)}</div>}
            </div>
            {!comparisonMode&&range&&<div className="border-t px-4 py-1" aria-label="Pan selected chart range"><svg viewBox="0 0 1080 22" preserveAspectRatio="none" className="block h-6 w-full cursor-grab touch-none active:cursor-grabbing" role="slider" aria-label="Click to reset zoom or drag the selected range to pan" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(view[0])} aria-valuetext={`${clock(view[0])} to ${clock(view[1])}`} onClick={resetFromChartClick} onPointerDown={event=>down(event,true)} onPointerMove={event=>move(event,true)} onPointerUp={up} onPointerCancel={()=>{gesture.current=null;setSelection(null)}}><rect x={plotLeft} y="8" width={plotWidth} height="6" rx="3" fill="currentColor" opacity=".08"/><rect x={x(view[0],true)} y="5" width={Math.max(8,x(view[1],true)-x(view[0],true))} height="12" rx="3" fill="#64748b" fillOpacity=".35" stroke="#475569" strokeWidth="1"/></svg></div>}
          </div>}
          </section>
        </div>
      </div>
      </div>
    </section>
  </>
}
