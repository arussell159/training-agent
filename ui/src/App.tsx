import { useCallback, useEffect, useRef, useState } from "react"
import {
  CalendarDays,
  Dumbbell,
  History,
  Home,
  Library,
  MessageCircle,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
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
import { Badge } from "@/components/ui/badge"
import { ConversationHistory } from "@/components/conversation-history"
import { SettingsWorkspace } from "@/components/settings-workspace"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { TrainingCalendar } from "@/components/training-calendar"
import { TrainingCoach } from "@/components/training-coach"
import { TrainingDashboard } from "@/components/training-dashboard"
import { TrainingLibrary } from "@/components/training-library"
import { WorkoutDetailPage } from "@/components/workout-detail-page"
import {
  loadCoachConversations,
  type CoachConversationSummary,
  type PlannedWorkout,
} from "@/lib/training-context"

const navigation = [
  { label: "Home", icon: Home },
  { label: "Coach", icon: MessageCircle },
  { label: "Calendar", icon: CalendarDays },
  { label: "Library", icon: Library },
  { label: "Settings", icon: Settings },
]

function routeItem() {
  if (window.location.pathname === "/coach") return "Coach"
  if (window.location.pathname === "/calendar" || window.location.pathname === "/week") return "Calendar"
  if (window.location.pathname === "/library") return "Library"
  if (window.location.pathname === "/settings") return "Settings"
  return localStorage.getItem("training-app-active-item") ?? "Home"
}

function itemPath(item: string) {
  return ({ Home:"/", Coach:"/coach", Calendar:"/calendar", Library:"/library", Settings:"/settings" } as Record<string,string>)[item] || "/coach"
}

function routeConversation() {
  const params = new URLSearchParams(window.location.search)
  return {
    conversationId:params.get("conversation"),
    reviewId:params.get("review"),
  }
}

function AppWorkspace() {
  const initialConversation = routeConversation()
  const [activeItem, setActiveItem] = useState(routeItem)
  const [conversationId, setConversationId] = useState(initialConversation.conversationId)
  const [reviewId, setReviewId] = useState(initialConversation.reviewId)
  const [conversationTitle, setConversationTitle] = useState("Coach")
  const [conversationHistory, setConversationHistory] = useState<CoachConversationSummary[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [conversationToDelete, setConversationToDelete] = useState<CoachConversationSummary | null>(null)
  const [selectedWorkout, setSelectedWorkout] = useState<PlannedWorkout | null>(null)
  const [refreshRequest, setRefreshRequest] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [trainingPeaksDisconnected, setTrainingPeaksDisconnected] = useState(false)
  const workoutReturnScroll = useRef(0)
  const isCoachConversation = activeItem === "Coach"
  const selectedConversation = conversationHistory.find((conversation) =>
    conversationId ? conversation.id === conversationId : conversation.review_id === reviewId
  )
  const activeConversationId = conversationId || selectedConversation?.id || null
  const displayedConversationTitle = selectedConversation?.title || conversationTitle
  const handleRefreshComplete = useCallback(() => setIsRefreshing(false), [])
  const refreshConversationHistory = useCallback(async () => {
    try {
      setConversationHistory(await loadCoachConversations())
    } catch {
      // The current chat remains usable if history is temporarily unavailable.
    }
  }, [])

  useEffect(() => {
    localStorage.setItem("training-app-active-item", activeItem)
  }, [activeItem])

  useEffect(() => {
    const showReconnect = () => setTrainingPeaksDisconnected(true)
    window.addEventListener("trainingpeaks-auth-expired", showReconnect)
    return () => window.removeEventListener("trainingpeaks-auth-expired", showReconnect)
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadCoachConversations()
      .then((conversations) => {
        if (!cancelled) setConversationHistory(conversations)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [refreshConversationHistory])

  useEffect(() => {
    const handlePopState = () => {
      const route = routeConversation()
      setSelectedWorkout(null)
      setActiveItem(routeItem())
      setConversationId(route.conversationId)
      setReviewId(route.reviewId)
      if (!route.conversationId && !route.reviewId) setConversationTitle("Coach")
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  const selectItem = (item: string) => {
    setSelectedWorkout(null)
    setActiveItem(item)
    if (item === "Coach") {
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
    const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}`, {
      method:"PATCH",
      headers:{ "Content-Type":"application/json", Accept:"application/json" },
      body:JSON.stringify({ pinned:!conversation.pinned }),
    })
    if (response.ok) await refreshConversationHistory()
  }

  const deleteConversation = async () => {
    if (!conversationToDelete) return
    const deleted = conversationToDelete
    const response = await fetch(`/api/conversations/${encodeURIComponent(deleted.id)}`, { method:"DELETE" })
    setConversationToDelete(null)
    if (!response.ok) return
    if (activeConversationId === deleted.id) selectItem("Coach")
    await refreshConversationHistory()
  }

  const handleConversationSaved = useCallback((conversation: CoachConversationSummary) => {
    setConversationId(conversation.id)
    setConversationTitle(conversation.title)
    if (!conversation.review_id) {
      window.history.replaceState({}, "", `/coach?conversation=${encodeURIComponent(conversation.id)}`)
    }
    void refreshConversationHistory()
  }, [refreshConversationHistory])

  const openWorkout = (workout: PlannedWorkout) => {
    workoutReturnScroll.current = window.scrollY
    setSelectedWorkout(workout)
    requestAnimationFrame(() => window.scrollTo({ top: 0 }))
  }

  const closeWorkout = () => {
    const returnTo = workoutReturnScroll.current
    setSelectedWorkout(null)
    requestAnimationFrame(() => window.scrollTo({ top: returnTo }))
  }

  return (
    <>
      <AlertDialog open={trainingPeaksDisconnected} onOpenChange={setTrainingPeaksDisconnected}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reconnect TrainingPeaks</AlertDialogTitle>
            <AlertDialogDescription>
              Your TrainingPeaks session has expired. Your saved coaching context remains available in Supabase. Sign in to TrainingPeaks, then update the connection from Settings to resume syncing new workouts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Use saved data</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.open("https://app.trainingpeaks.com", "_blank", "noopener,noreferrer")
                selectItem("Settings")
              }}
            >
              Sign in and reconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(conversationToDelete)} onOpenChange={(open) => !open && setConversationToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{conversationToDelete?.title}” will disappear from history and will no longer be used as coaching context. This cannot be undone from the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void deleteConversation()}>
              Delete chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-[min(92vw,24rem)] gap-0 p-0 md:hidden">
          <SheetHeader className="border-b">
            <SheetTitle>Coach history</SheetTitle>
            <SheetDescription>Daily reviews and conversations from the last 90 days.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <ConversationHistory
              conversations={conversationHistory}
              activeConversationId={activeConversationId}
              onOpen={openConversation}
              onPin={(conversation) => void pinConversation(conversation)}
              onDelete={setConversationToDelete}
            />
          </div>
          <SheetFooter className="border-t">
            <Button onClick={() => { setHistoryOpen(false); selectItem("Coach") }}>
              <Plus /> New conversation
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="px-3 py-4">
          <Button
            variant="ghost"
            className="h-10 w-full justify-start px-2 text-base"
            onClick={() => selectItem("Home")}
          >
            <Dumbbell />
            <span>AR Performance</span>
          </Button>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navigation.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      isActive={activeItem === item.label}
                      onClick={() => selectItem(item.label)}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupContent>
              <ConversationHistory
                conversations={conversationHistory}
                activeConversationId={activeConversationId}
                onOpen={openConversation}
                onPin={(conversation) => void pinConversation(conversation)}
                onDelete={setConversationToDelete}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset
        className={(isCoachConversation || activeItem === "Settings") && !selectedWorkout ? "h-svh min-h-0 overflow-hidden" : undefined}
      >
        {!selectedWorkout && activeItem !== "Calendar" && activeItem !== "Settings" && (
          <header className={`sticky top-0 z-50 flex h-14 w-full shrink-0 items-center border-b bg-background/95 px-4 shadow-sm backdrop-blur ${isCoachConversation ? "md:px-6" : ""}`}>
            {isCoachConversation ? (
              <>
                <div className="min-w-0 flex-1 pr-2">
                  <h1 className="truncate text-sm font-semibold md:text-base">
                    <span className="md:hidden">{displayedConversationTitle}</span>
                    <span className="hidden md:inline">Coach</span>
                  </h1>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Badge variant="outline" className="hidden gap-1.5 md:flex">
                    <ShieldCheck className="size-3.5 text-emerald-600" /> 90-day context
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="md:hidden"
                    onClick={() => setHistoryOpen(true)}
                  >
                    <History /> History
                  </Button>
                </div>
              </>
            ) : (
              <h1 className="min-w-0 truncate text-sm font-semibold">{activeItem}</h1>
            )}
            {activeItem === "Home" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto cursor-pointer"
                disabled={isRefreshing}
                onClick={() => {
                  setIsRefreshing(true)
                  setRefreshRequest((request) => request + 1)
                }}
              >
                <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
                <span className="hidden sm:inline">Refresh TrainingPeaks</span>
                <span className="sm:hidden">Refresh</span>
              </Button>
            )}
          </header>
        )}
        <main
          className={`flex min-h-0 flex-1 ${
            selectedWorkout
              ? ""
              : isCoachConversation
                ? "overflow-hidden pb-16 md:pb-0"
                : activeItem === "Settings"
                  ? "overflow-hidden"
                  : "pb-20 md:pb-0"
          }`}
        >
          {selectedWorkout ? (
            <WorkoutDetailPage workout={selectedWorkout} onBack={closeWorkout} />
          ) : activeItem === "Home" ? (
            <TrainingDashboard
              onWorkoutOpen={openWorkout}
              refreshRequest={refreshRequest}
              onRefreshComplete={handleRefreshComplete}
            />
          ) : activeItem === "Calendar" ? (
            <TrainingCalendar onWorkoutOpen={openWorkout} />
          ) : isCoachConversation ? (
            <TrainingCoach
              key={reviewId || conversationId || "new-conversation"}
              conversationTitle={displayedConversationTitle}
              conversationId={conversationId}
              reviewId={reviewId}
              onConversationSaved={handleConversationSaved}
            />
          ) : activeItem === "Settings" ? (
            <SettingsWorkspace onClose={() => selectItem("Home")} />
          ) : activeItem === "Library" ? (
            <TrainingLibrary onWorkoutOpen={openWorkout} />
          ) : null}
        </main>

        {!selectedWorkout && activeItem !== "Settings" && (
          <nav
            aria-label="Primary navigation"
            className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
          >
            {navigation.map((item) => (
              <Button
                key={item.label}
                type="button"
                variant="ghost"
                aria-current={activeItem === item.label ? "page" : undefined}
                className="h-16 min-w-0 flex-col gap-1 rounded-none px-1 text-[10px] font-medium aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
                onClick={() => selectItem(item.label)}
              >
                <item.icon className="size-4" />
                <span className="max-w-full truncate">{item.label}</span>
              </Button>
            ))}
          </nav>
        )}
      </SidebarInset>
    </>
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
