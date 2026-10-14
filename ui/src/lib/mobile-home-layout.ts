import { useSyncExternalStore } from "react"

export type MobileHomeLayout = "redesign" | "classic"

const storageKey = "ar-performance:mobile-home-layout"
const changeEvent = "mobile-home-layout-changed"
let memoryLayout: MobileHomeLayout = "redesign"
let storageUnavailable = false

function readLayout(): MobileHomeLayout {
  if (storageUnavailable) return memoryLayout
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === "classic" || saved === "redesign") return saved
  } catch {
    // Keep the switch usable when browser storage is unavailable.
    storageUnavailable = true
  }
  return memoryLayout
}

function subscribe(callback: () => void) {
  window.addEventListener(changeEvent, callback)
  window.addEventListener("storage", callback)
  return () => {
    window.removeEventListener(changeEvent, callback)
    window.removeEventListener("storage", callback)
  }
}

export function setMobileHomeLayout(layout: MobileHomeLayout) {
  memoryLayout = layout
  try {
    localStorage.setItem(storageKey, layout)
  } catch {
    storageUnavailable = true
  }
  window.dispatchEvent(new Event(changeEvent))
  window.requestAnimationFrame(() =>
    window.scrollTo({ top: 0, left: 0, behavior: "instant" })
  )
}

export function useMobileHomeLayout() {
  return useSyncExternalStore(subscribe, readLayout, () => "redesign" as const)
}
