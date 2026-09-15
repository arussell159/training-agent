import type {PlannedWorkout} from './training-context'

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
 const meters=completed?(workout.workout_summary?.completed?.distance_meters ?? workout.distance_meters ?? null):estimatedPlannedDistance(workout)
 if(meters==null)return '—'
 const prefix=completed?'':'~'
 return /swim/i.test(workout.sport)?`${prefix}${Math.round(meters/.9144).toLocaleString()} yds`:`${prefix}${(meters/1609.344).toFixed(2)} mi`
}
