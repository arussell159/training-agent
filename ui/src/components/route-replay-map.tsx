import { useEffect, useRef } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { mapboxConfig } from "@/lib/mapbox-config"
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

const FOLLOW_PITCH = 74

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
  onBuffering: (value: boolean) => void
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
  onBuffering,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const latest = useRef({ route, progress, speed, threeD, following })
  latest.current = { route, progress, speed, threeD, following }
  const updateRef = useRef<() => void>(() => {})
  const syncRouteRef = useRef<() => void>(() => {})
  useEffect(() => {
    let route = latest.current.route
    if (!container.current || !mapboxConfig || route.points.length < 2) return
    onReady(false)
    onIntroComplete(false)
    onHorizonChange(0)
    let map: mapboxgl.Map
    try {
      map = new mapboxgl.Map({
        container: container.current,
        accessToken: mapboxConfig.accessToken,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [route.points[0].longitude, route.points[0].latitude],
        zoom: 15,
        pitch: 0,
        maxPitch: 85,
        attributionControl: false,
        logoPosition: "bottom-left",
        fadeDuration: 0,
        projection: "mercator",
        maxTileCacheSize: 128,
      })
      map.addControl(
        new mapboxgl.AttributionControl({ compact: true }),
        "bottom-right"
      )
    } catch {
      onError(true)
      return
    }
    let loaded = false
    let introducing = true
    let introTimer = 0
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    const followPadding = () => ({
      top: Math.min(180, container.current!.clientHeight * 0.24),
      bottom: 120,
      left: 30,
      right: 30,
    })
    const updateHorizon = () => {
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
      onHorizonChange(Math.round(Math.max(0, horizon)))
    }
    map.on("move", updateHorizon)
    const timeout = window.setTimeout(() => {
      if (!loaded) onError(true)
    }, 20000)
    const markers: mapboxgl.Marker[] = []
    const addMarker = (color: string, index: number, size: number) => {
      const element = document.createElement("div")
      element.style.cssText = `width:${size}px;height:${size}px;border:3px solid white;border-radius:50%;background:${color};box-shadow:0 2px 12px #0008;`
      const marker = new mapboxgl.Marker({ element })
        .setLngLat([
          route.points[index].longitude,
          route.points[index].latitude,
        ])
        .addTo(map)
      markers.push(marker)
      return marker
    }
    let geometry = replayGeometry(route)
    let coordinates = geometry.coordinates
    let bounds = new mapboxgl.LngLatBounds()
    for (const coordinate of coordinates)
      bounds.extend(coordinate as [number, number])
    const followZoom = () =>
      (route.distances.at(-1) ?? 0) > 30000 ? 14.5 : 15.5
    let previousProgress = -1,
      previousFollowing = true,
      previousThreeD = latest.current.threeD
    let cameraHeadings = prepareReplayCamera(route)
    let bearing = replayCameraBearing(
      cameraHeadings,
      latest.current.progress,
      latest.current.speed,
      replayTourSeconds(route)
    )
    let previousCameraTime = performance.now()
    const update = () => {
      if (!loaded || introducing) return
      const state = latest.current,
        frame = replayFrame(route, state.progress)
      if (!frame) return
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
          replayTourSeconds(route)
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
          zoom: followZoom(),
          pitch: state.threeD ? FOLLOW_PITCH : 0,
          bearing: state.threeD ? bearing : 0,
          padding: followPadding(),
        })
      } else if (previousFollowing || previousThreeD !== state.threeD) {
        map.fitBounds(bounds, {
          padding: {
            top: Math.min(240, container.current!.clientHeight * 0.3),
            bottom: Math.min(170, container.current!.clientHeight * 0.25),
            left: 45,
            right: 45,
          },
          maxZoom: 16,
          pitch: state.threeD ? 45 : 0,
          bearing: 0,
          duration: 0,
        })
      }
      previousProgress = state.progress
      previousFollowing = state.following
      previousThreeD = state.threeD
    }
    syncRouteRef.current = () => {
      if (route === latest.current.route) return
      route = latest.current.route
      geometry = replayGeometry(route)
      coordinates = geometry.coordinates
      bounds = new mapboxgl.LngLatBounds()
      for (const coordinate of coordinates)
        bounds.extend(coordinate as [number, number])
      cameraHeadings = prepareReplayCamera(route)
      previousProgress = -1
      if (loaded) {
        ;(map.getSource("replay-route") as mapboxgl.GeoJSONSource).setData(
          feature(coordinates)
        )
        markers[0]?.setLngLat(coordinates[0] as [number, number])
        markers[1]?.setLngLat(coordinates.at(-1)! as [number, number])
        update()
      }
    }
    const finishIntro = () => {
      if (!introducing) return
      introducing = false
      window.clearTimeout(introTimer)
      map.off("moveend", finishIntro)
      update()
      onIntroComplete(true)
    }
    updateRef.current = () => {
      // A view toggle during the entrance takes effect immediately.
      if (
        introducing &&
        loaded &&
        (!latest.current.threeD || !latest.current.following)
      ) {
        map.off("moveend", finishIntro)
        map.stop()
        finishIntro()
      } else update()
    }
    map.on("load", () => {
      loaded = true
      clearTimeout(timeout)
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
            ["match", ["get", "class"], ["landmark", "historic"], true, false],
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
      map.addSource("replay-terrain", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      })
      map.setTerrain({ source: "replay-terrain", exaggeration: 1 })
      map.setFog({
        color: "#334761",
        "high-color": "#17253f",
        "space-color": "#0d172a",
        "horizon-blend": 0.15,
      })
      map.addSource("replay-route", {
        type: "geojson",
        lineMetrics: true,
        data: feature(coordinates),
      })
      map.addLayer({
        id: "replay-context",
        type: "line",
        source: "replay-route",
        paint: { "line-color": "#fff", "line-width": 3, "line-opacity": 0.2 },
        layout: { "line-cap": "round", "line-join": "round" },
      })
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
      addMarker("#92d34e", 0, 16)
      addMarker("#172029", route.points.length - 1, 14)
      markerRef.current = addMarker("#ff641e", 0, 20)
      onError(false)
      onReady(true)
      if (reducedMotion || !latest.current.threeD) {
        finishIntro()
        return
      }
      // A local entrance avoids downloading a whole long ride at several zoom levels.
      const entrance = new mapboxgl.LngLatBounds()
      for (let i = 0; i < coordinates.length; i++) {
        entrance.extend(coordinates[i] as [number, number])
        if (route.distances[geometry.indices[i]] > 1500) break
      }
      map.fitBounds(entrance, {
        padding: { top: 100, bottom: 140, left: 50, right: 50 },
        maxZoom: 14.5,
        pitch: 0,
        bearing: 0,
        duration: 0,
      })
      const first = replayFrame(route, latest.current.progress)!
      bearing = replayCameraBearing(
        cameraHeadings,
        latest.current.progress,
        latest.current.speed,
        replayTourSeconds(route)
      )
      introTimer = window.setTimeout(() => {
        map.once("moveend", finishIntro)
        map.flyTo({
          center: [first.longitude, first.latitude],
          zoom: followZoom(),
          pitch: FOLLOW_PITCH,
          bearing,
          padding: followPadding(),
          duration: 2800,
          curve: 1.35,
          easing: (t) => t * t * (3 - 2 * t),
        })
      }, 350)
    })
    map.on("error", () => {
      if (!loaded) onError(true)
    })
    map.on("webglcontextlost", () => onError(true))
    map.on("webglcontextrestored", () => {
      onError(false)
      update()
    })
    let missingSince = 0,
      bufferingSince = 0
    const imageryTimer = window.setInterval(() => {
      if (!loaded || introducing) return
      const now = performance.now()
      if (map.areTilesLoaded() || !latest.current.following) {
        missingSince = 0
        if (bufferingSince) {
          bufferingSince = 0
          onBuffering(false)
        }
      } else if (bufferingSince && now - bufferingSince > 5000) {
        bufferingSince = 0
        missingSince = now
        onBuffering(false)
      } else if (!missingSince) missingSince = now
      else if (!bufferingSince && now - missingSince > 750) {
        bufferingSince = now
        onBuffering(true)
      }
    }, 250)
    // Camera updates also emit rotation events; only a user gesture exits follow mode.
    map.on("dragstart", (event) => {
      if (event.originalEvent) {
        latest.current.following = false
        finishIntro()
        onFollowingChange(false)
      }
    })
    map.on("rotatestart", (event) => {
      if (event.originalEvent) {
        latest.current.following = false
        finishIntro()
        onFollowingChange(false)
      }
    })
    const observer = new ResizeObserver(() => {
      map.resize()
      update()
      updateHorizon()
    })
    observer.observe(container.current)
    return () => {
      clearTimeout(timeout)
      clearTimeout(introTimer)
      clearInterval(imageryTimer)
      onBuffering(false)
      observer.disconnect()
      updateRef.current = () => {}
      syncRouteRef.current = () => {}
      for (const marker of markers) marker.remove()
      map.remove()
      markerRef.current = null
    }
  }, [
    onFollowingChange,
    onReady,
    onError,
    onIntroComplete,
    onHorizonChange,
    onBuffering,
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
