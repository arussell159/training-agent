import { useEffect, useRef } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { mapboxConfig } from "@/lib/mapbox-config"
import { replayMapQuality } from "@/lib/route-replay-map-quality"
import {
  longitudeDelta,
  prepareReplayCamera,
  replayCameraBearing,
  replayFrame,
  replayGeometry,
  replayTrimProgress,
  replayTourSeconds,
  type ReplayRoute,
} from "@/lib/route-replay"

type Props = {
  route: ReplayRoute
  progress: number
  speed: number
  threeD: boolean
  following: boolean
  onFollowingChange: (value: boolean) => void
  onReady: (value: boolean) => void
  onIntroComplete: (value: boolean) => void
  onHorizonChange: (height: number) => void
  onError: (value: boolean) => void
}
const feature = (coordinates: number[][]) => ({
  type: "Feature" as const,
  properties: {},
  geometry: { type: "LineString" as const, coordinates },
})

export function RouteReplayMap({
  route,
  progress,
  speed,
  threeD,
  following,
  onFollowingChange,
  onReady,
  onIntroComplete,
  onHorizonChange,
  onError,
}: Props) {
  const hasRoute = route.points.length >= 2
  const container = useRef<HTMLDivElement>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const latest = useRef({ route, progress, speed, threeD, following })
  latest.current = { route, progress, speed, threeD, following }
  const updateRef = useRef<() => void>(() => {})
  const syncRouteRef = useRef<() => void>(() => {})
  useEffect(() => {
    let route = latest.current.route
    onReady(false)
    onIntroComplete(false)
    onHorizonChange(0)
    const element = container.current
    if (!element || !hasRoute) return
    if (!mapboxConfig) {
      onError(true)
      return
    }
    let tourSeconds = replayTourSeconds(route)
    const cameraQuality = () =>
      replayMapQuality({
        distance: route.distances.at(-1) ?? 0,
        tourSeconds,
        speed: latest.current.speed,
        latitude: route.points[Math.floor(route.points.length / 2)].latitude,
        width: element.clientWidth,
        threeD: latest.current.threeD,
      })
    let quality = cameraQuality()
    let initialMap: mapboxgl.Map | null = null
    try {
      initialMap = new mapboxgl.Map({
        container: element,
        accessToken: mapboxConfig.accessToken,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [route.points[0].longitude, route.points[0].latitude],
        zoom: quality.zoom,
        pitch: quality.pitch,
        maxPitch: 85,
        attributionControl: false,
        logoPosition: "bottom-left",
        fadeDuration: 0,
        projection: "mercator",
      })
      initialMap.addControl(
        new mapboxgl.AttributionControl({ compact: true }),
        "bottom-right"
      )
    } catch {
      try {
        initialMap?.remove()
      } catch {
        /* Release a partially constructed map. */
      }
      onError(true)
      return
    }
    const map = initialMap
    let loaded = false
    let disposed = false
    const followPadding = () => ({
      top: Math.min(180, element.clientHeight * 0.24),
      bottom: 120,
      left: 30,
      right: 30,
    })
    let previousHorizon = -1
    const updateHorizon = () => {
      if (disposed || !element.isConnected) return
      const height = map.getContainer().clientHeight
      const padding = map.getPadding()
      // Mapbox's default vertical field of view is 2 * atan(1 / 3).
      // Stop the overlay at the geometric horizon, before the fog over land.
      const pitch = (map.getPitch() * Math.PI) / 180
      const horizon =
        pitch > 0
          ? height / 2 +
            ((padding.top ?? 0) - (padding.bottom ?? 0)) / 2 -
            (1.5 * height) / Math.tan(pitch)
          : 0
      const value = Math.round(Math.max(0, horizon))
      if (value !== previousHorizon) {
        previousHorizon = value
        onHorizonChange(value)
      }
    }
    map.on("move", updateHorizon)
    const timeout = window.setTimeout(() => {
      if (!loaded && !disposed && element.isConnected) failRequired()
    }, 20000)
    const markers: mapboxgl.Marker[] = []
    const addMarker = (color: string, index: number, size: number) => {
      const element = document.createElement("div")
      element.style.cssText = `width:${size}px;height:${size}px;border:3px solid white;border-radius:50%;background:${color};box-shadow:0 2px 12px #0008;`
      const marker = new mapboxgl.Marker({ element })
      markers.push(marker)
      marker
        .setLngLat([
          route.points[index].longitude,
          route.points[index].latitude,
        ])
        .addTo(map)
      return marker
    }
    let geometry = replayGeometry(route)
    let coordinates = geometry.coordinates
    let bounds = new mapboxgl.LngLatBounds()
    for (const coordinate of coordinates)
      bounds.extend(coordinate as [number, number])
    let previousProgress = -1,
      previousFollowing = true,
      previousThreeD = latest.current.threeD,
      previousSpeed = latest.current.speed,
      cameraNeedsSettings = true,
      overviewNeedsFit = true,
      terrainEnabled = false,
      terrainFailed = false
    const syncTerrain = () => {
      const enabled = quality.terrain && !terrainFailed
      if (enabled === terrainEnabled) return
      try {
        if (enabled && !map.getSource("replay-terrain")) {
          map.addSource("replay-terrain", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: 14,
          })
        }
        map.setTerrain(
          enabled ? { source: "replay-terrain", exaggeration: 1 } : null
        )
        terrainEnabled = enabled
      } catch {
        terrainFailed = true
        terrainEnabled = false
        cameraNeedsSettings = true
        try {
          map.setTerrain(null)
        } catch {
          /* Keep the satellite route usable. */
        }
      }
    }
    let cameraHeadings = prepareReplayCamera(route)
    let bearing = replayCameraBearing(
      cameraHeadings,
      latest.current.progress,
      latest.current.speed,
      tourSeconds
    )
    let previousCameraTime = performance.now()
    const update = () => {
      if (!loaded || disposed || !element.isConnected) return
      const state = latest.current,
        frame = replayFrame(route, state.progress)
      if (!frame) return
      if (state.following && !previousFollowing) cameraNeedsSettings = true
      if (previousSpeed !== state.speed || previousThreeD !== state.threeD) {
        quality = cameraQuality()
        cameraNeedsSettings = true
        syncTerrain()
      }
      const longitude =
        coordinates[0][0] + longitudeDelta(coordinates[0][0], frame.longitude)
      const position: [number, number] = [longitude, frame.latitude]
      if (state.progress !== previousProgress) {
        const trim: [number, number] = [
          replayTrimProgress(route, geometry, frame),
          1,
        ]
        map.setPaintProperty("replay-casing", "line-trim-offset", trim)
        map.setPaintProperty("replay-line", "line-trim-offset", trim)
      }
      markerRef.current?.setLngLat(position)
      if (state.following) {
        const target = replayCameraBearing(
          cameraHeadings,
          state.progress,
          state.speed,
          tourSeconds
        )
        const jump =
          previousProgress < 0 ||
          Math.abs(state.progress - previousProgress) > 0.025 ||
          !previousFollowing
        const now = performance.now()
        const elapsed = Math.max(
          0,
          Math.min(0.1, (now - previousCameraTime) / 1000)
        )
        previousCameraTime = now
        const turn = target - bearing
        // Time-based easing and a rotation limit prevent abrupt spins even at 10×.
        bearing = jump
          ? target
          : bearing +
            Math.max(
              -90 * elapsed,
              Math.min(90 * elapsed, turn * (1 - Math.exp(-elapsed / 0.2)))
            )
        map.jumpTo({
          center: position,
          bearing: state.threeD ? bearing : 0,
          ...(cameraNeedsSettings
            ? {
                zoom: quality.zoom,
                pitch: terrainFailed
                  ? Math.min(60, quality.pitch)
                  : quality.pitch,
                padding: followPadding(),
              }
            : {}),
        })
        cameraNeedsSettings = false
      } else if (
        previousFollowing ||
        previousThreeD !== state.threeD ||
        overviewNeedsFit
      ) {
        map.fitBounds(bounds, {
          padding: {
            top: Math.min(240, element.clientHeight * 0.3),
            bottom: Math.min(170, element.clientHeight * 0.25),
            left: 45,
            right: 45,
          },
          maxZoom: 16,
          pitch: state.threeD ? 45 : 0,
          bearing: 0,
          duration: 0,
        })
        overviewNeedsFit = false
      }
      previousProgress = state.progress
      previousFollowing = state.following
      previousThreeD = state.threeD
      previousSpeed = state.speed
    }
    let updateFrame = 0,
      previousMapUpdate = -Infinity
    const scheduleUpdate = () => {
      if (disposed || !element.isConnected || updateFrame) return
      const render = (now: number) => {
        updateFrame = 0
        if (disposed || !element.isConnected) return
        if (now - previousMapUpdate < 1000 / 30) {
          updateFrame = requestAnimationFrame(render)
          return
        }
        previousMapUpdate = now
        try {
          update()
        } catch {
          failRequired()
        }
      }
      updateFrame = requestAnimationFrame(render)
    }
    updateRef.current = scheduleUpdate
    syncRouteRef.current = () => {
      if (disposed || !element.isConnected) return
      if (route === latest.current.route) return
      route = latest.current.route
      geometry = replayGeometry(route)
      coordinates = geometry.coordinates
      bounds = new mapboxgl.LngLatBounds()
      for (const coordinate of coordinates)
        bounds.extend(coordinate as [number, number])
      cameraHeadings = prepareReplayCamera(route)
      tourSeconds = replayTourSeconds(route)
      quality = cameraQuality()
      previousProgress = -1
      cameraNeedsSettings = true
      overviewNeedsFit = true
      if (loaded) {
        try {
          ;(map.getSource("replay-route") as mapboxgl.GeoJSONSource).setData(
            feature(coordinates)
          )
          if (disposed) return
          markers[0]?.setLngLat(coordinates[0] as [number, number])
          markers[1]?.setLngLat(coordinates.at(-1)! as [number, number])
          syncTerrain()
          scheduleUpdate()
        } catch {
          failRequired()
        }
      }
    }
    let observer: ResizeObserver | null = null
    const dispose = () => {
      if (disposed) return
      disposed = true
      loaded = false
      clearTimeout(timeout)
      cancelAnimationFrame(updateFrame)
      observer?.disconnect()
      updateRef.current = () => {}
      syncRouteRef.current = () => {}
      for (const marker of markers) {
        try {
          marker.remove()
        } catch {
          /* Continue releasing the other resources. */
        }
      }
      try {
        map.remove()
      } catch {
        /* Cleanup remains idempotent after a renderer fault. */
      }
      markerRef.current = null
    }
    const failRequired = () => {
      if (disposed || !element.isConnected) return
      onReady(false)
      onIntroComplete(false)
      onError(true)
      dispose()
    }
    map.once("style.load", () => {
      if (disposed || !element.isConnected) return
      try {
        for (const layer of map.getStyle().layers) {
          if (layer.type !== "symbol") continue
          const isPointOfInterest = layer["source-layer"] === "poi_label"
          const isCity = /^settlement-(major|minor|subdivision)-label$/.test(
            layer.id
          )
          const isNaturalLandmark = layer["source-layer"] === "natural_label"
          if (isCity) {
            map.setLayerZoomRange(layer.id, layer.minzoom ?? 0, 24)
            if (layer.id === "settlement-major-label") {
              map.setFilter(layer.id, [
                "all",
                [
                  "match",
                  ["get", "class"],
                  ["settlement", "disputed_settlement"],
                  true,
                  false,
                ],
                ["match", ["get", "worldview"], ["all", "US"], true, false],
                ["<=", ["get", "symbolrank"], 14],
                ["<=", ["get", "filterrank"], 3],
              ])
            }
          }
          if (!isPointOfInterest && !isCity && !isNaturalLandmark) {
            map.setLayoutProperty(layer.id, "visibility", "none")
          } else if (isPointOfInterest) {
            const landmarks: mapboxgl.FilterSpecification = [
              "any",
              [
                "all",
                ["==", ["get", "class"], "park_like"],
                [
                  "match",
                  ["get", "maki"],
                  ["park", "national-park", "garden"],
                  true,
                  false,
                ],
                ["<=", ["coalesce", ["get", "sizerank"], 16], 6],
              ],
              [
                "match",
                ["get", "class"],
                ["landmark", "historic"],
                true,
                false,
              ],
              [
                "match",
                ["get", "maki"],
                ["museum", "monument", "attraction", "viewpoint", "castle"],
                true,
                false,
              ],
            ]
            const original = map.getFilter(layer.id)
            map.setFilter(
              layer.id,
              original ? ["all", original, landmarks] : landmarks
            )
          }
        }
        syncTerrain()
        try {
          map.setFog({
            color: "#334761",
            "high-color": "#17253f",
            "space-color": "#0d172a",
            "horizon-blend": 0.15,
          })
        } catch {
          /* Fog is optional; route and satellite imagery remain usable. */
        }
        map.addSource("replay-route", {
          type: "geojson",
          lineMetrics: true,
          data: feature(coordinates),
        })
        if (disposed) return
        map.addLayer({
          id: "replay-context",
          type: "line",
          source: "replay-route",
          paint: { "line-color": "#fff", "line-width": 3, "line-opacity": 0.2 },
          layout: { "line-cap": "round", "line-join": "round" },
        })
        if (disposed) return
        map.addLayer({
          id: "replay-casing",
          type: "line",
          source: "replay-route",
          paint: {
            "line-color": "#172029",
            "line-width": 10,
            "line-trim-offset": [0, 1],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        })
        if (disposed) return
        map.addLayer({
          id: "replay-line",
          type: "line",
          source: "replay-route",
          paint: {
            "line-color": "#ff641e",
            "line-width": 6,
            "line-trim-offset": [0, 1],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        })
        if (disposed) return
        addMarker("#92d34e", 0, 16)
        if (disposed) return
        addMarker("#172029", route.points.length - 1, 14)
        if (disposed) return
        const movingMarker = addMarker("#ff641e", 0, 20)
        if (disposed) return
        markerRef.current = movingMarker
        loaded = true
        clearTimeout(timeout)
        onError(false)
        onReady(true)
        update()
        onIntroComplete(true)
      } catch {
        failRequired()
      }
    })
    map.on("error", (event) => {
      if (disposed || !element.isConnected) return
      const sourceId = (event as typeof event & { sourceId?: string }).sourceId
      if (sourceId === "replay-route") failRequired()
      else if (!loaded) onError(true)
      else if (sourceId === "replay-terrain" && !terrainFailed) {
        terrainFailed = true
        cameraNeedsSettings = true
        syncTerrain()
        scheduleUpdate()
      }
    })
    map.on("webglcontextlost", () => {
      if (!disposed && element.isConnected) onError(true)
    })
    map.on("webglcontextrestored", () => {
      if (disposed || !element.isConnected) return
      onError(false)
      scheduleUpdate()
    })
    // Camera updates also emit rotation events; only a user gesture exits follow mode.
    map.on("dragstart", (event) => {
      if (disposed || !element.isConnected) return
      if (event.originalEvent) {
        latest.current.following = false
        onFollowingChange(false)
      }
    })
    map.on("rotatestart", (event) => {
      if (disposed || !element.isConnected) return
      if (event.originalEvent) {
        latest.current.following = false
        onFollowingChange(false)
      }
    })
    observer = new ResizeObserver(() => {
      if (disposed || !element.isConnected) return
      map.resize()
      quality = cameraQuality()
      cameraNeedsSettings = true
      overviewNeedsFit = true
      scheduleUpdate()
      updateHorizon()
    })
    if (!disposed && element.isConnected) observer.observe(element)
    return dispose
  }, [
    hasRoute,
    onFollowingChange,
    onReady,
    onError,
    onIntroComplete,
    onHorizonChange,
  ])
  useEffect(() => {
    syncRouteRef.current()
  }, [route])
  useEffect(() => {
    updateRef.current()
  }, [progress, speed, threeD, following])
  return (
    <div
      ref={container}
      style={{ position: "absolute", inset: 0 }}
      aria-label="Satellite route replay map"
    />
  )
}
