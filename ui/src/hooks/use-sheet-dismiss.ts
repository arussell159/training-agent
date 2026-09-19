import { useEffect } from "react"

// Only claim a downward gesture that begins with the reader at its top.
// Ordinary reading and horizontal gestures remain native browser scrolling.
export function useSheetDismiss(
  id: string,
  open: boolean,
  onClose: () => void
) {
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
    } | null = null
    let sheet: HTMLElement | null = null
    const reset = () => {
      sheet?.style.removeProperty("transform")
      sheet?.style.removeProperty("transition-duration")
      gesture = null
    }
    const start = (event: TouchEvent) => {
      reset()
      if (event.touches.length !== 1 || !(event.target instanceof Element))
        return
      sheet = event.target.closest<HTMLElement>(".sheet-modal")
      if (
        !sheet ||
        (sheet.querySelector(".report-reader-scroll")?.scrollTop || 0) > 1
      )
        return
      gesture = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        time: performance.now(),
        dy: 0,
        dragging: false,
      }
    }
    const move = (event: TouchEvent) => {
      if (!gesture || !sheet) return
      if (event.touches.length !== 1) return reset()
      const dx = event.touches[0].clientX - gesture.x
      const dy = event.touches[0].clientY - gesture.y
      if (!gesture.dragging) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return
        if (dy <= 0 || Math.abs(dx) > dy) return reset()
        gesture.dragging = true
      }
      if (!event.cancelable) return reset()
      event.preventDefault()
      gesture.dy = Math.max(0, dy)
      sheet.style.transitionDuration = "0ms"
      sheet.style.transform = `translate3d(0, ${gesture.dy}px, 0)`
    }
    const end = () => {
      const dismiss =
        gesture?.dragging &&
        (gesture.dy >= 80 ||
          (gesture.dy >= 25 &&
            gesture.dy / Math.max(1, performance.now() - gesture.time) > 0.5))
      reset()
      if (dismiss) onClose()
    }
    root.addEventListener("touchstart", start, { passive: true })
    root.addEventListener("touchmove", move, { passive: false })
    root.addEventListener("touchend", end)
    root.addEventListener("touchcancel", reset)
    return () => {
      root.removeEventListener("touchstart", start)
      root.removeEventListener("touchmove", move)
      root.removeEventListener("touchend", end)
      root.removeEventListener("touchcancel", reset)
      reset()
    }
  }, [id, open, onClose])
}
