import {WorkoutDescription} from '@/components/workout-description'
import {lazy,Suspense,useState} from 'react'
import {formatDuration} from '@/lib/duration'
import { MobileHeaderMenu } from "@/components/ui/mobile-header-menu"
const WorkoutAnalysis=lazy(()=>import('@/components/workout-analysis').then(m=>({default:m.WorkoutAnalysis})))
import {WorkoutRouteMap} from '@/components/workout-route-map'
import { WorkoutProfile } from "@/components/workout-profile"
import { WorkoutSummary } from "@/components/workout-summary"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import {ArrowLeft} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  completedMinutes,
  durationMinutes,
  type PlannedWorkout,
} from "@/lib/training-context"





export function WorkoutDetailPage({
  workout,
  onBack,
}: {
  workout: PlannedWorkout
  onBack: () => void
}) {
  const [mapAvailable,setMapAvailable]=useState(false)
  const completed = completedMinutes(workout)
  const values=workout.status==='completed'?workout.workout_summary?.completed:workout.workout_summary?.planned
  const swim=/swim/i.test(workout.sport),bike=/bike|ride/i.test(workout.sport)
  const numeric=(value:number|null|undefined,digits=0)=>value!=null&&Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:digits}):null
  const pace=values?.average_speed && values.average_speed>0?Math.round((swim?91.44:1609.344)/values.average_speed):null
  const duration=values?.duration_seconds!=null?Math.round(values.duration_seconds):null
  const movingTime=duration!=null?duration>=3600?`${Math.floor(duration/3600)}:${String(Math.floor(duration%3600/60)).padStart(2,'0')}:${String(duration%60).padStart(2,'0')}`:`${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}`:Number.isFinite(workout.actualDurationMinutes)?formatDuration(completed):null
  const stats=[
    {label:workout.status==='completed'?'Distance':'Est. distance',value:plannedDistanceLabel(workout)},
    {label:'Elevation gain',value:values?.elevation_gain!=null?`${numeric(values.elevation_gain/.3048)} ft`:null},
    {label:workout.status==='completed'?'Moving time':'Planned time',value:workout.status==='completed'?movingTime:formatDuration(durationMinutes(workout))},
    {label:bike?'Avg power':'Avg pace',value:bike?(values?.average_power!=null?`${numeric(values.average_power)} W`:null):pace?`${Math.floor(pace/60)}:${String(pace%60).padStart(2,'0')} /${swim?'100 yd':'mi'}`:null},
    {label:bike?'Avg speed':'Avg heart rate',value:bike?(values?.average_speed!=null?`${numeric(values.average_speed*2.236936,1)} mi/h`:null):values?.average_hr!=null?`${numeric(values.average_hr)} bpm`:null},
    {label:'Calories',value:values?.calories!=null?`${numeric(values.calories)} Cal`:null},
    ...(!bike?[{label:'Max heart rate',value:values?.max_hr!=null?`${numeric(values.max_hr)} bpm`:null}]:[]),
  ].filter(stat=>stat.value && stat.value!=='—')

  return (
    <div className="min-h-svh w-full min-w-0 bg-background">
      <header className="mobile-site-header sticky top-0 z-40 flex h-[72px] items-center border-b bg-background/95 px-4 backdrop-blur md:px-4">
        <Button type="button" variant="ghost" onClick={onBack} className="size-11 shrink-0 rounded-full bg-muted/35 p-0" aria-label="Back">
          <ArrowLeft className="size-6" />
        </Button>
        <span className="mobile-header-title flex-1 truncate text-center text-lg font-semibold">{swim?'Swim':bike?'Ride':/run/i.test(workout.sport)?'Run':workout.sport}</span>
      <MobileHeaderMenu /></header>

      <div className="mx-auto w-full max-w-3xl">
      <WorkoutRouteMap workout={workout} onAvailable={setMapAvailable}/>
      <article className={`relative flex w-full min-w-0 flex-col gap-6 bg-background px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-7 md:px-8 ${mapAvailable?'-mt-7 rounded-t-[28px] pt-3':'pt-5'}`}>
        {mapAvailable&&<div aria-hidden="true" className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-muted-foreground/35"/>}
        <section className="space-y-5 pt-1">
          <div className="flex items-start gap-3">
            <h1 className="text-[27px] leading-tight font-bold tracking-tight sm:text-3xl">
              {workout.title}
            </h1>
          </div>
        </section>

        <section aria-label="Workout highlights" className="grid grid-cols-2 gap-x-6 gap-y-7 py-3 text-center">{stats.map(stat=><div key={stat.label}><p className="text-xs text-muted-foreground sm:text-sm">{stat.label}</p><p className="mt-1.5 text-lg font-bold tracking-tight tabular-nums sm:text-2xl">{stat.value}</p></div>)}</section>

        {workout.status!=='completed'&&<><WorkoutDescription workout={workout}/><WorkoutProfile workout={workout}/></>}
        <div className="hidden md:block"><WorkoutSummary workout={workout}/></div>
        <Suspense fallback={<div className="h-44 animate-pulse rounded-xl bg-muted/30"/>}><WorkoutAnalysis workout={workout}/></Suspense>
        {workout.status==='completed'&&<><WorkoutDescription workout={workout}/><WorkoutProfile workout={workout}/></>}

      </article>
      </div>
    </div>
  )
}
