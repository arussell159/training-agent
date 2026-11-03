import { useLayoutEffect } from "react"
import { performanceProbe } from "@/lib/performance-probe"

const key = "training-agent-home-performance-v1"
let navigation = 0, measured = -1, returning = false
export type HomeTiming = { kind: "launch" | "return"; ms: number; time: string }
export function markHomeNavigation() {navigation = performance.now();returning = true}
export function homeTimings(): HomeTiming[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(key) || "[]")
    return Array.isArray(rows) ? rows.filter((r): r is HomeTiming => r && ["launch","return"].includes(r.kind) && Number.isFinite(r.ms) && r.ms >= 0 && typeof r.time === "string").slice(-20) : []
  } catch {return []}
}
export function useHomeReady(active: boolean) {
  useLayoutEffect(() => {
    if(!active || measured === navigation)return
    let frame = 0, cancelled = false
    const record = () => {
      if(cancelled || measured === navigation)return
      // Wait for the styled React frame to reach the screen, not a skeleton.
      frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{
        if(cancelled || measured === navigation || !document.documentElement.hasAttribute("data-app-ready"))return
        measured=navigation
        const ms=Math.round(performance.now()-navigation),kind=returning ? "return" : "launch"
        performance.mark("home-interactive",{detail:{kind,ms}})
        performanceProbe("home-interactive",{kind,durationMs:ms,targetMs:250})
        try{localStorage.setItem(key,JSON.stringify([...homeTimings(),{kind,ms,time:new Date().toISOString()}].slice(-20)))}catch{/* Optional local diagnostics. */}
      })})
    }
    record()
    window.addEventListener("training-styles-ready",record)
    return ()=>{cancelled=true;cancelAnimationFrame(frame);window.removeEventListener("training-styles-ready",record)}
  },[active])
}
