import {useEffect,useState} from 'react'
import {apiFetch} from '@/lib/api-client'
import type {PlannedWorkout} from '@/lib/training-context'
import {Button} from '@/components/ui/button'
import {Pencil} from 'lucide-react'
export function WorkoutDescription({workout}:{workout:PlannedWorkout}){
 const original=workout.details ?? workout.goal ?? ''
 const [saved,setSaved]=useState(original),[draft,setDraft]=useState(original),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(()=>{setSaved(original);setDraft(original);setEditing(false);setError('')},[workout.id,original])
 const save=async()=>{setBusy(true);setError('');try{
  const response=await apiFetch('/api/calendar/workout-description',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:workout.id,description:draft})});const result=await response.json();if(!response.ok || !result.verified)throw Error(result.error || 'Description could not be saved');
  setSaved(result.description);setEditing(false);window.dispatchEvent(new CustomEvent('workout-description-updated',{detail:{id:workout.id,description:result.description}}))
 }catch(e){setError(e instanceof Error?e.message:'Description could not be saved')}finally{setBusy(false)}}
 return <section className="space-y-3" aria-label="Workout description"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Workout instructions</h3>{!editing&&<Button variant="ghost" size="sm" onClick={()=>{setDraft(saved);setEditing(true)}}><Pencil className="size-3.5"/>Edit</Button>}</div>
  {editing?<><textarea aria-label="Workout description" value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} className="min-h-64 w-full resize-y rounded-xl border bg-background p-3 text-[1.0625rem] leading-7 md:text-sm md:leading-6"/><div className="flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={()=>setEditing(false)}>Cancel</Button><Button size="sm" disabled={busy || draft===saved} onClick={()=>void save()}>{busy?'Saving…':'Save to Intervals.icu'}</Button></div></>:<p className="whitespace-pre-wrap text-[1.0625rem] leading-7 text-foreground md:text-sm md:leading-6">{saved}</p>}
  {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
 </section>
}
