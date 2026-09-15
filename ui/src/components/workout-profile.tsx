import {workoutProfileSegments,workoutStepLabel} from '@/lib/workout-structure'
import type {PlannedWorkout} from '@/lib/training-context'
import {Tooltip,TooltipTrigger,TooltipContent,TooltipProvider} from '@/components/ui/tooltip'

export function WorkoutProfile({workout,compact=false}:{workout:PlannedWorkout;compact?:boolean}){
 const segments=workoutProfileSegments(workout.structure)
 if(!segments.length)return null
 return <TooltipProvider><div className={compact?'relative flex h-8 items-end overflow-hidden':'relative flex h-32 items-end gap-px rounded-md border bg-slate-50 px-2 py-3 dark:bg-slate-900 sm:h-32'} aria-label="Intervals.icu workout profile">
  {segments.map((segment,index)=>{
   const bar=<span className="absolute inset-x-0 bottom-0 border-t-2 border-blue-600 bg-slate-300 dark:bg-slate-600" style={{height:`${segment.intensity}%`}} />
   if(compact)return <span key={index} className="relative h-full min-w-px" style={{flexGrow:segment.width,flexBasis:0}}>{bar}</span>
   return <Tooltip key={index}><TooltipTrigger render={<button type="button" className="relative h-full min-w-px outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-blue-500" style={{flexGrow:segment.width,flexBasis:0}} aria-label={workoutStepLabel(segment.step,workout.sport)} />}>{bar}</TooltipTrigger>
    <TooltipContent className="border border-slate-200 bg-white px-3 py-2 text-slate-950 shadow-md" arrowClassName="bg-white fill-white">
     <div className="min-w-44 space-y-2">
      <p className="text-xs font-semibold">{segment.repeatCount>1?`Repeat ${segment.repeatCount} times`:'Workout interval'}</p>
      {segment.group.map((step,i)=><div key={i} className={`flex gap-2 text-xs ${step===segment.step?'font-semibold':''}`}><span className="text-slate-400">{i+1}</span><div className="border-l border-slate-200 pl-2"><p>{step.intensity==='rest'?'Rest':step.text || 'Work'}</p><p className="mt-0.5 font-normal text-slate-600">{workoutStepLabel(step,workout.sport)}</p></div></div>)}
     </div>
    </TooltipContent>
   </Tooltip>
  })}
 </div></TooltipProvider>
}
