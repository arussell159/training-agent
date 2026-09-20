// Explicitly isolated UI fixtures. All API calls are intercepted; editor requests
// use tools/workout-editor-preview.mjs, whose provider exists only in memory.
import { createRoot } from "react-dom/client"
import Framework7 from "framework7/lite"
import Picker from "framework7/components/picker"
import Sheet from "framework7/components/sheet"
import Searchbar from "framework7/components/searchbar"
import Accordion from "framework7/components/accordion"
import Framework7React, { App as Framework7App } from "framework7-react"
import App from "../src/App"
import { setApiAuthenticated } from "../src/lib/api-client"
import {
  rememberTrainingContext,
  type PlannedWorkout,
} from "../src/lib/training-context"
import "../src/index.css"
import "../src/styles/framework7-navbar.less"

// eslint-disable-next-line react-hooks/rules-of-hooks
Framework7.use([Framework7React, Picker, Sheet, Accordion, Searchbar])
const today = new Date().toLocaleDateString("en-CA")
const originalFetch = window.fetch.bind(window)
const bike = new URLSearchParams(location.search).get("sport") === "Ride"
const longLaps = new URLSearchParams(location.search).has("long")
const resetResponse = await originalFetch(
  `/api/test/reset?sport=${bike ? "Ride" : "Run"}`
)
const resetWorkout = resetResponse.ok ? await resetResponse.json() : {}
const planned: PlannedWorkout = {
  ...resetWorkout,
  id: resetWorkout.id || "event:998",
  title: resetWorkout.title || `Planned ${bike ? "bike" : "run"} fixture`,
  sport: resetWorkout.sport || (bike ? "Ride" : "Run"),
  duration: resetWorkout.duration || "1h15m",
  goal: resetWorkout.goal || "Fixture workout",
  workout_date: today,
  date: today,
  status: "today",
}
let elapsed = 0,
  distance = 0
const durations = longLaps
  ? Array.from({ length: 20 }, (_, i) => [632, 664, 610, 584][i % 4])
  : [632, 664, 610, 584, 230]
const laps = durations.map((seconds, index) => {
  const length =
    (!longLaps && index === 4 ? 0.37 : 1) * 1609.344 * (bike ? 5 : 1)
  const lap = {
    id: String(index + 1),
    label: `Lap ${index + 1}`,
    start: elapsed,
    end: elapsed + seconds,
    distance: length,
    speed: length / seconds,
    power: bike ? 150 + index * 5 : null,
    heartRate: 145 + index * 7,
    kind: "lap",
  }
  elapsed += seconds
  return lap
})
const points = laps.flatMap((lap) =>
  Array.from({ length: 30 }, (_, index) => {
    const point = {
      time: lap.start + ((lap.end - lap.start) * index) / 30,
      distance: distance + (lap.distance * index) / 30,
      speed: lap.speed,
      heartRate: lap.heartRate,
      power: lap.power,
      elevation: 40 + Math.sin((lap.start + index * 10) / 250) * 10,
    }
    if (index === 29) distance += lap.distance
    return point
  })
)
points.push({ ...points.at(-1)!, time: elapsed, distance })
const summary = {
  duration_seconds: elapsed,
  distance_meters: distance,
  average_speed: distance / elapsed,
  average_hr: 160,
  max_hr: 184,
  elevation_gain: 40,
}
const completed: PlannedWorkout = {
  ...planned,
  id: "event:999",
  activity_id: longLaps ? "i999999997" : bike ? "i999999998" : "i999999999",
  status: "completed",
  title: `Completed ${bike ? "bike" : "run"} fixture`,
  actualDurationMinutes: elapsed / 60,
  workout_summary: { planned: null, completed: summary },
}
const context = {
  athlete: {
    name: "Mobile verification",
    time_zone: "America/Chicago",
    zones: {},
  },
  metrics: { fitness: 50, form: 10, fatigue: 40 },
  wellness: { hrv: 60, resting_hr: 50, sleep: 28000 },
  wellness_history: [
    { date: today, sleepSecs: 28000, sleepScore: 85, remSleepSecs: 5400 },
  ],
  planned: [planned, completed],
  history: [completed],
  source: "intervals.icu",
  version: "mobile-fixture-v1",
}
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href)
  const route = decodeURIComponent(
    url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "")
  )
  if (route.includes("/editor") || route.startsWith("test/"))
    return originalFetch(input, init)
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    })
  if (route.startsWith("training-context")) return json(context)
  if (route.startsWith("sync")) return json({ context })
  if (route.includes("/analysis"))
    return json({ points, laps, intervals: laps, duration: elapsed })
  if (route.includes("/summary")) return json(summary)
  if (route.includes("/route")) return json({ points: [] })
  if (route.includes("reports/status"))
    return json({
      status: "complete",
      eligible: false,
      text:
        "# Workout report\n\nImported report fixture from Intervals.icu.\n\n" +
        "Recovery and workout details.\n\n".repeat(40),
    })
  if (route.includes("annual-plan")) return json({ plan: null, plans: [] })
  if (route.includes("config")) return json({ calendarSummaryOpen: true })
  return json({})
}
setApiAuthenticated(true)
rememberTrainingContext(context, "full")
createRoot(document.getElementById("root")!).render(
  <Framework7App name="Verification" theme="ios">
    <App />
  </Framework7App>
)
