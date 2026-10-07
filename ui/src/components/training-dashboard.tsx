import { HomeCardsSkeleton, ChartSkeleton } from "@/components/loading-layouts"
import { fallbackTrainingContext } from "@/lib/training-context"
import { lazy, Suspense, useEffect, useState } from "react"

import { SectionCards } from "@/components/section-cards"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  loadFullTrainingContext,
  cachedTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"
import {
  forgetOpenWorkout,
  rememberOpenWorkout,
  restoreOpenWorkout,
} from "@/lib/workout-navigation"

const WorkoutDialog = lazy(() =>
  import("@/components/training-calendar").then((module) => ({
    default: module.WorkoutDialog,
  }))
)
const ChartAreaInteractive = lazy(() =>
  import("@/components/chart-area-interactive").then((module) => ({
    default: module.ChartAreaInteractive,
  }))
)

export function TrainingDashboard({
  onWorkoutOpen,
}: {
  onWorkoutOpen?: (workout: PlannedWorkout) => void
}) {
  const [context, setContext] = useState(cachedTrainingContext)
  const [selectedWorkout, setSelectedWorkout] =
    useState<PlannedWorkout | null>(null)
  const isMobile = useIsMobile()
  const [settled, setSettled] = useState(() => context !== fallbackTrainingContext)

  const openWorkout = (workout: PlannedWorkout) => {
    if (isMobile && onWorkoutOpen) {
      onWorkoutOpen(workout)
      return
    }
    rememberOpenWorkout(workout)
    setSelectedWorkout(workout)
  }
  useEffect(() => {
    let active = true
    // The saved 12-week view paints immediately; one compact network read
    // refreshes it without replacing the chart with a short weekly view.
    void loadFullTrainingContext().then((nextContext) => {
      if (active) { setContext(nextContext); setSettled(true) }
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const restore = () =>
      setSelectedWorkout(
        restoreOpenWorkout([...context.planned, ...context.history])
      )
    window.addEventListener("popstate", restore)
    return () => window.removeEventListener("popstate", restore)
  }, [context])

  useEffect(() => {
    let active = true
    const update = () => {
      if (active) setContext(cachedTrainingContext())
    }
    window.addEventListener("training-context-updated", update)
    return () => {
      active = false
      window.removeEventListener("training-context-updated", update)
    }
  }, [])

  return (
    <div className="mobile-dashboard flex w-full min-w-0 flex-1 flex-col gap-3 p-4 sm:gap-4 md:gap-6 md:p-6">
      {settled ? <SectionCards context={context} onWorkoutOpen={openWorkout} /> : <HomeCardsSkeleton />}
      <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:gap-4">
        <Suspense fallback={<ChartSkeleton className="dashboard-history-card training-history-card rounded-2xl border bg-background" />}>
          {settled ? <ChartAreaInteractive context={context} compactDesktop /> : <ChartSkeleton className="dashboard-history-card training-history-card rounded-2xl border bg-card" />}
        </Suspense>
      </div>
      {selectedWorkout ? (
        <Suspense fallback={null}>
          <WorkoutDialog
            workout={selectedWorkout}
            onOpenChange={(open) => {
              if (!open) {
                forgetOpenWorkout()
                setSelectedWorkout(null)
              }
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
