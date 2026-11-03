import { useState } from "react"
import { homeTimings } from "@/lib/home-performance"

export function HomePerformanceStatus() {
  const [timings] = useState(homeTimings)
  const launch=timings.findLast(row=>row.kind === "launch"),back=timings.findLast(row=>row.kind === "return")
  return <section className="space-y-4 text-sm">
    <p className="text-muted-foreground">Measured on this device when Home’s workout and fitness cards have painted and can be used. The target is 250 ms.</p>
    <dl className="space-y-3">{[["Latest launch",launch],["Latest return to Home",back]].map(([label,row])=><div key={String(label)} className="flex justify-between gap-4"><dt>{String(label)}</dt><dd className="font-medium tabular-nums">{typeof row === "object" && row ? `${row.ms} ms` : "Open Home to measure"}</dd></div>)}</dl>
    <p className="text-xs text-muted-foreground">Launch timing starts when the page begins loading. It includes sign-in verification and ends after the real Home cards paint. The iPhone’s icon animation happens before this timer. Measurements stay on this device.</p>
  </section>
}
