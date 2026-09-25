import { METERS_PER_100_YARDS } from "../../../app-backend/lib/swim-units.mjs"
import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import type { PlannedWorkout } from "@/lib/training-context"
import type { RecordedPoint } from "@/lib/segment-statistics"
import { distanceSplits, type DistanceSplit } from "@/lib/distance-splits"
import { swimSplits, type SwimSplitAnalysis } from "@/lib/swim-splits"
import { formatSignalClock } from "@/lib/interval-signals"
import { useIsMobile } from "@/hooks/use-mobile"
import { DesktopWorkoutRouteMap } from "@/components/desktop-workout-route-map"

type Analysis = SwimSplitAnalysis & { points: RecordedPoint[] }

const splitMph = (split: DistanceSplit) =>
  (split.distance * 3600) / (1609.344 * (split.end - split.start))

export function WorkoutMapSplits({
  workout,
  analysis: suppliedAnalysis,
}: {
  workout: PlannedWorkout
  analysis?: Analysis
}) {
  const mobile = useIsMobile()
  const id =
    workout.activity_id ||
    (workout.id.startsWith("activity:") ? workout.id.slice(9) : null)
  const revision =
    (workout as PlannedWorkout & { activity_revision?: string })
      .activity_revision || ""
  const [loaded, setLoaded] = useState<Analysis | null>(null)
  const analysis = suppliedAnalysis || loaded
  useEffect(() => {
    if (!id || suppliedAnalysis) return
    const controller = new AbortController()
    void apiFetch(
      `/api/activities/${encodeURIComponent(id)}/analysis?schema=8&v=${encodeURIComponent(revision)}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        if (!response.ok) throw Error()
        return (await response.json()) as Analysis
      })
      .then((value) => {
        if (!controller.signal.aborted) setLoaded(value)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [id, revision, suppliedAnalysis])
  const swim = /swim/i.test(workout.sport),
    bike = /bike|ride|cycl/i.test(workout.sport)
  const splitDistance = swim ? METERS_PER_100_YARDS : bike ? 8046.72 : 1609.344
  const splits = useMemo<DistanceSplit[]>(
    () =>
      swim
        ? swimSplits(analysis || {}).map((split) => ({
            ...split,
            heartRate: null,
            elevation: null,
          }))
        : distanceSplits(analysis?.points || [], splitDistance),
    [analysis, splitDistance, swim]
  )
  const routePoints = useMemo(
    () =>
      (analysis?.points || []).flatMap((point) =>
        point.latitude != null && point.longitude != null
          ? [
              {
                time: point.time,
                latitude: point.latitude,
                longitude: point.longitude,
              },
            ]
          : []
      ),
    [analysis]
  )
  const showPower = bike && splits.some((split) => split.power != null)
  if (!id) return null
  const subtitle = bike
    ? "5 miles per split"
    : swim
      ? "100 yards per split"
      : "1 mile per split"
  const empty = (
    <p className="py-4 text-xs text-muted-foreground">
      {analysis
        ? "Split data is not available for this recording."
        : "Loading splits…"}
    </p>
  )
  if (mobile) {
    const speed = (split: DistanceSplit) =>
      bike ? splitMph(split) : -split.pace
    const fastest = Math.max(...splits.map(speed)),
      slowest = Math.min(...splits.map(speed))
    return (
      <section
        aria-label="Workout splits"
        className="w-full min-w-0 border-t py-5"
      >
        <h2 className="mb-5 text-xl font-bold">Splits</h2>
        {splits.length ? (
          <table className="w-full table-fixed text-xs tabular-nums">
            <caption className="sr-only">
              {subtitle}. {bike ? "Speed in mph" : "Pace"},{" "}
              {swim
                ? ""
                : "net elevation in feet and average heart rate in bpm"}
              {showPower ? ", average power in watts" : ""}.
            </caption>
            <colgroup>
              <col className="w-8" />
              <col className="w-12" />
              <col />
              {!swim && (
                <>
                  <col className="w-10" />
                  <col className="w-8" />
                </>
              )}
              {showPower && <col className="w-10" />}
            </colgroup>
            <thead>
              <tr className="border-b text-muted-foreground">
                <th scope="col" className="pb-3 text-left font-normal">
                  {swim ? "Yd" : "Mi"}
                </th>
                <th scope="col" className="pb-3 text-left font-normal">
                  {bike ? "mph" : "Pace"}
                </th>
                <th scope="col">
                  <span className="sr-only">
                    Relative {bike ? "speed" : "pace"}
                  </span>
                </th>
                {!swim && (
                  <>
                    <th scope="col" className="pb-3 text-right font-normal">
                      Elev
                    </th>
                    <th scope="col" className="pb-3 text-right font-normal">
                      HR
                    </th>
                  </>
                )}
                {showPower && (
                  <th scope="col" className="pb-3 text-right font-normal">
                    W
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {splits.map((split) => (
                <tr key={split.number}>
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {split.distance < splitDistance - 0.5
                      ? swim
                        ? Math.round(
                            (split.distance / METERS_PER_100_YARDS) * 100
                          )
                        : Number((split.distance / 1609.344).toFixed(2))
                      : swim
                        ? split.number * 100
                        : split.number * (bike ? 5 : 1)}
                  </th>
                  <td className="py-1.5">
                    {split.estimated ? "~" : ""}
                    {bike
                      ? splitMph(split).toFixed(1)
                      : formatSignalClock(split.pace)}
                  </td>
                  <td className="py-1.5 pr-1">
                    <div
                      aria-hidden="true"
                      className="h-5 rounded bg-[#0875d1]"
                      style={{
                        width: `${slowest === fastest ? 100 : 25 + (75 * (speed(split) - slowest)) / (fastest - slowest)}%`,
                      }}
                    />
                  </td>
                  {!swim && (
                    <>
                      <td className="py-1.5 text-right">
                        {split.elevation == null
                          ? "—"
                          : Math.round(split.elevation / 0.3048)}
                      </td>
                      <td className="py-1.5 text-right">
                        {split.heartRate == null
                          ? "—"
                          : Math.round(split.heartRate)}
                      </td>
                    </>
                  )}
                  {showPower && (
                    <td className="py-1.5 text-right">
                      {split.power == null ? "—" : Math.round(split.power)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          empty
        )}
      </section>
    )
  }
  return (
    <section
      aria-label="Workout splits and route"
      className="overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <div
        className={`grid ${swim ? "" : "md:grid-cols-[280px_minmax(0,1fr)]"}`}
      >
        <div className={swim ? "" : "border-b md:border-r md:border-b-0"}>
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Splits</h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {subtitle}
            </p>
          </div>
          {splits.length ? (
            <div className="max-h-[320px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b">
                    <th className="px-4 py-2 text-left font-medium">Split</th>
                    <th className="px-4 py-2 text-right font-medium">
                      {bike ? "Speed" : "Pace"}
                    </th>
                    {showPower && (
                      <th className="px-4 py-2 text-right font-medium">
                        Power
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {splits.map((split) => (
                    <tr key={split.number} className="border-b last:border-b-0">
                      <td className="px-4 py-2.5 tabular-nums">
                        {split.number}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {split.estimated ? "~" : ""}
                        {bike
                          ? `${splitMph(split).toFixed(1)} mph`
                          : `${formatSignalClock(split.pace)} /${swim ? "100 yd" : "mi"}`}
                      </td>
                      {showPower && (
                        <td className="px-4 py-2.5 text-right">
                          {split.power != null
                            ? `${Math.round(split.power)} W`
                            : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4">{empty}</div>
          )}
        </div>
        {!swim && (
          <div className="hidden min-w-0 md:block">
            <DesktopWorkoutRouteMap
              workout={workout}
              timedPoints={routePoints}
            />
          </div>
        )}
      </div>
    </section>
  )
}
