// Isolated UI verification: every request returns a fixture, with no credentials
// or connections to Intervals.icu, Supabase, GitHub or the deployed app.
import { createRoot } from "react-dom/client"
import Framework7 from "framework7/lite"
import Framework7React, { App as Framework7App } from "framework7-react"
import App from "../src/App"
import { AppToastProvider } from "../src/components/ui/toast"
import { TooltipProvider } from "../src/components/ui/tooltip"
import { ThemeProvider } from "../src/components/theme-provider"
import { setApiAuthenticated } from "../src/lib/api-client"
import { rememberTrainingContext } from "../src/lib/training-context"
import "../src/index.css"
import "../src/styles/framework7-navbar.less"
import "../src/styles/mobile-glass-actions.css"
import "../src/styles/mobile-bottom-nav.css"
import "../src/styles/mobile-dashboard.css"

// eslint-disable-next-line react-hooks/rules-of-hooks
Framework7.use([Framework7React])
const today = new Date().toLocaleDateString("en-CA")
const context = {
  athlete: { name: "Mobile preview", time_zone: "America/Chicago", zones: {} },
  metrics: { fitness: 73, fatigue: 78, form: -5 },
  wellness: { hrv: 60, resting_hr: 50, sleep: 29340 },
  wellness_history: [
    { date: today, sleepSecs: 29340, sleepScore: 85, remSleepSecs: 5400 },
  ],
  planned: [],
  history: [],
  version: "preview",
  source: "intervals",
}
let exportStarted = 0
const scenario = new URLSearchParams(location.search).get("scenario")
window.fetch = async (input) => {
  const url = new URL(String(input), location.href)
  const route =
    url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "")
  const json = (data: unknown) => Response.json(data)
  if (route === "sync/progress")
    return json({
      phase: "intervals",
      label: "Loading workouts and wellness",
      completed: 4,
      total: 6,
    })
  if (route === "sync") {
    if (url.searchParams.has("forceIntervals")) {
      await new Promise((resolve) => setTimeout(resolve, 3500))
      if (scenario === "intervals-error")
        return new Response(
          JSON.stringify({
            error: "Intervals.icu could not be reached. Please try again.",
          }),
          { status: 503 }
        )
      exportStarted = Date.now()
      return json({
        context,
        section11Sync: { status: "running", revision: 1 },
      })
    }
    return json({ context, section11Sync: { status: "complete", revision: 1 } })
  }
  if (route === "section11-sync")
    return json({
      status:
        Date.now() - exportStarted < 20000
          ? "running"
          : scenario === "github-error"
            ? "failed"
            : "complete",
      revision: 1,
      commit: "fixture",
      error: "GitHub could not be reached. Refresh to retry.",
    })
  if (route === "training-context") return json(context)
  if (route === "config") return json({ calendarSummaryOpen: true })
  if (route.includes("annual-plan")) return json({ plan: null, plans: [] })
  return json({})
}
setApiAuthenticated(true)
rememberTrainingContext(context, "full")
document.documentElement.style.setProperty("--f7-safe-area-bottom", "34px")
createRoot(document.getElementById("root")!).render(
  <Framework7App name="Sync verification" theme="ios">
    <ThemeProvider>
      <TooltipProvider>
        <AppToastProvider>
          <App />
        </AppToastProvider>
      </TooltipProvider>
    </ThemeProvider>
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        bottom: 8,
        left: "calc(50% - 66px)",
        width: 132,
        height: 5,
        borderRadius: 5,
        background: "var(--foreground)",
        zIndex: 45,
        pointerEvents: "none",
      }}
    />
  </Framework7App>
)
