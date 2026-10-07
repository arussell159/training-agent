import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import Framework7 from "framework7/lite"
import Dialog from "framework7/components/dialog"
import Sortable from "framework7/components/sortable"
import Framework7React, { App as Framework7App } from "framework7-react"

import "./index.css"
import "./styles/framework7-navbar.less"
import "./styles/mobile-glass-actions.css"
import "./styles/mobile-bottom-nav.css"
import "./styles/mobile-dashboard.css"
import App from "./App.tsx"
import { AppAuth } from "@/components/app-auth"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppToastProvider } from "@/components/ui/toast"

// Sortable installs its touch handlers during app init. Other feature modules
// register with their lazy route before its controls render.
// Framework7's plugin registration method is not a React Hook.
// eslint-disable-next-line react-hooks/rules-of-hooks
Framework7.use([Framework7React, Dialog, Sortable])

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
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Private browsing and offline startup can disable service workers.
    })
  })
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Framework7App
      name="Training Agent"
      theme="ios"
      sortable={{ moveElements: false }}
      clicks={{ externalLinks: "a" }}
      touch={{ activeState: false, touchRipple: false, touchHighlight: false }}
    >
      <AppAuth>
        <ThemeProvider>
          <TooltipProvider>
            <AppToastProvider>
              <App />
            </AppToastProvider>
          </TooltipProvider>
        </ThemeProvider>
      </AppAuth>
    </Framework7App>
  </StrictMode>
)
