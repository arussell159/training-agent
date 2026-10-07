import { createRoot } from "react-dom/client"
import { useEffect, useState } from "react"
import Framework7 from "framework7/lite"
import Picker from "framework7/components/picker"
import Sheet from "framework7/components/sheet"
import Searchbar from "framework7/components/searchbar"
import Accordion from "framework7/components/accordion"
import Actions from "framework7/components/actions"
import Calendar from "framework7/components/calendar"
import Dialog from "framework7/components/dialog"
import Progressbar from "framework7/components/progressbar"
import Range from "framework7/components/range"
import Sortable from "framework7/components/sortable"
import Framework7React, { App as Framework7App } from "framework7-react"
import App from "../src/App"
import { AppToastProvider } from "../src/components/ui/toast"
import { TooltipProvider } from "../src/components/ui/tooltip"
import { ThemeProvider } from "../src/components/theme-provider"
import { RouteReplay } from "../src/components/route-replay"
import { RouteReplayButton } from "../src/components/route-replay-button"
import {
  Dialog as ReplayDialog,
  DialogContent,
  DialogTitle,
} from "../src/components/ui/dialog"
import { setApiAuthenticated } from "../src/lib/api-client"
import {
  rememberTrainingContext,
  type PlannedWorkout,
} from "../src/lib/training-context"
import { rememberOpenWorkout } from "../src/lib/workout-navigation"
import "../src/index.css"
import "../src/styles/framework7-navbar.less"
import "../src/styles/mobile-glass-actions.css"
import "../src/styles/mobile-bottom-nav.css"
import "../src/styles/mobile-dashboard.css"

