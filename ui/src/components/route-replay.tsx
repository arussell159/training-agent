import { useEffect, useMemo, useRef, useState } from "react"
import { LocateFixed, Pause, Play, X } from "lucide-react"
import { DialogClose } from "@/components/ui/dialog"
import {
  cachedActivityAnalysis,
  loadActivityAnalysis,
} from "@/lib/activity-analysis"
import {
  prepareReplayRoute,
  replayFrame,
  replayTourSeconds,
  REPLAY_SPEED_OPTIONS,
  replayDurationLabel,
  advanceReplayProgress,
  type ReplayPoint,
} from "@/lib/route-replay"
import type { PlannedWorkout } from "@/lib/training-context"
import { RouteReplayMap } from "@/components/route-replay-map"

const clock = (seconds: number) => {
  const rounded = Math.max(0, Math.floor(seconds))
  return rounded >= 3600
    ? `${Math.floor(rounded / 3600)}:${String(Math.floor(rounded / 60) % 60).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`
    : `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`
}

export function RouteReplay({
  workout,
  points,
  timed,
}: {
  workout: PlannedWorkout
  points: ReplayPoint[]
  timed: boolean
}) {
  const id =
    workout.activity_id ||
    (workout.id.startsWith("activity:") ? workout.id.slice(9) : null)
  const revision =
    (workout as PlannedWorkout & { activity_revision?: string })
      .activity_revision || ""
  const [recorded, setRecorded] = useState<ReplayPoint[] | null>(() =>
    id
      ? ((cachedActivityAnalysis(id, revision)?.points as ReplayPoint[]) ??
        null)
      : null
  )
  const [loading, setLoading] = useState(() =>
    Boolean(id && !cachedActivityAnalysis(id, revision))
  )
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
  const [speed, setSpeed] = useState(() => {
    try {
      const saved = Number(sessionStorage.getItem("route-replay-speed-v1"))
      if (REPLAY_SPEED_OPTIONS.some((value) => value === saved)) return saved
    } catch {
      /* Replay controls remain available when storage is blocked. */
    }
    return 1
  })
  const [threeD, setThreeD] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
  const [following, setFollowing] = useState(true)
  const [mapReady, setMapReady] = useState(false)
  const [introComplete, setIntroComplete] = useState(false)
  const [horizonHeight, setHorizonHeight] = useState(0)
  const [mapError, setMapError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [interacting, setInteracting] = useState(false)
  const [controlFocused, setControlFocused] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    let active = true
    void loadActivityAnalysis(id, revision, controller.signal)
      .then((data) => {
        if (active) setRecorded(data.points as ReplayPoint[])
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout)
        if (active) setLoading(false)
      })
    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [id, revision])
  const route = useMemo(() => {
    if (recorded) {
      const full = prepareReplayRoute(recorded, true)
      if (full.points.length > 1 && full.duration > 0) return full
    }
    return prepareReplayRoute(points, timed)
  }, [recorded, points, timed])
  const frame = replayFrame(route, progress)
  const tourSeconds = replayTourSeconds(route)
  const usableRoute = route.points.length > 1 && route.duration > 0
  const ready = mapReady && introComplete && !mapError && usableRoute
  const missingRoute = !loading && !usableRoute
  const clearHideTimer = () => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current)
  }
  const revealControls = () => {
    setControlsVisible(true)
    clearHideTimer()
    if (ready && playing && !interacting && !controlFocused) {
      hideTimer.current = setTimeout(() => setControlsVisible(false), 1000)
    }
  }
  useEffect(() => {
    setControlsVisible(true)
    if (ready && playing && !interacting && !controlFocused) {
      hideTimer.current = setTimeout(() => setControlsVisible(false), 1000)
    }
    return () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current)
    }
  }, [ready, playing, interacting, controlFocused])
  // Base duration scales with the recording and route length, including geometry-only routes.
  useEffect(() => {
    if (!playing || !ready) return
    let request = 0,
      previous: number | null = null,
      lastPaint = 0
    const tick = (now: number) => {
      if (previous === null) previous = now
      if (now - lastPaint >= 32) {
        const delta = Math.max(0, now - previous)
        previous = now
        lastPaint = now
        setProgress((value) =>
          advanceReplayProgress(value, delta, tourSeconds, speed)
        )
      }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing, ready, speed, tourSeconds])
  useEffect(() => {
    if (progress >= 1) setPlaying(false)
  }, [progress])
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener("visibilitychange", visibility)
    return () => document.removeEventListener("visibilitychange", visibility)
  }, [])
  const bike = /bike|ride|cycl/i.test(workout.sport)
  const hasSpeed = frame?.speed != null && frame.speed > 0.15
  const pace = hasSpeed
    ? bike
      ? (frame.speed! * 2.236936).toFixed(1)
      : clock(1609.344 / frame.speed!)
    : "—"
  const buttonClass =
    "flex !size-11 shrink-0 items-center justify-center rounded-full !p-0 text-slate-900 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-40"
  const fadeClass = `transition-opacity duration-200 motion-reduce:transition-none ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"}`
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      data-testid="route-replay"
      onPointerMove={revealControls}
      onPointerDownCapture={() => {
        clearHideTimer()
        setControlsVisible(true)
        setInteracting(true)
      }}
      onPointerUp={() => setInteracting(false)}
      onPointerCancel={() => setInteracting(false)}
      onFocusCapture={(event) => {
        revealControls()
        setControlFocused(
          event.target instanceof Element &&
            Boolean(
              event.target.closest(
                '[data-testid="replay-playback-controls"], [data-testid="replay-top-controls"]'
              )
            )
        )
      }}
      onBlurCapture={(event) => {
        setControlFocused(
          event.relatedTarget instanceof Element &&
            Boolean(
              event.relatedTarget.closest(
                '[data-testid="replay-playback-controls"], [data-testid="replay-top-controls"]'
              )
            )
        )
      }}
      onKeyDownCapture={revealControls}
    >
      {
        <RouteReplayMap
          key={attempt}
          route={route}
          progress={progress}
          speed={speed}
          threeD={threeD}
          following={following}
          onFollowingChange={setFollowing}
          onReady={setMapReady}
          onIntroComplete={setIntroComplete}
          onHorizonChange={setHorizonHeight}
          onError={setMapError}
        />
      }
      <div
        data-testid="replay-sky-gradient"
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10"
        style={{
          height: horizonHeight,
          opacity: Math.min(1, horizonHeight / 64),
          background:
            "linear-gradient(180deg, rgba(13,23,42,.88) 0%, rgba(22,36,62,.80) 48%, rgba(40,59,86,.66) 72%, rgba(40,59,86,.20) 90%, transparent 100%)",
        }}
      />
      <div
        data-testid="replay-metrics"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 px-5 pt-[max(6rem,calc(env(safe-area-inset-top)+5rem))] pb-12 text-center text-white"
        style={{
          textShadow: "0 1px 5px rgba(0,0,0,.65)",
        }}
      >
        <h2 className="mx-auto max-w-lg truncate text-sm font-semibold tracking-tight">
          {workout.title}
        </h2>
        <dl className="mx-auto mt-3 grid max-w-lg grid-cols-3 gap-2 tabular-nums">
          {[
            {
              label: bike ? "Speed" : "Pace",
              value: pace,
              unit: bike ? "mph" : "/mi",
            },
            {
              label: "Elevation",
              value:
                frame?.elevation != null
                  ? Math.round(frame.elevation / 0.3048).toLocaleString()
                  : "—",
              unit: "ft",
            },
            {
              label: "Distance",
              value:
                frame?.distance != null
                  ? (frame.distance / 1609.344).toFixed(2)
                  : "—",
              unit: "mi",
            },
          ].map((stat) => (
            <div key={stat.label}>
              <dt className="text-[10px] font-medium text-white/80 sm:text-xs">
                {stat.label}
              </dt>
              <dd className="mt-1 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
                {stat.value}
                <span className="mt-1 block text-xs font-normal tracking-normal text-white/85">
                  {stat.unit}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div
        data-testid="replay-top-controls"
        className={`absolute inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-20 flex justify-between ${fadeClass}`}
      >
        <DialogClose
          aria-label="Close route replay"
          className={`${buttonClass} bg-white/95 shadow-md backdrop-blur-md`}
        >
          <X className="size-5" />
        </DialogClose>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Follow route"
            aria-pressed={following}
            onClick={() => setFollowing(!following)}
            className={`${buttonClass} bg-white/95 shadow-md backdrop-blur-md`}
          >
            <LocateFixed
              className={`size-5 ${following ? "text-orange-600" : "text-slate-900"}`}
            />
          </button>
          <button
            type="button"
            aria-label="3D view"
            aria-pressed={threeD}
            onClick={() => setThreeD(!threeD)}
            className={`${buttonClass} bg-white/95 text-xs font-semibold shadow-md backdrop-blur-md`}
          >
            {threeD ? "3D" : "2D"}
          </button>
        </div>
      </div>
      {((loading && !usableRoute) || !mapReady || mapError || missingRoute) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-6">
          <div
            role="status"
            className="max-w-sm rounded-2xl bg-white/95 p-5 text-center text-sm text-slate-900 shadow-lg backdrop-blur-md"
          >
            {missingRoute ? (
              "This recording has no timed GPS route to replay."
            ) : mapError ? (
              <>
                <p>The satellite map couldn’t load.</p>
                <button
                  type="button"
                  className="mt-3 rounded-full bg-orange-50 px-4 py-2 font-semibold text-orange-700"
                  onClick={() => {
                    setMapError(false)
                    setMapReady(false)
                    setIntroComplete(false)
                    setPlaying(false)
                    setAttempt((value) => value + 1)
                  }}
                >
                  Retry map
                </button>
              </>
            ) : loading && !usableRoute ? (
              "Loading activity data…"
            ) : (
              "Loading satellite map…"
            )}
          </div>
        </div>
      )}
      <div
        data-testid="replay-playback-controls"
        className={`absolute inset-x-4 bottom-[max(2.5rem,calc(env(safe-area-inset-bottom)+1.5rem))] z-20 mx-auto max-w-2xl rounded-2xl bg-white/95 p-2 text-slate-900 shadow-lg backdrop-blur-xl ${fadeClass}`}
      >
        <div>
          <div className="flex items-center justify-between px-3 pt-1 text-[11px] text-slate-500 tabular-nums">
            <span>
              {route.timed
                ? `${clock(frame?.time || 0)} / ${clock(route.duration)}`
                : "Route preview · timing unavailable"}
            </span>
            <span>
              {progress >= 1
                ? "Replay complete"
                : `${Math.round(progress * 100)}% · ${replayDurationLabel(tourSeconds * (1 - progress), speed)} left`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={
                playing
                  ? "Pause replay"
                  : progress >= 1
                    ? "Play again"
                    : "Play replay"
              }
              disabled={!ready}
              className={buttonClass}
              onClick={() => {
                if (progress >= 1) setProgress(0)
                setPlaying(!playing)
              }}
            >
              {playing ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="ml-0.5 size-5 fill-current" />
              )}
            </button>
            <input
              style={{ colorScheme: "light" }}
              aria-label="Replay progress"
              aria-valuetext={
                route.timed
                  ? clock(frame?.time || 0)
                  : `${Math.round(progress * 100)} percent`
              }
              type="range"
              min="0"
              max="1000"
              step="1"
              value={Math.round(progress * 1000)}
              disabled={!ready}
              onChange={(event) => {
                setPlaying(false)
                setProgress(Number(event.target.value) / 1000)
              }}
              className="h-11 min-w-0 flex-1 cursor-pointer accent-orange-500"
            />
            <select
              aria-label="Replay speed"
              title={`Full replay: ${replayDurationLabel(tourSeconds, speed)} at ${speed}×`}
              value={speed}
              style={{ colorScheme: "light" }}
              className="h-11 w-16 shrink-0 cursor-pointer rounded-full bg-transparent px-1 text-center text-sm font-semibold text-slate-900 tabular-nums hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!REPLAY_SPEED_OPTIONS.some((value) => value === next))
                  return
                setSpeed(next)
                try {
                  sessionStorage.setItem("route-replay-speed-v1", String(next))
                } catch {
                  /* Optional preference. */
                }
              }}
            >
              {REPLAY_SPEED_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
