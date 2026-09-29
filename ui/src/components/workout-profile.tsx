import {WorkoutEditor,useEditedWorkout} from '@/components/workout-editor'
import {useState} from 'react'
import {workoutProfileSegments,workoutStepLabel} from '@/lib/workout-structure'
import type {PlannedWorkout} from '@/lib/training-context'
import {Tooltip,TooltipTrigger,TooltipContent,TooltipProvider} from '@/components/ui/tooltip'
import {chartSegments,stepLabel} from '../../../app-backend/lib/workout-editor-model.mjs'

type ProfileProps={workout:PlannedWorkout;compact?:boolean;tall?:boolean;mobilePlanned?:boolean;mobileCalendar?:boolean;desktopDetail?:boolean;home?:boolean;enableEditOnClick?:boolean;onEditNode?:(id:string)=>void}
export function WorkoutProfile(props:ProfileProps){
 const workout=useEditedWorkout(props.workout),[editing,setEditing]=useState<string|null>(null)
 const editable=Boolean(props.enableEditOnClick)&&workout.id.startsWith('event:')&&workout.status!=='completed'
 const edit=(id='')=>{if(!editable)return;props.onEditNode?.(id);if(!props.onEditNode)setEditing(id)}
 return <><div data-workout-profile={workout.id} role={editable?'button':undefined} tabIndex={editable?0:undefined} aria-label={editable?`Edit ${workout.title}`:undefined} title={editable?'Click an interval to edit it':undefined} className={editable?'cursor-pointer':undefined} onPointerDown={event=>{if(editable)event.stopPropagation()}} onKeyDown={event=>{if(editable&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();edit()}}} onClick={event=>{if(editable){event.stopPropagation();edit()}}}>
  <WorkoutProfileChart {...props} workout={workout} onEditNode={editable&&!props.mobilePlanned?edit:undefined}/>
 </div>{editing!==null&&<div onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}><WorkoutEditor workout={workout} initialFocusId={editing||undefined} onClose={()=>setEditing(null)}/></div>}</>
}
function WorkoutProfileChart({workout,compact=false,tall=false,mobilePlanned=false,mobileCalendar=false,desktopDetail=false,home=false,onEditNode}:ProfileProps){
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
