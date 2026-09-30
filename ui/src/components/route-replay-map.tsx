import { useEffect, useRef } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { mapboxConfig } from "@/lib/mapbox-config"
import {
  longitudeDelta,
  replayBearing,
  replayFrame,
  type ReplayRoute,
} from "@/lib/route-replay"

const FOLLOW_PITCH = 74

type Props = {
  route: ReplayRoute
  progress: number
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
  threeD,
  following,
  onFollowingChange,
  onReady,
  onIntroComplete,
  onHorizonChange,
  onError,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const latest = useRef({ progress, threeD, following })
  latest.current = { progress, threeD, following }
  const updateRef = useRef<() => void>(() => {})
  useEffect(() => {
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
    // Keep source updates bounded even on long, second-by-second recordings.
    const stride = Math.max(1, Math.ceil(route.points.length / 2000))
    const coordinates: number[][] = []
    let unwrapped = route.points[0].longitude
    const longitudes = route.points.map((point, index) => {
      if (index)
        unwrapped += longitudeDelta(
          route.points[index - 1].longitude,
          point.longitude
        )
      return unwrapped
    })
    for (let i = 0; i < route.points.length; i += stride)
      coordinates.push([longitudes[i], route.points[i].latitude])
    coordinates.push([longitudes.at(-1)!, route.points.at(-1)!.latitude])
    const bounds = new mapboxgl.LngLatBounds()
    for (const coordinate of coordinates)
      bounds.extend(coordinate as [number, number])
    let previousProgress = -1,
      previousFollowing = true,
      previousThreeD = latest.current.threeD
    let bearing = replayBearing(
      route.points[0],
      route.points[Math.min(route.points.length - 1, 10)]
    )
    const update = () => {
      if (!loaded || introducing) return
      const state = latest.current,
        frame = replayFrame(route, state.progress)
      if (!frame) return
      const longitude =
        longitudes[frame.index] +
        longitudeDelta(route.points[frame.index].longitude, frame.longitude)
      const position: [number, number] = [longitude, frame.latitude]
      const traversed: number[][] = []
      for (let i = 0; i <= frame.index; i += stride)
        traversed.push([longitudes[i], route.points[i].latitude])
      traversed.push(position)
      ;(map.getSource("replay-trail") as mapboxgl.GeoJSONSource).setData(
        feature(traversed)
      )
      markerRef.current?.setLngLat(position)
      if (state.following) {
        const ahead = replayFrame(route, Math.min(1, state.progress + 0.015))!
        const moving =
          Math.abs(ahead.latitude - frame.latitude) +
            Math.abs(longitudeDelta(frame.longitude, ahead.longitude)) >
          0.00001
        const target = moving ? replayBearing(frame, ahead) : bearing
        const jump =
          previousProgress < 0 ||
          Math.abs(state.progress - previousProgress) > 0.025 ||
          !previousFollowing
        bearing += longitudeDelta(bearing, target) * (jump ? 1 : 0.035)
        map.jumpTo({
          center: position,
          zoom: 15.5,
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
        const isCity = /^settlement-(major|minor)-label$/.test(layer.id)
        const isNaturalLandmark = layer["source-layer"] === "natural_label"
        if (!isPointOfInterest && !isCity && !isNaturalLandmark) {
          map.setLayoutProperty(layer.id, "visibility", "none")
        } else if (isPointOfInterest) {
          const landmarks: mapboxgl.FilterSpecification = [
            "any",
            [
              "match",
              ["get", "class"],
              ["park_like", "landmark", "historic"],
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
        data: feature(coordinates),
      })
      map.addLayer({
        id: "replay-context",
        type: "line",
        source: "replay-route",
        paint: { "line-color": "#fff", "line-width": 3, "line-opacity": 0.2 },
        layout: { "line-cap": "round", "line-join": "round" },
      })
      map.addSource("replay-trail", {
        type: "geojson",
        data: feature([coordinates[0], coordinates[0]]),
      })
      map.addLayer({
        id: "replay-casing",
        type: "line",
        source: "replay-trail",
        paint: { "line-color": "#172029", "line-width": 10 },
        layout: { "line-cap": "round", "line-join": "round" },
      })
      map.addLayer({
        id: "replay-line",
        type: "line",
        source: "replay-trail",
        paint: { "line-color": "#ff641e", "line-width": 6 },
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
      // Begin with the whole route overhead, then descend and tilt into follow view.
      map.fitBounds(bounds, {
        padding: { top: 100, bottom: 140, left: 50, right: 50 },
        maxZoom: 14,
        pitch: 0,
        bearing: 0,
        duration: 0,
      })
      const first = replayFrame(route, latest.current.progress)!
      const ahead = replayFrame(
        route,
        Math.min(1, latest.current.progress + 0.015)
      )!
      bearing = replayBearing(first, ahead)
      introTimer = window.setTimeout(() => {
        map.once("moveend", finishIntro)
        map.flyTo({
          center: [first.longitude, first.latitude],
          zoom: 15.5,
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
      observer.disconnect()
      updateRef.current = () => {}
      for (const marker of markers) marker.remove()
      map.remove()
      markerRef.current = null
    }
  }, [
    route,
    onFollowingChange,
    onReady,
    onError,
    onIntroComplete,
    onHorizonChange,
  ])
  useEffect(() => {
    updateRef.current()
  }, [progress, threeD, following])
  return (
    <div
      ref={container}
      style={{ position: "absolute", inset: 0 }}
      aria-label="Satellite route replay map"
    />
  )
}
