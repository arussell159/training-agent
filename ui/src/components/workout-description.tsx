import {useEffect,useState} from 'react'
import {queueWorkoutMutation} from '@/lib/training-context'
import type {PlannedWorkout} from '@/lib/training-context'
import {Button} from '@/components/ui/button'
import {Pencil} from 'lucide-react'
import {WorkoutEditor} from '@/components/workout-editor'
export function WorkoutDescription({workout,title='Workout instructions',mobileCompact=false}:{workout:PlannedWorkout;title?:string;mobileCompact?:boolean}){
 const original=workout.details ?? workout.goal ?? ''
 const [saved,setSaved]=useState(original),[draft,setDraft]=useState(original),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[visualEditing,setVisualEditing]=useState(false)
 useEffect(()=>{setSaved(original);setDraft(original);setEditing(false);setError('')},[workout.id,original])
 const save=async()=>{setBusy(true);setError('');try{
  await queueWorkoutMutation({type:'description',id:workout.id,description:draft});
  setSaved(draft);setEditing(false);window.dispatchEvent(new CustomEvent('workout-description-updated',{detail:{id:workout.id,description:draft}}))
 }catch(e){setError(e instanceof Error?e.message:'Description could not be saved')}finally{setBusy(false)}}
 return <section className={mobileCompact?'space-y-2':'space-y-3'} aria-label="Workout description">{visualEditing&&<WorkoutEditor workout={workout} onClose={()=>setVisualEditing(false)}/>}<div className="flex items-center justify-between"><h3 className={mobileCompact?'text-base font-bold':'text-sm font-semibold'}>{title}</h3>{!editing&&<Button variant="ghost" size="sm" className={mobileCompact?'size-7 p-0':''} onClick={()=>{if(workout.id.startsWith('event:')&&workout.structure){setVisualEditing(true);return}setDraft(saved);setEditing(true)}} aria-label="Edit workout details"><Pencil className="size-3.5"/>{mobileCompact?<span className="sr-only">Edit</span>:'Edit'}</Button>}</div>
  {editing?<><textarea aria-label="Workout description" value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} className="min-h-64 w-full resize-y rounded-xl border bg-background p-3 text-[1.0625rem] leading-7 md:text-sm md:leading-6"/><div className="flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={()=>setEditing(false)}>Cancel</Button><Button size="sm" disabled={busy || draft===saved} onClick={()=>void save()}>{busy?'Saving…':'Save to Intervals.icu'}</Button></div></>:<p className={`whitespace-pre-wrap text-foreground ${mobileCompact?'text-sm leading-5':'text-[1.0625rem] leading-7 md:text-sm md:leading-6'}`}>{saved}</p>}
  {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
 </section>
}
