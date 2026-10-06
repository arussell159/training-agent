import { useEffect, useMemo, useRef } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

import { mapboxConfig } from "@/lib/mapbox-config"
import type {
  MapRoutePoint,
  MapboxRouteMapProps,
} from "@/components/mapbox-route-map"

const line = (points: MapRoutePoint[]) => ({
  type: "Feature" as const,
  properties: {},
  geometry: {
    type: "LineString" as const,
    coordinates: points.map((point) => [point.longitude, point.latitude]),
  },
})

export function prewarmRouteMap() {
  if (mapboxConfig) {
    try { mapboxgl.prewarm() } catch { /* Map initialization can retry when opened. */ }
  }
}

export function MapboxRouteMapCanvas({
  points,
  center,
  highlightRange,
  className,
  interactive = true,
  topPadding = 0,
  bottomPadding = 0,
}: MapboxRouteMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const highlightedRef = useRef<MapRoutePoint[]>([])
  const valid = useMemo(
    () =>
      points.filter(
        (point) =>
          Number.isFinite(point.time) &&
          Number.isFinite(point.latitude) &&
          Number.isFinite(point.longitude) &&
          Math.abs(point.latitude) <= 85 &&
          Math.abs(point.longitude) <= 180
      ),
    [points]
  )
  const highlighted = useMemo(
    () =>
      highlightRange
        ? valid.filter(
            (point) =>
              point.time >= highlightRange[0] && point.time <= highlightRange[1]
          )
        : [],
    [highlightRange, valid]
  )
  highlightedRef.current = highlighted

  // Adding real playback timestamps must not destroy and reload an identical map.
  const geometryKey = useMemo(() => JSON.stringify(valid.map(point => [point.latitude, point.longitude])), [valid])
  const positions = useMemo<MapRoutePoint[]>(() => (JSON.parse(geometryKey) as [number, number][])
    .map(([latitude, longitude], time) => ({latitude, longitude, time})), [geometryKey])

  useEffect(() => {
    const hasRoute = positions.length > 1
    const mapCenter = hasRoute
      ? ([positions[0].longitude, positions[0].latitude] as [number, number])
      : center
    if (!container.current || !mapboxConfig || !mapCenter) return
    const bounds = new mapboxgl.LngLatBounds()
    if (hasRoute)
      for (const point of positions)
        bounds.extend([point.longitude, point.latitude])
    mapboxgl.accessToken = mapboxConfig.accessToken
    const map = new mapboxgl.Map({
      container: container.current,
      style: mapboxConfig.style,
      center: mapCenter,
      ...(hasRoute
        ? {
            bounds,
            fitBoundsOptions: {
              padding: {
                top: 36 + topPadding,
                right: 36,
                bottom: 36 + bottomPadding,
                left: 36,
              },
              maxZoom: 16,
            },
          }
        : {}),
      zoom: hasRoute ? 12 : 10,
      interactive,
      attributionControl: true,
      logoPosition: "bottom-left",
    })
    mapRef.current = map
    if (interactive)
      map.addControl(
        new mapboxgl.NavigationControl({ showCompass: false }),
        "top-left"
      )
    const startMarker = hasRoute
      ? new mapboxgl.Marker({
          element: (() => {
            const element = document.createElement("div")
            element.className =
              "size-4 rounded-full border-[3px] border-white bg-lime-600 shadow-sm"
            return element
          })(),
        }).setLngLat([positions[0].longitude, positions[0].latitude])
      : new mapboxgl.Marker({ color: "#4f46e5" }).setLngLat(mapCenter)
    const finishMarker = hasRoute
      ? new mapboxgl.Marker({
          element: (() => {
            const element = document.createElement("div")
            element.className =
              "size-[18px] rounded-full border-[3px] border-white shadow-sm"
            element.style.background =
              "conic-gradient(#111827 0 25%, white 0 50%, #111827 0 75%, white 0)"
            element.style.backgroundSize = "6px 6px"
            return element
          })(),
        }).setLngLat([positions.at(-1)!.longitude, positions.at(-1)!.latitude])
      : null
    map.on("load", () => {
      if (hasRoute) {
        map.addSource("recorded-route", {
          type: "geojson",
          data: line(positions),
        })
        map.addLayer({
          id: "recorded-route-casing",
          type: "line",
          source: "recorded-route",
          paint: {
            "line-color": "#ffffff",
            "line-width": 8,
            "line-opacity": 0.95,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        })
        map.addLayer({
          id: "recorded-route-line",
          type: "line",
          source: "recorded-route",
          paint: { "line-color": "#1677b8", "line-width": 4.5 },
          layout: { "line-cap": "round", "line-join": "round" },
        })
        map.addSource("highlighted-route", {
          type: "geojson",
          data: line(highlightedRef.current),
        })
        map.addLayer({
          id: "highlighted-route-casing",
          type: "line",
          source: "highlighted-route",
          paint: { "line-color": "#ffffff", "line-width": 9 },
          layout: { "line-cap": "round", "line-join": "round" },
        })
        map.addLayer({
          id: "highlighted-route-line",
          type: "line",
          source: "highlighted-route",
          paint: { "line-color": "#f4511e", "line-width": 5.5 },
          layout: { "line-cap": "round", "line-join": "round" },
        })
      }
      startMarker.addTo(map)
      finishMarker?.addTo(map)
    })
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      startMarker.remove()
      finishMarker?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [bottomPadding, center, interactive, topPadding, positions])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource("highlighted-route") as
      mapboxgl.GeoJSONSource | undefined
    if (source) source.setData(line(highlighted))
  }, [highlighted])

  return (
    <div ref={container} className={className} aria-label="Activity route" />
  )
}
