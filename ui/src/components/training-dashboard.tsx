import { useEffect, useState } from "react"

import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { SectionCards } from "@/components/section-cards"
import { WorkoutDialog } from "@/components/training-calendar"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  fallbackTrainingContext,
  loadTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"

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
    if (!refreshRequest) return
    let active = true
    loadTrainingContext(true).then((nextContext) => {
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
      <WorkoutDialog
        workout={selectedWorkout}
        onOpenChange={(open) => !open && setSelectedWorkout(null)}
      />
    </div>
  )
}
