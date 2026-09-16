import {WorkoutDescription} from '@/components/workout-description'
import {lazy,Suspense,useState} from 'react'
import {formatDuration} from '@/lib/duration'
import { MobileHeaderMenu } from "@/components/ui/mobile-header-menu"
const WorkoutAnalysis=lazy(()=>import('@/components/workout-analysis').then(m=>({default:m.WorkoutAnalysis})))
import {WorkoutRouteMap} from '@/components/workout-route-map'
import { WorkoutProfile } from "@/components/workout-profile"
import { WorkoutSummary } from "@/components/workout-summary"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import {
  ArrowLeft,
  Bike,
  Dumbbell,
  Footprints,
  Waves,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  completedMinutes,
  cachedTrainingContext,
  durationMinutes,
  type PlannedWorkout,
} from "@/lib/training-context"



function SportIcon({ sport }: { sport: string }) {
  const value = sport.toLowerCase()
  const className = "size-5"
  if (value.includes("swim")) return <Waves className={className} />
  if (value.includes("bike")) return <Bike className={className} />
  if (value.includes("run")) return <Footprints className={className} />
  return <Dumbbell className={className} />
}

function formatDate(workout: PlannedWorkout) {
  const recorded=workout.recorded_start_local?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/)
  if(recorded){
    const context=cachedTrainingContext()
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:context.athlete.time_zone || 'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
    const date=new Date(`${recorded[1]}T12:00:00`)
    const hour=Number(recorded[2]),time=`${hour%12 || 12}:${recorded[3]} ${hour>=12?'PM':'AM'}`
    return `${recorded[1]===today?'Today':date.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})} at ${time}`
  }
  if (!workout.workout_date) return workout.date
  const date = new Date(`${workout.workout_date}T12:00:00`)
  if (Number.isNaN(date.getTime())) return workout.date
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}


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
  const athlete=cachedTrainingContext().athlete.name || 'Athlete'
  const statusLabel =
    workout.status === "completed"
      ? "Completed"
      : workout.status === "today"
        ? "Today"
        : "Planned"

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
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">{athlete.split(' ').map(part=>part[0]).slice(0,2).join('')}</div>
            <div className="min-w-0"><p className="text-sm font-semibold">{athlete}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><SportIcon sport={workout.sport}/>{formatDate(workout)}{/zwift/i.test(workout.title)?' · Virtual':''}</p></div>
          </div>
          <div className="flex items-start gap-3">
            <h1 className="text-[27px] leading-tight font-bold tracking-tight sm:text-3xl">
              {workout.title}
            </h1>
          </div>
        </section>

        <section aria-label="Workout highlights" className="grid grid-cols-2 gap-x-6 gap-y-7 py-3 text-center">{stats.map(stat=><div key={stat.label}><p className="text-xs text-muted-foreground sm:text-sm">{stat.label}</p><p className="mt-1.5 text-lg font-bold tracking-tight tabular-nums sm:text-2xl">{stat.value}</p></div>)}</section>
        <div className="flex flex-wrap items-center gap-3 border-b pb-4 text-xs text-muted-foreground"><span>{statusLabel}</span>{workout.device_name&&<span>{workout.device_name}</span>}</div>

        <WorkoutDescription workout={workout}/>
        <WorkoutProfile workout={workout} />
        <WorkoutSummary workout={workout} />
        <Suspense fallback={<div className="h-44 animate-pulse rounded-xl bg-muted/30"/>}><WorkoutAnalysis workout={workout}/></Suspense>

      </article>
      </div>
    </div>
  )
}
