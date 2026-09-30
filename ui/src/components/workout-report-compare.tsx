import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import { ArrowLeft, ExternalLink, RotateCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { apiFetch } from "@/lib/api-client"
import { formatPace } from "@/lib/duration"
import { metric, type ReportWorkout } from "@/lib/workout-reports-model"
import type { RecordedPoint } from "@/lib/segment-statistics"
import type { WorkoutComparisonStats, WorkoutRecordedAnalysis } from "@/components/workout-analysis"

const WorkoutAnalysis = lazy(() => import("@/components/workout-analysis").then((module) => ({ default: module.WorkoutAnalysis })))
const cache = new Map<string, WorkoutRecordedAnalysis>()
const sampleCache = new Map<string, WorkoutRecordedAnalysis>()
const localPreview = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)
const number = (value: number, digits = 0) => value.toLocaleString("en-US", { maximumFractionDigits: digits })
const durationLabel = (seconds: number) => {
  const value = Math.max(0, Math.round(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const remainder = value % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`
}
const activityId = (workout: ReportWorkout) =>
  workout.activity_id || (workout.id.startsWith("activity:") ? workout.id.slice(9) : null)
const revision = (workout: ReportWorkout) =>
  (workout as ReportWorkout & { activity_revision?: string }).activity_revision || ""

// Only the local preview substitutes example signals. Real summaries stay untouched.
function sampleAnalysis(workout: ReportWorkout, index: number): WorkoutRecordedAnalysis {
  const sampleKey = [workout.id, revision(workout), ...["duration_seconds", "average_speed", "average_hr", "average_power", "average_cadence"].map((key) => metric(workout, key))].join(":")
  const cached = sampleCache.get(sampleKey)
  if (cached) return cached
  const swim = /swim/i.test(workout.sport)
  const run = /run/i.test(workout.sport)
  const duration = Math.max(900, metric(workout, "duration_seconds") || 3600)
  const speed = metric(workout, "average_speed") || (swim ? 1.05 : run ? 3.1 : 7.5)
  const heartRate = metric(workout, "average_hr") || (swim ? 138 : 151)
  const power = metric(workout, "average_power") || (swim ? 170 : run ? 245 : 205)
  const cadence = metric(workout, "average_cadence") || (swim ? 29 : run ? 170 : 82)
  const seed = [...workout.id].reduce((sum, char) => sum + char.charCodeAt(0), index * 17)
  let distance = 0
  const points: RecordedPoint[] = Array.from({ length: 181 }, (_, position) => {
    const time = duration * position / 180
    const phase = position / 180
    const variation = Math.sin(phase * Math.PI * 8 + seed) * 0.045 + Math.sin(phase * Math.PI * 23 + seed * 0.3) * 0.018
    const interval = Math.sin(phase * Math.PI * 5 + seed * 0.1) * 0.055
    const currentSpeed = Math.max(0.2, speed * (1 + variation + interval))
    if (position) distance += currentSpeed * duration / 180
    return {
      time,
      speed: currentSpeed,
      heartRate: Math.round(heartRate + 7 * Math.sin(phase * Math.PI * 5 + seed * 0.1) + 4 * phase),
      power: Math.round(power * (1 + variation * 2 + interval * 1.5)),
      cadence: Math.round(cadence + Math.sin(phase * Math.PI * 9 + seed) * (swim ? 2 : 5)),
      elevation: swim ? null : 85 + 22 * Math.sin(phase * Math.PI * 3 + seed * 0.02),
      distance,
    }
  })
  const analysis = { duration, points, laps: [], intervals: [] }
  sampleCache.set(sampleKey, analysis)
  if (sampleCache.size > 24) sampleCache.delete(sampleCache.keys().next().value!)
  return analysis
}

export function WorkoutReportCompare({ workouts, onBack, onWorkoutOpen }: {
  workouts: ReportWorkout[]
  onBack: () => void
  onWorkoutOpen: (workout: ReportWorkout) => void
}) {
  const [analyses, setAnalyses] = useState<Record<string, WorkoutRecordedAnalysis>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [highlights, setHighlights] = useState<Record<string, WorkoutComparisonStats | null>>({})
  const onComparisonStats = useCallback((id: string, stats: WorkoutComparisonStats | null) => {
    setHighlights((current) => ({ ...current, [id]: stats }))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let pending = workouts.length
    const finished = () => {
      pending -= 1
      if (!controller.signal.aborted && pending === 0) setLoading(false)
    }
    for (const workout of workouts) {
      const id = activityId(workout)
      if (!id) {
        setErrors((current) => ({ ...current, [workout.id]: "No recorded stream is available." }))
        finished()
        continue
      }
      const key = `${id}${revision(workout)}:analysis-8`
      const cached = cache.get(key)
      if (cached) {
        setAnalyses((current) => ({ ...current, [workout.id]: cached }))
        finished()
        continue
      }
      void apiFetch(`/api/activities/${encodeURIComponent(id)}/analysis?schema=8&v=${encodeURIComponent(revision(workout))}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            const result = await response.json().catch(() => null) as { error?: string } | null
            throw Error(result?.error || "The recording could not be loaded.")
          }
          return await response.json() as WorkoutRecordedAnalysis
        })
        .then((analysis) => {
          cache.set(key, analysis)
          if (cache.size > 24) cache.delete(cache.keys().next().value!)
          if (!controller.signal.aborted) setAnalyses((current) => ({ ...current, [workout.id]: analysis }))
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setErrors((current) => ({
            ...current, [workout.id]: reason instanceof Error ? reason.message : "The recording could not be loaded.",
          }))
        })
        .finally(finished)
    }
    return () => controller.abort()
  }, [workouts, retry])

  const entries = workouts.map((workout, index) => ({
    workout,
    analysis: analyses[workout.id] || (localPreview && errors[workout.id] ? sampleAnalysis(workout, index) : null),
    sample: !analyses[workout.id] && localPreview && Boolean(errors[workout.id]),
  }))
  const hasSamples = entries.some((entry) => entry.sample)
  const hasRecording = entries.some((entry) => entry.analysis?.points.length)
  const retryRecordings = () => { setErrors({}); setLoading(true); setRetry((value) => value + 1) }

  return <section className="min-w-0 flex-1 bg-background px-6 py-6 md:px-8 md:py-4" aria-label="Compare workouts">
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <Button variant="ghost" className="-ml-3 mb-4 gap-2" onClick={onBack}><ArrowLeft /> Back to reports</Button>
        <h1 className="text-2xl font-semibold tracking-tight">Compare workouts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Drag across a graph to highlight and zoom into a range. Click to reset.</p>
      </header>

      {hasSamples && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <p><strong>Preview data</strong> · Example traces are shown where recordings could not be loaded. Workout summaries are unchanged.</p>
        <Button variant="outline" size="sm" onClick={retryRecordings}><RotateCw /> Retry recordings</Button>
      </div>}
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading recordings…</p>}
      {!loading && !hasSamples && Object.keys(errors).length > 0 && <Button variant="outline" onClick={retryRecordings}><RotateCw /> Retry recordings</Button>}

      {hasRecording && <Card className="min-w-0 gap-0 py-0" aria-label="Selected workout graphs">
        {entries.filter((entry) => entry.analysis?.points.length).map(({ workout, analysis, sample }) => {
          const distance = metric(workout, "distance_meters")
          const moving = metric(workout, "duration_seconds")
          const swim = /swim/i.test(workout.sport)
          const run = /run/i.test(workout.sport)
          const highlight = highlights[workout.id]
          return <section key={workout.id} className="grid min-w-0 border-b last:border-b-0 lg:h-[250px] lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="min-w-0 py-1 lg:border-r">
              <Suspense fallback={<p className="py-12 text-center text-sm text-muted-foreground">Loading workout graph…</p>}>
                <WorkoutAnalysis workout={workout} analysisOverride={analysis!} comparisonMode onComparisonStats={onComparisonStats} />
              </Suspense>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 border-t p-2.5 lg:min-h-0 lg:overflow-y-auto lg:border-t-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{workout.sport} · {workout.workout_date}</p>
                  <h2 className="mt-0.5 text-sm font-semibold leading-snug">{workout.title || "Workout"}</h2>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Open ${workout.title || "workout"} details`} onClick={() => onWorkoutOpen(workout)}><ExternalLink /></Button>
              </div>
              <section className="border-t pt-2" aria-label={`Current range statistics for ${workout.title || "workout"}`}>
                <h3 className="text-[11px] font-medium">{highlight?.selected ? `Highlighted · ${durationLabel(highlight.start)}–${durationLabel(highlight.end)}` : "Workout stats"}</h3>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-2 text-[11px] leading-tight tabular-nums">
                  <div className="min-w-0"><dt className="text-muted-foreground">Moving time</dt><dd className="mt-0.5 font-medium">{highlight?.selected ? durationLabel(highlight.end - highlight.start) : moving == null ? "—" : durationLabel(moving)}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground">Distance</dt><dd className="mt-0.5 font-medium">{highlight?.selected ? highlight.distance == null ? "—" : swim ? `${number(highlight.distance / 0.9144)} yd` : `${number(highlight.distance / 1609.344, 2)} mi` : distance == null ? "—" : swim ? `${number(distance / 0.9144)} yd` : `${number(distance / 1609.344, 2)} mi`}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground">{swim || run ? "Avg pace" : "Avg speed"}</dt><dd className="mt-0.5 font-medium">{highlight?.speed != null && highlight.speed > 0 ? swim || run ? `${formatPace((swim ? 91.44 : 1609.344) / highlight.speed)} ${swim ? "/100 yd" : "/mi"}` : `${number(highlight.speed * 2.236936, 1)} mph` : "—"}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground">Avg power</dt><dd className="mt-0.5 font-medium">{highlight?.power == null ? "—" : `${number(highlight.power)} W`}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground">Avg heart rate</dt><dd className="mt-0.5 font-medium">{highlight?.heartRate == null ? "—" : `${number(highlight.heartRate)} bpm`}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground">Avg cadence</dt><dd className="mt-0.5 font-medium">{highlight?.cadence == null ? "—" : `${number(highlight.cadence)} ${swim ? "strokes/min" : run ? "spm" : "rpm"}`}</dd></div>
                </dl>
              </section>
              {sample && <Badge variant="secondary">Sample trace</Badge>}
            </div>
          </section>
        })}
      </Card>}
      {!loading && !hasRecording && <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No recorded streams are available for these workouts.</CardContent></Card>}
    </div>
  </section>
}
