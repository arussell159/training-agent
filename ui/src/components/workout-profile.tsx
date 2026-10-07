import {WorkoutEditor,useEditedWorkout} from '@/components/workout-editor'
import {Fragment,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react'
import {workoutProfileSegments,workoutStepLabel} from '@/lib/workout-structure'
import type {PlannedWorkout} from '@/lib/training-context'
import {Tooltip,TooltipTrigger,TooltipContent,TooltipProvider} from '@/components/ui/tooltip'
import {chartSegments,stepLabel,stepMetrics} from '../../../app-backend/lib/workout-editor-model.mjs'

type ProfileProps={workout:PlannedWorkout;compact?:boolean;tall?:boolean;mobilePlanned?:boolean;mobileCalendar?:boolean;desktopDetail?:boolean;home?:boolean;enableEditOnClick?:boolean;onEditNode?:(id:string)=>void;disableDesktopTimeline?:boolean}
export function WorkoutProfile(props:ProfileProps){
 const workout=useEditedWorkout(props.workout),[editing,setEditing]=useState<string|null>(null)
 const editable=Boolean(props.enableEditOnClick)&&workout.id.startsWith('event:')&&workout.status!=='completed'
 const edit=(id='')=>{if(!editable)return;props.onEditNode?.(id);if(!props.onEditNode)setEditing(id)}
 return <><div data-workout-profile={workout.id} role={editable?'button':undefined} tabIndex={editable?0:undefined} aria-label={editable?`Edit ${workout.title}`:undefined} title={editable?'Click an interval to edit it':undefined} className={editable?'cursor-pointer':undefined} onPointerDown={event=>{if(editable)event.stopPropagation()}} onKeyDown={event=>{if(editable&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();edit()}}} onClick={event=>{if(editable){event.stopPropagation();edit()}}}>
  <WorkoutProfileChart {...props} workout={workout} onEditNode={editable&&!props.mobilePlanned?edit:undefined}/>
 </div>{editing!==null&&<div onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}><WorkoutEditor workout={workout} initialFocusId={editing||undefined} onClose={()=>setEditing(null)}/></div>}</>
}
function WorkoutProfileChart(props:ProfileProps){
 const {workout,compact=false,tall=false,mobilePlanned=false,mobileCalendar=false,desktopDetail=false,home=false,onEditNode,disableDesktopTimeline=false}=props
 if(desktopDetail&&!disableDesktopTimeline&&workout.status!=='completed')return <><div className="hidden lg:block"><DesktopPlannedWorkoutTimeline workout={workout} tall={tall} onEditNode={onEditNode}/></div><div className="lg:hidden"><WorkoutProfileChart {...props} disableDesktopTimeline/></div></>
 if(workout.editor_model)return <CanonicalWorkoutProfile workout={workout} compact={compact||mobilePlanned} tall={tall||desktopDetail} mobilePlanned={mobilePlanned} mobileCalendar={mobileCalendar} home={home} desktopDetail={desktopDetail} onEditNode={onEditNode}/>
 const segments=workoutProfileSegments(workout.structure)
 if(!segments.length)return null
 const groups=segments.reduce<Array<{id:string;segments:typeof segments}>>((result,segment)=>{
  const previous=result.at(-1)
  if(previous?.id===segment.setId)previous.segments.push(segment)
  else result.push({id:segment.setId,segments:[segment]})
  return result
 },[])
 const heightClass=home?'h-20 md:h-28':desktopDetail?(tall?'h-[130px]':'h-[82px]'):compact?(tall?'h-20':'h-8'):(tall?'h-32':'h-32')
 const intervalTime=(seconds:number)=>{const value=Math.max(0,Math.round(seconds));return value<60?`${value} sec`:`${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`}
  return <TooltipProvider delay={100} closeDelay={100}><div className={`relative flex items-end gap-[2px] overflow-hidden border-b border-foreground/10 ${mobilePlanned?'h-12':heightClass}`} aria-label="Intervals.icu workout profile">
  {groups.map(profileGroup=>{
   const segment=profileGroup.segments[0],width=profileGroup.segments.reduce((sum,item)=>sum+item.width,0)
   const setLabel=segment.repeatCount>1?`${segment.repeatCount} x set: ${segment.group.map(step=>workoutStepLabel(step,workout.sport)).join(' + ')}`:workoutStepLabel(segment.step,workout.sport)
   return <Tooltip key={profileGroup.id}><TooltipTrigger render={<button type="button" className={`group/profile relative flex h-full min-w-px items-end outline-none ${mobileCalendar?'gap-[2px]':mobilePlanned?'':'gap-px'}`} style={{flexGrow:width,flexBasis:0}} aria-label={setLabel} />}>
     {profileGroup.segments.map((item,index)=><span key={index} className="relative h-full min-w-px" style={{flexGrow:item.width,flexBasis:0}}><span className={`absolute inset-x-0 bottom-0 ${mobileCalendar?'':'rounded-t-[4px]'} shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] transition-[filter] group-hover/profile:brightness-90 group-focus-visible/profile:brightness-90 ${profileBarColor(item.intensity,workout.sport,mobileCalendar)}`} style={{height:`${item.intensity}%`}} /></span>)}
   </TooltipTrigger>
    <TooltipContent className="border border-slate-200 bg-white px-3 py-2 text-slate-950" arrowClassName="bg-white fill-white">
     <div className="min-w-44 space-y-2">
      <p className="text-xs font-semibold">{segment.repeatCount>1?`${segment.repeatCount} x set`:'Workout interval'}</p>
      {segment.group.map((step,i)=><div key={i} className="flex gap-2 text-xs"><span className="text-muted-foreground">{i+1}</span><div className="border-l border-border pl-2"><p>{step.intensity==='rest'?'Rest':step.text || 'Work'}</p><p className="mt-0.5 font-normal text-muted-foreground">{workoutStepLabel(step,workout.sport)}</p></div></div>)}
      <div className="flex items-center justify-between gap-4 border-t border-border pt-1 text-xs text-muted-foreground"><span>{segment.repeatCount>1?`Repeat ${segment.repeatIndex} of ${segment.repeatCount}`:segment.step.ramp?'Ramp interval':'Interval'}</span><span className="tabular-nums">{intervalTime(segment.step.duration || segment.width)}</span></div>
     </div>
    </TooltipContent>
   </Tooltip>
  })}
  </div></TooltipProvider>
}
type DesktopTimelinePart={key:string;seconds:number;start:number;end:number;rest:boolean;title:string;description:string;notes?:string;repeat?:string;stepId?:string}
function timelineParts(workout:PlannedWorkout):DesktopTimelinePart[]{
 if(workout.editor_model){
  const model=workout.editor_model,chart=chartSegments(model),values=chart.segments.flatMap(s=>[s.start,s.end]),max=Math.max(1.3,...values)
  return chart.segments.map((s,index)=>{
   const metrics=stepMetrics(s.step,model.thresholds),measured=Number(metrics.seconds),seconds=Number.isFinite(measured)&&measured>0?measured:60
   return {key:`${s.step.id||index}:${s.index}`,seconds,start:Math.max(0,Math.min(1,s.start/max)),end:Math.max(0,Math.min(1,s.end/max)),rest:s.step.role==='rest',title:String(s.step.label||`Interval ${index+1}`),description:stepLabel(s.step),notes:typeof s.step.notes==='string'?s.step.notes:undefined,repeat:s.iteration?`Repetition ${s.iteration}`:undefined,stepId:typeof s.step.id==='string'?s.step.id:undefined}
  })
 }
 return workoutProfileSegments(workout.structure).map((s,index)=>({key:`${s.setId}:${index}`,seconds:Math.max(0.001,Number(s.width)||60),start:Math.max(0,Math.min(1,s.intensity/100)),end:Math.max(0,Math.min(1,s.intensity/100)),rest:s.step.intensity==='rest',title:s.repeatCount>1?`${s.repeatCount} × set`:'Workout interval',description:workoutStepLabel(s.step,workout.sport),repeat:s.repeatCount>1?`Repetition ${s.repeatIndex} of ${s.repeatCount}`:undefined}))
}
function timelineClock(seconds:number){
 const whole=Math.max(0,Math.floor(seconds)),hours=Math.floor(whole/3600),minutes=Math.floor((whole%3600)/60),remainder=whole%60
 return hours?`${hours}:${String(minutes).padStart(2,'0')}:${String(remainder).padStart(2,'0')}`:`${minutes}:${String(remainder).padStart(2,'0')}`
}
function DesktopPlannedWorkoutTimeline({workout,tall,onEditNode}:{workout:PlannedWorkout;tall:boolean;onEditNode?:(id:string)=>void}){
 const parts=timelineParts(workout),totalSeconds=parts.reduce((sum,part)=>sum+part.seconds,0)
 const contentRef=useRef<HTMLDivElement|null>(null),lastClientX=useRef<number|null>(null),[cursor,setCursor]=useState<{x:number;width:number}|null>(null)
 if(!parts.length||totalSeconds<=0)return null
 const intervals=[60,120,180,300,600,900,1200,1800,3600],targetInterval=totalSeconds/8,tickInterval=intervals.find(value=>value>=targetInterval)||3600
 const ticks:number[]=[]
 for(let value=0;value<totalSeconds;value+=tickInterval)ticks.push(value)
 if(ticks.at(-1)!==totalSeconds)ticks.push(totalSeconds)
 const preferredWidth=Math.max(480,Math.ceil(totalSeconds*0.55)),heightClass=tall?'h-[130px]':'h-[82px]'
 let elapsed=0
 const handlePointerMove=(event:ReactPointerEvent<HTMLDivElement>)=>{
  lastClientX.current=event.clientX
  const rect=contentRef.current?.getBoundingClientRect()
  if(!rect)return
  setCursor({x:Math.max(0,Math.min(rect.width,event.clientX-rect.left)),width:rect.width})
 }
 const updateCursorAfterScroll=()=>{
  if(lastClientX.current==null)return
  const rect=contentRef.current?.getBoundingClientRect()
  if(rect)setCursor({x:Math.max(0,Math.min(rect.width,lastClientX.current-rect.left)),width:rect.width})
 }
 const cursorSeconds=cursor&&cursor.width>0?Math.max(0,Math.min(totalSeconds,cursor.x/cursor.width*totalSeconds)):0
 return <TooltipProvider delay={100} closeDelay={100}><div role="region" aria-label={`Scrollable planned workout profile, ${timelineClock(totalSeconds)} total`} tabIndex={0} className="max-w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onPointerMove={handlePointerMove} onPointerLeave={()=>{lastClientX.current=null;setCursor(null)}} onScroll={updateCursorAfterScroll}><div ref={contentRef} className="relative" style={{width:`max(100%, ${preferredWidth}px)`}}>
  <div className={`relative flex items-end gap-[2px] overflow-hidden border-b border-foreground/10 ${heightClass}`} aria-label={`Workout intervals from ${timelineClock(0)} to ${timelineClock(totalSeconds)}`}>
   {parts.map((part)=>{
    const startSeconds=elapsed;elapsed+=part.seconds
    const inset=8,plotHeight=85,startHeight=inset+part.start*plotHeight,endHeight=inset+part.end*plotHeight,intensity=(part.start+part.end)*50
    return <Tooltip key={part.key}><TooltipTrigger render={<button type="button" className="group/profile relative h-full min-w-px flex-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" style={{flexGrow:part.seconds,flexBasis:0}} aria-label={`${part.title}: ${part.description}`} onClick={event=>{if(!onEditNode||!part.stepId)return;event.stopPropagation();onEditNode(part.stepId)}}><span className={`absolute inset-x-0 bottom-0 rounded-t-[4px] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] transition-[filter] group-hover/profile:brightness-90 ${part.rest?'bg-muted-foreground/25':profileBarColor(intensity,workout.sport)}`} style={{height:'100%',clipPath:`polygon(0 ${100-startHeight}%,100% ${100-endHeight}%,100% 100%,0 100%)`}}/></button>} /><TooltipContent className="border border-border bg-popover text-popover-foreground"><div className="min-w-44 space-y-1"><p className="text-xs font-semibold">{part.title}</p><p className="text-xs">{part.description}</p>{part.notes&&<p className="text-xs text-muted-foreground">{part.notes}</p>}{part.repeat&&<p className="text-xs text-muted-foreground">{part.repeat}</p>}<p className="border-t border-border pt-1 text-[10px] tabular-nums text-muted-foreground">{timelineClock(startSeconds)}–{timelineClock(startSeconds+part.seconds)}</p></div></TooltipContent></Tooltip>
   })}
  </div>
  {cursor&&<><div aria-hidden="true" className="pointer-events-none absolute top-0 bottom-6 z-10 border-l-2 border-slate-900/80 shadow-[0_0_2px_rgba(255,255,255,0.9)]" style={{left:cursor.x}}/><span aria-hidden="true" className="pointer-events-none absolute top-0 z-20 -translate-x-1/2 rounded bg-popover px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-popover-foreground shadow" style={{left:cursor.x}}>{timelineClock(cursorSeconds)}</span></>}
  <div className="relative h-6 border-t border-border/70 text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">{ticks.map((tick,index)=><Fragment key={tick}><span className="absolute top-0 bottom-4 border-l border-border/60" style={{left:`${tick/totalSeconds*100}%`}}/><span className="absolute top-1 whitespace-nowrap" style={{left:`${tick/totalSeconds*100}%`,transform:index===0?'none':index===ticks.length-1?'translateX(-100%)':'translateX(-50%)'}}>{timelineClock(tick)}</span></Fragment>)}</div>
 </div></div></TooltipProvider>
}
function CanonicalWorkoutProfile({workout,compact,tall,home,desktopDetail,mobilePlanned,mobileCalendar,onEditNode}:{workout:PlannedWorkout;compact:boolean;tall:boolean;home:boolean;desktopDetail:boolean;mobilePlanned:boolean;mobileCalendar:boolean;onEditNode?:(id:string)=>void}){
 const chart=chartSegments(workout.editor_model!),values=chart.segments.flatMap(s=>[s.start,s.end]),max=Math.max(mobilePlanned?0.001:1.3,...values),colorScale=Math.max(1.3,...values);
 const heightClass=home?'h-20 md:h-28':desktopDetail?(tall?'h-[130px]':'h-[82px]'):compact?(tall?'h-20':'h-12'):(tall?'h-32':'h-32')
  return <TooltipProvider delay={100} closeDelay={100}><div><div className={`relative flex items-end gap-[2px] overflow-hidden border-b border-foreground/10 ${heightClass}`} aria-label={`Workout profile · ${chart.axis}`}>
  {chart.segments.map(s=>{const intensity=(s.start+s.end)/(2*colorScale)*100;const inset=mobilePlanned?0:8;const plotHeight=mobilePlanned?100:85;return <Tooltip key={`${s.step.id}:${s.index}`}><TooltipTrigger render={<button type="button" className="group/profile relative h-full min-w-px outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" style={{flexGrow:s.width,flexBasis:0}} aria-label={`${s.step.label}: ${stepLabel(s.step)}`} onClick={event=>{if(!onEditNode)return;event.stopPropagation();onEditNode(s.step.id)}} />}><span className={`absolute inset-x-0 bottom-0 rounded-t-[4px] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] transition-[filter] group-hover/profile:brightness-90 ${s.step.role==='rest'?'bg-muted-foreground/25':profileBarColor(intensity,workout.sport,mobileCalendar)}`} style={{height:'100%',clipPath:`polygon(0 ${100-(inset+s.start/max*plotHeight)}%,100% ${100-(inset+s.end/max*plotHeight)}%,100% 100%,0 100%)`}}/></TooltipTrigger><TooltipContent className="border border-border bg-popover text-popover-foreground"><p>{s.step.label} · {stepLabel(s.step)}</p>{s.step.notes&&<p>{s.step.notes}</p>}{s.group&&<p>Repetition {s.iteration}</p>}</TooltipContent></Tooltip>})}
 </div>{!compact&&<p className="mt-1 text-[10px] text-muted-foreground">{chart.axis}</p>}</div></TooltipProvider>
}

