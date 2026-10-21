const entryKey = (state: unknown): string | null => {
  if (!state || typeof state !== "object") return null
  const marker = (state as Record<string, unknown>).__workoutNavigation
  if (!marker || typeof marker !== "object") return null
  const value = marker as { session?: string; index?: number }
  return typeof value.session === "string" && Number.isSafeInteger(value.index)
    ? JSON.stringify([value.session, value.index])
    : null
}

/** Keep scroll per history entry, without modifying navigation guard state or
 * writing history/storage on each scroll. Install after the history barrier. */
export function installRouteScrollRestoration(browser: Window) {
  const positions = new Map<string, number>()
  let active = entryKey(browser.history.state)
  let frame = 0
  const previous = browser.history.scrollRestoration
  browser.history.scrollRestoration = "manual"
  const capture = () => {
    if (active) positions.set(active, Math.max(0, browser.scrollY))
  }
  capture()
  const flush = () => {
    browser.cancelAnimationFrame(frame)
    frame = 0
    capture()
  }
  const scroll = () => {
    if (frame) return
    frame = browser.requestAnimationFrame(() => {
      frame = 0
      capture()
    })
  }
  const pushed = () => {
    active = entryKey(browser.history.state)
    // Indexes can be reused after Back followed by a new branch of history.
    if (active) positions.set(active, 0)
  }
  browser.addEventListener("scroll", scroll, { passive: true })
  browser.addEventListener("workout-navigation-before-push", flush)
  browser.addEventListener("workout-navigation-pushed", pushed)
  return {
    restore() {
      // With native restoration disabled, this is still the departing screen's
      // scroll even though history.state already points at the accepted target.
      flush()
      active = entryKey(browser.history.state)
      return active ? (positions.get(active) ?? null) : null
    },
    dispose() {
      browser.cancelAnimationFrame(frame)
      browser.removeEventListener("scroll", scroll)
      browser.removeEventListener("workout-navigation-before-push", flush)
      browser.removeEventListener("workout-navigation-pushed", pushed)
      browser.history.scrollRestoration = previous
    },
  }
}
