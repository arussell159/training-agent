import type {PlannedWorkout} from './training-context'
import {expandSteps,workoutTotals} from '../../../app-backend/lib/workout-editor-model.mjs'

export function estimatedPlannedDistance(workout:PlannedWorkout):number|null{
 const planned=workout.workout_summary?.planned
 const speed=planned?.average_speed,time=planned?.duration_seconds
 if(speed!=null && speed>0 && time!=null && time>0)return speed*time
 if(planned?.distance_meters!=null && planned.distance_meters>0)return planned.distance_meters
 try{const doc=JSON.parse(workout.structure || 'null');if(Number(doc?.distance)>0)return Number(doc.distance)}catch{/* No usable provider structure. */}
 // Power is not speed: no fixed watts-to-distance conversion is valid without
 // an athlete/course model, so power-only sessions remain unavailable.
 return null
}

export function plannedDistanceLabel(workout:PlannedWorkout):string{
 const completed=workout.status==='completed'
 if(!completed&&workout.editor_model){
  const totals=workoutTotals(workout.editor_model)
  if(!totals.distance)return totals.unknownDistance?'—':'0'
  const steps=expandSteps(workout.editor_model.steps)
  const hasTime=steps.some(({step})=>step.end.kind!=='distance'&&step.role!=='rest')
  const yards=/y$/.test(workout.editor_model.poolLength)||(!workout.editor_model.poolLength&&steps.some(({step})=>step.end.unit==='yd'))
  const amount=/swim/i.test(workout.sport)?yards?`${Math.round(totals.distance/.9144).toLocaleString()} yds`:`${Math.round(totals.distance).toLocaleString()} m`:`${(totals.distance/1609.344).toFixed(2)} mi`
  return `${totals.unknownDistance?'≥ ':hasTime?'~':''}${amount}`
 }
 const meters=completed?(workout.workout_summary?.completed?.distance_meters ?? workout.distance_meters ?? null):estimatedPlannedDistance(workout)
 if(meters==null)return '—'
 const prefix=completed?'':'~'
 return /swim/i.test(workout.sport)?`${prefix}${Math.round(meters/.9144).toLocaleString()} yds`:`${prefix}${(meters/1609.344).toFixed(2)} mi`
}
