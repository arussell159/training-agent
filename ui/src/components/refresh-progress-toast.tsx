import { useEffect, useState } from "react"
import { Progress } from "@/components/ui/progress"
import type { ManualRefreshProgress } from "@/lib/training-context"

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
}

export function RefreshProgressToast({
  startedAt,
  progress,
}: {
  startedAt: number
  progress: ManualRefreshProgress
}) {
  const [seconds, setSeconds] = useState(() =>
    Math.floor((Date.now() - startedAt) / 1000)
  )

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  const hasStepProgress =
    typeof progress.completed === "number" &&
    typeof progress.total === "number" &&
    progress.total > 0
  const value = hasStepProgress
    ? Math.min(100, Math.round((progress.completed! / progress.total!) * 100))
    : null

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate">{progress.label}</span>
        <span className="shrink-0 font-mono tabular-nums" aria-live="off">
          {formatElapsed(seconds)} elapsed
        </span>
      </div>
      {hasStepProgress && progress.phase === "github" && (
        <p className="text-[11px] text-muted-foreground">
          {progress.completed} of {progress.total} Section 11 steps complete
        </p>
      )}
      {progress.phase === "intervals" && hasStepProgress && (
        <p className="text-[11px] text-muted-foreground">
          {progress.completed} of {progress.total} Intervals.icu requests complete
        </p>
      )}
      <Progress value={value} aria-label={progress.label} />
    </div>
  )
}
