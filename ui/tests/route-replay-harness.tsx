import { createRoot } from "react-dom/client"
import { useEffect } from "react"
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
const fallback = new URLSearchParams(location.search).has("fallback")
const longRide = new URLSearchParams(location.search).has("long")
const slow = new URLSearchParams(location.search).has("slow")
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
    duration_seconds: 14400,
    elapsed_time_seconds: 14400,
    distance_meters: 160000,
    average_speed: 160000 / 14400,
  })
  Object.assign(workout, {
    title: "Long ride performance test",
    sport: "Ride",
    duration: "4h",
    actualDurationMinutes: 240,
    activity_revision: "long-v1",
  })
}
const count = longRide ? 14401 : 481
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
const originalFetch = window.fetch.bind(window)
const laps = Array.from({ length: 5 }, (_, i) => ({
  id: String(i + 1),
  label: `Lap ${i + 1}`,
  kind: "lap",
  start: i * 576,
  end: (i + 1) * 576,
  distance: 1632,
  speed: 8160 / 2880,
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
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href)
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, init)
  const route =
    url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "")
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
    return fallback
      ? json({ error: "No recording" }, 404)
      : json({
          points,
          laps,
          intervals: laps,
          duration: summary.duration_seconds,
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
createRoot(document.getElementById("root")!).render(
  <Framework7App name="Replay preview" theme="ios">
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        <AppToastProvider>
          <PreviewApp />
        </AppToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  </Framework7App>
)
