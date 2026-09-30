import { createRoot } from "react-dom/client"
import Framework7 from "framework7/lite"
import Framework7React, { App as Framework7App } from "framework7-react"
import { setApiAuthenticated } from "../src/lib/api-client"
import { WorkoutReportsPage } from "../src/components/workout-reports-page"
import "../src/index.css"
import "../src/styles/framework7-navbar.less"

// Isolated UI fixture: every network request is intercepted.
// eslint-disable-next-line react-hooks/rules-of-hooks
Framework7.use([Framework7React])
setApiAuthenticated(true)
if (new URLSearchParams(location.search).has("dark"))
  document.documentElement.classList.add("dark")
const rows = Array.from({ length: 12 }, (_, index) => ({
  id: `activity:${index + 1}`,
  activity_id: String(index + 1),
  status: "completed" as const,
  workout_date: `2026-09-${String(29 - index).padStart(2, "0")}`,
  recorded_start_local: `2026-09-${String(29 - index).padStart(2, "0")}T08:30:00`,
  title: ["Morning easy run", "Pool endurance", "Long ride"][index % 3],
  sport: ["Run", "Swim", "Ride"][index % 3],
  day: "TUE",
  date: "Sep 29",
  duration: "1h",
  goal: "",
  workout_summary: {
    planned: null,
    completed: {
      duration_seconds: 2400 + index * 250,
      elapsed_time_seconds: 2600 + index * 250,
      distance_meters: 1609.344 * (index + 1),
      average_speed: 2.5,
      elevation_gain: index < 11 ? 0 : null,
      average_hr: 141 + index,
      calories: 350 + index * 20,
      tss: 42 + index,
    },
  },
}))
const original = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const path = String(input)
  const analysis = new URL(path, location.origin).searchParams.get("__api_route")?.match(/^activities\/(\d+)\/analysis$/)
  if (analysis) {
    const index = Number(analysis[1]) - 1
    const duration = 2400 + index * 250
    return new Response(JSON.stringify({
      version: 8,
      duration,
      laps: [],
      intervals: [],
      points: Array.from({ length: Math.floor(duration / 10) + 1 }, (_, step) => {
        const time = Math.min(duration, step * 10)
        return {
          time,
          distance: time * 2.5,
          elevation: 30 + Math.sin(step / 26 + index) * 12,
          speed: 2.4 + Math.sin(step / 12 + index) * 0.25,
          power: 170 + Math.sin(step / 10 + index) * 35,
          heartRate: 130 + index * 2 + Math.sin(step / 18 + index) * 12,
          cadence: 85 + Math.sin(step / 15 + index) * 8,
        }
      }),
    }), { headers: { "Content-Type": "application/json" } })
  }
  if (path.includes("training-context"))
    return new Response(
      JSON.stringify({
        athlete: { time_zone: "America/Chicago" },
        history: rows,
        planned: [],
        context_scope: "full",
        retention_days: 90,
        source: "fixture",
      }),
      { headers: { "Content-Type": "application/json" } }
    )
  if (path.includes("training-preferences"))
    return new Response(JSON.stringify({ training_preferences: {} }), {
      headers: { "Content-Type": "application/json" },
    })
  return original(input, init)
}
createRoot(document.getElementById("root")!).render(
  <Framework7App name="Reports fixture" theme="ios">
    <WorkoutReportsPage
      onWorkoutOpen={() => {
        /* Navigation is checked in the application shell. */
      }}
    />
  </Framework7App>
)
