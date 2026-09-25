import {useEffect,useState} from 'react'
import {apiFetch} from '@/lib/api-client'
import {revalidateTrainingContext,rememberTrainingContext,trainingMutationState,type TrainingContext} from '@/lib/training-context'

export function BackgroundSync() {
  const [error,setError]=useState('')
  const [retry,setRetry]=useState(0)
  const [pending,setPending]=useState(0)
  useEffect(()=>{
    let active=true,busy=false,pendingCheck=false,retryNow=retry>0
    const controller=new AbortController()
    const check=async(forceIntervals=false,forceSection11=false)=>{
      if(busy){pendingCheck=true;return}
      if(!active || trainingMutationState().busy || !navigator.onLine)return
      busy=true
      const revision=trainingMutationState().revision
      try {
        const params=new URLSearchParams()
        if(retryNow || forceSection11){params.set('force','1')}
        if(retryNow)params.set('retry','1')
        if(forceIntervals)params.set('forceIntervals','1')
        const suffix=params.size?`?${params}`:''
        const response=await apiFetch(`/api/sync${suffix}`,{method:'POST',signal:controller.signal})
        retryNow=false
        const result=await response.json() as {context?:TrainingContext;error?:string;sync_error?:string;section11Sync?:{status:string;error?:string};queue?:{pending:number;failed:number}}
        if(!response.ok || !result.context)throw Error(result.error || 'Updates could not be checked.')
        if(result.sync_error)throw Error(result.sync_error)
        if(active && revision===trainingMutationState().revision && !trainingMutationState().busy){rememberTrainingContext(result.context);setPending(result.queue?.pending || 0);setError(result.section11Sync?.status==='failed'?result.section11Sync.error || 'Section 11 sync failed.':result.queue?.failed?'An edit needs a sync retry.':'')}
      }catch(e){if(active && !controller.signal.aborted)setError(e instanceof Error?e.message:'Updates could not be checked.')}
      finally{
        busy=false
        if(active && pendingCheck){pendingCheck=false;window.setTimeout(()=>void check(),0)}
      }
    }
    void revalidateTrainingContext()
    const directSyncAvailable=!['localhost','127.0.0.1'].includes(window.location.hostname)
    const start=window.setTimeout(()=>void check(true,directSyncAvailable),1500)
    const edit=()=>window.setTimeout(()=>void check(),0)
    const contextUpdated=(event:Event)=>{
      const context=(event as CustomEvent<TrainingContext>).detail
      const workouts=[...new Map([...context.history,...context.planned].map(w=>[(w as {id?:string}).id,w as {sync_status?:string}])).values()]
      setPending(workouts.filter(w=>w.sync_status==='pending').length)
    }
    window.addEventListener('request-background-sync',edit)
    window.addEventListener('training-context-updated',contextUpdated)
    return()=>{active=false;controller.abort();window.clearTimeout(start);window.removeEventListener('request-background-sync',edit);window.removeEventListener('training-context-updated',contextUpdated)}
  },[retry])
  return error || pending?<button type="button" role="status" onClick={()=>setRetry(v=>v+1)} className="fixed right-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-30 max-w-64 rounded-xl border bg-background/95 px-3 py-2 text-left text-xs shadow-sm md:bottom-4">{error?'Saved data shown · Sync needs attention. Tap to retry.':`${pending} saved edit${pending===1?'':'s'} syncing to Intervals.icu…`}</button>:null
}
