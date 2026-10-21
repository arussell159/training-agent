import { prepareWorkout } from "@/lib/workout-preload"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  HomeCardsSkeleton,
  ChartSkeleton,
  FitnessHistorySkeleton,
} from "@/components/loading-layouts"
import { fallbackTrainingContext } from "@/lib/training-context"
import { lazy, Suspense, useEffect, useRef, useState } from "react"

import {
  MobileHomeOverview,
  MobileHomeHeading,
} from "@/components/mobile-home-overview"
import type { MobileHomeLayout } from "@/lib/mobile-home-layout"
import { PageErrorBoundary } from "@/components/page-error-boundary"
import { performanceProbe } from "@/lib/performance-probe"
import { preloadable } from "@/lib/preloadable"
import { useIsMobile } from "@/hooks/use-mobile"
import { useWorkoutAccountBoundary } from "@/hooks/use-workout-account-boundary"
import { runWithWorkoutNavigationGuard } from "@/lib/workout-navigation-guard"
import { openActivityEffort } from "@/lib/activity-effort-navigation"
import { fitnessPeakEffortTarget } from "@/lib/fitness-history"
import {
  loadFullTrainingContext,
  cachedTrainingContext,
  trainingCacheScope,
  type PlannedWorkout,
} from "@/lib/training-context"
import {
  forgetOpenWorkout,
  rememberOpenWorkout,
  restoreOpenWorkout,
} from "@/lib/workout-navigation"

const sectionCardsRoute = preloadable(() =>
  import("@/components/section-cards").then((module) => ({
    default: module.SectionCards,
  }))
)
const SectionCards = sectionCardsRoute.Component
if (
  typeof window !== "undefined" &&
  window.matchMedia("(min-width: 768px)").matches
)
  void sectionCardsRoute.preload().catch(() => {})

const workoutDialogRoute = preloadable(
  () =>
    import("@/components/training-calendar").then((module) => ({
      default: module.WorkoutDialog,
    })),
  (props) => (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogTitle>{props.workout?.title || "Workout"}</DialogTitle>
        <ChartSkeleton />
      </DialogContent>
    </Dialog>
  )
)
const WorkoutDialog = workoutDialogRoute.Component
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
const DesktopTrainingAnalysis = lazy(() =>
  import("./desktop-training-analysis").then((module) => ({
    default: module.DesktopTrainingAnalysis,
  }))
)

type TrainingDashboardProps = {
  onWorkoutOpen?: (workout: PlannedWorkout) => void
  mobileLayout?: MobileHomeLayout
}

export function TrainingDashboard(props: TrainingDashboardProps) {
  const account = useWorkoutAccountBoundary(true)
  if (!account.trusted)
    return (
      <section className="p-6" aria-label="Reopen home">
        <h2>Reopen home</h2>
        <p role="alert">
          The connected account changed. Reload to view the current account.
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </section>
    )
  return <TrustedTrainingDashboard {...props} />
}

function TrustedTrainingDashboard({
  onWorkoutOpen,
  mobileLayout = "redesign",
}: TrainingDashboardProps) {
  const [context, setContext] = useState(cachedTrainingContext)
  useEffect(() => {
    if (context !== fallbackTrainingContext)
      performanceProbe("dashboard-visible")
  }, [context])
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(
    null
  )
  const isMobile = useIsMobile()
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const redesigned = isMobile && mobileLayout === "redesign"
  const [settled, setSettled] = useState(
    () => context !== fallbackTrainingContext
  )
  const chartRegion = useRef<HTMLDivElement>(null)
  const [chartVisible, setChartVisible] = useState(false)
  useEffect(() => {
    const element = chartRegion.current
    if (!element) return
    if (typeof IntersectionObserver === "undefined") {
      setChartVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setChartVisible(true)
        observer.disconnect()
      },
      { rootMargin: "400px 0px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [analysisOpen])

  const openWorkout = (workout: PlannedWorkout) =>
    runWithWorkoutNavigationGuard(() => {
      if (workout.app_pending_operation) return
      if (isMobile && onWorkoutOpen) {
        onWorkoutOpen(workout)
        return
      }
      setSelectedWorkout(workout)
      // Opening is a local action. URL bookkeeping and lazy data reads must not
      // leave the first click without a visible response.
      rememberOpenWorkout(workout)
      prepareWorkout(workout, true)
      void workoutDialogRoute.preload().catch(() => {})
    })
  useEffect(() => {
    let active = true
    // The saved 12-week view paints immediately; one compact network read
    // refreshes it without replacing the chart with a short weekly view.
    void loadFullTrainingContext().then((nextContext) => {
      if (active) {
        setContext(nextContext)
        setSettled(true)
      }
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
    <div
      className={`mobile-dashboard ${redesigned ? "mobile-home-redesign" : ""} flex w-full min-w-0 flex-1 flex-col gap-3 p-4 sm:gap-4 md:gap-6 md:p-6`}
    >
      {!isMobile && !analysisOpen && (
        <button
          type="button"
          className="self-end rounded border border-border bg-background px-4 py-2 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={() => setAnalysisOpen(true)}
        >
          Analysis
        </button>
      )}
      {!isMobile && analysisOpen ? (
        <Suspense fallback={<ChartSkeleton />}>
          <DesktopTrainingAnalysis
            key={trainingCacheScope()}
            context={context}
            onOverview={() => setAnalysisOpen(false)}
            onWorkoutOpen={openWorkout}
          />
        </Suspense>
      ) : (
        <>
          {redesigned ? (
            <MobileHomeOverview
              context={context}
              loading={!settled}
              onWorkoutOpen={openWorkout}
            />
          ) : settled ? (
            <Suspense fallback={<HomeCardsSkeleton />}>
              <SectionCards context={context} onWorkoutOpen={openWorkout} />
            </Suspense>
          ) : (
            <HomeCardsSkeleton />
          )}
          {redesigned && <MobileHomeHeading title="Your progress" />}
          <div
            ref={chartRegion}
            className="dashboard-history-grid grid w-full min-w-0 grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2"
          >
            <Suspense
              fallback={
                <ChartSkeleton className="dashboard-history-card training-history-card rounded-2xl border bg-background" />
              }
            >
              {settled && chartVisible ? (
                <ChartAreaInteractive context={context} compactDesktop />
              ) : (
                <ChartSkeleton className="dashboard-history-card training-history-card rounded-2xl border bg-card" />
              )}
            </Suspense>
            <div className="flex min-w-0 flex-col md:min-h-[448px]">
              <PageErrorBoundary resetKey="fitness-history">
                <Suspense fallback={<FitnessHistorySkeleton />}>
                  {settled && chartVisible ? (
                    <FitnessHistoryCard
                      onEffortOpen={(peak, sport) => {
                        const target = fitnessPeakEffortTarget(peak, sport)
                        if (target) openActivityEffort(target)
                      }}
                    />
                  ) : (
                    <FitnessHistorySkeleton />
                  )}
                </Suspense>
              </PageErrorBoundary>
            </div>
          </div>
        </>
      )}
      {selectedWorkout ? (
        <Suspense
          fallback={
            <Dialog
              open
              onOpenChange={(open) => {
                if (!open) {
                  forgetOpenWorkout()
                  setSelectedWorkout(null)
                }
              }}
            >
              <DialogContent showCloseButton>
                <DialogTitle>{selectedWorkout.title}</DialogTitle>
                <ChartSkeleton />
              </DialogContent>
            </Dialog>
          }
        >
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
