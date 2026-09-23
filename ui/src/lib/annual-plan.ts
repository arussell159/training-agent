import type { PlannedWorkout, TrainingContext } from "@/lib/training-context"
// @ts-expect-error Shared browser/server helper is plain JavaScript by design.
import { completedActivityKey, completedActivityValues } from "../../../app-backend/lib/completed-activity.mjs"

export type PlanMode = "automatic" | "manual"
export type PlanMethodology = "hours" | "tss" | "target_ctl"
export type PlanPhase = "Not Set" | "Preparation" | "Base 1" | "Base 2" | "Base 3" | "Build 1" | "Build 2" | "Peak" | "Race" | "Transition"

export const PLAN_PHASES: PlanPhase[] = ["Not Set","Preparation","Base 1","Base 2","Base 3","Build 1","Build 2","Peak","Race","Transition"]
export const PHASE_COLORS: Record<PlanPhase,string> = {
  "Not Set":"#475569",Preparation:"#52525b","Base 1":"#0369a1","Base 2":"#075985","Base 3":"#0c4a6e",
  "Build 1":"#3f6212","Build 2":"#166534",Peak:"#a16207",Race:"#c2410c",Transition:"#4b5563",
}

export interface PlanEvent {
  id:string;name:string;date:string;sport:string;distance:string;priority:"A"|"B"|"C"|null;goal:string;targetCtl:number|null;source?:string
}
export interface PlanAllocation {swim:number;bike:number;run:number;strength:number}
export interface AnnualPlanWeek {
  id:string;startDate:string;endDate:string;phase:PlanPhase;phaseWeek:number|null;recovery:boolean;
  targetHours:number|null;completedHours?:number|null;targetTss:number|null;weeksToEvent:number|null;countdownEventId:string|null;
  locked:boolean;manual:boolean;notes:string;focus:string;limiters:string;restrictions:string;recoveryStatus:string;
  allocation:PlanAllocation;projectedCtl:number|null;projectedAtl:number|null;projectedTsb:number|null;rampRate:number|null
}
export interface AnnualPlan {
  id:string;name:string;startDate:string;endDate:string;mode:PlanMode;methodology:PlanMethodology;recoveryCycle:3|4;
  baseline:number|null;background:string;currentFitness:string;availability:Record<string,number|string>;events:PlanEvent[];
  weeks:AnnualPlanWeek[];conflicts:Array<{weekId:string;message:string}>;assumptions:string[];
  source:{source_id:string;passage_id:string;title:string;url:string;claim:string;application:string};
  createdAt:string;updatedAt:string;revision:number;revisionHistory:Array<{revision:number;savedAt:string;reason:string}>;isDraft:boolean
}

type CalendarWorkout = PlannedWorkout & {category?:string;raw?:{category?:string;priority?:string;race_priority?:string;distance?:number;name?:string}}
export interface WeekActuals {scheduledHours:number|null;scheduledTss:number|null;completedHours:number|null;completedTss:number|null;scheduledCount:number;completedCount:number}

export function dateLabel(value:string, options:Intl.DateTimeFormatOptions={month:"short",day:"numeric"}) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US",{...options,timeZone:"UTC"})
}
export function formatHours(value:number|null) {
  if(value==null || !Number.isFinite(value))return "—"
  const minutes=Math.round(value*60)
  return `${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,"0")}m`
}
export function formatMetric(value:number|null,view:"hours"|"tss") {return view==="hours"?formatHours(value):value==null?"—":`${Math.round(value)} TSS`}

