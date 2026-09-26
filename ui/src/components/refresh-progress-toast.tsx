import { Progress } from "@/components/ui/progress"
import type { ManualRefreshProgress } from "@/lib/training-context"

export function RefreshProgressToast({
  progress,
}: {
  progress: ManualRefreshProgress
}) {
  const hasStepProgress =
    typeof progress.completed === "number" &&
    typeof progress.total === "number" &&
    progress.total > 0
  const value = hasStepProgress
    ? Math.min(100, Math.round((progress.completed! / progress.total!) * 100))
    : null

  const label =
    progress.phase === "github"
      ? "App updated. Saving your latest training…"
      : progress.phase === "saving" ||
          progress.phase === "finalizing" ||
          progress.phase === "complete"
        ? "Updating your dashboard…"
        : "Loading workouts and wellness…"

  return (
    <div className="space-y-3 pb-0.5">
      <p className="text-pretty">{label}</p>
      <Progress value={value} aria-label={label} className="h-1" />
    </div>
  )
}
