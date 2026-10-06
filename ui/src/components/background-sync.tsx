import { useEffect } from "react"
import { apiFetch } from "@/lib/api-client"
import { rememberLiveTrainingContext, trainingMutationState, type TrainingContext } from "@/lib/training-context"

export function BackgroundSync() {
  useEffect(() => {
    let busy=false, active=true, timer=0, lastCheck=0, failures=0
    const controller=new AbortController()
    const check=async(force=false)=>{
      if(!active || busy || document.visibilityState==='hidden' || !navigator.onLine || trainingMutationState().busy)return
      if(!force && Date.now()-lastCheck<30_000)return
      busy=true;lastCheck=Date.now()
      const revision=trainingMutationState().revision
      try {
        const response=await apiFetch('/api/training-updates',{signal:controller.signal})
        const result=await response.json() as {context?:TrainingContext;error?:string}
        if(!response.ok || !result.context)throw Error(result.error || 'Training check failed')
        if(active && revision===trainingMutationState().revision && !trainingMutationState().busy)
          rememberLiveTrainingContext(result.context)
        failures=0
        window.dispatchEvent(new Event('github-sync-check'))
      } catch {failures++}
      finally {
        busy=false
        window.clearTimeout(timer)
        if(active)timer=window.setTimeout(()=>void check(),Math.min(300_000,30_000*2**Math.min(failures,3)))
      }
    }
    const resume=()=>void check(true)
    const edited=()=>{
      void apiFetch('/api/sync?trainingOnly=1',{method:'POST'}).then(()=>check(true)).catch(()=>{})
    }
    void check(true)
    window.addEventListener('focus',resume)
    window.addEventListener('online',resume)
    document.addEventListener('visibilitychange',resume)
    window.addEventListener('request-background-sync',edited)
    return ()=>{
      active=false;controller.abort();window.clearTimeout(timer)
      window.removeEventListener('focus',resume)
      window.removeEventListener('online',resume)
      document.removeEventListener('visibilitychange',resume)
      window.removeEventListener('request-background-sync',edited)
    }
  },[])
  return null
}
