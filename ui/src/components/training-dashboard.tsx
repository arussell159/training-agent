import { HomeCardsSkeleton, ChartSkeleton, FitnessHistorySkeleton } from "@/components/loading-layouts"
import { fallbackTrainingContext } from "@/lib/training-context"
import { lazy, Suspense, useEffect, useRef, useState } from "react"

import { SectionCards } from "@/components/section-cards"
import { PageErrorBoundary } from "@/components/page-error-boundary"
import { performanceProbe } from '@/lib/performance-probe'
import { useIsMobile } from "@/hooks/use-mobile"
import { openActivityEffort } from "@/lib/activity-effort-navigation"
import { fitnessPeakEffortTarget } from "@/lib/fitness-history"
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
const FitnessHistoryCard = lazy(() =>
  import("@/components/fitness-history-card").then((module) => ({
    default: module.FitnessHistoryCard,
  }))
)

export function TrainingDashboard({
  onWorkoutOpen,
}: {
  onWorkoutOpen?: (workout: PlannedWorkout) => void
}) {
  const [context, setContext] = useState(cachedTrainingContext)
  useEffect(() => {
    if (context !== fallbackTrainingContext) performanceProbe('dashboard-visible')
  }, [context])
  const [selectedWorkout, setSelectedWorkout] =
    useState<PlannedWorkout | null>(null)
  const isMobile = useIsMobile()
  const [settled, setSettled] = useState(() => context !== fallbackTrainingContext)
  const chartRegion = useRef<HTMLDivElement>(null)
  const [chartVisible, setChartVisible] = useState(false)
  useEffect(() => {
    const element = chartRegion.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') { setChartVisible(true); return }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setChartVisible(true)
      observer.disconnect()
    }, { rootMargin: '400px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

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
      <div ref={chartRegion} className="dashboard-history-grid grid w-full min-w-0 grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
        <Suspense fallback={<ChartSkeleton className="dashboard-history-card training-history-card rounded-2xl border bg-background" />}>
          {settled && chartVisible ? <ChartAreaInteractive context={context} compactDesktop /> : <ChartSkeleton className="dashboard-history-card training-history-card rounded-2xl border bg-card" />}
        </Suspense>
        <div className="flex min-w-0 flex-col md:min-h-[448px]">
          <PageErrorBoundary resetKey="fitness-history">
            <Suspense fallback={<FitnessHistorySkeleton />}>
              {settled && chartVisible ? <FitnessHistoryCard onEffortOpen={(peak, sport) => {
                const target = fitnessPeakEffortTarget(peak, sport)
                if (target) openActivityEffort(target)
              }} /> : <FitnessHistorySkeleton />}
            </Suspense>
          </PageErrorBoundary>
        </div>
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
