// Isolated navigation regression fixture. No API request reaches a live account.
// Delayed replies intentionally ignore aborts to exercise stale-response guards.
import { createRoot } from "react-dom/client"
import Framework7 from "framework7/lite"
import Searchbar from "framework7/components/searchbar"
import Calendar from "framework7/components/calendar"
import Picker from "framework7/components/picker"
import Sheet from "framework7/components/sheet"
import Accordion from "framework7/components/accordion"
import Framework7React, { App as Framework7App } from "framework7-react"
import App from "../src/App"
import { AppToastProvider } from "../src/components/ui/toast"
import { TooltipProvider } from "../src/components/ui/tooltip"
import { setApiAuthenticated } from "../src/lib/api-client"
import { nutritionChanged } from "../src/lib/nutrition"
import {
  rememberTrainingContext,
  type PlannedWorkout,
} from "../src/lib/training-context"
import "../src/index.css"
import "../src/styles/framework7-navbar.less"
import "../src/styles/mobile-glass-actions.css"
import "../src/styles/mobile-bottom-nav.css"
import "../src/styles/mobile-dashboard.css"

// eslint-disable-next-line react-hooks/rules-of-hooks
Framework7.use([Framework7React, Searchbar, Calendar, Picker, Sheet, Accordion])
const today = new Date().toLocaleDateString("en-CA")
const summary = {
  duration_seconds: 1200,
  distance_meters: 4000,
  average_speed: 3.33,
  average_hr: 148,
  tss: 28,
  calories: 300,
}
const planned: PlannedWorkout = {
  id: "event:501",
  day: "Today",
  date: today,
  workout_date: today,
  sport: "Run",
  title: "Planned run fixture",
  duration: "20m",
  goal: "Easy run",
  status: "today",
}
const completed: PlannedWorkout = {
  ...planned,
  id: "activity:fixture-a",
  activity_id: "fixture-a",
  status: "completed",
  title: "Completed run fixture",
  actualDurationMinutes: 20,
  workout_summary: { planned: null, completed: summary },
}
const second = {
  ...completed,
  id: "activity:fixture-b",
  activity_id: "fixture-b",
  title: "Second recording fixture",
}
const points = Array.from({ length: 1201 }, (_, time) => ({
  time,
  latitude: 41.88 + Math.sin((time / 1200) * Math.PI * 2) * 0.007,
  longitude: -87.63 + Math.cos((time / 1200) * Math.PI * 2) * 0.009,
  distance: (time / 1200) * 4000,
  speed: 3.33,
  heartRate: 145 + (time % 15),
  elevation: 180 + Math.sin(time / 40) * 4,
}))
const laps = Array.from({ length: 4 }, (_, index) => ({
  id: `lap-${index + 1}`,
  label: `Lap ${index + 1}`,
  start: index * 300,
  end: (index + 1) * 300,
  distance: 1000,
}))
const context = {
  athlete: {
    name: "Navigation fixture",
    time_zone: "America/Chicago",
    zones: {},
  },
  metrics: { fitness: 50, form: 10, fatigue: 40 },
  wellness: {},
  wellness_history: [],
  planned: [planned, completed, second],
  history: [completed, second],
  source: "intervals.icu",
  version: "isolated-navigation-v1",
}
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  })
let apiCalls = 0
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    location.href,
  )
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, init)
  apiCalls++
  const route = decodeURIComponent(
    url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, ""),
  )
  if (init?.method && init.method !== "GET")
    return new Response('{"error":"Fixture writes are disabled"}', {
      status: 403,
    })
  if (route.startsWith("training-context")) {
    await pause(250)
    return json(context)
  }
  if (route.startsWith("training-updates")) {
    await pause(700)
    return json({ context })
  }
  if (route.includes("/analysis")) {
    await pause(1500)
    return json({ points, laps, intervals: laps, duration: 1200 })
  }
  if (route.includes("/summary")) {
    await pause(900)
    return json(summary)
  }
  if (route.includes("/route")) {
    await pause(500)
    return json({ points: points.map((p) => [p.latitude, p.longitude]) })
  }
  if (route.startsWith("nutrition/library"))
    return json({ foods: [], favorites: [], recipes: [] })
  if (route.startsWith("nutrition")) {
    await pause(5000)
    const date = url.searchParams.get("date") || today
    return json({
      date,
      day: { date, entries: [], revision: 0 },
      targets: {},
      week: [
        {
          date,
          logged: false,
          totals: { calories: 0, protein: 0, fat: 0, carbs: 0 },
        },
      ],
      aiAvailable: true,
    })
  }
  if (route.includes("reports/status"))
    return json({ status: "not_requested", eligible: false })
  if (route.includes("annual-plan")) return json({ plan: null, plans: [] })
  if (route.includes("config")) return json({ calendarSummaryOpen: true })
  return json({})
}

