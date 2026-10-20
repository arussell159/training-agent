import { useEffect } from "react"
import "@/styles/interaction-feedback.css"

/** A pressed state starts on contact, without delaying or synthesizing clicks. */
export function InteractionFeedback() {
  useEffect(() => {
    let pressed: HTMLElement | null = null
    let releaseTimer = 0
    let origin = { x: 0, y: 0 }
    const clear = () => {
      window.clearTimeout(releaseTimer)
      pressed?.removeAttribute("data-app-pressed")
      pressed = null
    }
    const press = (target: EventTarget | null) => {
      clear()
      if (
        !window.matchMedia("(max-width: 767px)").matches ||
        !(target instanceof Element)
      )
        return
      const control = target.closest<HTMLElement>(
        'button, a[href], [role="button"], summary'
      )
      if (
        !control ||
        control.matches(
          ':disabled, [aria-disabled="true"], [data-press-feedback="off"]'
        ) ||
        control.closest("[inert]")
      )
        return
      pressed = control
      control.setAttribute("data-app-pressed", "")
    }
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return
      origin = { x: event.clientX, y: event.clientY }
      press(event.target)
    }
    const move = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10)
        clear()
    }
    const release = () => {
      releaseTimer = window.setTimeout(clear, 100)
    }
    const key = (event: KeyboardEvent) => {
      if (!event.repeat && (event.key === "Enter" || event.key === " "))
        press(event.target)
    }
    document.addEventListener("pointerdown", down, {
      capture: true,
      passive: true,
    })
    document.addEventListener("pointermove", move, {
      capture: true,
      passive: true,
    })
    document.addEventListener("pointerup", release, true)
    document.addEventListener("pointercancel", clear, true)
    document.addEventListener("keydown", key, true)
    document.addEventListener("keyup", release, true)
    window.addEventListener("blur", clear)
    return () => {
      clear()
      document.removeEventListener("pointerdown", down, true)
      document.removeEventListener("pointermove", move, true)
      document.removeEventListener("pointerup", release, true)
      document.removeEventListener("pointercancel", clear, true)
      document.removeEventListener("keydown", key, true)
      document.removeEventListener("keyup", release, true)
      window.removeEventListener("blur", clear)
    }
  }, [])
  return null
}
