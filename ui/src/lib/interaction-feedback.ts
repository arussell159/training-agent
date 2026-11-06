const pressTargets = [
  'button, a[href], summary, select, input:not([type="hidden"]), textarea, label, [contenteditable]:not([contenteditable="false"])',
  '[role="button"], [role="link"], [role="tab"], [role="switch"]',
  '[role="checkbox"], [role="radio"], [role="option"], [role="combobox"]',
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
  '[role="slider"], [role="spinbutton"], [role="treeitem"], [role="scrollbar"]',
  // Framework7 renders these controls as plain elements.
  ".calendar-jump-inline .calendar-day:not(.calendar-day-disabled)",
  ".dialog .dialog-button, .actions-modal .actions-button",
  "[data-press-action]",
].join(", ")

const measureOnPointerDown =
  '[data-press-action="gesture"], [data-press-action="self"], input[type="range"], [role="slider"]'
const editingFields = `textarea, [contenteditable], input:not(
  [type="button"], [type="submit"], [type="reset"], [type="image"],
  [type="checkbox"], [type="radio"], [type="file"], [type="color"],
  [type="date"], [type="datetime-local"], [type="month"], [type="time"], [type="week"]
)`

function pressOrigin(offset: number, size: number) {
  return `${Math.max(0, Math.min(100, (offset / (size || 1)) * 100))}%`
}

type PressSurface = HTMLElement | SVGElement

/** Contact feedback only: never prevents, delays, or synthesizes an action. */
export function installInteractionFeedback(
  document: Document,
  browser: Window
) {
  const motions = new Map<PressSurface, Animation[]>()
  let pressed: PressSurface | null = null
  let pendingFrame: number | null = null
  let contact:
    | { kind: "pointer"; id: number; x: number; y: number }
    | { kind: "key"; key: string }
    | null = null
  const stopMotion = (surface: PressSurface) => {
    for (const animation of motions.get(surface) ?? []) {
      animation.onfinish = null
      animation.cancel()
    }
    motions.delete(surface)
    if (surface.getAttribute("data-app-press-origin") !== null) {
      surface.style.removeProperty("--app-press-origin")
      surface.removeAttribute("data-app-press-origin")
    }
  }
  const clear = (immediate = false) => {
    if (pendingFrame !== null) browser.cancelAnimationFrame(pendingFrame)
    pendingFrame = null
    const surface = pressed
    pressed = null
    contact = null
    if (!surface) return
    surface.removeAttribute("data-app-pressed")
    const animations = motions.get(surface)
    const first = animations?.[0]
    if (
      !immediate &&
      surface.isConnected &&
      animations &&
      first &&
      typeof first.currentTime === "number" &&
      first.currentTime > 0
    ) {
      first.onfinish = () => {
        if (
          first.currentTime === 0 &&
          motions.get(surface) === animations &&
          pressed !== surface
        )
          stopMotion(surface)
      }
      // Reverse from the current scale so even a short tap releases smoothly.
      for (const animation of animations) animation.reverse()
    } else {
      stopMotion(surface)
    }
  }
  const reset = () => {
    clear(true)
    for (const surface of motions.keys()) stopMotion(surface)
  }
  const show = (surface: PressSurface, pointer?: PointerEvent) => {
    pressed = surface
    const contentOnly =
      surface.getAttribute("data-press-feedback-content") !== null
    const previous = motions.get(surface)
    const instant =
      typeof surface.animate !== "function" ||
      browser.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!instant && previous) {
      surface.setAttribute("data-app-pressed", "")
      for (const animation of previous) {
        animation.onfinish = null
        animation.updatePlaybackRate(1)
        animation.play()
      }
      return
    }
    if (previous) stopMotion(surface)
    if (pointer?.pointerType && !contentOnly) {
      // Keep the down point inside the scaled control, including at its edges.
      const { left, top, width, height } = surface.getBoundingClientRect()
      const x = pressOrigin(pointer.clientX - left, width)
      const y = pressOrigin(pointer.clientY - top, height)
      surface.style.setProperty("--app-press-origin", `${x} ${y}`)
      surface.setAttribute("data-app-press-origin", "")
    }
    surface.setAttribute("data-app-pressed", instant ? "instant" : "")
    if (instant) return
    const targets = contentOnly ? Array.from(surface.children) : [surface]
    motions.set(
      surface,
      targets.map((target) => {
        const scale = browser.getComputedStyle(target).scale
        return target.animate(
          { scale: [scale === "none" ? "1" : scale, "0.97"] },
          { duration: 120, easing: "ease-in-out", fill: "both" }
        )
      })
    )
  }
  const press = (target: EventTarget | null, pointer?: PointerEvent) => {
    if (!(target instanceof Element)) return false
    const candidate = target.closest<HTMLElement | SVGElement>(pressTargets)
    const control =
      candidate?.tagName === "LABEL"
        ? (candidate as HTMLLabelElement).control
        : candidate
    if (
      !control ||
      control.matches(':disabled, [aria-disabled="true"]') ||
      (control.matches('[data-press-action="self"]') && target !== control) ||
      (!pointer && control.matches(editingFields)) ||
      control.closest("[inert]")
    )
      return false
    const parent = control.parentElement
    const surface =
      parent &&
      (parent.hasAttribute("data-press-feedback-surface") ||
        control.getAttribute("data-press-feedback-surface") === "parent")
        ? parent
        : control
    if (pointer && control.matches(measureOnPointerDown)) {
      // Let charts, sliders, and calendar gestures measure their resting box.
      pendingFrame = browser.requestAnimationFrame(() => {
        pendingFrame = null
        if (surface.isConnected) show(surface, pointer)
      })
    } else {
      show(surface, pointer)
    }
    return true
  }
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return
    clear()
    if (press(event.target, event))
      contact = {
        kind: "pointer",
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      }
  }
  const move = (event: PointerEvent) => {
    if (
      contact?.kind === "pointer" &&
      contact.id === event.pointerId &&
      Math.hypot(event.clientX - contact.x, event.clientY - contact.y) > 10
    )
      clear(true)
  }
  const release = (event: PointerEvent) => {
    if (contact?.kind === "pointer" && contact.id === event.pointerId)
      clear(event.type === "pointercancel")
  }
  const key = (event: KeyboardEvent) => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return
    clear()
    if (press(event.target)) contact = { kind: "key", key: event.key }
  }
  const keyRelease = (event: KeyboardEvent) => {
    if (contact?.kind === "key" && contact.key === event.key) clear()
  }
  const visibility = () => {
    if (document.visibilityState === "hidden") reset()
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
  document.addEventListener("pointercancel", release, true)
  document.addEventListener("keydown", key, true)
  document.addEventListener("keyup", keyRelease, true)
  document.addEventListener("visibilitychange", visibility)
  browser.addEventListener("blur", reset)
  return () => {
    reset()
    document.removeEventListener("pointerdown", down, true)
    document.removeEventListener("pointermove", move, true)
    document.removeEventListener("pointerup", release, true)
    document.removeEventListener("pointercancel", release, true)
    document.removeEventListener("keydown", key, true)
    document.removeEventListener("keyup", keyRelease, true)
    document.removeEventListener("visibilitychange", visibility)
    browser.removeEventListener("blur", reset)
  }
}
