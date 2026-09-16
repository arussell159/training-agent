import {workoutProfileSegments,workoutStepLabel} from '@/lib/workout-structure'
import type {PlannedWorkout} from '@/lib/training-context'
import {Tooltip,TooltipTrigger,TooltipContent,TooltipProvider} from '@/components/ui/tooltip'

export function WorkoutProfile({workout,compact=false,tall=false,mobilePlanned=false,desktopDetail=false}:{workout:PlannedWorkout;compact?:boolean;tall?:boolean;mobilePlanned?:boolean;desktopDetail?:boolean}){
 const segments=workoutProfileSegments(workout.structure)
 if(!segments.length)return null
 const groups=segments.reduce<Array<{id:string;segments:typeof segments}>>((result,segment)=>{
  const previous=result.at(-1)
  if(previous?.id===segment.setId)previous.segments.push(segment)
  else result.push({id:segment.setId,segments:[segment]})
  return result
 },[])
 return <TooltipProvider><div className={mobilePlanned?'relative flex h-12 items-end gap-1 overflow-hidden':desktopDetail?`relative flex items-end gap-px overflow-hidden ${tall?'h-[130px]':'h-[82px]'}`:compact?`relative flex items-end gap-px overflow-hidden ${tall?'h-20':'h-8'}`:'relative flex h-32 items-end gap-px border bg-slate-50 px-2 py-3 dark:bg-slate-900 sm:h-32'} aria-label="Intervals.icu workout profile">
  {groups.map(profileGroup=>{
   const segment=profileGroup.segments[0],width=profileGroup.segments.reduce((sum,item)=>sum+item.width,0)
   const setLabel=segment.repeatCount>1?`${segment.repeatCount} x set: ${segment.group.map(step=>workoutStepLabel(step,workout.sport)).join(' + ')}`:workoutStepLabel(segment.step,workout.sport)
   const isSingleStep=profileGroup.segments.every(item=>item.step===segment.step)
   const peak=Math.max(...profileGroup.segments.map(item=>item.intensity),1)
   const start=profileGroup.segments[0].intensity/peak*100,end=profileGroup.segments.at(-1)!.intensity/peak*100
   return <Tooltip key={profileGroup.id}><TooltipTrigger render={<button type="button" className={`group/profile relative flex h-full min-w-px items-end outline-none ${mobilePlanned?'':'gap-px'}`} style={{flexGrow:width,flexBasis:0}} aria-label={setLabel} />}>
    {mobilePlanned&&isSingleStep?<span className="absolute inset-x-0 bottom-0 min-h-1 bg-sky-500 transition-[filter] group-hover/profile:brightness-90 group-focus-visible/profile:brightness-90" style={{height:`${peak}%`,clipPath:`polygon(0 ${100-start}%,100% ${100-end}%,100% 100%,0 100%)`}}/>:profileGroup.segments.map((item,index)=><span key={index} className="relative h-full min-w-px" style={{flexGrow:item.width,flexBasis:0}}><span className={`absolute inset-x-0 bottom-0 transition-[filter] group-hover/profile:brightness-90 group-focus-visible/profile:brightness-90 ${mobilePlanned?'bg-sky-500':'border-t-2 border-blue-600 bg-slate-300 dark:bg-slate-600'}`} style={{height:`${item.intensity}%`}} /></span>)}
   </TooltipTrigger>
    <TooltipContent className="border border-slate-200 bg-white px-3 py-2 text-slate-950" arrowClassName="bg-white fill-white">
     <div className="min-w-44 space-y-2">
      <p className="text-xs font-semibold">{segment.repeatCount>1?`${segment.repeatCount} x set`:'Workout interval'}</p>
      {segment.group.map((step,i)=><div key={i} className="flex gap-2 text-xs"><span className="text-slate-400">{i+1}</span><div className="border-l border-slate-200 pl-2"><p>{step.intensity==='rest'?'Rest':step.text || 'Work'}</p><p className="mt-0.5 font-normal text-slate-600">{workoutStepLabel(step,workout.sport)}</p></div></div>)}
     </div>
    </TooltipContent>
   </Tooltip>
  })}
 </div></TooltipProvider>
}
