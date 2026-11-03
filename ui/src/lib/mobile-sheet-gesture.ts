type Gesture = {
  id: number
  source: "pointer" | "touch"
  sheet: HTMLElement
  scroll: HTMLElement | null
  x: number
  y: number
  time: number
  height: number
  maximum: number
  dy: number
  mode: "down" | "up" | null
  expand: boolean
}

/** Mobile sheets follow the finger; interrupted gestures never perform an action.
 * Editable controls, charts, native Back and ordinary reading keep their gestures. */
export function bindMobileSheetGesture(
  root: HTMLElement,
  close: () => void,
  {
    expanded = false,
    onExpand,
  }: { expanded?: boolean; onExpand?: () => void } = {}
) {
  const document = root.ownerDocument,
    window = document.defaultView!
  let gesture: Gesture | null = null
  const reset = () => {
    const sheet = gesture?.sheet
    gesture = null
    for (const property of [
      "transform",
      "height",
      "max-height",
      "transition-duration",
    ])
      sheet?.style.removeProperty(property)
  }
  const begin = (
    target: EventTarget | null,
    source: Gesture["source"],
    id: number,
    x: number,
    y: number
  ) => {
    reset()
    const element = target as Element | null
    if (
      !element?.closest ||
      x <= 24 ||
      document.documentElement.dataset.mobileKeyboardOpen === "true"
    )
      return
    if (
      element.closest(
        'button, input, select, textarea, a, label, [contenteditable="true"], [role="button"], [role="slider"], [role="spinbutton"], svg, canvas, [data-sheet-gesture-ignore]'
      )
    )
      return
    const sheet = element.closest<HTMLElement>(".sheet-modal")
    const scroll = element.closest<HTMLElement>("[data-sheet-scroll]")
    if (!sheet || (scroll && scroll.scrollTop > 1)) return
    gesture = {
      id,
      source,
      sheet,
      scroll,
      x,
      y,
      time: window.performance.now(),
      height: sheet.getBoundingClientRect().height,
      dy: 0,
      mode: null,
      maximum: Math.min(
        (window.visualViewport?.height || window.innerHeight) - 8,
        Number.parseFloat(window.getComputedStyle(sheet).maxHeight) || Infinity
      ),
      expand: Boolean(
        onExpand &&
        !expanded &&
        element.closest(".detail-sheet-handle, .terms-metric-sheet-heading")
      ),
    }
  }
  const move = (event: Event, x: number, y: number) => {
    const current = gesture
    if (!current) return
    if ((current.scroll && current.scroll.scrollTop > 1) || !event.cancelable)
      return reset()
    const dx = x - current.x,
      dy = y - current.y
    if (!current.mode) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return
      if (Math.abs(dx) >= Math.abs(dy)) return reset()
      if (dy > 0) current.mode = "down"
      else if (current.expand) current.mode = "up"
      else return reset()
    }
    event.preventDefault()
    current.dy = dy
    current.sheet.style.transitionDuration = "0ms"
    if (current.mode === "up") {
      const height = Math.min(
        current.maximum,
        current.height + Math.max(0, -dy)
      )
      current.sheet.style.height = `${height}px`
      current.sheet.style.maxHeight = `${height}px`
    } else
      current.sheet.style.transform = `translate3d(0, ${Math.max(0, dy)}px, 0)`
  }
  const finish = () => {
    const current = gesture
    reset()
    if (!current?.mode) return
    const elapsed = Math.max(1, window.performance.now() - current.time)
    if (
      current.mode === "down" &&
      (current.dy >= 80 || (current.dy >= 25 && current.dy / elapsed > 0.5))
    )
      close()
    if (
      current.mode === "up" &&
      (-current.dy >= 70 || (-current.dy >= 24 && -current.dy / elapsed > 0.45))
    )
      onExpand?.()
  }
  const pointerStart = (event: PointerEvent) => {
    if (
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return reset()
    const target = event.target as Element | null
    // The touch handler owns scrollable readers, where pointer events get cancelled by native pan-y.
    if (
      event.pointerType === "touch" &&
      target?.closest?.("[data-sheet-scroll]")
    )
      return
    begin(target, "pointer", event.pointerId, event.clientX, event.clientY)
    if (gesture) {
      try {
        target?.setPointerCapture(event.pointerId)
      } catch {
        /* Capture is optional. */
      }
    }
  }
  const pointerMove = (event: PointerEvent) => {
    if (gesture?.source === "pointer" && gesture.id === event.pointerId)
      move(event, event.clientX, event.clientY)
  }
  const pointerEnd = (event: PointerEvent) => {
    if (gesture?.source === "pointer" && gesture.id === event.pointerId)
      finish()
  }
  const pointerCancel = (event: PointerEvent) => {
    if (gesture?.source === "pointer" && gesture.id === event.pointerId) reset()
  }
  const touchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return reset()
    const target = event.target as Element | null
    if (!target?.closest?.("[data-sheet-scroll]")) return
    const touch = event.touches[0]
    begin(target, "touch", touch.identifier, touch.clientX, touch.clientY)
  }
  const touchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) return reset()
    if (gesture?.source !== "touch") return
    const touch = Array.from(event.touches).find(
      (item) => item.identifier === gesture?.id
    )
    if (!touch) return reset()
    move(event, touch.clientX, touch.clientY)
  }
  const touchEnd = (event: TouchEvent) => {
    if (
      gesture?.source === "touch" &&
      Array.from(event.changedTouches).some(
        (item) => item.identifier === gesture?.id
      )
    )
      finish()
  }
  const touchCancel = () => reset()
  const visibility = () => {
    if (document.visibilityState === "hidden") reset()
  }
  root.addEventListener("pointerdown", pointerStart, { passive: true })
  root.addEventListener("pointermove", pointerMove, { passive: false })
  root.addEventListener("pointerup", pointerEnd)
  root.addEventListener("pointercancel", pointerCancel)
  root.addEventListener("lostpointercapture", pointerCancel)
  root.addEventListener("touchstart", touchStart, { passive: true })
  root.addEventListener("touchmove", touchMove, { passive: false })
  root.addEventListener("touchend", touchEnd)
  root.addEventListener("touchcancel", touchCancel)
  document.addEventListener("visibilitychange", visibility)
  window.addEventListener("blur", reset)
  window.addEventListener("pagehide", reset)
  return () => {
    reset()
    root.removeEventListener("pointerdown", pointerStart)
    root.removeEventListener("pointermove", pointerMove)
    root.removeEventListener("pointerup", pointerEnd)
    root.removeEventListener("pointercancel", pointerCancel)
    root.removeEventListener("lostpointercapture", pointerCancel)
    root.removeEventListener("touchstart", touchStart)
    root.removeEventListener("touchmove", touchMove)
    root.removeEventListener("touchend", touchEnd)
    root.removeEventListener("touchcancel", touchCancel)
    document.removeEventListener("visibilitychange", visibility)
    window.removeEventListener("blur", reset)
    window.removeEventListener("pagehide", reset)
  }
}
