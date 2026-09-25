import { useEffect } from "react"

// The title/handle can always dismiss; the reader can dismiss only at its top.
// Ordinary reading and horizontal gestures remain native browser scrolling.
export function useSheetDismiss(
  id: string,
  open: boolean,
  onClose: () => void,
  options: { expanded?: boolean; onExpand?: () => void } = {}
) {
  const { expanded = false, onExpand } = options
  useEffect(() => {
    if (!open) return
    const root = document.getElementById(id)
    if (!root) return
    let gesture: {
      x: number
      y: number
      time: number
      dy: number
      dragging: boolean
      mode: "down" | "up" | null
      canExpand: boolean
      startHeight: number
    } | null = null
    let scrollTouch: {
      identifier: number
      x: number
      y: number
      time: number
      sheet: HTMLElement
      scroll: HTMLElement
      dy: number
      dragging: boolean
    } | null = null
    let sheet: HTMLElement | null = null
    const reset = () => {
      sheet?.style.removeProperty("transform")
      sheet?.style.removeProperty("height")
      sheet?.style.removeProperty("max-height")
      sheet?.style.removeProperty("transition-duration")
      gesture = null
    }
    const start = (event: PointerEvent) => {
      reset()
      if (
        !event.isPrimary ||
        (event.pointerType === "mouse" && event.button !== 0) ||
        !(event.target instanceof Element)
      )
        return
      // Touch scrolling in the report body is handled separately so a
      // downward swipe at its top can dismiss instead of being eaten by pan-y.
      if (event.pointerType === "touch" && event.target.closest("[data-sheet-scroll]"))
        return
      sheet = event.target.closest<HTMLElement>(".sheet-modal")
      if (
        !sheet ||
        (event.target.closest("[data-sheet-scroll]")?.scrollTop || 0) > 1
      )
        return
      gesture = {
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
        dy: 0,
        dragging: false,
        mode: null,
        canExpand: Boolean(
          onExpand &&
            !expanded &&
            event.target.closest(
              ".detail-sheet-handle, .terms-metric-sheet-heading"
            )
        ),
        startHeight: sheet.getBoundingClientRect().height,
      }
      try {
        event.target.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture is best-effort; the sheet root still receives bubbling events.
      }
    }
    const move = (event: PointerEvent) => {
      if (!gesture || !sheet) return
      const dx = event.clientX - gesture.x
      const dy = event.clientY - gesture.y
      if (!gesture.dragging) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return
        if (Math.abs(dx) > Math.abs(dy)) return reset()
        if (dy < 0 && gesture.canExpand) gesture.mode = "up"
        else if (dy > 0) gesture.mode = "down"
        else return reset()
        gesture.dragging = true
      }
      if (!event.cancelable) return reset()
      event.preventDefault()
      gesture.dy = dy
      sheet.style.transitionDuration = "0ms"
      if (gesture.mode === "up") {
        const maximum =
          window.innerHeight -
          Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top") || "0") -
          8
        const height = Math.min(maximum, gesture.startHeight + Math.max(0, -dy))
        sheet.style.height = `${height}px`
        sheet.style.maxHeight = `${height}px`
      } else sheet.style.transform = `translate3d(0, ${Math.max(0, dy)}px, 0)`
    }
    const end = () => {
      const expand =
        gesture?.dragging &&
        gesture.mode === "up" &&
        (-gesture.dy >= 70 ||
          (-gesture.dy >= 24 &&
            -gesture.dy / Math.max(1, performance.now() - gesture.time) > 0.45))
      const dismiss =
        gesture?.dragging &&
        gesture.mode === "down" &&
        (gesture.dy >= 80 ||
          (gesture.dy >= 25 &&
            gesture.dy / Math.max(1, performance.now() - gesture.time) > 0.5))
      if (expand && sheet) {
        sheet.style.transitionDuration = "180ms"
        sheet.style.height = "calc(var(--app-viewport-height, 100dvh) - env(safe-area-inset-top) - 8px)"
        sheet.style.maxHeight = sheet.style.height
        onExpand?.()
        const current = sheet
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            current.style.removeProperty("height")
            current.style.removeProperty("max-height")
            current.style.removeProperty("transition-duration")
          })
        )
        gesture = null
        return
      }
      reset()
      if (dismiss) onClose()
    }
    const touchStart = (event: TouchEvent) => {
      if (!(event.target instanceof Element)) return
      const scroll = event.target.closest<HTMLElement>("[data-sheet-scroll]")
      const touch = event.changedTouches[0]
      const activeSheet = event.target.closest<HTMLElement>(".sheet-modal")
      if (!scroll || !activeSheet || !touch || scroll.scrollTop > 1) {
        scrollTouch = null
        return
      }
      scrollTouch = {
        identifier: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: performance.now(),
        sheet: activeSheet,
        scroll,
        dy: 0,
        dragging: false,
      }
    }
    const touchMove = (event: TouchEvent) => {
      if (!scrollTouch || scrollTouch.scroll.scrollTop > 1) return
      const touch = Array.from(event.touches).find(
        (item) => item.identifier === scrollTouch?.identifier
      )
      if (!touch) return
      const dx = touch.clientX - scrollTouch.x
      const dy = touch.clientY - scrollTouch.y
      if (!scrollTouch.dragging && Math.max(Math.abs(dx), Math.abs(dy)) < 6) return
      if (!scrollTouch.dragging && (dy <= 0 || Math.abs(dx) > Math.abs(dy))) {
        scrollTouch = null
        return
      }
      if (dy <= 0 || !event.cancelable) return
      event.preventDefault()
      scrollTouch.dragging = true
      scrollTouch.dy = dy
      scrollTouch.sheet.style.transitionDuration = "0ms"
      scrollTouch.sheet.style.transform = `translate3d(0, ${Math.max(0, dy)}px, 0)`
    }
    const finishScrollTouch = (cancelled = false) => {
      if (!scrollTouch) return
      const current = scrollTouch
      scrollTouch = null
      current.sheet.style.transitionDuration = "180ms"
      current.sheet.style.removeProperty("transform")
      requestAnimationFrame(() =>
        current.sheet.style.removeProperty("transition-duration")
      )
      if (cancelled || !current.dragging) return
      const elapsed = Math.max(1, performance.now() - current.time)
      if (
        current.dy >= 80 ||
        (current.dy >= 25 && current.dy / elapsed > 0.5)
      )
        onClose()
    }
    const touchEnd = (event: TouchEvent) => {
      if (
        scrollTouch &&
        Array.from(event.changedTouches).some(
          (item) => item.identifier === scrollTouch?.identifier
        )
      )
        finishScrollTouch()
    }
    const touchCancel = () => finishScrollTouch(true)
    root.addEventListener("pointerdown", start, { passive: true })
    root.addEventListener("pointermove", move, { passive: false })
    root.addEventListener("pointerup", end)
    root.addEventListener("pointercancel", reset)
    root.addEventListener("touchstart", touchStart, { passive: true })
    root.addEventListener("touchmove", touchMove, { passive: false })
    root.addEventListener("touchend", touchEnd, { passive: true })
    root.addEventListener("touchcancel", touchCancel, { passive: true })
    return () => {
      root.removeEventListener("pointerdown", start)
      root.removeEventListener("pointermove", move)
      root.removeEventListener("pointerup", end)
      root.removeEventListener("pointercancel", reset)
      root.removeEventListener("touchstart", touchStart)
      root.removeEventListener("touchmove", touchMove)
      root.removeEventListener("touchend", touchEnd)
      root.removeEventListener("touchcancel", touchCancel)
      if (scrollTouch) finishScrollTouch(true)
      reset()
    }
  }, [id, open, onClose, expanded, onExpand])
}
