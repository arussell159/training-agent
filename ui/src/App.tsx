import { PageSkeleton } from "@/components/loading-layouts"
import { appRouteItem as routeItem } from "@/lib/app-route"
import { restoreReportReader } from "@/lib/report-navigation"
import { BackgroundSync } from "@/components/background-sync"
import { GithubSyncIndicator } from "@/components/github-sync-indicator"
import { prefetchWorkoutRecording } from "@/lib/activity-analysis"
import { prefetchNutrition } from "@/lib/nutrition"
import { flushSync } from "react-dom"
import { SidebarNavigationSlim } from "@/components/application/app-navigation/sidebar-navigation/sidebar-slim"
import {
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  ArrowLeft,
  Apple,
  CalendarDays,
  BookOpen,
  Ellipsis,
  Home,
  Library,
  MessageCircle,
  RefreshCw,
  Settings,
  CalendarRange,
  TableProperties,
} from "lucide-react"
import { useToastManager } from "@/components/ui/toast"
import { PageErrorBoundary } from "@/components/page-error-boundary"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { MobileNavbar, MobilePageTabs } from "@/components/ui/navbars"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import {
  MobileHeaderNavigation,
  MobileDefinitionsOpen,
} from "@/components/ui/mobile-header-navigation"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMobileViewport } from "@/hooks/use-mobile-viewport"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import {
  cachedTrainingContext,
  refreshRecentIntervals,
  loadFullTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"
import {
  forgetOpenWorkout,
  rememberOpenWorkout,
  restoreOpenWorkout,
  workoutRouteId,
} from "@/lib/workout-navigation"

const pageImports = {
  Nutrition: () => import("@/components/nutrition-page"),
  Settings: () => import("@/components/settings-workspace"),
  Calendar: () => import("@/components/training-calendar"),
  Coach: () => import("@/components/coach-page"),
  Home: () => import("@/components/training-dashboard"),
  Library: () => import("@/components/training-library"),
  "Annual Plan": () => import("@/components/annual-plan-creator"),
  "Workout Reports": () => import("@/components/workout-reports-page"),
}
function preloadPage(item: string) {
  const load = pageImports[item as keyof typeof pageImports]
  if (load) void load().catch(() => {})
  if (item === "Nutrition") void prefetchNutrition().catch(() => {})
}
// Fetch the requested page's code while authentication is in flight. Importing
// components does not fetch private data; the auth gate still controls rendering.
if (typeof window !== 'undefined') {
  const page = routeItem(window.location.pathname)
  const load = pageImports[page as keyof typeof pageImports]
  if (load) void load().catch(() => {})
}
const TermsReferenceDialog = lazy(() =>
  import("@/components/terms-reference-dialog").then((module) => ({
    default: module.TermsReferenceDialog,
  }))
)
const MobileTermsPage = lazy(() =>
  import("@/components/terms-reference/mobile-terms-page").then((module) => ({
    default: module.MobileTermsPage,
  }))
)
const ReportReaderPage = lazy(() =>
  import("@/components/report-reader-page").then((module) => ({
    default: module.ReportReaderPage,
  }))
)

const NutritionPage = lazy(() =>
  pageImports.Nutrition().then(module => ({ default: module.NutritionPage }))
)
const SettingsWorkspace = lazy(() =>
  pageImports["Settings"]().then((module) => ({
    default: module.SettingsWorkspace,
  }))
)
const TrainingCalendar = lazy(() =>
  pageImports["Calendar"]().then((module) => ({
    default: module.TrainingCalendar,
  }))
)
const CoachPage = lazy(() =>
  pageImports["Coach"]().then((module) => ({
    default: module.CoachPage,
  }))
)
const TrainingDashboard = lazy(() =>
  pageImports["Home"]().then((module) => ({
    default: module.TrainingDashboard,
  }))
)
const TrainingLibrary = lazy(() =>
  pageImports["Library"]().then((module) => ({
    default: module.TrainingLibrary,
  }))
)
const AnnualPlanCreator = lazy(() =>
  pageImports["Annual Plan"]().then((module) => ({
    default: module.AnnualPlanCreator,
  }))
)
const WorkoutReportsPage = lazy(() =>
  pageImports["Workout Reports"]().then((module) => ({
    default: module.WorkoutReportsPage,
  }))
)
const WorkoutDetailPage = lazy(() =>
  import("@/components/workout-detail-page").then((module) => ({
    default: module.WorkoutDetailPage,
  }))
)

const navigation = [
  { label: "Home", icon: Home },
  { label: "Calendar", icon: CalendarDays },
  { label: "Coach", icon: MessageCircle },
  { label: "Nutrition", icon: Apple },
  { label: "Library", icon: Library },
  { label: "Annual Plan", icon: CalendarRange },
  { label: "Workout Reports", icon: TableProperties },
  { label: "Settings", icon: Settings },
]

function itemPath(item: string) {
  return (
    (
      {
        Nutrition: "/nutrition",
        Home: "/",
        Coach: "/coach",
        Calendar: "/calendar",
        Library: "/library",
        "Annual Plan": "/annual-plan",
        "Workout Reports": "/workout-reports",
        Settings: "/settings",
      } as Record<string, string>
    )[item] || "/coach"
  )
}

// Fetch the current view's code while the server verifies the session.
if (workoutRouteId())
  void import("@/components/workout-detail-page").catch(() => {})
else if (restoreReportReader())
  void import("@/components/report-reader-page").catch(() => {})
else void pageImports[routeItem() as keyof typeof pageImports]().catch(() => {})

function RouteScrollReset({
  route,
  target,
}: {
  route: string
  target: { current: number }
}) {
  useLayoutEffect(() => {
    window.scrollTo({ top: target.current, left: 0, behavior: "instant" })
  }, [route, target])
  return null
}

function AppWorkspace() {
  useMobileViewport()
  const mobileTerms = useIsMobile()
  useEffect(() => {
    let active = true
    const warm = async () => {
      for (const item of [routeItem() === "Home" ? "Calendar" : "Home"]) {
        if (!active) return
        if (item !== routeItem())
          await pageImports[item as keyof typeof pageImports]().catch(() => {})
      }
    }
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(() => void warm(), {
        timeout: 5000,
      })
      return () => {
        active = false
        window.cancelIdleCallback(id)
      }
    }
    const id = setTimeout(() => void warm(), 3000)
    return () => {
      active = false
      clearTimeout(id)
    }
  }, [])
  const [selectedReport, setSelectedReport] = useState(() =>
    workoutRouteId() ? null : restoreReportReader()
  )
  const [activeItem, setActiveItem] = useState<string>(routeItem)
  const nutritionReturnRoute = useRef("Home")
  const [nutritionQuickAddRequest, setNutritionQuickAddRequest] = useState(0)
  const nutritionQuickAddSequence = useRef(0)
  const [navigationItem, setNavigationItem] = useState<string>(routeItem)
  const [annualPlanChartVisible, setAnnualPlanChartVisible] = useState(true)
  const [calendarNavigationVersion, setCalendarNavigationVersion] = useState(0)
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(
    () =>
      restoreOpenWorkout([
        ...cachedTrainingContext().planned,
        ...cachedTrainingContext().history,
      ])
  )
  const [pendingWorkoutId, setPendingWorkoutId] = useState(() =>
    restoreOpenWorkout([
      ...cachedTrainingContext().planned,
      ...cachedTrainingContext().history,
    ])
      ? null
      : workoutRouteId()
  )
  const [workoutLoadError, setWorkoutLoadError] = useState<string | null>(null)
  const [workoutLoadAttempt, setWorkoutLoadAttempt] = useState(0)
  const [calendarReturnScroll, setCalendarReturnScroll] = useState<
    number | null
  >(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const refreshRequest = useRef<Promise<void> | null>(null)
  const toastManager = useToastManager()
  const [intervalsDisconnected, setIntervalsDisconnected] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  useEffect(() => {
    const updateVisibility = (event: Event) =>
      setAnnualPlanChartVisible(Boolean((event as CustomEvent<boolean>).detail))
    window.addEventListener("annual-plan-chart-visibility", updateVisibility)
    return () =>
      window.removeEventListener(
        "annual-plan-chart-visibility",
        updateVisibility
      )
  }, [])
  const workoutReturnScroll = useRef(0)
  const routeScrollTarget = useRef(0)
  const workoutReturnRoute = useRef<string | null>(null)
  const clearCalendarReturnScroll = useCallback(
    () => setCalendarReturnScroll(null),
    []
  )
  const isCoachPage = activeItem === "Coach"
  const refreshIntervals = useCallback(() => {
    if (refreshRequest.current) return refreshRequest.current
    setIsRefreshing(true)
    const request = (async () => {
      try {
        const { queue, githubSync } = await refreshRecentIntervals()
        if (queue.unknown > 0) {
          toastManager.add({
            type: "warning",
            title: "A workout edit still needs verification",
            description:
              "Intervals.icu has not confirmed the edit. Check your calendar before retrying.",
            timeout: 10000,
          })
        } else if (queue.failed > 0) {
          toastManager.add({
            type: "warning",
            title: "A workout edit could not sync",
            description:
              "Your saved draft remains available. Check the Intervals.icu connection and refresh again.",
            timeout: 10000,
          })
        }
        void githubSync
          .then(() => window.dispatchEvent(new Event("github-sync-check")))
          .catch((error) => {
            toastManager.add({
              type: "error",
              title: "Training data loaded; GitHub sync needs attention",
              description:
                error instanceof Error
                  ? error.message
                  : "Please refresh to check again.",
              timeout: 6000,
            })
          })
        window.dispatchEvent(new Event("github-sync-check"))
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Training data could not refresh",
          description:
            error instanceof Error ? error.message : "Please try again.",
          timeout: 6000,
        })
      } finally {
        setIsRefreshing(false)
        refreshRequest.current = null
      }
    })()
    refreshRequest.current = request
    return request
  }, [toastManager])
  useEffect(() => {
    const showReconnect = () => setIntervalsDisconnected(true)
    window.addEventListener("intervals-auth-expired", showReconnect)
    return () =>
      window.removeEventListener("intervals-auth-expired", showReconnect)
  }, [])

  useEffect(() => {
    const id = pendingWorkoutId
    if (!id) return
    let active = true
    setWorkoutLoadError(null)
    void loadFullTrainingContext(false, workoutLoadAttempt > 0)
      .then((context) => {
        if (!active || workoutRouteId() !== id) return
        const workout = [...context.history, ...context.planned].find(
          (item) => (item as PlannedWorkout).id === id
        )
        if (workout) {
          setSelectedWorkout(workout as PlannedWorkout)
          setPendingWorkoutId(null)
        } else
          setWorkoutLoadError(
            "This workout is no longer available in your saved calendar."
          )
      })
      .catch(() => {
        if (active)
          setWorkoutLoadError(
            "The workout could not load. Check your connection and try again."
          )
      })
    return () => {
      active = false
    }
  }, [pendingWorkoutId, workoutLoadAttempt])

  useEffect(() => {
    const handlePopState = () => {
      const route = routeItem()
      const restoredWorkout = restoreOpenWorkout([
        ...cachedTrainingContext().planned,
        ...cachedTrainingContext().history,
      ])
      routeScrollTarget.current = 0
      if (!restoredWorkout && route === workoutReturnRoute.current) {
        routeScrollTarget.current = workoutReturnScroll.current
        if (route === "Calendar")
          setCalendarReturnScroll(workoutReturnScroll.current)
        workoutReturnRoute.current = null
      }
      startTransition(() => {
        setSelectedReport(workoutRouteId() ? null : restoreReportReader())
        setSelectedWorkout(restoredWorkout)
        setPendingWorkoutId(restoredWorkout ? null : workoutRouteId())
        setActiveItem(route)
      })
      setNavigationItem(route)
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])
  useEffect(() => {
    const update = (event: Event) => {
      const context = (
        event as CustomEvent<{
          planned: PlannedWorkout[]
          history: PlannedWorkout[]
        }>
      ).detail
      if (
        !context ||
        !Array.isArray(context.planned) ||
        !Array.isArray(context.history)
      )
        return
      setSelectedWorkout((current) =>
        current
          ? [...context.planned, ...context.history].find(
              (w) => w.id === current.id
            ) || current
          : null
      )
    }
    window.addEventListener("training-context-updated", update)
    return () => window.removeEventListener("training-context-updated", update)
  }, [])

  useEffect(() => {
    const open = () => {
      routeScrollTarget.current = 0
      setSelectedReport(restoreReportReader())
      setSelectedWorkout(null)
      setPendingWorkoutId(null)
    }
    window.addEventListener("section11-report-open", open)
    return () => window.removeEventListener("section11-report-open", open)
  }, [])

  useEffect(() => {
    const openTerms = () => setTermsOpen(true)
    window.addEventListener("terms-open", openTerms)
    return () => window.removeEventListener("terms-open", openTerms)
  }, [])

  const selectItem = useCallback(
    (item: string, quickAdd = false) => {
      if (!Object.hasOwn(pageImports, item)) return
      const currentItem = routeItem()
      if (item === "Nutrition" && currentItem !== "Nutrition")
        nutritionReturnRoute.current = currentItem
      if (
        item === "Calendar" &&
        activeItem === "Calendar" &&
        !selectedReport &&
        !selectedWorkout &&
        !pendingWorkoutId &&
        window.matchMedia("(max-width: 767px)").matches
      ) {
        window.dispatchEvent(new Event("calendar-go-today"))
        return
      }
      if (
        item === currentItem &&
        !selectedReport &&
        !selectedWorkout &&
        !workoutRouteId() &&
        !quickAdd
      )
        return
      setNavigationItem(item)
      preloadPage(item)
      routeScrollTarget.current = 0
      workoutReturnRoute.current = null
      window.history.pushState({}, "", itemPath(item))
      const quickAddRequest = quickAdd ? ++nutritionQuickAddSequence.current : 0
      const navigate = () => {
        setNutritionQuickAddRequest(quickAddRequest)
        setSelectedReport(null)
        setSelectedWorkout(null)
        setPendingWorkoutId(null)
        setCalendarReturnScroll(null)
        setActiveItem(item)
        if (item === "Calendar")
          setCalendarNavigationVersion((value) => value + 1)
      }
      // Commit the textarea during the original tap so mobile browsers can open
      // the keyboard. Neither a lazy import nor a food-log request gates this path.
      if (quickAdd) flushSync(navigate)
      else startTransition(navigate)
    },
    [activeItem, selectedReport, selectedWorkout, pendingWorkoutId]
  )

  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (
        event as CustomEvent<string | { item?: string; quickAdd?: "type" }>
      ).detail
      if (typeof detail === "string") {
        if (detail) selectItem(detail)
        return
      }
      if (detail?.item) {
        selectItem(detail.item, detail.quickAdd === "type")
      }
    }
    window.addEventListener("app-navigate", navigate)
    return () => window.removeEventListener("app-navigate", navigate)
  }, [selectItem])

  const openWorkout = (workout: PlannedWorkout) => {
    prefetchWorkoutRecording(workout)
    workoutReturnRoute.current = activeItem
    workoutReturnScroll.current = window.scrollY
    routeScrollTarget.current = 0
    setCalendarReturnScroll(null)
    rememberOpenWorkout(workout)
    setPendingWorkoutId(null)
    startTransition(() => setSelectedWorkout(workout))
  }

  const closeWorkout = () => {
    if (workoutReturnRoute.current === "Workout Reports") {
      workoutReturnRoute.current = null
      window.history.back()
      return
    }
    const returnTo = workoutReturnScroll.current
    const returnToCalendar = workoutReturnRoute.current === "Calendar"
    workoutReturnRoute.current = null
    routeScrollTarget.current = returnTo
    forgetOpenWorkout()
    setSelectedWorkout(null)
    setPendingWorkoutId(null)
    setWorkoutLoadError(null)
    if (returnToCalendar) setCalendarReturnScroll(returnTo)
  }

  return (
    <MobileDefinitionsOpen.Provider value={mobileTerms && termsOpen}>
      <MobileHeaderNavigation.Provider
        value={async () => {
          await refreshIntervals()
        }}
      >
        <BackgroundSync />
        <GithubSyncIndicator />
        {termsOpen && mobileTerms && (
          <Suspense fallback={null}>
            <MobileTermsPage open onOpenChange={setTermsOpen} />
          </Suspense>
        )}
        {termsOpen && !mobileTerms && (
          <Suspense fallback={null}>
            <TermsReferenceDialog open onOpenChange={setTermsOpen} />
          </Suspense>
        )}
        <AlertDialog
          open={intervalsDisconnected}
          onOpenChange={setIntervalsDisconnected}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reconnect Intervals.icu</AlertDialogTitle>
              <AlertDialogDescription>
                Your Intervals.icu API key is missing or no longer valid. Your
                saved training data remains available in Supabase. Open
                Intervals.icu Settings, then update the API key from Settings to
                resume syncing new workouts.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Use saved data</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  window.open(
                    "https://intervals.icu/settings",
                    "_blank",
                    "noopener,noreferrer"
                  )
                  selectItem("Settings")
                }}
              >
                Sign in and reconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <SidebarNavigationSlim
          items={navigation}
          activeItem={navigationItem}
          onNavigate={selectItem}
          onPrefetch={preloadPage}
        />

        <SidebarInset
          inert={mobileTerms && termsOpen}
          aria-hidden={mobileTerms && termsOpen ? true : undefined}
          className={
            selectedWorkout && selectedWorkout.status !== "completed"
              ? "planned-workout-nav-shell"
              : (activeItem === "Home" || activeItem === "Nutrition") &&
                  !selectedWorkout &&
                  !pendingWorkoutId &&
                  !selectedReport
                ? "home-dashboard-shell"
                : (isCoachPage || activeItem === "Library") &&
                    !selectedWorkout &&
                    !pendingWorkoutId &&
                    !selectedReport
                  ? "coach-app-shell h-dvh min-h-0 overflow-hidden"
                  : (activeItem === "Settings" ||
                        activeItem === "Annual Plan") &&
                      !selectedWorkout &&
                      !pendingWorkoutId &&
                      !selectedReport
                    ? "mobile-content-under-nav-shell h-svh min-h-0 overflow-hidden"
                    : undefined
          }
        >
          {!selectedReport &&
            !selectedWorkout &&
            !pendingWorkoutId &&
            activeItem !== "Calendar" &&
            activeItem !== "Annual Plan" &&
            activeItem !== "Settings" &&
            !isCoachPage &&
            activeItem !== "Library" &&
            activeItem !== "Workout Reports" &&
            activeItem !== "Nutrition" && (
              <MobileSiteNavbar
                title={
                  activeItem === "Home" ? (
                    <span className="home-brand-title">AR Performance</span>
                  ) : (
                    activeItem
                  )
                }
              />
            )}
          <header className="sticky top-0 z-50 hidden h-14 w-full shrink-0 items-center border-b bg-background/95 px-4 shadow-sm backdrop-blur md:flex">
            {selectedWorkout?.status === "completed" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={closeWorkout}
                className="mr-2 shrink-0 rounded-lg"
                aria-label={
                  workoutReturnRoute.current === "Workout Reports"
                    ? "Back to workout reports"
                    : "Back to calendar"
                }
              >
                <ArrowLeft className="size-4" />
                {workoutReturnRoute.current === "Workout Reports"
                  ? "Workout Reports"
                  : "Calendar"}
              </Button>
            )}
            <h1 className="min-w-0 truncate text-sm font-semibold">
              {selectedReport
                ? selectedReport.kind === "weekly"
                  ? "Weekly Report"
                  : "Training Block"
                : selectedWorkout?.title ||
                  (pendingWorkoutId
                    ? "Workout"
                    : activeItem === "Annual Plan"
                      ? "Annual Planner"
                      : activeItem)}
            </h1>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="ml-auto cursor-pointer"
                    aria-label="Site menu"
                    title="Site menu"
                  />
                }
              >
                <Ellipsis className="size-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-max min-w-52">
                {activeItem === "Annual Plan" && (
                  <>
                    <DropdownMenuItem
                      className="whitespace-nowrap"
                      onClick={() =>
                        window.dispatchEvent(
                          new Event("annual-plan-chart-toggle")
                        )
                      }
                    >
                      {annualPlanChartVisible ? "Hide chart" : "Show chart"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  disabled={isRefreshing}
                  className="whitespace-nowrap"
                  onClick={() => void refreshIntervals()}
                >
                  <RefreshCw
                    className={isRefreshing ? "animate-spin" : undefined}
                  />
                  Refresh Intervals.icu
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="whitespace-nowrap"
                  onClick={() => window.dispatchEvent(new Event("terms-open"))}
                >
                  <BookOpen />
                  Terms &amp; definitions
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <main
            className={`flex min-h-0 flex-1 ${
              selectedWorkout || pendingWorkoutId
                ? "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
                : isCoachPage || activeItem === "Library"
                  ? "coach-page-main overflow-hidden md:pb-0"
                  : activeItem === "Settings"
                    ? "overflow-hidden pb-0"
                    : activeItem === "Nutrition"
                      ? "nutrition-page-main pb-0"
                      : activeItem === "Annual Plan"
                        ? "w-full overflow-hidden pb-0"
                        : "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
            }`}
          >
            <PageErrorBoundary
              resetKey={`${activeItem}:${selectedWorkout?.id ?? ""}:${JSON.stringify(selectedReport)}`}
            >
              <Suspense
                fallback={
                  <PageSkeleton
                    page={
                      selectedReport
                        ? "Report"
                        : selectedWorkout || pendingWorkoutId
                          ? "Workout"
                          : activeItem
                    }
                  />
                }
              >
                <MobilePageTabs
                  activeItem={
                    ["Workout Reports", "Library", "Nutrition"].includes(
                      activeItem
                    )
                      ? "Settings"
                      : activeItem
                  }
                >
                  <RouteScrollReset
                    route={`${activeItem}:${selectedWorkout?.id ?? ""}:${selectedReport ? JSON.stringify(selectedReport) : ""}`}
                    target={routeScrollTarget}
                  />
                  {activeItem === "Settings" && !selectedReport && (
                    <div
                      className={
                        selectedWorkout || pendingWorkoutId
                          ? "hidden"
                          : "flex min-h-0 w-full min-w-0 flex-1"
                      }
                    >
                      <SettingsWorkspace onWorkoutOpen={openWorkout} />
                    </div>
                  )}
                  {pendingWorkoutId ? (
                    <div className="relative w-full">
                      <div aria-hidden={workoutLoadError ? true : undefined}>
                        <PageSkeleton page="Workout" />
                      </div>
                      {workoutLoadError && (
                        <div className="absolute inset-0 flex items-start justify-center bg-background/95 px-6 pt-16">
                          <div
                            role="alert"
                            className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6"
                          >
                            <p className="font-semibold">Workout unavailable</p>
                            <p className="text-sm text-muted-foreground">
                              {workoutLoadError}
                            </p>
                            <div className="flex gap-3">
                              <Button
                                onClick={() =>
                                  setWorkoutLoadAttempt((value) => value + 1)
                                }
                              >
                                Try again
                              </Button>
                              <Button variant="outline" onClick={closeWorkout}>
                                Back
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : selectedReport ? (
                    <ReportReaderPage target={selectedReport} />
                  ) : selectedWorkout ? (
                    <WorkoutDetailPage
                      key={selectedWorkout.id}
                      workout={selectedWorkout}
                      onBack={closeWorkout}
                    />
                  ) : activeItem === "Nutrition" ? (
                    <NutritionPage
                      key={nutritionQuickAddRequest}
                      onBack={() => selectItem(nutritionReturnRoute.current)}
                      returnLabel={
                        nutritionReturnRoute.current === "Settings"
                          ? "More"
                          : nutritionReturnRoute.current
                      }
                      quickAddRequest={nutritionQuickAddRequest}
                    />
                  ) : activeItem === "Home" ? (
                    <TrainingDashboard onWorkoutOpen={openWorkout} />
                  ) : activeItem === "Calendar" ? (
                    <TrainingCalendar
                      key={calendarNavigationVersion}
                      onWorkoutOpen={openWorkout}
                      restoreScrollTop={calendarReturnScroll}
                      onScrollRestored={clearCalendarReturnScroll}
                    />
                  ) : isCoachPage ? (
                    <CoachPage />
                  ) : activeItem === "Settings" ? null : activeItem ===
                    "Library" ? (
                    <TrainingLibrary onWorkoutOpen={openWorkout} />
                  ) : activeItem === "Workout Reports" ? (
                    <WorkoutReportsPage onWorkoutOpen={openWorkout} />
                  ) : activeItem === "Annual Plan" ? (
                    <AnnualPlanCreator />
                  ) : null}
                </MobilePageTabs>
              </Suspense>
            </PageErrorBoundary>
          </main>

          <MobileNavbar
            activeItem={
              ["Workout Reports", "Library", "Nutrition"].includes(
                navigationItem
              )
                ? "Settings"
                : navigationItem
            }
            onNavigate={selectItem}
            onPrefetch={preloadPage}
          />
        </SidebarInset>
      </MobileHeaderNavigation.Provider>
    </MobileDefinitionsOpen.Provider>
  )
}

export function App() {
  return (
    <SidebarProvider>
      <AppWorkspace />
    </SidebarProvider>
  )
}

export default App
