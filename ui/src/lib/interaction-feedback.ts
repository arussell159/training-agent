/** Contact feedback only: never prevents, delays, or synthesizes an action. */
export function installInteractionFeedback(
  document: Document,
  browser: Window
) {
  let pressed: HTMLElement | null = null
  let contact:
    | { kind: "pointer"; id: number; x: number; y: number }
    | { kind: "key"; key: string }
    | null = null
  const clear = () => {
    pressed?.removeAttribute("data-app-pressed")
    pressed = null
    contact = null
  }
  const press = (target: EventTarget | null) => {
    if (
      !browser.matchMedia("(max-width: 767px), (pointer: coarse)").matches ||
      !(target instanceof Element)
    )
      return false
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
      return false
    pressed = control
    control.setAttribute("data-app-pressed", "")
    return true
  }
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return
    clear()
    if (press(event.target))
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
