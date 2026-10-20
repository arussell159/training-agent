import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  Clipboard,
  EllipsisVertical,
  GripVertical,
  Layers,
  LineChart,
  MessageSquare,
  Plus,
  Settings2,
  X,
  Expand,
  ArrowUp,
  ArrowDown,
  Map,
  Table2,
  BarChart3,
} from "lucide-react"
import {
  cachedActivityAnalysis,
  cachedActivitySummary,
  loadActivityAnalysis,
  loadActivitySummary,
} from "@/lib/activity-analysis"
import {
  cachedTrainingContext,
  type PlannedWorkout,
  type WorkoutSummaryValues,
} from "@/lib/training-context"
import { deviceCacheScope } from "@/lib/device-cache"
import {
  createRouteCursorIndex,
  nearestRouteCursorPoint,
} from "@/lib/route-cursor"
import {
  recordedSignalInfo,
  recordedSignalStatistics,
  type RecordedSignal,
} from "@/lib/analysis-360-signals"
import {
  analysisRangeMetrics,
  defaultAnalysisTiles,
  validAnalysisTiles,
  type AnalysisTile,
  type AnalysisRange,
  type AnalysisLap,
} from "@/lib/analysis-360"
import {
  sportZoneSettings,
  type SportZoneSettings,
} from "../../../app-backend/lib/workout-editor-zones.mjs"
import { DesktopSportIcon } from "./desktop-sport-icon"
import { DesktopWorkoutRouteMap } from "./desktop-workout-route-map"
import {
  Analysis360SignalChart,
  Analysis360Zones,
  analysisClock,
  type ZoneConfiguration,
} from "./analysis-360-charts"
import { Analysis360Laps } from "./analysis-360-laps"
import { Analysis360Power } from "./analysis-360-power"
import type { WorkoutRecordedAnalysis } from "./workout-analysis"
import {
  Analysis360ChartsSkeleton,
  Analysis360SummarySkeleton,
} from "./workout-analysis-skeleton"
import "./workout-analysis-360.css"

const n = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", { maximumFractionDigits: digits })
const numeric = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null
const tileNames: Record<AnalysisTile["kind"], string> = {
  single: "Single Channel Chart",
  multi: "Multi-Channel Chart",
  stacked: "Stacked Channel Chart",
  zones: "Time in Zones",
  map: "Map",
  laps: "Lap Grid",
}

