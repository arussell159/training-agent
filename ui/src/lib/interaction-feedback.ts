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

/** Contact feedback only: never prevents, delays, or synthesizes an action. */
export function installInteractionFeedback(
  document: Document,
  browser: Window
) {
  let pressed: HTMLElement | SVGElement | null = null
  let pendingFrame: number | null = null
  let contact:
    | { kind: "pointer"; id: number; x: number; y: number }
    | { kind: "key"; key: string }
    | null = null
  const clear = () => {
    if (pendingFrame !== null) browser.cancelAnimationFrame(pendingFrame)
    pendingFrame = null
    if (pressed?.getAttribute("data-app-pressed") === "pointer")
      pressed.style.removeProperty("--app-press-origin")
    pressed?.removeAttribute("data-app-pressed")
    pressed = null
    contact = null
  }
  const show = (surface: HTMLElement | SVGElement, pointer?: PointerEvent) => {
    pressed = surface
    if (pointer?.pointerType) {
      // Keep the down point inside the scaled control, including at its edges.
      const { left, top, width, height } = surface.getBoundingClientRect()
      const x = pressOrigin(pointer.clientX - left, width)
      const y = pressOrigin(pointer.clientY - top, height)
      surface.style.setProperty("--app-press-origin", `${x} ${y}`)
      surface.setAttribute("data-app-pressed", "pointer")
    } else {
      surface.setAttribute("data-app-pressed", "")
    }
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
    const surface = parent?.hasAttribute("data-press-feedback-surface")
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
      clear()
  }
  const release = (event: PointerEvent) => {
    if (contact?.kind === "pointer" && contact.id === event.pointerId) clear()
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
    if (document.visibilityState === "hidden") clear()
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
  browser.addEventListener("blur", clear)
  return () => {
    clear()
    document.removeEventListener("pointerdown", down, true)
    document.removeEventListener("pointermove", move, true)
    document.removeEventListener("pointerup", release, true)
    document.removeEventListener("pointercancel", release, true)
    document.removeEventListener("keydown", key, true)
    document.removeEventListener("keyup", keyRelease, true)
    document.removeEventListener("visibilitychange", visibility)
    browser.removeEventListener("blur", clear)
  }
}
