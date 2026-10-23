import { StrictMode, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import "./styles/framework7-navbar.less"
import "./styles/mobile-glass-actions.css"
import "./styles/mobile-bottom-nav.css"
import "./styles/mobile-dashboard.css"
import "./styles/mobile-home-redesign.css"
import "./styles/desktop-readability.css"
import App from "./App.tsx"
import { AppAuth } from "@/components/app-auth"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppToastProvider } from "@/components/ui/toast"
import { performanceProbe } from "@/lib/performance-probe"
import { InteractionFeedback } from "@/components/interaction-feedback"
import { WorkoutSyncFeedback } from "@/components/workout-sync-feedback"
import { NutritionSyncFeedback } from "@/components/nutrition-sync-feedback"
import { cleanAppShellRecoveryUrl } from "@/lib/app-shell-recovery"
import { installAssetPreloadRecovery } from "@/lib/asset-preload-recovery"

installAssetPreloadRecovery()

const recoveredUrl = cleanAppShellRecoveryUrl(window.location.href)
if (recoveredUrl)
  window.history.replaceState(window.history.state, "", recoveredUrl)

// Navigation uses semantic HTML. Feature routes initialize Framework7 on demand.
document.documentElement.classList.add("ios")

// Browser zoom is an accessibility control. Individual charts/drag handles own
// their gestures; the app shell must not cancel pinch or Ctrl+wheel zoom.

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    performanceProbe("shell-cache-active", {
      controlled: !!navigator.serviceWorker.controller,
    })
  })
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        performanceProbe("shell-cache-ready", {
          controlled: !!navigator.serviceWorker.controller,
        })
      })
      .catch(() => {
        // Private browsing and offline startup can disable service workers.
      })
  })
}

function BootReady() {
  useLayoutEffect(() => {
    // Keep the inline shell until the first React commit AND its styles exist.
    ;(
      window as Window & { __trainingFinishBoot?: () => void }
    ).__trainingFinishBoot?.()
  }, [])
  return null
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BootReady />
    <div id="framework7-root" className="framework7-root">
      <AppAuth>
        <ThemeProvider>
          <TooltipProvider>
            <AppToastProvider>
              <InteractionFeedback />
              <WorkoutSyncFeedback />
              <NutritionSyncFeedback />
              <App />
            </AppToastProvider>
          </TooltipProvider>
        </ThemeProvider>
      </AppAuth>
    </div>
  </StrictMode>
)