function SummaryPanel({
  workout,
  summary,
  analysis,
  ftp,
}: {
  workout: PlannedWorkout
  summary: WorkoutSummaryValues | null
  analysis: WorkoutRecordedAnalysis | null
  ftp: number | null
}) {
  const metrics = useMemo(
    () =>
      analysis
        ? analysisRangeMetrics(analysis.points, 0, analysis.duration, ftp)
        : null,
    [analysis, ftp]
  )
  const total = summary || workout.workout_summary?.completed
  const duration = total?.duration_seconds ?? analysis?.duration
  const swim = /swim/i.test(workout.sport)
  const np = total?.normalized_power ?? metrics?.normalizedPower,
    power = total?.average_power ?? metrics?.power,
    hr = total?.average_hr ?? metrics?.heartRate
  const context = cachedTrainingContext(),
    day = workout.workout_date || "",
    date = new Date(`${day}T12:00:00Z`)
  const prior = new Date(date)
  prior.setUTCDate(prior.getUTCDate() - 1)
  const previousDay = Number.isFinite(prior.getTime())
    ? prior.toISOString().slice(0, 10)
    : ""
  const wellness = (value: string) =>
    context.wellness_history?.find((row) => (row.date || row.id) === value)
  const before = wellness(previousDay),
    after = wellness(day)
  const current = day === new Date().toLocaleDateString("en-CA")
  const fitness =
      numeric(after?.ctl) ??
      (current ? numeric(context.metrics.fitness) : null),
    fatigue =
      numeric(after?.atl) ?? (current ? numeric(context.metrics.fatigue) : null)
  const form =
    numeric(after?.tsb) ??
    (fitness != null && fatigue != null ? fitness - fatigue : null)
  const details = [
    ["Work", total?.work_kj ?? metrics?.work, "kJ", 0],
    ["NP", np, "W", 0],
    ["VI", np != null && power && power > 0 ? np / power : null, "", 2],
    ["W/kg", null, "W", 1],
    ["Avg heart rate", hr, "bpm", 0],
    ["Pw:Hr", null, "%", 2],
    ["EF", np != null && hr && hr > 0 ? np / hr : null, "", 2],
    [
      "El. Gain",
      (total?.elevation_gain ?? metrics?.gain) == null
        ? null
        : (total?.elevation_gain ?? metrics?.gain)! / 0.3048,
      "ft",
      0,
    ],
    [
      "El. Loss",
      (total?.elevation_loss ?? metrics?.loss) == null
        ? null
        : (total?.elevation_loss ?? metrics?.loss)! / 0.3048,
      "ft",
      0,
    ],
    [
      "VAM",
      metrics?.gain != null && duration
        ? (metrics.gain / duration) * 3600
        : null,
      "m/h",
      0,
    ],
    ["Grade", metrics?.grade, "%", 1],
    ["VAM W/kg", null, "", 1],
    ["IF", total?.intensity_factor ?? metrics?.intensity, "", 2],
  ] as const
  const metric = (label: string, value: string, unit = "") => (
    <div key={label}>
      <dt>{label}</dt>
      <dd>
        {value}
        <small>{unit && ` ${unit}`}</small>
      </dd>
    </div>
  )
  return (
    <aside className="a360-summary" aria-label="Workout summary">
      <h2>Summary</h2>
      <section>
        <h3>Workout Stats</h3>
        <dl className="a360-summary-grid">
          {metric("Duration", duration == null ? "—" : analysisClock(duration))}
          {metric(
            "Distance",
            n(
              (total?.distance_meters ?? metrics?.distance) == null
                ? null
                : (total?.distance_meters ?? metrics?.distance)! /
                    (swim ? 0.9144 : 1609.344),
              swim ? 0 : 2
            ),
            swim ? "yds" : "mi"
          )}
          {metric("TSS", n(total?.tss ?? workout.load))}
        </dl>
        <h4>
          Time{" "}
          <span title="Elapsed time includes pauses. Moving time uses recorded speed, where available.">
            ⓘ
          </span>
        </h4>
        <dl className="a360-summary-grid">
          {metric(
            "Elapsed time",
            total?.elapsed_time_seconds == null
              ? duration == null
                ? "—"
                : analysisClock(duration)
              : analysisClock(total.elapsed_time_seconds)
          )}
          {metric(
            "Moving time",
            metrics?.moving == null ? "—" : analysisClock(metrics.moving)
          )}
          {metric(
            "Idle Time",
            metrics?.moving == null || duration == null
              ? "—"
              : analysisClock(Math.max(0, duration - metrics.moving))
          )}
        </dl>
        <h4>Additional Metrics</h4>
        <dl className="a360-summary-grid a360-additional-metrics">
          {details.map(([label, value, unit, digits]) =>
            metric(label, n(value, digits), unit)
          )}
        </dl>
      </section>
      <section className="a360-performance">
        <h3>Performance Metrics</h3>
        <p>How this workout impacted fitness and fatigue.</p>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Before</th>
              <th>Change</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Fitness", numeric(before?.ctl), fitness],
                ["Fatigue", numeric(before?.atl), fatigue],
              ] as const
            ).map(([label, beforeValue, afterValue]) => (
              <tr key={label} data-metric={label.toLowerCase()}>
                <th>{label}:</th>
                <td>{n(beforeValue)}</td>
                <td>
                  {n(
                    beforeValue != null && afterValue != null
                      ? afterValue - beforeValue
                      : null
                  )}
                </td>
                <td>{n(afterValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="a360-form">
          <strong>
            Today’s Form: <span>{n(form)}</span>
          </strong>
          <b>{form == null ? "—" : form > 0 ? "Recharging" : "Overloading"}</b>
          <div className="a360-form-scale">
            <i
              style={{
                left: `${Math.min(96, Math.max(4, 50 + (form ?? 0)))}%`,
              }}
            />
          </div>
          <div>
            <span>Overloading</span>
            <span>Recharging</span>
          </div>
        </div>
      </section>
    </aside>
  )
}

export function WorkoutAnalysis360({
  workout,
  onSummary,
  onClassicAnalyze,
  onClose,
  onCommentsTarget,
  busy = false,
}: {
  workout: PlannedWorkout
  onSummary: () => void
  onClassicAnalyze: () => void
  onClose: () => void
  onCommentsTarget: (target: HTMLDivElement | null) => void
  busy?: boolean
}) {
  const id =
    workout.activity_id ||
    (workout.id.startsWith("activity:") ? workout.id.slice(9) : null)
  const revision =
    (workout as PlannedWorkout & { activity_revision?: string })
      .activity_revision || ""
  const [data, setData] = useState<WorkoutRecordedAnalysis | null>(() =>
    id ? cachedActivityAnalysis(id, revision) || null : null
  )
  const [summary, setSummary] = useState<WorkoutSummaryValues | null>(() =>
    id
      ? cachedActivitySummary(id, revision) ||
        workout.workout_summary?.completed ||
        null
      : null
  )
  const [error, setError] = useState(""),
    [retry, setRetry] = useState(0)
  const [tab, setTab] = useState<"Analyze" | "Power" | "Lap Comparison">(
      "Analyze"
    ),
    [visitedPower, setVisitedPower] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(true),
    [side, setSide] = useState<"Comments" | "Library" | null>(null)
  const [tiles, setTiles] = useState<AnalysisTile[]>([]),
    [loadedKey, setLoadedKey] = useState("")
  const [settingsId, setSettingsId] = useState<string | null>(null),
    [moveId, setMoveId] = useState<string | null>(null),
    [removed, setRemoved] = useState<{
      tile: AnalysisTile
      index: number
    } | null>(null)
  const [selection, setSelection] = useState<AnalysisRange | null>(null),
    [zoom, setZoom] = useState<AnalysisRange | null>(null),
    [cursor, setCursor] = useState<number | null>(null),
    [selectedLaps, setSelectedLaps] = useState<string[]>([])
  const dragTile = useRef<string | null>(null),
    cursorFrame = useRef(0),
    nextCursor = useRef<number | null>(null)
  const resizeDrag = useRef<{ id: string; y: number; height: number } | null>(
    null
  )
  const resized = useRef(false)
  useEffect(() => {
    if (!id) {
      setError("This workout has no recorded activity.")
      return
    }
    const controller = new AbortController()
    setError("")
    void loadActivityAnalysis(id, revision, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value)
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "The recording could not be loaded."
          )
      })
    void loadActivitySummary(id, revision, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSummary(value)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [id, revision, retry])
  const duration = data?.duration || 1,
    range: AnalysisRange = zoom || [0, duration]
  const available = useMemo(
    () =>
      data
        ? recordedSignalStatistics(
            data.points,
            0,
            data.duration,
            workout.sport
          ).map((row) => row.key)
        : [],
    [data, workout.sport]
  )
  const availableKey = available.join(","),
    layoutKey = `analysis-360-layout-v1:${deviceCacheScope()}:${workout.sport}`
  useEffect(() => {
    if (!data) return
    let saved: AnalysisTile[] | null = null
    try {
      saved = validAnalysisTiles(
        JSON.parse(localStorage.getItem(layoutKey) || "null"),
        available
      )
    } catch {
      /* A bad or inaccessible local preference falls back to the default workspace. */
    }
    setTiles(saved ?? defaultAnalysisTiles(available))
    setLoadedKey(layoutKey)
    // The channel signature controls the stored layout validation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, layoutKey, availableKey])
  useEffect(() => {
    if (loadedKey !== layoutKey) return
    try {
      localStorage.setItem(layoutKey, JSON.stringify(tiles))
    } catch {
      /* Chart editing remains usable when browser storage is unavailable. */
    }
  }, [tiles, layoutKey, loadedKey])
  useEffect(() => () => cancelAnimationFrame(cursorFrame.current), [])
  const moveCursor = useCallback((time: number | null) => {
    nextCursor.current = time
    if (cursorFrame.current) return
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = 0
      setCursor(nextCursor.current)
    })
  }, [])
  const points = data?.points || []
  const nearest = useMemo(() => {
    if (cursor == null || !data?.points.length) return null
    let left = 0,
      right = data.points.length - 1
    while (left < right) {
      const middle = Math.floor((left + right) / 2)
      if (data.points[middle].time < cursor) left = middle + 1
      else right = middle
    }
    const point = data.points[left],
      previous = data.points[Math.max(0, left - 1)]
    return Math.abs(previous.time - cursor) < Math.abs(point.time - cursor)
      ? previous
      : point
  }, [cursor, data])
  const route = useMemo(
      () => createRouteCursorIndex(data?.points || []),
      [data]
    ),
    routeCursor = nearestRouteCursorPoint(route, cursor)
  const context = cachedTrainingContext(),
    zoneSettings = sportZoneSettings(
      (context.athlete as { sport_settings?: SportZoneSettings[] })
        .sport_settings || [],
      workout.sport
    )
  const ftp =
    zoneSettings?.ftp ??
    (/bike|ride|cycl/i.test(workout.sport)
      ? context.athlete.zones?.bike_ftp
      : null) ??
    null
  const zoneConfiguration = useMemo<ZoneConfiguration>(
    () =>
      zoneSettings?.power_zones?.length && ftp
        ? { key: "power", threshold: ftp, boundaries: zoneSettings.power_zones }
        : zoneSettings?.pace_zones?.length && zoneSettings.threshold_pace
          ? {
              key: "speed",
              threshold: zoneSettings.threshold_pace,
              boundaries: zoneSettings.pace_zones,
            }
          : null,
    [zoneSettings, ftp]
  )
  const laps = useMemo<AnalysisLap[]>(
    () =>
      data
        ? [
            ...data.laps.map((lap) => ({
              id: `device:${lap.id}`,
              label: lap.label,
              start: lap.start,
              end: lap.end,
              source: "Device" as const,
            })),
            ...data.intervals
              .filter((interval) => interval.end > interval.start)
              .map((interval) => ({
                id: `interval:${interval.id}`,
                label: interval.label,
                start: interval.start,
                end: interval.end,
                source: "Detected Interval" as const,
              })),
          ]
            .filter(
              (lap) =>
                lap.end > lap.start &&
                lap.start >= 0 &&
                lap.end <= data.duration
            )
            .sort((a, b) => a.start - b.start)
        : [],
    [data]
  )
  const toggleLap = (id: string) =>
    setSelectedLaps((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    )
  const update = (tile: AnalysisTile) =>
    setTiles((current) =>
      current.map((item) => (item.id === tile.id ? tile : item))
    )
  const setting = tiles.find((tile) => tile.id === settingsId)
  const addTile = (kind: AnalysisTile["kind"], preset = false) => {
    const primary = available.includes("power")
      ? "power"
      : available.includes("pace")
        ? "pace"
        : available[0]
    const channels =
      kind === "multi" || kind === "stacked"
        ? available.filter((key) =>
            [primary, "speed", "heartRate", "elevation"].includes(key)
          )
        : primary
          ? [primary]
          : []
    const tile: AnalysisTile = {
      id: crypto.randomUUID(),
      kind,
      name: preset
        ? "Ride Profile"
        : kind === "single"
          ? recordedSignalInfo(primary, workout.sport).label
          : tileNames[kind].replace(" Chart", ""),
      channels,
      axis: "time",
      zones: true,
      height:
        kind === "stacked"
          ? 480
          : kind === "map" || kind === "laps"
            ? 320
            : 160,
    }
    setTiles((current) => [...current, tile])
    setSettingsId(tile.id)
  }
  const moveTile = (id: string, destination: number) =>
    setTiles((current) => {
      const next = [...current],
        index = next.findIndex((tile) => tile.id === id)
      if (index < 0) return current
      const [item] = next.splice(index, 1)
      next.splice(Math.max(0, Math.min(next.length, destination)), 0, item)
      return next
    })
  const addPreset = (name: string, channels: RecordedSignal[]) => {
    const tile: AnalysisTile = {
      id: crypto.randomUUID(),
      kind: "multi",
      name,
      channels,
      axis: "time",
      zones: true,
      height: 160,
    }
    setTiles((current) => [...current, tile])
    setSettingsId(tile.id)
  }
  const chooseTab = (value: typeof tab) => {
    setTab(value)
    if (value === "Power") setVisitedPower(true)
  }
  const chooseRange = (value: AnalysisRange | null) => {
    setSelection(value)
    setCursor(null)
  }
  const canZoom =
    selection && (!zoom || selection[0] !== zoom[0] || selection[1] !== zoom[1])
  const day = workout.workout_date
    ? new Date(`${workout.workout_date}T12:00:00Z`).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
      )
    : workout.date
  return (
    <main className="analysis360" aria-label="Analyze 360 workspace">
      <header className="a360-header">
        <DesktopSportIcon sport={workout.sport} />
        <strong>
          {/bike|ride|cycl/i.test(workout.sport) ? "Bike" : workout.sport}
        </strong>
        <span>{day}</span>
        <span className="a360-header-spacer" />
        <details className="a360-main-menu">
          <summary aria-label="Analyze 360 options">
            <EllipsisVertical size={18} />
          </summary>
          <div>
            <button type="button" onClick={onSummary}>
              Workout Summary
            </button>
            <button type="button" onClick={onClassicAnalyze}>
              Analyze
            </button>
            <button
              type="button"
              onClick={() => setTiles(defaultAnalysisTiles(available))}
            >
              Reset chart layout
            </button>
          </div>
        </details>
        <button
          type="button"
          disabled={busy}
          aria-label="Close Analyze 360"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div
        className={`a360-layout ${summaryOpen ? "" : "a360-summary-collapsed"} ${side ? "a360-side-open" : ""}`}
      >
        <nav className="a360-left-rail" aria-label="Analysis navigation">
          <button
            type="button"
            aria-label="Toggle workout summary"
            aria-pressed={summaryOpen}
            onClick={() => setSummaryOpen((value) => !value)}
          >
            <Clipboard size={18} />
            <span>Summary</span>
          </button>
        </nav>
        {summaryOpen && !data && !error ? (
          <Analysis360SummarySkeleton />
        ) : (
          summaryOpen && (
            <SummaryPanel
              workout={workout}
              summary={summary}
              analysis={data}
              ftp={ftp}
            />
          )
        )}
        <section className="a360-main">
          <div
            className="a360-tabs"
            role="tablist"
            aria-label="Analyze 360 views"
          >
            {(["Analyze", "Power", "Lap Comparison"] as const).map((value) => (
              <button
                key={value}
                role="tab"
                type="button"
                id={`a360-tab-${value.replaceAll(" ", "-")}`}
                aria-selected={tab === value}
                aria-controls={`a360-panel-${value.replaceAll(" ", "-")}`}
                onClick={() => chooseTab(value)}
              >
                {value}
              </button>
            ))}
          </div>
          {(!data || loadedKey !== layoutKey) && !error && (
            <Analysis360ChartsSkeleton />
          )}
          {!data && error && (
            <div className="a360-empty" role="alert">
              {error}
              {error && (
                <button
                  type="button"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {data && loadedKey === layoutKey && (
            <>
              <div
                className="a360-scroll a360-chart-workspace"
                role="tabpanel"
                aria-labelledby="a360-tab-Analyze"
                id="a360-panel-Analyze"
                hidden={tab !== "Analyze"}
              >
                {removed && (
                  <div className="a360-data-status" role="status">
                    {removed.tile.name} removed.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setTiles((current) => {
                          const next = [...current]
                          next.splice(removed.index, 0, removed.tile)
                          return next
                        })
                        setRemoved(null)
                      }}
                    >
                      Undo
                    </button>
                  </div>
                )}
                {tiles.map((tile, index) => (
                  <section
                    className={`a360-tile ${setting?.id === tile.id ? "a360-tile-selected" : ""}`}
                    key={tile.id}
                    aria-label={`${tile.name} card`}
                    style={{ minHeight: tile.height }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (dragTile.current) moveTile(dragTile.current, index)
                      dragTile.current = null
                    }}
                  >
                    <header>
                      <span>
                        {tile.kind === "stacked" ? (
                          <Layers size={15} />
                        ) : tile.kind === "map" ? (
                          <Map size={15} />
                        ) : tile.kind === "laps" ? (
                          <Table2 size={15} />
                        ) : tile.kind === "zones" ? (
                          <BarChart3 size={15} />
                        ) : (
                          <LineChart size={15} />
                        )}
                      </span>
                      <strong>{tile.name}</strong>
                      <div className="a360-tile-move">
                        <button
                          type="button"
                          draggable
                          aria-label={`Move ${tile.name} card`}
                          onDragStart={(event) => {
                            dragTile.current = tile.id
                            event.dataTransfer.setData("text/plain", tile.id)
                          }}
                          onDragEnd={() => {
                            dragTile.current = null
                          }}
                          onClick={() =>
                            setMoveId((value) =>
                              value === tile.id ? null : tile.id
                            )
                          }
                        >
                          <GripVertical size={15} />
                        </button>
                        {moveId === tile.id && (
                          <div>
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => {
                                moveTile(tile.id, index - 1)
                                setMoveId(null)
                              }}
                            >
                              <ArrowUp size={14} />
                              Move up
                            </button>
                            <button
                              type="button"
                              disabled={index === tiles.length - 1}
                              onClick={() => {
                                moveTile(tile.id, index + 1)
                                setMoveId(null)
                              }}
                            >
                              <ArrowDown size={14} />
                              Move down
                            </button>
                          </div>
                        )}
                      </div>
                      <span className="a360-header-spacer" />
                      <button
                        type="button"
                        aria-label={`Settings for ${tile.name}`}
                        onClick={() => {
                          setSettingsId(tile.id)
                          setSide("Library")
                        }}
                      >
                        <Settings2 size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${tile.name} card`}
                        onClick={() => {
                          setRemoved({ tile, index })
                          setTiles((current) =>
                            current.filter((item) => item.id !== tile.id)
                          )
                          if (settingsId === tile.id) setSettingsId(null)
                        }}
                      >
                        <X size={15} />
                      </button>
                    </header>
                    {tile.kind === "map" ? (
                      <div
                        className="a360-map"
                        style={{ height: tile.height - 32 }}
                      >
                        <DesktopWorkoutRouteMap
                          workout={workout}
                          timedPoints={route}
                          highlightRange={selection}
                          cursorPoint={routeCursor}
                          onCursorTimeChange={moveCursor}
                          compact
                        />
                      </div>
                    ) : tile.kind === "laps" ? (
                      <Analysis360Laps
                        sport={workout.sport}
                        laps={laps}
                        points={points}
                        ftp={ftp}
                        selected={selectedLaps}
                        onToggle={toggleLap}
                        onSelect={chooseRange}
                        onCompare={() => chooseTab("Lap Comparison")}
                      />
                    ) : tile.kind === "zones" ? (
                      <Analysis360Zones
                        points={points}
                        configuration={zoneConfiguration}
                        range={range}
                      />
                    ) : (
                      <Analysis360SignalChart
                        points={points}
                        sport={workout.sport}
                        duration={duration}
                        tile={tile}
                        range={range}
                        selection={selection}
                        cursor={cursor}
                        cursorPoint={nearest}
                        onCursor={moveCursor}
                        onSelect={chooseRange}
                        zoneConfiguration={zoneConfiguration}
                      />
                    )}
                    <button
                      className="a360-resize"
                      type="button"
                      aria-label={`Resize ${tile.name} card`}
                      title="Increase chart height; resets after the largest size"
                      onPointerDown={(event) => {
                        if (event.button !== 0) return
                        event.preventDefault()
                        resized.current = false
                        resizeDrag.current = {
                          id: tile.id,
                          y: event.clientY,
                          height: tile.height,
                        }
                        event.currentTarget.setPointerCapture(event.pointerId)
                      }}
                      onPointerMove={(event) => {
                        const drag = resizeDrag.current
                        if (!drag || drag.id !== tile.id) return
                        const change = event.clientY - drag.y
                        if (Math.abs(change) > 3) {
                          resized.current = true
                          update({
                            ...tile,
                            height: Math.max(
                              160,
                              Math.min(900, drag.height + change)
                            ),
                          })
                        }
                      }}
                      onPointerUp={(event) => {
                        resizeDrag.current = null
                        if (
                          event.currentTarget.hasPointerCapture(event.pointerId)
                        )
                          event.currentTarget.releasePointerCapture(
                            event.pointerId
                          )
                      }}
                      onPointerCancel={() => {
                        resizeDrag.current = null
                        resized.current = false
                      }}
                      onClick={() =>
                        resized.current
                          ? (resized.current = false)
                          : update({
                              ...tile,
                              height:
                                tile.height >= 640 ? 160 : tile.height + 80,
                            })
                      }
                    >
                      <Expand size={12} />
                    </button>
                  </section>
                ))}
                {!tiles.length && (
                  <div className="a360-empty">
                    <p>
                      Add charts from the library to build your analysis
                      workspace.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSide("Library")
                        setSettingsId(null)
                      }}
                    >
                      Open chart library
                    </button>
                  </div>
                )}
              </div>
              {visitedPower && (
                <div
                  className="a360-scroll"
                  role="tabpanel"
                  aria-labelledby="a360-tab-Power"
                  id="a360-panel-Power"
                  hidden={tab !== "Power"}
                >
                  <Analysis360Power
                    points={points}
                    duration={duration}
                    workout={workout}
                    onSelect={(value) => {
                      chooseRange(value)
                      chooseTab("Analyze")
                    }}
                  />
                </div>
              )}
              <div
                className="a360-scroll"
                role="tabpanel"
                aria-labelledby="a360-tab-Lap-Comparison"
                id="a360-panel-Lap-Comparison"
                hidden={tab !== "Lap Comparison"}
              >
                <Analysis360Laps
                  sport={workout.sport}
                  laps={laps}
                  points={points}
                  ftp={ftp}
                  selected={selectedLaps}
                  onToggle={toggleLap}
                  onSelect={chooseRange}
                  onCompare={() => chooseTab("Lap Comparison")}
                  comparison
                />
              </div>
              {selection && (
                <div
                  className="a360-selection-bar"
                  aria-label="Selected chart range"
                >
                  <span>
                    {analysisClock(selection[0])}–{analysisClock(selection[1])}
                  </span>
                  <button
                    type="button"
                    disabled={!canZoom}
                    onClick={() => {
                      setZoom(selection)
                      setCursor(null)
                    }}
                  >
                    Zoom
                  </button>
                  <button
                    type="button"
                    disabled={!zoom}
                    onClick={() => {
                      setZoom(null)
                      setCursor(null)
                    }}
                  >
                    Unzoom
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelection(null)
                      setZoom(null)
                      setCursor(null)
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        <aside
          className="a360-side-panel"
          hidden={!side}
          aria-label={side || "Analysis tools"}
        >
          <h2>
            {side === "Library" && setting ? (
              <>
                <button
                  type="button"
                  aria-label="Back to chart library"
                  onClick={() => setSettingsId(null)}
                >
                  <ArrowLeft size={16} />
                </button>
                {tileNames[setting.kind]}
              </>
            ) : (
              side
            )}
            <button
              type="button"
              aria-label="Close analysis side panel"
              onClick={() => setSide(null)}
            >
              <X size={15} />
            </button>
          </h2>
          <div
            className="a360-comments"
            hidden={side !== "Comments"}
            ref={onCommentsTarget}
          />
          {side === "Library" && (
            <div className="a360-library">
              {setting ? (
                <>
                  <p>
                    Explore recorded data channels from your workout and analyze
                    trends and performance metrics together.
                  </p>
                  <h3>Chart Options</h3>
                  <label>
                    <span>Tile Name</span>
                    <input
                      aria-label="Tile Name"
                      value={setting.name}
                      maxLength={128}
                      onChange={(event) =>
                        update({ ...setting, name: event.target.value })
                      }
                    />
                  </label>
                  <small>{setting.name.length}/128</small>
                  {!["map", "laps"].includes(setting.kind) && (
                    <>
                      {setting.kind !== "zones" && (
                        <label>
                          <span>x-axis</span>
                          <select
                            aria-label="x-axis"
                            value={setting.axis}
                            onChange={(event) =>
                              update({
                                ...setting,
                                axis: event.target.value as "time" | "distance",
                              })
                            }
                          >
                            <option value="time">Duration</option>
                            <option
                              value="distance"
                              disabled={
                                !points.some((point) => point.distance != null)
                              }
                            >
                              Distance
                            </option>
                          </select>
                        </label>
                      )}
                      <h3>Primary Channel</h3>
                      <label>
                        <span>Channel</span>
                        <select
                          aria-label="Primary channel"
                          disabled={setting.kind === "zones"}
                          value={
                            setting.kind === "zones"
                              ? zoneConfiguration?.key ||
                                setting.channels[0] ||
                                ""
                              : setting.channels[0] || ""
                          }
                          onChange={(event) => {
                            const key = event.target.value as RecordedSignal
                            update({
                              ...setting,
                              channels: [
                                key,
                                ...setting.channels
                                  .slice(1)
                                  .filter((item) => item !== key),
                              ],
                            })
                          }}
                        >
                          {available.map((key) => (
                            <option key={key} value={key}>
                              {recordedSignalInfo(key, workout.sport).label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {setting.kind !== "zones" && (
                        <label className="a360-check">
                          <input
                            type="checkbox"
                            checked={setting.zones}
                            onChange={(event) =>
                              update({
                                ...setting,
                                zones: event.target.checked,
                              })
                            }
                          />
                          Display Zones
                        </label>
                      )}
                      {setting.kind !== "single" &&
                        setting.kind !== "zones" && (
                          <>
                            <h3>Additional Channels</h3>
                            {setting.channels.slice(1).map((key) => (
                              <div className="a360-extra-channel" key={key}>
                                <label>
                                  <span>Channel</span>
                                  <select
                                    aria-label={`Additional ${recordedSignalInfo(key, workout.sport).label} channel`}
                                    value={key}
                                    onChange={(event) =>
                                      update({
                                        ...setting,
                                        channels: setting.channels
                                          .map((item) =>
                                            item === key
                                              ? (event.target
                                                  .value as RecordedSignal)
                                              : item
                                          )
                                          .filter(
                                            (value, index, all) =>
                                              all.indexOf(value) === index
                                          ),
                                      })
                                    }
                                  >
                                    {available
                                      .filter(
                                        (item) =>
                                          item === key ||
                                          !setting.channels.includes(item)
                                      )
                                      .map((item) => (
                                        <option key={item} value={item}>
                                          {
                                            recordedSignalInfo(
                                              item,
                                              workout.sport
                                            ).label
                                          }
                                        </option>
                                      ))}
                                  </select>
                                </label>
                                <button
                                  type="button"
                                  onClick={() =>
                                    update({
                                      ...setting,
                                      channels: setting.channels.filter(
                                        (item) => item !== key
                                      ),
                                    })
                                  }
                                >
                                  Remove Channel
                                </button>
                              </div>
                            ))}
                            <button
                              className="a360-outline"
                              type="button"
                              disabled={
                                setting.channels.length >= available.length
                              }
                              onClick={() => {
                                const next = available.find(
                                  (key) => !setting.channels.includes(key)
                                )
                                if (next)
                                  update({
                                    ...setting,
                                    channels: [...setting.channels, next],
                                  })
                              }}
                            >
                              Add Channel
                            </button>
                          </>
                        )}
                    </>
                  )}
                </>
              ) : (
                <>
                  <h3>Custom Charts</h3>
                  <p>Create charts with your workout’s recorded channels.</p>
                  {Object.entries(tileNames).map(([kind, label]) => (
                    <button
                      className="a360-library-item"
                      key={kind}
                      type="button"
                      disabled={
                        ["map", "laps"].includes(kind)
                          ? tiles.some((tile) => tile.kind === kind)
                          : !available.length
                      }
                      onClick={() => addTile(kind as AnalysisTile["kind"])}
                    >
                      <LineChart size={18} />
                      <span>{label}</span>
                      <Plus size={16} />
                    </button>
                  ))}
                  <h3>Prebuilt Charts</h3>
                  <p>Ready to use chart configurations</p>
                  <button
                    className="a360-library-item"
                    type="button"
                    disabled
                    title="Anaerobic battery requires an FRC model that is not supplied by the connected provider."
                  >
                    <Layers size={18} />
                    <span>
                      Anaerobic Battery<small>Multi-Channel Chart</small>
                    </span>
                  </button>
                  <button
                    className="a360-library-item"
                    type="button"
                    disabled={!available.includes("efficiency")}
                    onClick={() =>
                      addPreset("Aerobic Efficiency", [
                        "efficiency",
                        "power",
                        "heartRate",
                      ])
                    }
                  >
                    <LineChart size={18} />
                    <span>
                      Aerobic Efficiency<small>Multi-Channel Chart</small>
                    </span>
                    <Plus size={16} />
                  </button>
                  <button
                    className="a360-library-item"
                    type="button"
                    disabled={!available.includes("torque")}
                    onClick={() =>
                      addPreset("Force Profile", ["torque", "cadence", "power"])
                    }
                  >
                    <LineChart size={18} />
                    <span>
                      Force Profile<small>Multi-Channel Chart</small>
                    </span>
                    <Plus size={16} />
                  </button>
                  <button
                    className="a360-library-item"
                    type="button"
                    disabled={!available.length}
                    onClick={() => addTile("stacked", true)}
                  >
                    <Layers size={18} />
                    <span>
                      Ride Profile<small>Stacked Channel Chart</small>
                    </span>
                    <Plus size={16} />
                  </button>
                </>
              )}
            </div>
          )}
        </aside>
        <nav className="a360-right-rail" aria-label="Analysis tools">
          {(["Comments", "Library"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={side === value}
              onClick={() => {
                setSide((current) => (current === value ? null : value))
                if (value === "Library") setSettingsId(null)
              }}
            >
              {value === "Comments" ? (
                <MessageSquare size={18} />
              ) : (
                <LineChart size={18} />
              )}
              <span>{value}</span>
            </button>
          ))}
        </nav>
      </div>
    </main>
  )
}