function profileBarColor(intensity:number,sport:string,mobileCalendar=false){
 const value=sport.toLowerCase()
 const shades=mobileCalendar
  ? value.includes('swim')
   ? ['bg-sky-500/25','bg-sky-500/45','bg-sky-500/70','bg-sky-600']
   : value.includes('bike')||value.includes('brick')
    ? ['bg-indigo-500/25','bg-indigo-500/45','bg-indigo-500/70','bg-indigo-600']
    : value.includes('run')
     ? ['bg-emerald-500/25','bg-emerald-500/45','bg-emerald-500/70','bg-emerald-600']
     : value.includes('strength')
      ? ['bg-amber-500/25','bg-amber-500/45','bg-amber-500/70','bg-amber-600']
      : ['bg-slate-400/25','bg-slate-400/45','bg-slate-400/70','bg-slate-500']
  : value.includes('swim')
  ? ['bg-cyan-500/25','bg-cyan-500/45','bg-cyan-500/70','bg-cyan-500']
  : value.includes('bike')||value.includes('brick')
   ? ['bg-violet-500/25','bg-violet-500/45','bg-violet-500/70','bg-violet-500']
   : value.includes('run')
    ? ['bg-lime-500/25','bg-lime-500/45','bg-lime-500/70','bg-lime-500']
    : value.includes('strength')
     ? ['bg-orange-500/25','bg-orange-500/45','bg-orange-500/70','bg-orange-500']
     : ['bg-slate-400/25','bg-slate-400/45','bg-slate-400/70','bg-slate-400']
 if(intensity<=8)return shades[0]
 if(intensity<45)return shades[1]
 if(intensity<70)return shades[2]
 return shades[3]
}
