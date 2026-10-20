import { Skeleton } from "@/components/ui/skeleton"
import { Suspense, useMemo } from "react"
import { preloadable } from "@/lib/preloadable"
import { mapboxConfig } from "@/lib/mapbox-config"

export type MapRoutePoint = {
  time: number
  latitude: number
  longitude: number
}

type MapCanvasProps = {
  points: MapRoutePoint[]
  center?: [number, number]
  highlightRange?: [number, number] | null
  cursorPoint?: MapRoutePoint | null
  onCursorTimeChange?: (time: number | null) => void
  className: string
  interactive?: boolean
  topPadding?: number
  bottomPadding?: number
}

const mapCanvasRoute = preloadable(() =>
  import("@/components/mapbox-route-map-canvas").then((module) => ({
    default: module.MapboxRouteMapCanvas,
  })),
  props => <Skeleton className={props.className} aria-label="Loading activity map" />
)
const MapCanvas = mapCanvasRoute.Component
export const preloadRouteMap = mapCanvasRoute.preload

export function MapboxRouteMap(props: MapCanvasProps) {
  const available = useMemo(() => {
    let valid = 0
    for (const point of props.points) {
      if (
        Number.isFinite(point.time) &&
        Number.isFinite(point.latitude) &&
        Number.isFinite(point.longitude) &&
        Math.abs(point.latitude) <= 85 &&
        Math.abs(point.longitude) <= 180 &&
        ++valid === 2
      )
        return true
    }
    return false
  }, [props.points])
  if (!mapboxConfig)
    return available ? (
      <OfflineRouteMap {...props} />
    ) : (
      <div
        className={`${props.className} flex items-center justify-center bg-muted/25 text-xs text-muted-foreground`}
      >
        Mapbox is not configured.
      </div>
    )
  if (!available && !props.center)
    return <div className={props.className} aria-hidden="true" />
  return (
    <Suspense
      fallback={
        <Skeleton
          className={props.className}
          aria-label="Loading activity map"
        />
      }
    >
      <MapCanvas {...props} />
    </Suspense>
  )
}

/* The implementation stays in its own deferred chunk so route-less workout
details do not download Mapbox GL. */
export type { MapCanvasProps as MapboxRouteMapProps }

function OfflineRouteMap({
  points,
  className,
  cursorPoint,
  highlightRange,
  onCursorTimeChange,
}: MapCanvasProps) {
  const geometry = useMemo(() => {
    const valid = points.filter(
      (point) =>
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    )
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (const point of valid) {
      minX = Math.min(minX, point.longitude)
      maxX = Math.max(maxX, point.longitude)
      minY = Math.min(minY, point.latitude)
      maxY = Math.max(maxY, point.latitude)
    }
    const correction = Math.cos((((minY + maxY) / 2) * Math.PI) / 180),
      scale = Math.min(
        760 / Math.max((maxX - minX) * correction, 0.00001),
        130 / Math.max(maxY - minY, 0.00001)
      )
    return valid.map((point) => ({
      ...point,
      x: 400 + (point.longitude - (minX + maxX) / 2) * correction * scale,
      y: 85 - (point.latitude - (minY + maxY) / 2) * scale,
    }))
  }, [points])
  const path = geometry.map((point) => `${point.x},${point.y}`).join(" ")
  const cursor =
    cursorPoint &&
    geometry.reduce(
      (best, point) =>
        Math.abs(point.time - cursorPoint.time) <
        Math.abs(best.time - cursorPoint.time)
          ? point
          : best,
      geometry[0]
    )
  const highlight = highlightRange
    ? geometry.filter(
        (point) =>
          point.time >= highlightRange[0] && point.time <= highlightRange[1]
      )
    : []
  return (
    <div className={className} aria-label="Activity route">
      <svg
        viewBox="0 0 800 170"
        className="h-full w-full"
        role="img"
        aria-label="Recorded route without map tiles"
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect(),
            scale = Math.min(bounds.width / 800, bounds.height / 170),
            left = bounds.left + (bounds.width - 800 * scale) / 2,
            top = bounds.top + (bounds.height - 170 * scale) / 2
          const nearest = geometry.reduce(
            (best, point) =>
              Math.hypot(
                left + point.x * scale - event.clientX,
                top + point.y * scale - event.clientY
              ) <
              Math.hypot(
                left + best.x * scale - event.clientX,
                top + best.y * scale - event.clientY
              )
                ? point
                : best,
            geometry[0]
          )
          onCursorTimeChange?.(nearest?.time ?? null)
        }}
        onPointerLeave={() => onCursorTimeChange?.(null)}
      >
        <rect width="800" height="170" fill="#eef2ed" />
        <polyline points={path} fill="none" stroke="#1677b8" strokeWidth="3" />
        {highlight.length > 1 && (
          <polyline
            points={highlight.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke="#f4511e"
            strokeWidth="4"
          />
        )}
        {geometry[0] && (
          <circle cx={geometry[0].x} cy={geometry[0].y} r="4" fill="#65a30d" />
        )}
        {cursor && (
          <circle
            cx={cursor.x}
            cy={cursor.y}
            r="5"
            fill="#f97316"
            stroke="white"
            strokeWidth="2"
          />
        )}
        <text x="10" y="158" fontSize="10" fill="#53647a">
          Recorded route · offline map preview
        </text>
      </svg>
    </div>
  )
}
