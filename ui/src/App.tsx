import { apiFetch } from "@/lib/api-client"
import {BackgroundSync} from '@/components/background-sync'
import { SidebarNavigationSlim } from "@/components/application/app-navigation/sidebar-navigation/sidebar-slim"
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import {
  CalendarDays,
  Menu,
  Home,
  Library,
  MessageCircle,
  SquarePen,
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
import { ConversationHistory } from "@/components/conversation-history"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import {
  loadCoachConversations,
  refreshRecentIntervals,
  cachedTrainingContext,
  type CoachConversationSummary,
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
const TrainingCoach = lazy(() =>
  import("@/components/training-coach").then((module) => ({
    default: module.TrainingCoach,
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

function routeConversation() {
  const params = new URLSearchParams(window.location.search)
  return {
    conversationId: params.get("conversation"),
    reviewId: params.get("review"),
  }
}

function AppWorkspace() {
  const initialConversation = routeConversation()
  const [activeItem, setActiveItem] = useState(routeItem)
  const [calendarNavigationVersion, setCalendarNavigationVersion] = useState(0)
  const [conversationId, setConversationId] = useState(
    initialConversation.conversationId
  )
  const [reviewId, setReviewId] = useState(initialConversation.reviewId)
  const [conversationTitle, setConversationTitle] = useState("Coach")
  const [conversationHistory, setConversationHistory] = useState<
    CoachConversationSummary[]
  >([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [newChatVersion, setNewChatVersion] = useState(0)
  const [conversationToDelete, setConversationToDelete] =
    useState<CoachConversationSummary | null>(null)
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(()=>window.matchMedia('(max-width: 767px)').matches?restoreOpenWorkout([...cachedTrainingContext().planned,...cachedTrainingContext().history]):null)
  const [refreshRequest, setRefreshRequest] = useState(0)
  const [contextVersion, setContextVersion] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [intervalsDisconnected, setIntervalsDisconnected] =
    useState(false)
  const workoutReturnScroll = useRef(0)
  const isCoachConversation = activeItem === "Coach"
  const selectedConversation = conversationHistory.find((conversation) =>
    conversationId
      ? conversation.id === conversationId
      : conversation.review_id === reviewId
  )
  const activeConversationId =
    conversationId || selectedConversation?.id || null
  const displayedConversationTitle =
    selectedConversation?.title || conversationTitle
  const handleRefreshComplete = useCallback(() => setIsRefreshing(false), [])
  const refreshConversationHistory = useCallback(async () => {
    try {
      setConversationHistory(await loadCoachConversations())
    } catch {
      // The current chat remains usable if history is temporarily unavailable.
    }
  }, [])

  useEffect(() => {
    const showReconnect = () => setIntervalsDisconnected(true)
    window.addEventListener("intervals-auth-expired", showReconnect)
    return () =>
      window.removeEventListener("intervals-auth-expired", showReconnect)
  }, [])

  useEffect(() => {
    if(activeItem!=='Coach' && !historyOpen)return
    let cancelled = false
    void loadCoachConversations()
      .then((conversations) => {
        if (!cancelled) setConversationHistory(conversations)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [refreshConversationHistory,activeItem,historyOpen])

  useEffect(() => {
    const handlePopState = () => {
      const route = routeConversation()
      setSelectedWorkout(window.matchMedia('(max-width: 767px)').matches?restoreOpenWorkout([...cachedTrainingContext().planned,...cachedTrainingContext().history]):null)
      setActiveItem(routeItem())
      setConversationId(route.conversationId)
      setReviewId(route.reviewId)
      if (!route.conversationId && !route.reviewId)
        setConversationTitle("Coach")
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

  const selectItem = (item: string) => {
    setSelectedWorkout(null)
    setActiveItem(item)
    if (item === "Calendar") setCalendarNavigationVersion((value) => value + 1)
    if (item === "Coach") {
      setNewChatVersion((value) => value + 1)
      setConversationId(null)
      setReviewId(null)
      setConversationTitle("Coach")
    }
    window.history.pushState({}, "", itemPath(item))
  }

  const openConversation = (conversation: CoachConversationSummary) => {
    setSelectedWorkout(null)
    setActiveItem("Coach")
    setConversationId(conversation.id)
    setReviewId(conversation.review_id)
    setConversationTitle(conversation.title)
    setHistoryOpen(false)
    const url = conversation.review_id
      ? `/coach?review=${encodeURIComponent(conversation.review_id)}`
      : `/coach?conversation=${encodeURIComponent(conversation.id)}`
    window.history.pushState({}, "", url)
  }

  const pinConversation = async (conversation: CoachConversationSummary) => {
    const response = await apiFetch(
      `/api/conversations/${encodeURIComponent(conversation.id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ pinned: !conversation.pinned }),
      }
    )
    if (response.ok) await refreshConversationHistory()
  }

  const deleteConversation = async () => {
    if (!conversationToDelete) return
    const deleted = conversationToDelete
    const response = await apiFetch(
      `/api/conversations/${encodeURIComponent(deleted.id)}`,
      { method: "DELETE" }
    )
    setConversationToDelete(null)
    if (!response.ok) return
    if (activeConversationId === deleted.id) selectItem("Coach")
    await refreshConversationHistory()
  }

  const handleConversationSaved = useCallback(
    (conversation: CoachConversationSummary) => {
      setConversationId(conversation.id)
      setConversationTitle(conversation.title)
      if (!conversation.review_id) {
        window.history.replaceState(
          {},
          "",
          `/coach?conversation=${encodeURIComponent(conversation.id)}`
        )
      }
      void refreshConversationHistory()
    },
    [refreshConversationHistory]
  )

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
              Your Intervals.icu API key is missing or no longer valid. Your saved coaching
              context remains available in Supabase. Open Intervals.icu Settings,
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

      <AlertDialog
        open={Boolean(conversationToDelete)}
        onOpenChange={(open) => !open && setConversationToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{conversationToDelete?.title}” will disappear from history and
              will no longer be used as coaching context. This cannot be undone
              from the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void deleteConversation()}
            >
              Delete chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[80vw] max-w-80 gap-0 p-0 md:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Chat history</SheetTitle>
            <SheetDescription>
              Recent coach conversations and daily reviews.
            </SheetDescription>
          </SheetHeader>
          <div className="p-2 pt-4">
            <Button
              variant="secondary"
              className="h-10 w-full justify-start rounded-xl"
              onClick={() => {
                setHistoryOpen(false)
                selectItem("Coach")
              }}
            >
              <SquarePen className="size-4" /> New chat
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
            <ConversationHistory
              conversations={conversationHistory}
              activeConversationId={activeConversationId}
              onOpen={openConversation}
              onPin={(conversation) => void pinConversation(conversation)}
              onDelete={setConversationToDelete}
            />
          </div>
          <Button
            variant="ghost"
            className="m-2 justify-start"
            onClick={() => {
              setHistoryOpen(false)
              selectItem("Home")
            }}
          >
            <Home className="size-4" /> Home
          </Button>{" "}
        </SheetContent>
      </Sheet>

      <SidebarNavigationSlim items={navigation} activeItem={activeItem} onNavigate={selectItem}>
        <ConversationHistory
          conversations={conversationHistory}
          activeConversationId={activeConversationId}
          onOpen={openConversation}
          onPin={(conversation) => void pinConversation(conversation)}
          onDelete={setConversationToDelete}
        />
      </SidebarNavigationSlim>

      <SidebarInset
        className={
          (isCoachConversation || activeItem === "Settings") && !selectedWorkout
            ? "h-svh min-h-0 overflow-hidden"
            : undefined
        }
      >
        {!selectedWorkout &&
          activeItem !== "Calendar" &&
          activeItem !== "Settings" && (
            <header
              className="mobile-site-header sticky top-0 z-50 flex h-14 w-full shrink-0 items-center border-b bg-background/95 px-4 shadow-sm backdrop-blur"
            >
              {isCoachConversation ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mr-2 md:hidden"
                    aria-label="Open chat history"
                    onClick={() => setHistoryOpen(true)}
                  >
                    <Menu className="size-5" />
                  </Button>
                  <div className="min-w-0 flex-1 pr-2">
                    <h1 className="mobile-header-title truncate text-sm font-semibold">
                      <span className="md:hidden">Chat</span>
                      <span className="hidden md:inline">Coach</span>
                    </h1>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="New chat"
                      className="md:hidden"
                      onClick={() => selectItem("Coach")}
                    >
                      <SquarePen className="size-5" />
                    </Button>
                  </div>
                </>
              ) : (
                <h1 className="mobile-header-title min-w-0 truncate text-sm font-semibold">
                  {activeItem}
                </h1>
              )}
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
            isCoachConversation && !selectedWorkout ? "chat" : contextVersion
          }
          className={`flex min-h-0 flex-1 ${
            selectedWorkout
              ? "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
              : isCoachConversation
                ? "overflow-hidden"
                : activeItem === "Settings"
                  ? "overflow-hidden pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
                  : "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0"
          }`}
        >
          <Suspense fallback={<RouteFallback />}>
            {selectedWorkout ? (
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
            ) : isCoachConversation ? (
              <TrainingCoach
                key={
                  reviewId ||
                  conversationId ||
                  `new-conversation-${newChatVersion}`
                }
                conversationTitle={displayedConversationTitle}
                conversationId={conversationId}
                reviewId={reviewId}
                onConversationSaved={handleConversationSaved}
              />
            ) : activeItem === "Settings" ? (
              <SettingsWorkspace />
            ) : activeItem === "Library" ? (
              <TrainingLibrary onWorkoutOpen={openWorkout} />
            ) : activeItem === "Annual Plan" ? (
              <AnnualPlanCreator />
            ) : null}
          </Suspense>
        </main>

        {(!isCoachConversation || selectedWorkout) && (
          <MobileNavbar activeItem={activeItem} onNavigate={selectItem} />
        )}
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
