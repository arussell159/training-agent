import { Skeleton } from "@/components/ui/skeleton"
import { useEffect, useMemo, useState } from "react"

import { MapboxRouteMap } from "@/components/mapbox-route-map"
import { cachedActivityRoute, loadActivityRoute } from "@/lib/activity-analysis"
import { RouteReplayButton } from "@/components/route-replay-button"
import type { PlannedWorkout } from "@/lib/training-context"
import type { TimedRoutePoint } from "@/components/workout-route-map"

type Coordinate = [number, number]

export function DesktopWorkoutRouteMap({
  workout,
  timedPoints,
  highlightRange,
  cursorPoint,
  compact = false,
}: {
  workout: PlannedWorkout
  timedPoints?: TimedRoutePoint[]
  highlightRange?: [number, number] | null
  cursorPoint?: TimedRoutePoint | null
  compact?: boolean
}) {
  const id =
    workout.activity_id ||
    (workout.id.startsWith("activity:") ? workout.id.slice(9) : null)
  const revision =
    (workout as PlannedWorkout & { activity_revision?: string })
      .activity_revision || ""
  const key = `${id}:${revision}`
  const [failed, setFailed] = useState("")
  const [loaded, setLoaded] = useState<{
    key: string
    points: Coordinate[]
  } | null>(() => {
    const points = id ? cachedActivityRoute(id, revision) : null
    return points ? { key, points } : null
  })
  const fallback = useMemo(
    () => (loaded?.key === key ? loaded.points : []),
    [loaded, key],
  )
  const validTimed = useMemo(
    () =>
      (timedPoints || []).filter(
        (point) =>
          Number.isFinite(point.time) &&
          Number.isFinite(point.latitude) &&
          Number.isFinite(point.longitude) &&
          Math.abs(point.latitude) <= 85 &&
          Math.abs(point.longitude) <= 180,
      ),
    [timedPoints],
  )
  useEffect(() => {
    if (validTimed.length > 1 || !id) return
    const controller = new AbortController()
    void loadActivityRoute(id, revision, controller.signal)
      .then((points) => {
        if (!controller.signal.aborted) setLoaded({ key, points })
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(key)
      })
    return () => controller.abort()
  }, [id, revision, key, validTimed.length])
  const route = useMemo(
    () =>
      validTimed.length > 1
        ? validTimed
        : fallback.map(([latitude, longitude], time) => ({
            time,
            latitude,
            longitude,
          })),
    [validTimed, fallback],
  )
  if (route.length < 2 && (!id || loaded?.key === key || failed === key))
    return (
      <div
        className={`flex items-center justify-center bg-muted/25 text-sm text-muted-foreground ${compact ? "h-[300px] lg:h-full lg:min-h-[300px]" : "h-[320px]"}`}
      >
        {failed === key
          ? "Route could not be loaded."
          : "No GPS route is available."}
      </div>
    )
  if (route.length < 2)
    return (
      <Skeleton
        aria-label="Loading route"
        className={
          compact ? "h-[300px] lg:h-full lg:min-h-[300px]" : "h-[320px]"
        }
      />
    )
  return (
    <div
      className={`relative min-w-0 ${compact ? "h-[300px] lg:h-full lg:min-h-[300px]" : "h-[320px]"}`}
    >
      <MapboxRouteMap
        points={route}
        highlightRange={validTimed.length > 1 ? highlightRange : null}
        cursorPoint={validTimed.length > 1 ? cursorPoint : null}
        className="relative isolate z-0 h-full min-w-0 overflow-hidden bg-[#eef2ed]"
      />
      <RouteReplayButton
        workout={workout}
        points={route}
        timed={validTimed.length > 1}
        bottom={36}
      />
    </div>
  )
}
