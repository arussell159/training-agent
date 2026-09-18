import { useRef, useState, type ReactNode, type PointerEvent } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

export function WorkoutDetailSurface({
  children,
  className,
  completed,
  onClose,
}: {
  children: ReactNode
  className: string
  completed: boolean
  onClose: () => void
}) {
  const mobile = useIsMobile()
  const start = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const sheet = mobile && completed
  const endDrag = (
    event: PointerEvent<HTMLButtonElement>,
    cancelled = false
  ) => {
    const origin = start.current
    start.current = null
    setDragging(false)
    setDrag(0)
    if (!origin || cancelled) return
    const distance = event.clientY - origin.y
    suppressClick.current =
      Math.abs(distance) > 8 || Math.abs(event.clientX - origin.x) > 8
    if (distance >= 110 && Math.abs(event.clientX - origin.x) < 80) onClose()
  }
  return (
    <article
      className={cn(className, sheet && "workout-mobile-sheet")}
      style={
        sheet
          ? {
              transform: drag ? `translateY(${drag}px)` : undefined,
              transition: dragging ? "none" : "transform 180ms ease-out",
            }
          : undefined
      }
    >
      {sheet && (
        <button
          type="button"
          className="workout-swipe-handler"
          aria-label="Close workout details"
          title="Drag down to close"
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return
            start.current = { x: event.clientX, y: event.clientY }
            suppressClick.current = false
            setDragging(true)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (start.current)
              setDrag(
                Math.max(0, Math.min(260, event.clientY - start.current.y))
              )
          }}
          onPointerUp={(event) => endDrag(event)}
          onPointerCancel={(event) => endDrag(event, true)}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false
              return
            }
            onClose()
          }}
        >
          <span aria-hidden="true" />
        </button>
      )}
      {children}
    </article>
  )
}
