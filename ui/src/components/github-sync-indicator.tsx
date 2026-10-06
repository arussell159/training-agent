import { useEffect, useState } from "react"
import { Check } from "lucide-react"
import { apiFetch } from "@/lib/api-client"
import { cachedTrainingContext } from "@/lib/training-context"

export function GithubSyncIndicator() {
  const [available,setAvailable]=useState(false)
  useEffect(()=>{
    let active=true,busy=false,timer=0
    const controller=new AbortController()
    const check=async()=>{
      if(!active || busy || document.visibilityState==='hidden')return
      busy=true;window.clearTimeout(timer)
      const version=(cachedTrainingContext() as {version?:string}).version
      try {
        const response=await apiFetch('/api/section11-sync',{signal:controller.signal})
        if(!response.ok)throw Error()
        const result=await response.json() as {status:string;version?:string}
        if(active)setAvailable(result.status==='complete' && Boolean(version) && result.version===version)
        if(active && (result.status==='running' || result.status==='queued'))timer=window.setTimeout(()=>void check(),10_000)
      }catch{if(active)setAvailable(false)}
      finally{busy=false}
    }
    const changed=()=>{setAvailable(false);void check()}
    void check()
    window.addEventListener('github-sync-check',check)
    window.addEventListener('training-context-updated',changed)
    document.addEventListener('visibilitychange',check)
    return()=>{active=false;controller.abort();window.clearTimeout(timer);window.removeEventListener('github-sync-check',check);window.removeEventListener('training-context-updated',changed);document.removeEventListener('visibilitychange',check)}
  },[])
  return available?<span role="img" aria-label="Available in GitHub" title="Available in GitHub" className="pointer-events-none fixed right-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-30 grid size-5 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 md:bottom-3"><Check className="size-3.5" strokeWidth={3}/></span>:null
}
