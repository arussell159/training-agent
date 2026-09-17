import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { AppAuth } from "@/components/app-auth"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

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
    <AppAuth>
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </AppAuth>
  </StrictMode>
)
