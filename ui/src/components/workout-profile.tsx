import {WorkoutEditor,useEditedWorkout} from '@/components/workout-editor'
import {useState} from 'react'
import {workoutProfileSegments,workoutStepLabel} from '@/lib/workout-structure'
import type {PlannedWorkout} from '@/lib/training-context'
import {Tooltip,TooltipTrigger,TooltipContent,TooltipProvider} from '@/components/ui/tooltip'
import {chartSegments,stepLabel} from '../../../app-backend/lib/workout-editor-model.mjs'

type ProfileProps={workout:PlannedWorkout;compact?:boolean;tall?:boolean;mobilePlanned?:boolean;desktopDetail?:boolean;home?:boolean;enableEditOnClick?:boolean;onEditNode?:(id:string)=>void}
export function WorkoutProfile(props:ProfileProps){
 const workout=useEditedWorkout(props.workout),[editing,setEditing]=useState<string|null>(null)
 const editable=Boolean(props.enableEditOnClick)&&workout.id.startsWith('event:')&&workout.status!=='completed'
 const edit=(id='')=>{if(!editable)return;props.onEditNode?.(id);if(!props.onEditNode)setEditing(id)}
 return <><div data-workout-profile={workout.id} role={editable?'button':undefined} tabIndex={editable?0:undefined} aria-label={editable?`Edit ${workout.title}`:undefined} title={editable?'Click an interval to edit it':undefined} className={editable?'cursor-pointer':undefined} onPointerDown={event=>{if(editable)event.stopPropagation()}} onKeyDown={event=>{if(editable&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();edit()}}} onClick={event=>{if(editable){event.stopPropagation();edit()}}}>
  <WorkoutProfileChart {...props} workout={workout} onEditNode={editable?edit:undefined}/>
 </div>{editing!==null&&<div onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}><WorkoutEditor workout={workout} initialFocusId={editing||undefined} onClose={()=>setEditing(null)}/></div>}</>
}
function WorkoutProfileChart({workout,compact=false,tall=false,mobilePlanned=false,desktopDetail=false,home=false,onEditNode}:ProfileProps){
 if(workout.editor_model)return <CanonicalWorkoutProfile workout={workout} compact={compact||mobilePlanned} tall={tall||desktopDetail} home={home} desktopDetail={desktopDetail} onEditNode={onEditNode}/>
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
 return <TooltipProvider delay={100} closeDelay={100}><div className={`relative flex items-end gap-[2px] overflow-hidden border-b border-border/60 ${mobilePlanned?'h-12':heightClass}`} aria-label="Intervals.icu workout profile">
  {groups.map(profileGroup=>{
   const segment=profileGroup.segments[0],width=profileGroup.segments.reduce((sum,item)=>sum+item.width,0)
   const setLabel=segment.repeatCount>1?`${segment.repeatCount} x set: ${segment.group.map(step=>workoutStepLabel(step,workout.sport)).join(' + ')}`:workoutStepLabel(segment.step,workout.sport)
   const isSingleStep=profileGroup.segments.every(item=>item.step===segment.step)
   const peak=Math.max(...profileGroup.segments.map(item=>item.intensity),1)
   const start=profileGroup.segments[0].intensity/peak*100,end=profileGroup.segments.at(-1)!.intensity/peak*100
   return <Tooltip key={profileGroup.id}><TooltipTrigger render={<button type="button" className={`group/profile relative flex h-full min-w-px items-end outline-none ${mobilePlanned?'':'gap-px'}`} style={{flexGrow:width,flexBasis:0}} aria-label={setLabel} />}>
    {mobilePlanned&&isSingleStep?<span className="absolute inset-x-0 bottom-0 min-h-1 rounded-t-[3px] bg-primary transition-[filter] group-hover/profile:brightness-90 group-focus-visible/profile:brightness-90" style={{height:`${peak}%`,clipPath:`polygon(0 ${100-start}%,100% ${100-end}%,100% 100%,0 100%)`}}/>:profileGroup.segments.map((item,index)=><span key={index} className="relative h-full min-w-px" style={{flexGrow:item.width,flexBasis:0}}><span className={`absolute inset-x-0 bottom-0 rounded-t-[3px] transition-[filter] group-hover/profile:brightness-90 group-focus-visible/profile:brightness-90 ${profileBarColor(item.intensity)}`} style={{height:`${item.intensity}%`}} /></span>)}
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
function CanonicalWorkoutProfile({workout,compact,tall,home,desktopDetail,onEditNode}:{workout:PlannedWorkout;compact:boolean;tall:boolean;home:boolean;desktopDetail:boolean;onEditNode?:(id:string)=>void}){
 const chart=chartSegments(workout.editor_model!),max=Math.max(1.3,...chart.segments.flatMap(s=>[s.start,s.end]));
 const heightClass=home?'h-20 md:h-28':desktopDetail?(tall?'h-[130px]':'h-[82px]'):compact?(tall?'h-20':'h-12'):(tall?'h-32':'h-32')
 return <TooltipProvider delay={100} closeDelay={100}><div><div className={`relative flex items-end gap-[2px] overflow-hidden border-b border-border/60 ${heightClass}`} aria-label={`Workout profile · ${chart.axis}`}>
 {chart.segments.map(s=>{const intensity=(s.start+s.end)/(2*max)*100;return <Tooltip key={`${s.step.id}:${s.index}`}><TooltipTrigger render={<button type="button" className="group/profile relative h-full min-w-px outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" style={{flexGrow:s.width,flexBasis:0}} aria-label={`${s.step.label}: ${stepLabel(s.step)}`} onClick={event=>{if(!onEditNode)return;event.stopPropagation();onEditNode(s.step.id)}} />}><span className={`absolute inset-x-0 bottom-0 rounded-t-[3px] transition-[filter] group-hover/profile:brightness-90 ${s.step.role==='rest'?'bg-muted-foreground/25':profileBarColor(intensity)}`} style={{height:'100%',clipPath:`polygon(0 ${100-(8+s.start/max*85)}%,100% ${100-(8+s.end/max*85)}%,100% 100%,0 100%)`}}/></TooltipTrigger><TooltipContent className="border border-border bg-popover text-popover-foreground"><p>{s.step.label} · {stepLabel(s.step)}</p>{s.step.notes&&<p>{s.step.notes}</p>}{s.group&&<p>Repetition {s.iteration}</p>}</TooltipContent></Tooltip>})}
 </div>{!compact&&<p className="mt-1 text-[10px] text-muted-foreground">{chart.axis}</p>}</div></TooltipProvider>
}

function profileBarColor(intensity:number){
 if(intensity<=8)return 'bg-muted-foreground/25'
 if(intensity<45)return 'bg-primary/45'
 if(intensity<70)return 'bg-primary/70'
 return 'bg-primary'
}