const errors: string[] = []
window.addEventListener("error", (event) => errors.push(event.message))
window.addEventListener("unhandledrejection", (event) =>
  errors.push(String(event.reason)),
)
let shifts = 0,
  canvases = 0
const shiftSources: unknown[] = []
new PerformanceObserver((list) => {
  for (const entry of list.getEntries())
    if (
      !(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput
    ) {
      shifts += (entry as PerformanceEntry & { value: number }).value
      shiftSources.push({
        value: (entry as PerformanceEntry & { value: number }).value,
        route: location.pathname,
        sources: (
          entry as PerformanceEntry & { sources: { node: Element | null }[] }
        ).sources?.map((s) => s.node?.className),
      })
    }
}).observe({ type: "layout-shift", buffered: true })
const seenCanvases = new WeakSet<Element>()
new MutationObserver((records) => {
  for (const record of records)
    for (const node of record.addedNodes)
      if (node instanceof Element) {
        const added = [...node.querySelectorAll("canvas.mapboxgl-canvas")]
        if (node.matches("canvas.mapboxgl-canvas")) added.push(node)
        for (const canvas of added)
          if (!seenCanvases.has(canvas)) {
            seenCanvases.add(canvas)
            canvases++
          }
      }
}).observe(document.body, { childList: true, subtree: true })
const panel = document.createElement("aside")
panel.style.cssText =
  "position:fixed;bottom:70px;right:4px;z-index:999999;background:white;color:black;border:1px solid #999;padding:6px;font:11px monospace;max-width:310px"
panel.innerHTML =
  '<button id="stress">Run navigation stress</button> <button id="cold">Cold Home quick add</button> <button id="cold-workout">Cold workout</button> <button id="inspect">Inspect stability</button> <button id="reset">Reset layout metrics</button><pre id="result" style="white-space:pre-wrap;max-height:200px;overflow:auto"></pre>'
document.body.append(panel)
const result = panel.querySelector("#result")!
const inspect = () => ({
  errors,
  apiCalls,
  shifts: Number(shifts.toFixed(5)),
  shiftSources: shiftSources.slice(-5),
  canvases,
  screens: document.querySelectorAll(".nutrition-screen").length,
  inert: document.getElementById("root")?.inert,
  bodyOverflow: document.body.style.overflow,
  horizontalOverflow:
    document.documentElement.scrollWidth > window.innerWidth + 1,
  focus: document.activeElement?.id,
  route: location.pathname,
})
panel.querySelector("#inspect")!.addEventListener("click", () => {
  result.textContent = JSON.stringify(inspect(), null, 2)
})
panel.querySelector("#reset")!.addEventListener("click", () => {
  shifts = 0
  shiftSources.length = 0
  result.textContent = "Layout metrics reset"
})
panel.querySelector("#cold")!.addEventListener("click", () => {
  nutritionChanged()
  document
    .querySelector<HTMLButtonElement>('[aria-label="Quick add food by typing"]')
    ?.click()
  result.textContent = JSON.stringify(
    {
      ...inspect(),
      logStillLoading: Boolean(
        document.querySelector('[aria-label="Loading nutrition"]'),
      ),
    },
    null,
    2,
  )
})
panel.querySelector("#cold-workout")!.addEventListener("click", async () => {
  window.dispatchEvent(new Event("device-cache-cleared"))
  const baseline = canvases
  document
    .querySelector<HTMLButtonElement>(
      '[aria-label="Open Completed run fixture"]',
    )
    ?.click()
  await pause(1100)
  const early = {
    addedCanvases: canvases - baseline,
    signalChartsReady: Boolean(
      document.querySelector('[aria-label="Recorded signal graphs"]'),
    ),
    mapReady: Boolean(document.querySelector(".mapboxgl-canvas")),
  }
  await pause(1400)
  result.textContent = JSON.stringify(
    {
      early,
      late: {
        addedCanvases: canvases - baseline,
        signalChartsReady: Boolean(
          document.querySelector('[aria-label="Recorded signal graphs"]'),
        ),
      },
      errors,
    },
    null,
    2,
  )
})
const navigate = (item: string) =>
  window.dispatchEvent(new CustomEvent("app-navigate", { detail: { item } }))
panel.querySelector("#stress")!.addEventListener("click", async () => {
  const button = panel.querySelector<HTMLButtonElement>("#stress")!
  button.disabled = true
  let transitions = 0,
    workoutOpens = 0,
    workoutCloses = 0
  const closeWorkout = async () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const close = document.querySelector<HTMLButtonElement>(
        '[aria-label="Close workout details"], [aria-label="Back to workouts"], [aria-label="Back"]',
      )
      if (close) {
        close.click()
        workoutCloses++
        return
      }
      await pause(20)
    }
  }
  try {
    for (let cycle = 0; cycle < 12; cycle++) {
      for (const item of ["Home", "Calendar", "Nutrition", "Coach", "Home"]) {
        navigate(item)
        transitions++
        await pause(30)
      }
      const completedButton = document.querySelector<HTMLButtonElement>(
        '[aria-label="Open Completed run fixture"]',
      )
      if (completedButton) {
        completedButton.click()
        workoutOpens++
      }
      await pause(30)
      if (completedButton) await closeWorkout()
      await pause(30)
      window.dispatchEvent(
        new CustomEvent("app-navigate", {
          detail: { item: "Nutrition", quickAdd: "type" },
        }),
      )
      transitions++
      await pause(20)
      document
        .querySelector<HTMLButtonElement>(
          '.nutrition-screen button[aria-label="Back"]',
        )
        ?.click()
      await pause(20)
      navigate("Calendar")
      transitions++
      await pause(80)
      for (const offset of [4000, 16000, 2000, 0]) {
        window.dispatchEvent(new WheelEvent("wheel", { deltaY: offset }))
        window.scrollTo({ top: offset, behavior: "instant" })
        await pause(15)
      }
      const workout =
        document.querySelector<HTMLElement>(
          '[aria-label="Open Planned run fixture"]',
        ) ||
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-slot="card"][role="button"]',
          ),
        ).find((b) => b.textContent?.includes("Planned run fixture"))
      if (workout) {
        workout.click()
        workoutOpens++
      }
      await pause(30)
      if (workout) await closeWorkout()
      await pause(30)
    }
    navigate("Home")
    await pause(6000)
    result.textContent = JSON.stringify(
      { transitions, workoutOpens, workoutCloses, ...inspect() },
      null,
      2,
    )
  } catch (error) {
    errors.push(String(error))
    result.textContent = JSON.stringify(inspect(), null, 2)
  } finally {
    button.disabled = false
  }
})
setApiAuthenticated(true)
rememberTrainingContext(context, "full")
createRoot(document.getElementById("root")!).render(
  <Framework7App name="Verification" theme="ios">
    <TooltipProvider>
      <AppToastProvider>
        <App />
      </AppToastProvider>
    </TooltipProvider>
  </Framework7App>,
)
