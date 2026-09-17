import { restoreReportReader } from '@/lib/report-navigation'
import { ReportReaderPage } from '@/components/report-reader-page'
import {BackgroundSync} from '@/components/background-sync'
import { SidebarNavigationSlim } from "@/components/application/app-navigation/sidebar-navigation/sidebar-slim"
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import {
  CalendarDays,
  Home,
  Library,
  MessageCircle,
  RefreshCw,
  Settings,
  CalendarRange,
} from "lucide-react"

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
import { MobileNavbar } from "@/components/ui/navbars"
import { MobileHeaderMenu } from "@/components/ui/mobile-header-menu"
import { MobileHeaderNavigation } from "@/components/ui/mobile-header-navigation"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import {
  refreshRecentIntervals,
  cachedTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"
import {forgetOpenWorkout,rememberOpenWorkout,restoreOpenWorkout} from '@/lib/workout-navigation'

const SettingsWorkspace = lazy(() =>
  import("@/components/settings-workspace").then((module) => ({
    default: module.SettingsWorkspace,
  }))
)
const TrainingCalendar = lazy(() =>
  import("@/components/training-calendar").then((module) => ({
    default: module.TrainingCalendar,
  }))
)
const CoachPage = lazy(() =>
  import("@/components/coach-page").then((module) => ({
    default: module.CoachPage,
  }))
)
const TrainingDashboard = lazy(() =>
  import("@/components/training-dashboard").then((module) => ({
    default: module.TrainingDashboard,
  }))
)
const TrainingLibrary = lazy(() =>
  import("@/components/training-library").then((module) => ({
    default: module.TrainingLibrary,
  }))
)
const AnnualPlanCreator = lazy(() => import("@/components/annual-plan-creator").then((module) => ({ default: module.AnnualPlanCreator })))
const WorkoutDetailPage = lazy(() =>
  import("@/components/workout-detail-page").then((module) => ({
    default: module.WorkoutDetailPage,
  }))
)

function RouteFallback() {
  return (
    <div
      className="m-auto size-8 animate-pulse rounded-full bg-muted"
      aria-label="Loading view"
    />
  )
}

const navigation = [
  { label: "Home", icon: Home },
  { label: "Calendar", icon: CalendarDays },
  { label: "Coach", icon: MessageCircle },
  { label: "Library", icon: Library },
  { label: "Annual Plan", icon: CalendarRange },
  { label: "Settings", icon: Settings },
]

function routeItem() {
  if (window.location.pathname === "/coach") return "Coach"
  if (
    window.location.pathname === "/calendar" ||
    window.location.pathname === "/week"
  )
    return "Calendar"
  if (window.location.pathname === "/library") return "Library"
  if (window.location.pathname === "/annual-plan") return "Annual Plan"
  if (window.location.pathname === "/settings") return "Settings"
  return "Home"
}

function itemPath(item: string) {
  return (
    (
      {
        Home: "/",
        Coach: "/coach",
        Calendar: "/calendar",
        Library: "/library",
        "Annual Plan": "/annual-plan",
        Settings: "/settings",
      } as Record<string, string>
    )[item] || "/coach"
  )
}

function AppWorkspace() {
  const [selectedReport, setSelectedReport] = useState(restoreReportReader)
  const [activeItem, setActiveItem] = useState(routeItem)
  const [calendarNavigationVersion, setCalendarNavigationVersion] = useState(0)
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(()=>window.matchMedia('(max-width: 767px)').matches?restoreOpenWorkout([...cachedTrainingContext().planned,...cachedTrainingContext().history]):null)
  const [refreshRequest, setRefreshRequest] = useState(0)
  const [contextVersion, setContextVersion] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [intervalsDisconnected, setIntervalsDisconnected] =
    useState(false)
  const workoutReturnScroll = useRef(0)
  const isCoachPage = activeItem === "Coach"
  const handleRefreshComplete = useCallback(() => setIsRefreshing(false), [])
  useEffect(() => {
    const showReconnect = () => setIntervalsDisconnected(true)
    window.addEventListener("intervals-auth-expired", showReconnect)
    return () =>
      window.removeEventListener("intervals-auth-expired", showReconnect)
  }, [])

  useEffect(() => {
    const handlePopState = () => {
      setSelectedReport(restoreReportReader())
      setSelectedWorkout(window.matchMedia('(max-width: 767px)').matches?restoreOpenWorkout([...cachedTrainingContext().planned,...cachedTrainingContext().history]):null)
      setActiveItem(routeItem())
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])
  useEffect(()=>{
    const update=(event:Event)=>{
      const context=(event as CustomEvent<{planned:PlannedWorkout[];history:PlannedWorkout[]}>).detail
      setSelectedWorkout(current=>current?([...context.planned,...context.history].find(w=>w.id===current.id) || current):null)
    }
    window.addEventListener('training-context-updated',update)
    return()=>window.removeEventListener('training-context-updated',update)
  },[])

  useEffect(() => {
    const open = () => { setSelectedReport(restoreReportReader()); setSelectedWorkout(null); requestAnimationFrame(() => window.scrollTo({top: 0})) }
    window.addEventListener("section11-report-open", open)
    return () => window.removeEventListener("section11-report-open", open)
  }, [])

  const selectItem = (item: string) => {
    setSelectedReport(null)
    setSelectedWorkout(null)
    setActiveItem(item)
    if (item === "Calendar") setCalendarNavigationVersion((value) => value + 1)
    window.history.pushState({}, "", itemPath(item))
  }

  const openWorkout = (workout: PlannedWorkout) => {
    workoutReturnScroll.current = window.scrollY
    rememberOpenWorkout(workout)
    setSelectedWorkout(workout)
    requestAnimationFrame(() => window.scrollTo({ top: 0 }))
  }

  const closeWorkout = () => {
    const returnTo = workoutReturnScroll.current
    forgetOpenWorkout()
    setSelectedWorkout(null)
    requestAnimationFrame(() => window.scrollTo({ top: returnTo }))
  }

  return (
    <MobileHeaderNavigation.Provider
      value={async () => {
        const context = await refreshRecentIntervals()
        setSelectedWorkout((current) =>
          current
            ? ([...context.planned, ...context.history].find(
                (workout) => "id" in workout && workout.id === current.id
              ) as PlannedWorkout) || null
            : null
        )
        setContextVersion((version) => version + 1)
      }}
    >
      <BackgroundSync />
      <AlertDialog
        open={intervalsDisconnected}
        onOpenChange={setIntervalsDisconnected}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reconnect Intervals.icu</AlertDialogTitle>
            <AlertDialogDescription>
              Your Intervals.icu API key is missing or no longer valid. Your saved training
              data remains available in Supabase. Open Intervals.icu Settings,
              then update the API key from Settings to resume syncing new
              workouts.
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

      <SidebarNavigationSlim items={navigation} activeItem={activeItem} onNavigate={selectItem} />

      <SidebarInset
        className={
          (isCoachPage || activeItem === "Settings" || activeItem === "Annual Plan") && !selectedWorkout
            ? "h-svh min-h-0 overflow-hidden"
            : undefined
        }
      >
        {!selectedReport && !selectedWorkout &&
          activeItem !== "Calendar" &&
          activeItem !== "Annual Plan" &&
          activeItem !== "Settings" && (
            <header
              className="mobile-site-header sticky top-0 z-50 flex h-14 w-full shrink-0 items-center border-b bg-background/95 px-4 shadow-sm backdrop-blur"
            >
              <h1 className="mobile-header-title min-w-0 truncate text-sm font-semibold">{activeItem}</h1>
              {activeItem === "Home" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto hidden cursor-pointer md:inline-flex"
                  disabled={isRefreshing}
                  onClick={() => {
                    setIsRefreshing(true)
                    setRefreshRequest((request) => request + 1)
                  }}
                >
                  <RefreshCw
                    className={isRefreshing ? "animate-spin" : undefined}
                  />
                  <span className="hidden sm:inline">
                    Refresh Intervals.icu
                  </span>
                  <span className="sm:hidden">Refresh</span>
                </Button>
              )}
              <MobileHeaderMenu />
            </header>
          )}
        <main
          key={
            contextVersion
          }
          className={`flex min-h-0 flex-1 ${
            selectedWorkout
              ? "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
              : isCoachPage
                ? "overflow-y-auto pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
                : activeItem === "Settings"
                  ? "overflow-hidden pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
                  : activeItem === "Annual Plan"
                    ? "w-full overflow-hidden pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
                  : "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
          }`}
        >
          <Suspense fallback={<RouteFallback />}>
            {selectedReport ? (<ReportReaderPage target={selectedReport} />) : selectedWorkout ? (
              <WorkoutDetailPage
                workout={selectedWorkout}
                onBack={closeWorkout}
              />
            ) : activeItem === "Home" ? (
              <TrainingDashboard
                onWorkoutOpen={openWorkout}
                refreshRequest={refreshRequest}
                onRefreshComplete={handleRefreshComplete}
              />
            ) : activeItem === "Calendar" ? (
              <TrainingCalendar key={calendarNavigationVersion} onWorkoutOpen={openWorkout} />
            ) : isCoachPage ? (
              <CoachPage />
            ) : activeItem === "Settings" ? (
              <SettingsWorkspace />
            ) : activeItem === "Library" ? (
              <TrainingLibrary onWorkoutOpen={openWorkout} />
            ) : activeItem === "Annual Plan" ? (
              <AnnualPlanCreator />
            ) : null}
          </Suspense>
        </main>

        <MobileNavbar activeItem={activeItem} onNavigate={selectItem} />
      </SidebarInset>
    </MobileHeaderNavigation.Provider>
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
