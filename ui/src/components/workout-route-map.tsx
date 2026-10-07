import { useEffect, useMemo, useState } from "react"

import {
  MapboxRouteMap,
  type MapRoutePoint,
} from "@/components/mapbox-route-map"
import { cachedActivityRoute, loadActivityRoute, cachedActivityAnalysis, loadActivityAnalysis } from "@/lib/activity-analysis"
import { RouteReplayButton } from "@/components/route-replay-button"
import type { PlannedWorkout } from "@/lib/training-context"

type Coordinate = [number, number]
export type TimedRoutePoint = MapRoutePoint

export function WorkoutRouteMap({
  workout,
  onAvailable,
  timedPoints,
  highlightRange,
  compact = false,
  topPadding = 0,
  bottomPadding = 0,
  revealOffset = 0,
}: {
  workout: PlannedWorkout
  onAvailable?: (available: boolean) => void
  timedPoints?: TimedRoutePoint[]
  highlightRange?: [number, number] | null
  compact?: boolean
  topPadding?: number
  bottomPadding?: number
  revealOffset?: number
}) {
  const id =
    workout.activity_id ||
    (workout.id.startsWith("activity:") ? workout.id.slice(9) : null)
  const revision =
    (workout as PlannedWorkout & { activity_revision?: string })
      .activity_revision || ""
  const key = `${id}:${revision}`
  const [recording,setRecording]=useState(()=>({key,data:id?cachedActivityAnalysis(id,revision):null}))
  useEffect(()=>{
    if(!id || timedPoints)return
    const controller=new AbortController()
    void loadActivityAnalysis(id,revision,controller.signal).then(data=>{
      if(!controller.signal.aborted)setRecording({key,data})
    }).catch(()=>{})
    return()=>controller.abort()
  },[id,revision,key,timedPoints])
  const [route, setRoute] = useState<{
    key: string
    points: Coordinate[]
  } | null>(() => {
    const points = id ? cachedActivityRoute(id, revision) : null
    return points ? { key, points } : null
  })
  const [error, setError] = useState(false),
    [retry, setRetry] = useState(0)
  const fetched = useMemo(
    () => (route?.key === key ? route.points : []),
    [route, key]
  )
  const validTimedPoints = useMemo(
    () =>
      (timedPoints || (recording.key===key?recording.data?.points || []:[])).filter(
        (point) =>
          Number.isFinite(point.time) &&
          typeof point.latitude==='number' &&
          typeof point.longitude==='number' &&
          Math.abs(point.latitude) <= 85 &&
          Math.abs(point.longitude) <= 180
      ).map(point=>({time:point.time,latitude:point.latitude!,longitude:point.longitude!})),
    [timedPoints,recording,key]
  )
  const usesTimedRoute = validTimedPoints.length > 1
  const points = useMemo<TimedRoutePoint[]>(
    () =>
      usesTimedRoute
        ? validTimedPoints
        : fetched.map(([latitude, longitude], time) => ({
            time,
            latitude,
            longitude,
          })),
    [usesTimedRoute, validTimedPoints, fetched]
  )
  const available = points.length > 1
  const slotStyle = {
    height: compact
      ? "280px"
      : `calc(max(300px, min(48svh, 420px)) + ${revealOffset}px)`,
  }
  useEffect(() => {
    if (usesTimedRoute || !id) return
    const controller = new AbortController()
    setError(false)
    void loadActivityRoute(id, revision, controller.signal)
      .then((points) => {
        if (!controller.signal.aborted) setRoute({ key, points })
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
    return () => controller.abort()
  }, [id, revision, key, usesTimedRoute, retry])
  useEffect(() => {
    onAvailable?.(available)
  }, [available, onAvailable])
  if (!available && error)
    return (
      <div style={slotStyle} className="flex items-center justify-center gap-3 bg-muted/20 text-sm">
        <span>Map couldn’t load.</span>
        <button
          type="button"
          className="rounded-full border px-3 py-2"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry map
        </button>
      </div>
    )
  if (!available)
    return (
      <div style={slotStyle} className="flex items-center justify-center bg-[#d7edf4] text-sm text-muted-foreground">
        {id && route?.key !== key && !usesTimedRoute ? <span className="sr-only" role="status">Loading activity map</span> : "No GPS route recorded."}
      </div>
    )
  return (
    <div
      className="relative"
      style={slotStyle}
    >
      <MapboxRouteMap
        points={points}
        highlightRange={highlightRange}
        interactive={false}
        topPadding={topPadding}
        bottomPadding={bottomPadding}
        className="relative h-full overflow-hidden bg-[#eef2ed]"
      />
      <RouteReplayButton
        workout={workout}
        points={points}
        timed={usesTimedRoute}
        bottom={bottomPadding + 10}
      />
    </div>
  )
}
