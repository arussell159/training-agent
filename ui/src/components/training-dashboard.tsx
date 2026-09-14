import { lazy, Suspense, useEffect, useState } from "react"

import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { SectionCards } from "@/components/section-cards"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  fallbackTrainingContext,
  loadFullTrainingContext,
  loadTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"

const WorkoutDialog = lazy(() => import("@/components/training-calendar").then((module) => ({ default:module.WorkoutDialog })))

export function TrainingDashboard({
  onWorkoutOpen,
  refreshRequest = 0,
  onRefreshComplete,
}: {
  onWorkoutOpen?: (workout: PlannedWorkout) => void
  refreshRequest?: number
  onRefreshComplete?: () => void
}) {
  const [context, setContext] = useState(fallbackTrainingContext)
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(null)
  const isMobile = useIsMobile()

  const openWorkout = (workout: PlannedWorkout) => {
    if (isMobile && onWorkoutOpen) {
      onWorkoutOpen(workout)
      return
    }
    setSelectedWorkout(workout)
  }
  useEffect(() => {
    let active = true
    loadTrainingContext().then((nextContext) => {
      if (active) setContext(nextContext)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const hydrateHistory = () => {
      void loadFullTrainingContext().then((nextContext) => {
        if (active) setContext(nextContext)
      })
    }
    const timer = window.setTimeout(hydrateHistory, 500)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!refreshRequest) return
    let active = true
    loadFullTrainingContext(true).then((nextContext) => {
      if (active) setContext(nextContext)
    }).finally(() => {
      if (active) onRefreshComplete?.()
    })
    return () => {
      active = false
    }
  }, [refreshRequest, onRefreshComplete])

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-4 md:gap-6 md:p-6">
      <SectionCards
        context={context}
        onWorkoutOpen={openWorkout}
      />
      <ChartAreaInteractive context={context} />
      {selectedWorkout ? (
        <Suspense fallback={null}>
          <WorkoutDialog
            workout={selectedWorkout}
            onOpenChange={(open) => !open && setSelectedWorkout(null)}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