function plannedMinutes(workout:PlannedWorkout) {
  const seconds=workout.workout_summary?.planned?.duration_seconds
  return seconds!=null?seconds/60:workout.planned?.duration_minutes??workout.plannedDurationMinutes??null
}
export function calendarActuals(context:TrainingContext,plan:AnnualPlan|null, now = new Date()) {
  const result=new Map<string,WeekActuals>()
  if(!plan)return result
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:context.athlete.time_zone || 'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
  for(const week of plan.weeks)result.set(week.id,{scheduledHours:null,scheduledTss:null,completedHours:week.startDate<=today&&today<=week.endDate?0:null,completedTss:null,scheduledCount:0,completedCount:0})
  const actualHours=new Map<string,number>()
  const workouts=[...new Map(context.history.map(item=>[completedActivityKey(item as PlannedWorkout),item as PlannedWorkout])).values()] as PlannedWorkout[]
  for(const workout of workouts) {
    const day=workout.workout_date
    const week=plan.weeks.find(item=>day&&day>=item.startDate&&day<=item.endDate)
    if(!week)continue
    const totals=result.get(week.id)!
    const scheduled=plannedMinutes(workout)
    const scheduledTss=workout.workout_summary?.planned?.tss??workout.planned?.tss??(workout.id.startsWith("event:")?workout.load:null)
    if(workout.id.startsWith("event:")&&(scheduled!=null||scheduledTss!=null)) {
      totals.scheduledHours=(totals.scheduledHours??0)+(scheduled??0)/60
      totals.scheduledTss=(totals.scheduledTss??0)+(scheduledTss??0)
      totals.scheduledCount++
    }
    if(workout.status==="completed"||workout.completed_data?.duration_minutes!=null||workout.workout_summary?.completed) {
      const actual = completedActivityValues(workout)
      const completed=actual.hours*60,completedTss=workout.workout_summary?.completed?.tss??workout.completed_data?.tss??null
      if(completed!=null){totals.completedHours=(totals.completedHours??0)+completed/60;actualHours.set(week.id,(actualHours.get(week.id)??0)+completed/60)}
      if(completedTss!=null)totals.completedTss=(totals.completedTss??0)+completedTss
      totals.completedCount++
    }
  }
  for(const week of plan.weeks){const totals=result.get(week.id)!;if(week.endDate<today&&(actualHours.get(week.id)??0)===0&&week.completedHours!=null)totals.completedHours=week.completedHours}
  return result
}

export function calendarRaceEvents(context:TrainingContext): Array<Partial<PlanEvent>&{name:string;date:string}> {
  const workouts=[...new Map([...context.history,...context.planned].map(item=>[(item as PlannedWorkout).id,item as CalendarWorkout])).values()]
  const races=workouts.filter(item=>/^RACE(?:_[ABC])?$/.test(String(item.category||item.raw?.category||""))).map(item=>({
    id:item.id,name:item.title||item.raw?.name||"Race",date:item.workout_date||"",sport:item.sport,distance:item.raw?.distance?String(item.raw.distance):"",
    priority:(["A","B","C"].includes(String(item.raw?.priority||item.raw?.race_priority||String(item.category||item.raw?.category||"").split("_")[1]))?String(item.raw?.priority||item.raw?.race_priority||String(item.category||item.raw?.category||"").split("_")[1]):null) as PlanEvent["priority"],
    goal:item.goal||"",targetCtl:null,source:"intervals-calendar",
  }))
  if(context.athlete.race&&context.athlete.race_date&&!races.some(event=>event.date===context.athlete.race_date&&event.name===context.athlete.race))races.push({id:"athlete-race",name:context.athlete.race,date:context.athlete.race_date,sport:"Triathlon",distance:"",priority:null,goal:"",targetCtl:null,source:"athlete-record"})
  return races.filter(event=>/^\d{4}-\d{2}-\d{2}$/.test(event.date))
}

export function recentAverages(context:TrainingContext) {
  const completed=context.history.filter(item=>(item as PlannedWorkout).status==="completed").slice(-42)
  const dated=completed.filter(item=>item.workout_date)
  if(!dated.length)return {hours:null,tss:null}
  const first=new Date(`${dated[0].workout_date}T12:00:00Z`).getTime(),last=new Date(`${dated.at(-1)!.workout_date}T12:00:00Z`).getTime()
  const weeks=Math.max(1,Math.ceil((last-first+86_400_000)/(7*86_400_000)))
  let minutes=0,tss=0,hasDuration=false,hasTss=false
  for(const item of dated){const workout=item as PlannedWorkout;const duration=completedActivityValues(workout).hours*60,load=workout.workout_summary?.completed?.tss??workout.completed_data?.tss;if(duration>0){minutes+=duration;hasDuration=true}if(load!=null){tss+=load;hasTss=true}}
  return {hours:hasDuration?Math.round(minutes/60/weeks*4)/4:null,tss:hasTss?Math.round(tss/weeks):null}
}

export function phaseLabel(week:AnnualPlanWeek) {return week.phaseWeek?`${week.phase} - Week ${week.phaseWeek}${week.recovery?" · Recovery":""}`:week.phase}
