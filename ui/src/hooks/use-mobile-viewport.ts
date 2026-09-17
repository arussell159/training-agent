import { useEffect } from "react"

export function useMobileViewport() {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    const mobile = window.matchMedia("(max-width: 767px)")
    let frame = 0
    const update = () => {
      const height = viewport?.height ?? window.innerHeight
      const top = viewport?.offsetTop ?? 0
      const focused = document.activeElement
      const editing =
        focused instanceof HTMLElement &&
        focused.matches(
          'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]), [contenteditable="true"]'
        )
      const keyboard =
        (viewport?.scale ?? 1) <= 1.05 && window.innerHeight - height > 120
      root.style.setProperty("--app-viewport-height", `${height}px`)
      root.style.setProperty("--app-viewport-top", `${top}px`)
      root.dataset.mobileEditing = String(
        mobile.matches && (editing || keyboard)
      )
      // Keep the input's tap target stationary until the keyboard actually opens.
      root.dataset.mobileKeyboardOpen = String(mobile.matches && keyboard)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    viewport?.addEventListener("resize", schedule)
    viewport?.addEventListener("scroll", schedule)
    window.addEventListener("resize", schedule)
    document.addEventListener("focusin", schedule)
    document.addEventListener("focusout", schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener("resize", schedule)
      viewport?.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      document.removeEventListener("focusin", schedule)
      document.removeEventListener("focusout", schedule)
      root.style.removeProperty("--app-viewport-height")
      root.style.removeProperty("--app-viewport-top")
      delete root.dataset.mobileEditing
      delete root.dataset.mobileKeyboardOpen
    }
  }, [])
}
