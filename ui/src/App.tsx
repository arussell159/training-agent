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
  ArrowLeft,
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
import { useToastManager } from "@/components/ui/toast"
import { RefreshProgressToast } from "@/components/refresh-progress-toast"

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
import { f7ready } from "framework7-react"
import type { Dialog as Framework7Dialog } from "framework7/types"
import {
  MobileHeaderNavigation,
  MobileDefinitionsOpen,
} from "@/components/ui/mobile-header-navigation"
import { useIsMobile } from "@/hooks/use-mobile"
import { MobileTermsPage } from "@/components/terms-reference/mobile-terms-page"
import { useMobileViewport } from "@/hooks/use-mobile-viewport"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import {
  refreshRecentIntervals,
  cachedTrainingContext,
  type ManualRefreshProgress,
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

type MobileRefreshDialog = {
  dialog: Framework7Dialog.Dialog
  dismissed: boolean
}

function openMobileRefreshDialog(): Promise<MobileRefreshDialog | null> {
  return new Promise((resolve) => {
    f7ready((app) => {
      if (!app.dialog) {
        resolve(null)
        return
      }
      const dialog = app.dialog.progress("Refreshing Intervals.icu", 0)
      const inner = dialog.el.querySelector<HTMLElement>(".dialog-inner")
      if (inner) {
        inner.style.position = "relative"
        inner.style.paddingRight = "42px"
        const closeButton = document.createElement("button")
        closeButton.type = "button"
        closeButton.className = "refresh-progress-dialog-close"
        closeButton.setAttribute("aria-label", "Dismiss sync progress")
        closeButton.textContent = "×"
        closeButton.style.cssText =
          "position:absolute;top:8px;right:8px;display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:999px;background:var(--f7-dialog-button-bg-color, transparent);color:var(--foreground);font-size:24px;line-height:1;cursor:pointer"
        inner.append(closeButton)
        const refreshDialog = { dialog, dismissed: false }
        closeButton.addEventListener("click", () => {
          refreshDialog.dismissed = true
          dialog.close()
        })
        resolve(refreshDialog)
        return
      }
      resolve({ dialog, dismissed: false })
    })
  })
}

function AppWorkspace() {
  useMobileViewport()
  const mobileTerms = useIsMobile()
  useEffect(() => {
    let active = true
    const warm = async () => {
      for (const item of ["Home", "Calendar", "Coach", "Library", "Settings", "Annual Plan"]) {
        if (!active) return
        if (item !== routeItem()) await pageImports[item as keyof typeof pageImports]().catch(() => {})
      }
    }
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(() => void warm(), { timeout: 1500 })
      return () => { active = false; window.cancelIdleCallback(id) }
    }
    const id = setTimeout(() => void warm(), 1000)
    return () => { active = false; clearTimeout(id) }
  }, [])
  const [selectedReport, setSelectedReport] = useState(restoreReportReader)
  const [activeItem, setActiveItem] = useState(routeItem)
  const [navigationItem, setNavigationItem] = useState(routeItem)
  const [calendarNavigationVersion, setCalendarNavigationVersion] = useState(0)
  const [selectedWorkout, setSelectedWorkout] =
    useState<PlannedWorkout | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const toastManager = useToastManager()
  const [intervalsDisconnected, setIntervalsDisconnected] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const workoutReturnScroll = useRef(0)
  const isCoachPage = activeItem === "Coach"
  const refreshIntervals = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    const startedAt = Date.now()
    const mobileProgressDialog = mobileTerms
      ? await openMobileRefreshDialog()
      : null
    const toastId = "intervals-icu-refresh"
    const updateProgress = (progress: ManualRefreshProgress) => {
      if (mobileProgressDialog && !mobileProgressDialog.dismissed) {
        const { dialog } = mobileProgressDialog
        const title =
          progress.phase === "github"
            ? "Syncing training data to GitHub"
            : "Refreshing Intervals.icu"
        const hasProgress =
          typeof progress.completed === "number" &&
          typeof progress.total === "number" &&
          progress.total > 0
        const value = progress.phase === "complete"
          ? 100
          : hasProgress
            ? Math.max(0, Math.min(100, (progress.completed! / progress.total!) * 100))
            : 0
        const detail = hasProgress
          ? progress.phase === "github"
            ? `${progress.completed} of ${progress.total} GitHub Actions steps complete`
            : progress.phase === "intervals"
              ? `${progress.completed} of ${progress.total} Intervals.icu requests complete`
              : ""
          : ""
        dialog.setTitle(title)
        dialog.setProgress(value, 250)
        dialog.setText(detail ? `${progress.label} · ${detail}` : progress.label)
        const dialogText = dialog.el.querySelector<HTMLElement>(".dialog-text")
        if (dialogText) {
          dialogText.textContent = detail
            ? `${progress.label} · ${detail}`
            : progress.label
        }
        return
      }
      toastManager.update(toastId, {
        type: "loading",
        title:
          progress.phase === "github"
            ? "Syncing training data to GitHub"
            : "Refreshing Intervals.icu",
        description: <RefreshProgressToast startedAt={startedAt} progress={progress} />,
        timeout: 0,
      })
    }
    if (!mobileProgressDialog) {
      toastManager.add({
        id: toastId,
        type: "loading",
        title: "Refreshing Intervals.icu",
        description: (
          <RefreshProgressToast
            startedAt={startedAt}
            progress={{ phase: "starting", label: "Starting manual refresh", completed: 0, total: 1 }}
          />
        ),
        timeout: 0,
      })
    }
    try {
      const context = await refreshRecentIntervals(updateProgress)
      setSelectedWorkout((current) =>
        current
          ? [...context.planned, ...context.history].find(
              (workout): workout is PlannedWorkout =>
                "id" in workout && workout.id === current.id
            ) || current
          : null
      )
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      const duration = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`
      toastManager.update(toastId, {
        type: "success",
        title: "Intervals.icu refresh complete",
        description: `Training data updated in ${duration}.`,
        timeout: 6000,
      })
    } catch (error) {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      const duration = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`
      toastManager.update(toastId, {
        type: "error",
        title: "Intervals.icu refresh failed",
        description: `${error instanceof Error ? error.message : "Training data could not be refreshed."} (${duration})`,
        timeout: 8000,
      })
    } finally {
      if (mobileProgressDialog && mobileProgressDialog.dialog.opened) {
        mobileProgressDialog.dialog.close()
      }
      setIsRefreshing(false)
    }
  }, [isRefreshing, mobileTerms, toastManager])
  useEffect(() => {
    const showReconnect = () => setIntervalsDisconnected(true)
    window.addEventListener("intervals-auth-expired", showReconnect)
    return () =>
      window.removeEventListener("intervals-auth-expired", showReconnect)
  }, [])

  useEffect(() => {
    // Workout dialogs are transient UI. A reload should return to the page
    // underneath instead of restoring a dialog opened in an earlier session.
    forgetOpenWorkout()
  }, [])

  useEffect(() => {
    const handlePopState = () => {
      setSelectedReport(restoreReportReader())
      setSelectedWorkout(
        restoreOpenWorkout([
          ...cachedTrainingContext().planned,
          ...cachedTrainingContext().history,
        ])
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
    if (
      item === "Calendar" &&
      activeItem === "Calendar" &&
      !selectedReport &&
      !selectedWorkout &&
      window.matchMedia("(max-width: 767px)").matches
    ) {
      window.dispatchEvent(new Event("calendar-go-today"))
      return
    }
    setNavigationItem(item)
    preloadPage(item)
    setSelectedReport(null)
    setSelectedWorkout(null)
    setActiveItem(item)
    startTransition(() => {
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

  useEffect(() => {
    const navigate = (event: Event) => {
      const item = (event as CustomEvent<string>).detail
      if (typeof item === "string" && item) selectItem(item)
    }
    window.addEventListener("app-navigate", navigate)
    return () => window.removeEventListener("app-navigate", navigate)
  }, [selectItem])

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
          await refreshIntervals()
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
            activeItem === "Home" && !selectedWorkout && !selectedReport
              ? "home-dashboard-shell"
              : (isCoachPage || activeItem === "Library") &&
                  !selectedWorkout &&
                  !selectedReport
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
            !isCoachPage &&
            activeItem !== "Library" && (
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
                aria-label="Back to calendar"
              >
                <ArrowLeft className="size-4" />
                Calendar
              </Button>
            )}
            <h1 className="min-w-0 truncate text-sm font-semibold">
              {selectedReport
                ? selectedReport.kind === "weekly"
                  ? "Weekly Report"
                  : "Training Block"
                : selectedWorkout?.title || (activeItem === "Annual Plan" ? "Annual Planner" : activeItem)}
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
                <DropdownMenuItem
                  disabled={isRefreshing}
                  className="whitespace-nowrap"
                  onClick={() => void refreshIntervals()}
                >
                  <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
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
