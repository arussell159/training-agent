import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import Framework7 from "framework7/lite"
import Picker from "framework7/components/picker"
import Searchbar from "framework7/components/searchbar"
import Sheet from "framework7/components/sheet"
import Accordion from "framework7/components/accordion"
import Actions from "framework7/components/actions"
import Calendar from "framework7/components/calendar"
import Dialog from "framework7/components/dialog"
import Sortable from "framework7/components/sortable"
import PullToRefresh from "framework7/components/pull-to-refresh"
import Framework7React, { App as Framework7App } from "framework7-react"

import "./index.css"
import "./styles/framework7-navbar.less"
import App from "./App.tsx"
import { AppAuth } from "@/components/app-auth"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

// Framework7's plugin registration method is not a React Hook.
// eslint-disable-next-line react-hooks/rules-of-hooks
Framework7.use([
  Framework7React,
  Picker,
  Searchbar,
  Sheet,
  Accordion,
  Actions,
  Calendar,
  Dialog,
  Sortable,
  PullToRefresh,
])

// Keep gestures as scrolling/inspection rather than changing the app scale.
document.addEventListener("gesturestart", (event) => event.preventDefault(), {
  passive: false,
})
document.addEventListener("gesturechange", (event) => event.preventDefault(), {
  passive: false,
})
document.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches.length > 1) event.preventDefault()
  },
  { passive: false }
)
document.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey) event.preventDefault()
  },
  { passive: false }
)

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js")
  })
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Framework7App
      name="Training Agent"
      theme="ios"
      clicks={{ externalLinks: "a" }}
      touch={{ activeState: false, touchRipple: false, touchHighlight: false }}
    >
      <AppAuth>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </AppAuth>
    </Framework7App>
  </StrictMode>
)
