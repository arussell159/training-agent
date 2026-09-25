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
      if (active) setContext(nextContext)
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
      <SectionCards context={context} onWorkoutOpen={openWorkout} />
      <Suspense fallback={<div className="training-history-card min-h-[350px] rounded-2xl border bg-background md:min-h-[430px]" aria-label="Loading training history" />}>
        <ChartAreaInteractive context={context} />
      </Suspense>
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
