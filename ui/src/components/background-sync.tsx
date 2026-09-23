import {useEffect,useState} from 'react'
import {apiFetch} from '@/lib/api-client'
import {revalidateTrainingContext,rememberTrainingContext,trainingMutationState,type TrainingContext} from '@/lib/training-context'

export function BackgroundSync() {
  const [error,setError]=useState('')
  const [retry,setRetry]=useState(0)
  const [pending,setPending]=useState(0)
  useEffect(()=>{
    let active=true,busy=false,lastCheck=0,retryNow=retry>0
    const controller=new AbortController()
    const check=async()=>{
      if(!active || busy || trainingMutationState().busy || document.visibilityState==='hidden' || !navigator.onLine || Date.now()-lastCheck<60000)return
      busy=true;lastCheck=Date.now()
      const revision=trainingMutationState().revision
      try {
        const response=await apiFetch(`/api/sync${retryNow?'?retry=1':''}`,{method:'POST',signal:controller.signal})
        retryNow=false
        const result=await response.json() as {context?:TrainingContext;error?:string;sync_error?:string;queue?:{pending:number;failed:number}}
        if(!response.ok || !result.context)throw Error(result.error || 'Updates could not be checked.')
        if(active && revision===trainingMutationState().revision && !trainingMutationState().busy){rememberTrainingContext(result.context);setPending(result.queue?.pending || 0);setError(result.queue?.failed?'An edit needs a sync retry.':'')}
      }catch(e){if(active && !controller.signal.aborted && !trainingMutationState().revision)setError(e instanceof Error?e.message:'Updates could not be checked.')}
      finally{busy=false}
    }
    void revalidateTrainingContext()
    const start=window.setTimeout(()=>void check(),1500)
    const timer=window.setInterval(()=>void check(),120000)
    const resume=()=>void check()
    const edit=()=>{lastCheck=0;window.setTimeout(()=>void check(),0)}
    const contextUpdated=(event:Event)=>{
      const context=(event as CustomEvent<TrainingContext>).detail
      const workouts=[...new Map([...context.history,...context.planned].map(w=>[(w as {id?:string}).id,w as {sync_status?:string}])).values()]
      setPending(workouts.filter(w=>w.sync_status==='pending').length)
    }
    window.addEventListener('focus',resume)
    window.addEventListener('online',resume)
    document.addEventListener('visibilitychange',resume)
    window.addEventListener('request-background-sync',edit)
    window.addEventListener('training-context-updated',contextUpdated)
    return()=>{active=false;controller.abort();window.clearTimeout(start);window.clearInterval(timer);window.removeEventListener('focus',resume);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);window.removeEventListener('request-background-sync',edit);window.removeEventListener('training-context-updated',contextUpdated)}
  },[retry])
  return error || pending?<button type="button" role="status" onClick={()=>setRetry(v=>v+1)} className="fixed right-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-30 max-w-64 rounded-xl border bg-background/95 px-3 py-2 text-left text-xs shadow-sm md:bottom-4">{error?'Saved data shown · Sync needs attention. Tap to retry.':`${pending} saved edit${pending===1?'':'s'} syncing to Intervals.icu…`}</button>:null
}
