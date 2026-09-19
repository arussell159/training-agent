import { restoreReportReader } from "@/lib/report-navigation"
import { ReportReaderPage } from "@/components/report-reader-page"
import { BackgroundSync } from "@/components/background-sync"
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
  CalendarDays,
  BookOpen,
  Ellipsis,
  Home,
  Library,
  MessageCircle,
  RefreshCw,
  Settings,
  CalendarRange,
} from "lucide-react"

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
import { MobileHeaderNavigation, MobileDefinitionsOpen } from "@/components/ui/mobile-header-navigation"
import { useIsMobile } from "@/hooks/use-mobile"
import { MobileTermsPage } from "@/components/terms-reference/mobile-terms-page"
import { useMobileViewport } from "@/hooks/use-mobile-viewport"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import {
  refreshRecentIntervals,
  cachedTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"
import {
  forgetOpenWorkout,
  rememberOpenWorkout,
  restoreOpenWorkout,
} from "@/lib/workout-navigation"

const pageImports = {
  Settings: () => import("@/components/settings-workspace"),
  Calendar: () => import("@/components/training-calendar"),
  Coach: () => import("@/components/coach-page"),
  Home: () => import("@/components/training-dashboard"),
  Library: () => import("@/components/training-library"),
  "Annual Plan": () => import("@/components/annual-plan-creator"),
}
function preloadPage(item: string) {
  const load = pageImports[item as keyof typeof pageImports]
  if (load) void load().catch(() => {})
}
const TermsReferenceDialog = lazy(() =>
  import("@/components/terms-reference-dialog").then((module) => ({
    default: module.TermsReferenceDialog,
  }))
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

function RouteScrollReset({ route }: { route: string }) {
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" })
  }, [route])
  return null
}

function AppWorkspace() {
  useMobileViewport()
  const mobileTerms = useIsMobile()
  useEffect(() => {
    const warm = () => ["Home", "Calendar", "Coach"].forEach(preloadPage)
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm, { timeout: 750 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(warm, 300)
    return () => clearTimeout(id)
  }, [])
  const [selectedReport, setSelectedReport] = useState(restoreReportReader)
  const [activeItem, setActiveItem] = useState(routeItem)
  const [navigationItem, setNavigationItem] = useState(routeItem)
  const [calendarNavigationVersion, setCalendarNavigationVersion] = useState(0)
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(
    () =>
      window.matchMedia("(max-width: 767px)").matches
        ? restoreOpenWorkout([
            ...cachedTrainingContext().planned,
            ...cachedTrainingContext().history,
          ])
        : null
  )
  const [refreshRequest, setRefreshRequest] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [intervalsDisconnected, setIntervalsDisconnected] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
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
      setSelectedWorkout(
        window.matchMedia("(max-width: 767px)").matches
          ? restoreOpenWorkout([
              ...cachedTrainingContext().planned,
              ...cachedTrainingContext().history,
            ])
          : null
      )
      setActiveItem(routeItem())
      setNavigationItem(routeItem())
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
      setSelectedReport(restoreReportReader())
      setSelectedWorkout(null)
      requestAnimationFrame(() => window.scrollTo({ top: 0 }))
    }
    window.addEventListener("section11-report-open", open)
    return () => window.removeEventListener("section11-report-open", open)
  }, [])

  useEffect(() => {
    const openTerms = () => setTermsOpen(true)
    window.addEventListener("terms-open", openTerms)
    return () => window.removeEventListener("terms-open", openTerms)
  }, [])

  const selectItem = (item: string) => {
    setNavigationItem(item)
    preloadPage(item)
    startTransition(() => {
      setSelectedReport(null)
      setSelectedWorkout(null)
      setActiveItem(item)
      if (item === "Calendar")
        setCalendarNavigationVersion((value) => value + 1)
    })
    window.history.pushState({}, "", itemPath(item))
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" })
      requestAnimationFrame(() =>
        window.scrollTo({ top: 0, left: 0, behavior: "auto" })
      )
    })
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
    <MobileDefinitionsOpen.Provider value={mobileTerms && termsOpen}>
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
      }}
    >
      <BackgroundSync />
      <MobileTermsPage open={termsOpen} onOpenChange={setTermsOpen} />
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
          (isCoachPage || activeItem === "Library") && !selectedWorkout && !selectedReport
            ? "coach-app-shell h-dvh min-h-0 overflow-hidden"
            : (activeItem === "Settings" || activeItem === "Annual Plan") &&
                !selectedWorkout
              ? "h-svh min-h-0 overflow-hidden"
              : undefined
        }
      >
        {!selectedReport &&
          !selectedWorkout &&
          activeItem !== "Calendar" &&
          activeItem !== "Annual Plan" &&
          activeItem !== "Settings" &&
          !isCoachPage && activeItem !== "Library" && (
            <>
              <MobileSiteNavbar
                title={
                  activeItem === "Home" ? (
                    <span className="home-brand-title">AR Performance</span>
                  ) : (
                    activeItem
                  )
                }
              />
              <header className="sticky top-0 z-50 hidden h-14 w-full shrink-0 items-center border-b bg-background/95 px-4 shadow-sm backdrop-blur md:flex">
                <h1 className="min-w-0 truncate text-sm font-semibold">
                  {activeItem}
                </h1>
                {activeItem === "Home" && (
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
                      <DropdownMenuItem
                        disabled={isRefreshing}
                        className="whitespace-nowrap"
                        onClick={() => {
                          setIsRefreshing(true)
                          setRefreshRequest((request) => request + 1)
                        }}
                      >
                        <RefreshCw
                          className={isRefreshing ? "animate-spin" : undefined}
                        />
                        Refresh Intervals.icu
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="whitespace-nowrap"
                        onClick={() =>
                          window.dispatchEvent(new Event("terms-open"))
                        }
                      >
                        <BookOpen />
                        Terms &amp; definitions
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </header>
            </>
          )}
        <main
          className={`flex min-h-0 flex-1 ${
            selectedWorkout
              ? "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
              : isCoachPage || activeItem === "Library"
                ? "coach-page-main overflow-hidden md:pb-0"
                : activeItem === "Settings"
                  ? "overflow-hidden pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
                  : activeItem === "Annual Plan"
                    ? "w-full overflow-hidden pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
                    : "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
          }`}
        >
          <MobilePageTabs activeItem={activeItem}>
            <Suspense fallback={<RouteFallback />}>
              <RouteScrollReset route={activeItem} />
              {selectedReport ? (
                <ReportReaderPage target={selectedReport} />
              ) : selectedWorkout ? (
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
                <TrainingCalendar
                  key={calendarNavigationVersion}
                  onWorkoutOpen={openWorkout}
                />
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
          </MobilePageTabs>
        </main>

        <MobileNavbar
          activeItem={navigationItem}
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
