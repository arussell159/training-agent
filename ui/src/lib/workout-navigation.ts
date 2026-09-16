import type {PlannedWorkout} from '@/lib/training-context'

const STORAGE_KEY='training-agent-open-workout-v1'

export function workoutRouteId(){return new URLSearchParams(window.location.search).get('workout')}

export function restoreOpenWorkout(candidates:unknown[]=[]){
 const id=workoutRouteId()
 if(!id)return null
 const current=candidates.find((workout):workout is PlannedWorkout=>Boolean(workout&&typeof workout==='object'&&'id' in workout&&(workout as {id?:unknown}).id===id))
 if(current)return current
 try{
  const saved=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'null') as PlannedWorkout|null
  return saved?.id===id?saved:null
 }catch{return null}
}

export function rememberOpenWorkout(workout:PlannedWorkout){
 try{sessionStorage.setItem(STORAGE_KEY,JSON.stringify(workout))}catch{/* URL restoration still works from loaded context. */}
 const url=new URL(window.location.href)
 url.searchParams.set('workout',workout.id)
 window.history.pushState({},'',`${url.pathname}${url.search}${url.hash}`)
}

export function forgetOpenWorkout(){
 try{sessionStorage.removeItem(STORAGE_KEY)}catch{/* Session storage is optional. */}
 const url=new URL(window.location.href)
 url.searchParams.delete('workout')
 window.history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`)
}