// This event uses the real app and workout detail components. All API calls
// are intercepted so preview interactions never reach the athlete's provider.
// eslint-disable-next-line react-hooks/rules-of-hooks
Framework7.use([
  Framework7React,
  Picker,
  Sheet,
  Searchbar,
  Accordion,
  Actions,
  Calendar,
  Dialog,
  Progressbar,
  Range,
  Sortable,
])
const flags = new URLSearchParams(location.search)
const fallback = flags.has("fallback")
const longRide = flags.has("long")
const slow = flags.has("slow")
const direct = flags.has("direct")
const today = new Date().toLocaleDateString("en-CA")
const summary = {
  duration_seconds: 2880,
  elapsed_time_seconds: 2880,
  distance_meters: 8160,
  average_speed: 8160 / 2880,
  average_hr: 146,
  max_hr: 164,
  elevation_gain: 48,
  calories: 520,
}
const workout: PlannedWorkout = {
  id: "event:replay-fixture",
  activity_id: "replay-fixture",
  title: "Evening along the bayou",
  day: "Wednesday",
  date: today,
  workout_date: today,
  recorded_start_local: `${today}T18:30:00`,
  sport: "Run",
  duration: "48m",
  goal: "Easy run along the bayou",
  details:
    "Sample activity for testing route replay in the workout details screen.",
  actualDurationMinutes: 48,
  device_name: "Sample GPS recording",
  workout_summary: { planned: null, completed: summary },
  status: "completed",
}
if (longRide) {
  Object.assign(summary, {
    duration_seconds: 21600,
    elapsed_time_seconds: 21600,
    distance_meters: 200000,
    average_speed: 200000 / 21600,
  })
  Object.assign(workout, {
    title: "Long ride performance test",
    sport: "Ride",
    duration: "6h",
    actualDurationMinutes: 360,
    activity_revision: "long-v2",
  })
}
const count = flags.has("huge") ? 86401 : longRide ? 21601 : 481
const points = Array.from({ length: count }, (_, i) => {
  const t = i / (count - 1),
    out = t < 0.5 ? t * 2 : 2 - t * 2
  return {
    time: t * summary.duration_seconds,
    latitude:
      29.7608 + Math.sin(out * Math.PI * 4) * 0.0015 + (t > 0.5 ? 0.0009 : 0),
    longitude: -95.401 + out * (longRide ? 0.8 : 0.033),
    distance: t * summary.distance_meters,
    elevation: 8 + Math.sin(t * Math.PI * 6) * 4,
    speed: (longRide ? 11 : 2.8) + Math.sin(t * Math.PI * 8) * 0.4,
    heartRate: Math.round(146 + Math.sin(t * Math.PI * 8) * 10),
    cadence: 170,
    power: null,
  }
})
const replayPoints = flags.has("empty") ? [] : points
const originalFetch = window.fetch.bind(window)
const laps = Array.from({ length: 5 }, (_, i) => ({
  id: String(i + 1),
  label: `Lap ${i + 1}`,
  kind: "lap",
  start: (i * summary.duration_seconds) / 5,
  end: ((i + 1) * summary.duration_seconds) / 5,
  distance: summary.distance_meters / 5,
  speed: summary.average_speed,
  heartRate: 146,
  power: null,
}))
const context = {
  athlete: { name: "Replay preview", time_zone: "America/Chicago", zones: {} },
  metrics: { fitness: 50, form: 10, fatigue: 40 },
  wellness: { hrv: 60, resting_hr: 50, sleep: 28000 },
  planned: [workout],
  history: [workout],
  source: "intervals.icu",
  version: "replay-preview-v2",
  cache_scope: "replay-preview",
  context_scope: "full" as const,
}
const fixture = {
  points: count,
  duration: summary.duration_seconds,
  distance: summary.distance_meters,
  calls: [] as string[],
  mountedAt: 0,
}
Object.assign(window, { __replayFixture: fixture })
window.fetch = async (input, init) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    location.href
  )
  if (url.origin !== location.origin)
    throw new Error("Off-origin requests are blocked in the replay fixture")
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, init)
  const route =
    url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "")
  fixture.calls.push(route)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  // Appearance is a local preview preference; activity mutations stay blocked.
  if (route === "config") {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body || "{}"))
      if (
        Object.keys(body).length !== 1 ||
        !["light", "dark", "system"].includes(body.APP_THEME)
      ) {
        return json(
          { error: "Only appearance can be changed in this preview." },
          405
        )
      }
      localStorage.setItem("theme", body.APP_THEME)
    }
    return json({
      calendarSummaryOpen: true,
      theme: localStorage.getItem("theme") || "light",
    })
  }
  if (init?.method && init.method !== "GET")
    return json({ error: "This sample activity is for preview only." }, 405)
  if (route.startsWith("training-context")) return json(context)
  if (route.startsWith("sync")) return json({ context })
  if (route.includes("/route"))
    return json({ points: points.map((p) => [p.latitude, p.longitude]) })
  if (route.includes("/analysis")) {
    if (slow) await new Promise((resolve) => setTimeout(resolve, 6000))
    const linked = route.includes("replay-linked")
    return fallback
      ? json({ error: "No recording" }, 404)
      : json({
          points: linked
            ? points.map((point) => ({
                ...point,
                latitude: point.latitude + 0.03,
                time: point.time / 2,
                distance: point.distance / 2,
              }))
            : points,
          laps: linked ? [] : laps,
          intervals: linked ? [] : laps,
          duration: summary.duration_seconds / (linked ? 2 : 1),
        })
  }
  if (route.includes("/summary")) return json(summary)
  if (route.includes("reports/status"))
    return json({
      status: "complete",
      eligible: false,
      text: "# Evening along the bayou\n\nSample activity for testing the workout details and route replay.",
    })
  if (route.includes("annual-plan")) return json({ plan: null, plans: [] })
  return json({})
}
setApiAuthenticated(true)
rememberTrainingContext(context, "full")
function PreviewApp() {
  useEffect(() => {
    rememberOpenWorkout(workout)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }, [])
  return <App />
}
function DirectReplay() {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    fixture.mountedAt = performance.now()
  }, [])
  return (
    <>
      <button onClick={() => setOpen(true)}>Open replay fixture</button>
      {!open && <p>Replay closed</p>}
      <ReplayDialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="!fixed !inset-0 !h-full !w-full !max-w-none !translate-x-0 !translate-y-0 !gap-0 !rounded-none !border-0 !p-0"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Route replay fixture</DialogTitle>
          {open && (
            <RouteReplay
              workout={workout}
              points={replayPoints}
              timed={!fallback}
            />
          )}
        </DialogContent>
      </ReplayDialog>
    </>
  )
}
function ButtonReplay() {
  const [current, setCurrent] = useState(workout)
  useEffect(() => {
    Object.assign(window, {
      __replayRelink: () =>
        setCurrent({
          ...workout,
          activity_id: "replay-linked",
          activity_revision: "linked-v1",
          title: "Relinked recording fixture",
        }),
    })
  }, [])
  return (
    <div className="relative h-screen">
      <RouteReplayButton workout={current} points={points} timed />
    </div>
  )
}
createRoot(document.getElementById("root")!).render(
  <Framework7App name="Replay preview" theme="ios">
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        <AppToastProvider>
          {flags.has("button") ? (
            <ButtonReplay />
          ) : direct ? (
            <DirectReplay />
          ) : (
            <PreviewApp />
          )}
        </AppToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  </Framework7App>
)
