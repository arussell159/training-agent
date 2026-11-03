import { useCallback, useEffect, useRef, useState } from "react"
import type {
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
} from "react"

type Contact = {
  id: number
  x: number
  y: number
  left: number
  top: number
  bottom: number
  width: number
  dragged: boolean
  button: HTMLButtonElement
}

/** Let ordinary taps keep their native click. Only a deliberate horizontal
 * scrub captures contact and commits its destination on release. */
export function useMobileTabGesture(
  activeItem: string,
  count: number,
  onSelect: (index: number) => void
) {
  const pane = useRef<HTMLDivElement>(null)
  const contact = useRef<Contact | null>(null)
  const suppressClick = useRef(false)
  const [preview, setPreview] = useState<{
    page: string
    index: number
  } | null>(null)

  const reset = useCallback(() => {
    const previous = contact.current
    contact.current = null
    if (previous?.button.hasPointerCapture(previous.id))
      previous.button.releasePointerCapture(previous.id)
    pane.current?.style.removeProperty("--mobile-tab-position")
    pane.current?.removeAttribute("data-contact")
    pane.current?.removeAttribute("data-dragging")
    setPreview(null)
  }, [])

  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === "hidden") reset()
    }
    window.addEventListener("blur", reset)
    window.addEventListener("resize", reset)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      window.removeEventListener("blur", reset)
      window.removeEventListener("resize", reset)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [reset])

  useEffect(() => {
    // Back/Forward or another navigation source can change the active page
    // while contact is held. Never commit that stale gesture afterwards.
    reset()
  }, [activeItem, reset])

  const indexAt = (x: number, current: Contact) =>
    Math.max(
      0,
      Math.min(
        count - 1,
        Math.floor((x - current.left) / (current.width / count))
      )
    )

  return {
    pane,
    preview: preview?.page === activeItem ? preview.index : null,
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
        if (!event.isPrimary || event.button !== 0) return
        const button = (event.target as Element).closest<HTMLButtonElement>(
          "button[role=tab]"
        )
        if (!button || !pane.current?.contains(button)) return
        const rect = pane.current.getBoundingClientRect()
        const index = Number(button.dataset.tabIndex)
        suppressClick.current = false
        contact.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: rect.left,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          dragged: false,
          button,
        }
        pane.current.dataset.contact = "true"
        pane.current.style.setProperty(
          "--mobile-tab-position",
          `${index * 100}%`
        )
        setPreview({ page: activeItem, index })
      },
      onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        const current = contact.current
        if (!current || event.pointerId !== current.id || !pane.current) return
        const dx = event.clientX - current.x,
          dy = event.clientY - current.y
        if (!current.dragged) {
          if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
            suppressClick.current = true
            reset()
            return
          }
          if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return
          current.dragged = true
          current.button.setPointerCapture(current.id)
          pane.current.dataset.dragging = "true"
        }
        const tabWidth = current.width / count
        const position = Math.max(
          0,
          Math.min(
            current.width - tabWidth,
            event.clientX - current.left - tabWidth / 2
          )
        )
        pane.current.style.setProperty("--mobile-tab-position", `${position}px`)
        const index = indexAt(event.clientX, current)
        setPreview((previous) =>
          previous?.page === activeItem && previous.index === index
            ? previous
            : { page: activeItem, index }
        )
      },
      onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
        const current = contact.current
        if (!current || event.pointerId !== current.id) return
        const inside =
          event.clientX >= current.left - 12 &&
          event.clientX <= current.left + current.width + 12 &&
          event.clientY >= current.top - 24 &&
          event.clientY <= current.bottom + 24
        const index = indexAt(event.clientX, current)
        reset()
        if (current.dragged) {
          suppressClick.current = true
          if (inside) onSelect(index)
        }
      },
      onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
        if (contact.current?.id !== event.pointerId) return
        suppressClick.current = true
        reset()
      },
      onLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
        if (contact.current?.id === event.pointerId) reset()
      },
      onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
        if (suppressClick.current && event.detail > 0) {
          suppressClick.current = false
          event.preventDefault()
          event.stopPropagation()
        }
      },
      onContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
        event.preventDefault()
      },
    },
  }
}
