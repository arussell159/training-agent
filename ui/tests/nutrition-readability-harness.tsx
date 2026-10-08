// All nutrition data is synthetic. No request can reach a provider/database.
import { createRoot } from "react-dom/client"
import Framework7 from "framework7/lite"
import Searchbar from "framework7/components/searchbar"
import Calendar from "framework7/components/calendar"
import Picker from "framework7/components/picker"
import Sheet from "framework7/components/sheet"
import Framework7React, { App as Framework7App } from "framework7-react"
import { NutritionPage } from "../src/components/nutrition-page"
import { AppToastProvider } from "../src/components/ui/toast"
import { ThemeProvider } from "../src/components/theme-provider"
import { TooltipProvider } from "../src/components/ui/tooltip"
import { setApiAuthenticated } from "../src/lib/api-client"
import { rememberTrainingContext } from "../src/lib/training-context"
import {
  dateShift,
  foodTotals,
  type FoodEntry,
  type Meal,
} from "../src/lib/nutrition"
import "../src/index.css"
import "../src/styles/framework7-navbar.less"
import "../src/styles/mobile-glass-actions.css"
import "../src/styles/mobile-bottom-nav.css"
import "../src/styles/mobile-dashboard.css"

// eslint-disable-next-line react-hooks/rules-of-hooks
Framework7.use([Framework7React, Searchbar, Calendar, Picker, Sheet])
const theme =
  new URLSearchParams(location.search).get("theme") === "dark"
    ? "dark"
    : "light"
localStorage.setItem("theme", theme)
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
}).format(new Date())
const entry = (
  id: string,
  name: string,
  meal: Meal,
  calories: number,
  protein: number,
  carbs: number,
  fat: number
): FoodEntry => ({
  id,
  name,
  meal,
  quantity: 1,
  unit: "bowl",
  calories,
  protein,
  carbs,
  fat,
  fiber: 8,
  source: "manual",
  notes: "",
  barcode: null,
  imageUrl: null,
})
const entries = [
  entry(
    "breakfast-1",
    "Greek yogurt with berries and toasted oats",
    "breakfast",
    480,
    32,
    58,
    14
  ),
  entry("breakfast-2", "Coffee with steamed milk", "breakfast", 94, 6, 8, 4),
  entry(
    "lunch-1",
    "Grilled chicken, brown rice and avocado",
    "lunch",
    683,
    46,
    63,
    23
  ),
  entry(
    "dinner-1",
    "Recovery smoothie with yogurt, fruit and nut butter",
    "dinner",
    1250,
    104,
    163,
    35
  ),
]
const targets = {
  calories: 2400,
  protein: 160,
  carbs: 260,
  fat: 65,
  fiber: null,
}
const context = {
  athlete: {
    name: "Nutrition fixture",
    time_zone: "America/Chicago",
    zones: {},
  },
  metrics: { fitness: 50, form: 10, fatigue: 40 },
  wellness: {},
  planned: [],
  history: [],
  source: "intervals.icu",
  version: "nutrition-readability-fixture",
  context_scope: "full" as const,
}
const fixture = { calls: [] as string[], writes: [] as string[], backCount: 0 }
Object.assign(window, { __nutritionFixture: fixture })
window.fetch = async (input, init) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    location.href
  )
  const route = decodeURIComponent(
    url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "")
  )
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/"))
    throw new Error("Unexpected transport is blocked in the nutrition fixture")
  fixture.calls.push(route)
  if (init?.method && init.method !== "GET") {
    fixture.writes.push(route)
    return Response.json(
      { error: "Fixture writes are disabled" },
      { status: 405 }
    )
  }
  if (route === "config") return Response.json({ theme })
  if (route === "nutrition" || route.startsWith("nutrition?")) {
    const date = url.searchParams.get("date") || today
    return Response.json({
      date,
      day: { entries, revision: 1 },
      targets,
      targetsRevision: 1,
      aiAvailable: true,
      localPreview: true,
      week: Array.from({ length: 7 }, (_, index) => ({
        date: dateShift(date, index - 6),
        logged: true,
        targets,
        totals:
          index === 6
            ? foodTotals(entries)
            : {
                calories: 1900 + index * 117,
                protein: 112 + index * 9,
                carbs: 181 + index * 7,
                fat: 51 + index * 3,
                fiber: 21,
              },
      })),
    })
  }
  if (route === "nutrition/library")
    return Response.json({ revision: 1, items: [] })
  if (route.startsWith("training-context")) return Response.json(context)
  return Response.json(
    { error: "This fixture does not implement that request" },
    { status: 404 }
  )
}
setApiAuthenticated(true)
rememberTrainingContext(context, "full")
createRoot(document.getElementById("root")!).render(
  <Framework7App name="Nutrition readability" theme="ios">
    <ThemeProvider defaultTheme={theme}>
      <TooltipProvider>
        <AppToastProvider>
          <main className="nutrition-page-main">
            <NutritionPage
              returnLabel="Home"
              onBack={() => fixture.backCount++}
            />
          </main>
        </AppToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  </Framework7App>
)
