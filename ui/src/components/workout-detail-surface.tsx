import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

export function WorkoutDetailSurface({
  children,
  className,
  completed,
  onClose,
  mapReveal = 0,
  onMapRevealChange,
}: {
  children: ReactNode
  className: string
  completed: boolean
  onClose: () => void
  mapReveal?: number
  onMapRevealChange?: (offset: number) => void
}) {
  const mobile = useIsMobile()
  const article = useRef<HTMLElement>(null)
  const start = useRef<{
    x: number
    y: number
    offset: number
    limit: number
    collapsed: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const sheet = mobile && completed
  const revealsMap = sheet && Boolean(onMapRevealChange)
  const [collapsed, setCollapsed] = useState(false)
  const revealLimit = useCallback(() => {
    const surface = article.current
    const title = surface?.querySelector<HTMLElement>(
      "[data-workout-sheet-title]"
    )
    if (!surface || !title) return 0
    const bounds = surface.getBoundingClientRect()
    const titleHeight = title.getBoundingClientRect().bottom - bounds.top + 12
    const viewportBottom = window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height
      : window.innerHeight
    const navigation = document
      .querySelector<HTMLElement>(".mobile-navbar.toolbar")
      ?.getBoundingClientRect()
    const bottom =
      navigation && navigation.height > 0
        ? Math.min(viewportBottom, navigation.top)
        : viewportBottom
    return Math.max(0, bottom - 8 - (bounds.top - mapReveal) - titleHeight)
  }, [mapReveal])
  const updateReveal = (offset: number, limit: number) => {
    const next = Math.max(0, Math.min(limit, offset))
    onMapRevealChange?.(next)
    setCollapsed(limit > 0 && next >= limit - 1)
  }
  useEffect(() => {
    if (!revealsMap) return
    const resize = () => {
      const limit = revealLimit()
      onMapRevealChange?.(collapsed ? limit : Math.min(limit, mapReveal))
    }
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [revealsMap, mapReveal, collapsed, onMapRevealChange, revealLimit])
  const endDrag = (
    event: PointerEvent<HTMLButtonElement>,
    cancelled = false
  ) => {
    const origin = start.current
    start.current = null
    setDragging(false)
    setDrag(0)
    if (!origin) return
    const distance = event.clientY - origin.y
    suppressClick.current =
      Math.abs(distance) > 8 || Math.abs(event.clientX - origin.x) > 8
    if (revealsMap) {
      if (cancelled) {
        onMapRevealChange?.(origin.offset)
        setCollapsed(origin.collapsed)
        return
      }
      if (!suppressClick.current) return
      const next = Math.max(0, Math.min(origin.limit, origin.offset + distance))
      updateReveal(
        next > origin.limit - 24 ? origin.limit : next < 12 ? 0 : next,
        origin.limit
      )
      return
    }
    if (cancelled) return
    if (distance >= 110 && Math.abs(event.clientX - origin.x) < 80) onClose()
  }
  return (
    <article
      ref={article}
      data-map-collapsed={revealsMap && collapsed ? "true" : undefined}
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
          aria-label={
            revealsMap ? "Resize workout summary" : "Close workout details"
          }
          aria-expanded={revealsMap ? !collapsed : undefined}
          title={
            revealsMap
              ? "Drag down to reveal the map; drag up to expand details"
              : "Drag down to close"
          }
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return
            start.current = {
              x: event.clientX,
              y: event.clientY,
              offset: mapReveal,
              limit: revealLimit(),
              collapsed,
            }
            suppressClick.current = false
            setDragging(true)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (start.current && revealsMap) {
              updateReveal(
                start.current.offset + event.clientY - start.current.y,
                start.current.limit
              )
            } else if (start.current)
              setDrag(
                Math.max(0, Math.min(260, event.clientY - start.current.y))
              )
          }}
          onPointerUp={(event) => endDrag(event)}
          onPointerCancel={(event) => endDrag(event, true)}
          onLostPointerCapture={(event) => {
            if (start.current) endDrag(event, true)
          }}
          onKeyDown={(event) => {
            if (
              !revealsMap ||
              !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
            )
              return
            event.preventDefault()
            const limit = revealLimit()
            updateReveal(
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? limit
                  : mapReveal + (event.key === "ArrowDown" ? 64 : -64),
              limit
            )
          }}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false
              return
            }
            if (revealsMap)
              updateReveal(mapReveal > 0 ? 0 : revealLimit(), revealLimit())
            else onClose()
          }}
        >
          <span aria-hidden="true" />
        </button>
      )}
      {children}
    </article>
  )
}
