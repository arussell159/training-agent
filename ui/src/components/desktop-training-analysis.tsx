import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  Columns3,
  Download,
  ListFilter,
  RotateCw,
} from "lucide-react"
import { aggregateMetricValue } from "@/lib/aggregate-analysis"
import { DesktopDashboardCharts } from "./desktop-dashboard-charts"
import { dashboardRangeError } from "@/lib/dashboard-chart-settings"
import { loadTrainingHistoryRange } from "@/lib/training-history-range"
import {
  trainingCacheScope,
  type PlannedWorkout,
  type TrainingContext,
} from "@/lib/training-context"
import {
  completedActivities,
  metric,
  reportColumns,
  sortActivities,
  type ReportWorkout,
  type ReportColumn,
} from "@/lib/workout-reports-model"
import { calendarSportLabel, calendarSportType } from "@/lib/calendar-events"
import { analysisCsv } from "@/lib/analysis-360"
import { ChartSkeleton } from "./loading-layouts"
import "./desktop-training-analysis.css"

const WorkoutReportCompare = lazy(() =>
  import("./workout-report-compare").then((module) => ({
    default: module.WorkoutReportCompare,
  }))
)
type Tab = "Legacy Dashboard" | "Workout Comparison"
type Range = { preset: string; start: string; end: string }
const charts = [
  ["duration", "Total Duration"],
  ["tss", "TSS by Week"],
  ["performance", "Performance Management - All Workout Types"],
  ["run", "Run Distance"],
  ["bike", "Bike Distance"],
  ["swim", "Swim Distance"],
  ["zones", "Time in Heart Rate Zones"],
  ["fitness", "Fitness History"],
] as const
const chartIds = charts.map(([id]) => id)
type ChartId = (typeof chartIds)[number]
const defaultColumns = [
  "duration_seconds",
  "distance_meters",
  "work_kj",
  "tss",
  "hr_load",
  "pace_load",
  "intensity_factor",
]
const comparisonColumns: ReportColumn[] = [
  ...reportColumns,
  ...(
    [
      ["power_load", "Power load"],
      ["hr_load", "HR load"],
      ["pace_load", "Pace load"],
    ] as const
  ).map(([id, label]) => ({
    id,
    label,
    unit: "",
    value: (workout: ReportWorkout) => aggregateMetricValue(workout, id),
    format: (value: number) =>
      value.toLocaleString("en-US", { maximumFractionDigits: 0 }),
  })),
]
const rangePresets = ["7", "28", "90", "year", "custom"]
const sportFilters = [
  "all",
  "run",
  "bike",
  "swim",
  "Walk",
  "WeightTraining",
  "Rowing",
  "NordicSki",
  "Workout",
  "Other",
]
const todayForAthlete = (timeZone?: string) => {
  try {
    return new Date().toLocaleDateString("en-CA", {
      timeZone: timeZone || "America/Chicago",
    })
  } catch {
    return new Date().toLocaleDateString("en-CA", { timeZone: "UTC" })
  }
}
const dayKey = (date: Date) => date.toISOString().slice(0, 10)
const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
const clock = (value: number) => {
  const whole = Math.max(0, Math.round(value))
  return `${Math.floor(whole / 3600)}:${String(Math.floor((whole % 3600) / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`
}
const presetRange = (preset: string, today: string): Range => {
  const end = new Date(`${today}T12:00:00Z`),
    start = new Date(end)
  if (preset === "year") start.setUTCMonth(0, 1)
  else start.setUTCDate(start.getUTCDate() - (Number(preset) || 28) + 1)
  return { preset, start: dayKey(start), end: today }
}
const rangeError = (range: Range) => dashboardRangeError(range)
const sportMatches = (workout: PlannedWorkout, sport: string) => {
  if (sport === "all") return true
  const actual = calendarSportType(workout.editor_model?.sport || workout.sport)
  if (sport === "bike") return /bike|ride|cycl/i.test(actual)
  if (sport === "run") return /run/i.test(actual)
  if (sport === "swim") return /swim/i.test(actual)
  return actual === sport
}
type Preferences = {
  tab: Tab
  ranges: Record<Tab, Range>
  sport: string
  charts: ChartId[]
  columns: string[]
}
function initialPreferences(key: string, today: string): Preferences {
  const fallback: Preferences = {
    tab: "Legacy Dashboard",
    ranges: {
      "Legacy Dashboard": presetRange("28", today),
      "Workout Comparison": presetRange("7", today),
    },
    sport: "all",
    charts: [...chartIds],
    columns: [...defaultColumns],
  }
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null")
    if (!saved || saved.version !== 1) return fallback
    const tab =
      saved.tab === "Workout Comparison" ? saved.tab : "Legacy Dashboard"
    const ranges = { ...fallback.ranges }
    for (const name of ["Legacy Dashboard", "Workout Comparison"] as const) {
      const range = saved.ranges?.[name]
      if (range && rangePresets.includes(range.preset) && !rangeError(range))
        ranges[name] =
          range.preset === "custom" ? range : presetRange(range.preset, today)
    }
    return {
      tab,
      ranges,
      sport: sportFilters.includes(saved.sport) ? saved.sport : "all",
      charts: Array.isArray(saved.charts)
        ? [
            ...new Set<ChartId>(
              saved.charts.filter((id: ChartId) => chartIds.includes(id))
            ),
          ]
        : fallback.charts,
      columns: Array.isArray(saved.columns)
        ? [
            ...new Set<string>(
              saved.columns.filter((id: string) =>
                comparisonColumns.some((column) => column.id === id)
              )
            ),
          ]
        : fallback.columns,
    }
  } catch {
    return fallback
  }
}

export function DesktopTrainingAnalysis({
  context,
  onOverview,
  onWorkoutOpen,
}: {
  context: TrainingContext
  onOverview: () => void
  onWorkoutOpen: (workout: PlannedWorkout) => void
}) {
  const today = todayForAthlete(context.athlete.time_zone)
  const preferenceKey = `desktop-training-analysis-v1:${trainingCacheScope()}`
  const [preferences, setPreferences] = useState(() =>
    initialPreferences(preferenceKey, today)
  )
  const { tab, sport } = preferences
  const range = preferences.ranges[tab]
  const [rangeDraft, setRangeDraft] = useState(range)
  const [dateOpen, setDateOpen] = useState(false),
    [library, setLibrary] = useState(false),
    [columnsOpen, setColumnsOpen] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false)
  const [validation, setValidation] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0)
  const [loaded, setLoaded] = useState<{
    context: TrainingContext
    start: string
    end: string
  } | null>(null)
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [comparing, setComparing] = useState(false)
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" }>({
    id: "date",
    direction: "asc",
  })
  const request = useRef(0)
  const tabs = useRef<HTMLDivElement>(null)
  const dateButton = useRef<HTMLButtonElement>(null)
  const contextVersion = String(
    (context as TrainingContext & { version?: string }).version || ""
  )
  const previousVersion = useRef(contextVersion)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const refreshData = useCallback(() => {
    window.dispatchEvent(new Event("fitness-history-reset"))
    setRefresh((value) => value + 1)
  }, [])
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(refreshData, 40)
  }, [refreshData])
  useEffect(() => {
    window.addEventListener("training-mutation-settled", scheduleRefresh)
    return () => {
      window.removeEventListener("training-mutation-settled", scheduleRefresh)
      clearTimeout(refreshTimer.current)
    }
  }, [scheduleRefresh])
  useEffect(() => {
    if (previousVersion.current === contextVersion) return
    previousVersion.current = contextVersion
    scheduleRefresh()
  }, [contextVersion, scheduleRefresh])
  useEffect(() => {
    try {
      localStorage.setItem(
        preferenceKey,
        JSON.stringify({ version: 1, ...preferences })
      )
    } catch {
      /* Charts remain usable when browser preferences are unavailable. */
    }
  }, [preferenceKey, preferences])
  useEffect(() => {
    const controller = new AbortController(),
      revision = ++request.current
    setLoading(true)
    setError("")
    void loadTrainingHistoryRange(range.start, range.end, {
      signal: controller.signal,
      force: refresh > 0,
    })
      .then((value) => {
        if (!controller.signal.aborted && request.current === revision) {
          setLoaded({ context: value, start: range.start, end: range.end })
          setSelected([])
          setComparing(false)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted && request.current === revision)
          setError(
            reason instanceof Error
              ? reason.message
              : "Analysis could not be loaded."
          )
      })
      .finally(() => {
        if (!controller.signal.aborted && request.current === revision)
          setLoading(false)
      })
    return () => controller.abort()
  }, [range.start, range.end, refresh])
  const workouts = useMemo(
    () =>
      completedActivities(
        (loaded
          ? [...loaded.context.planned, ...loaded.context.history]
          : []) as ReportWorkout[]
      ),
    [loaded]
  )
  const filtered = useMemo(
    () => workouts.filter((workout) => sportMatches(workout, sport)),
    [workouts, sport]
  )
  const rows = useMemo(() => {
    const visible = filtered.filter(
      (workout) =>
        !query ||
        `${workout.title} ${workout.sport}`
          .toLowerCase()
          .includes(query.toLowerCase())
    )
    if (
      sort.id === "date" ||
      reportColumns.some((column) => column.id === sort.id)
    )
      return sortActivities(visible, sort.id, sort.direction)
    const column = comparisonColumns.find((item) => item.id === sort.id)
    return [...visible].sort((a, b) => {
      const av = column?.value(a) ?? null,
        bv = column?.value(b) ?? null
      if (av == null && bv != null) return 1
      if (bv == null && av != null) return -1
      return (
        ((av ?? 0) - (bv ?? 0)) * (sort.direction === "asc" ? 1 : -1) ||
        a.id.localeCompare(b.id)
      )
    })
  }, [filtered, query, sort])
  const chosen = rows.filter((workout) => selected.includes(workout.id))
  const selectedDurations = chosen.flatMap((workout) => {
    const value = metric(workout, "duration_seconds")
    return value == null ? [] : [value]
  })
  const columns = preferences.columns.flatMap((id) => {
    const column = comparisonColumns.find((item) => item.id === id)
    return column ? [column] : []
  })
  const changeTab = (value: Tab) => {
    setPreferences((current) => ({ ...current, tab: value }))
    setDateOpen(false)
    setValidation("")
    setSelected([])
    setComparing(false)
  }
  const updatePreset = (value: string) => {
    if (value === "custom") {
      setRangeDraft({ ...range, preset: "custom" })
      setDateOpen(true)
      return
    }
    setPreferences((current) => ({
      ...current,
      ranges: { ...current.ranges, [tab]: presetRange(value, today) },
    }))
    setValidation("")
  }
  const exportRows = () => {
    const csv = analysisCsv([
      [
        "Date",
        "Workout Name",
        "Athlete",
        "Type",
        ...columns.map(
          (column) => `${column.label}${column.unit ? ` (${column.unit})` : ""}`
        ),
      ],
      ...rows.map((workout) => [
        workout.workout_date,
        workout.title,
        context.athlete.name || "",
        calendarSportLabel(workout.sport),
        ...columns.map((column) => {
          const value = column.value(workout)
          return value == null ? "" : column.format(value, workout)
        }),
      ]),
    ])
    const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" })
      ),
      link = document.createElement("a")
    link.href = url
    link.download = `workout-comparison-${loaded?.start || range.start}-${loaded?.end || range.end}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const stale =
    loaded && (loaded.start !== range.start || loaded.end !== range.end)
  return (
    <section
      className="dta-workspace"
      aria-label="Training analysis"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        if (dateOpen) {
          event.preventDefault()
          setDateOpen(false)
          dateButton.current?.focus()
        } else if (columnsOpen || filtersOpen || library) {
          event.preventDefault()
          setColumnsOpen(false)
          setFiltersOpen(false)
          setLibrary(false)
        }
      }}
    >
      <div
        className="dta-tabs"
        role="tablist"
        aria-label="Training analysis views"
        ref={tabs}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return
          event.preventDefault()
          const value =
            event.key === "Home"
              ? "Legacy Dashboard"
              : event.key === "End"
                ? "Workout Comparison"
                : tab === "Legacy Dashboard"
                  ? "Workout Comparison"
                  : "Legacy Dashboard"
          changeTab(value)
          tabs.current
            ?.querySelector<HTMLButtonElement>(`[data-tab="${value}"]`)
            ?.focus()
        }}
      >
        {(["Legacy Dashboard", "Workout Comparison"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`dta-${value.replaceAll(" ", "-")}`}
            aria-selected={tab === value}
            aria-controls="dta-panel"
            tabIndex={tab === value ? 0 : -1}
            data-tab={value}
            onClick={() => changeTab(value)}
          >
            {value}
          </button>
        ))}
        <button type="button" className="dta-overview" onClick={onOverview}>
          <ArrowLeft size={14} />
          Overview
        </button>
      </div>
      <div className="dta-shell">
        {tab === "Legacy Dashboard" && (
          <aside className="dta-rail">
            <button
              type="button"
              onClick={() => setLibrary((value) => !value)}
              aria-expanded={library}
              aria-controls="dta-library"
            >
              <BarChart3 size={18} />
              Charts
              <br />
              Library
            </button>
          </aside>
        )}
        <div
          className="dta-content"
          role="tabpanel"
          id="dta-panel"
          aria-labelledby={`dta-${tab.replaceAll(" ", "-")}`}
        >
          <div
            className={`dta-controls ${tab === "Workout Comparison" ? "dta-comparison-controls" : ""}`}
          >
            {tab === "Workout Comparison" && (
              <select
                aria-label="Analysis date range"
                value={range.preset}
                onChange={(event) => updatePreset(event.target.value)}
              >
                <option value="7">Last 7 days</option>
                <option value="28">Last 28 days</option>
                <option value="90">Last 90 days</option>
                <option value="year">This year</option>
                <option value="custom">Custom dates</option>
              </select>
            )}
            <button
              ref={dateButton}
              type="button"
              className="dta-date-button"
              aria-expanded={dateOpen}
              onClick={() => {
                setRangeDraft(range)
                setDateOpen((value) => !value)
                setValidation("")
              }}
            >
              {dateLabel(range.start)} - {dateLabel(range.end)}
              <ChevronDown size={15} />
            </button>
            <button
              type="button"
              aria-label="Refresh training analysis"
              title="Refresh"
              onClick={refreshData}
              disabled={loading}
            >
              <RotateCw size={17} className={loading ? "dta-refreshing" : ""} />
            </button>
            <label className="dta-sport">
              <span>Activity Type</span>
              <select
                aria-label="Analysis activity type"
                value={sport}
                onChange={(event) => {
                  setPreferences((current) => ({
                    ...current,
                    sport: event.target.value,
                  }))
                  setSelected([])
                  setComparing(false)
                }}
              >
                <option value="all">All</option>
                <option value="run">Run</option>
                <option value="bike">Bike</option>
                <option value="swim">Swim</option>
                <option value="Walk">Walk</option>
                <option value="WeightTraining">Strength</option>
                <option value="Rowing">Rowing</option>
                <option value="NordicSki">XC-Ski</option>
                <option value="Workout">Crosstrain</option>
                <option value="Other">Other</option>
              </select>
            </label>
            {dateOpen && (
              <form
                className="dta-date-popover"
                onSubmit={(event) => {
                  event.preventDefault()
                  const message = rangeError(rangeDraft)
                  setValidation(message)
                  if (!message) {
                    setPreferences((current) => ({
                      ...current,
                      ranges: {
                        ...current.ranges,
                        [tab]: { ...rangeDraft, preset: "custom" },
                      },
                    }))
                    setDateOpen(false)
                  }
                }}
              >
                <label>
                  Start date
                  <input
                    type="date"
                    aria-label="Analysis start date"

                    value={rangeDraft.start}
                    onChange={(event) =>
                      setRangeDraft((current) => ({
                        ...current,
                        start: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  End date
                  <input
                    type="date"
                    aria-label="Analysis end date"

                    value={rangeDraft.end}
                    onChange={(event) =>
                      setRangeDraft((current) => ({
                        ...current,
                        end: event.target.value,
                      }))
                    }
                  />
                </label>
                {validation && <p role="alert">{validation}</p>}
                <button type="submit">Apply dates</button>
                <button type="button" onClick={() => setDateOpen(false)}>
                  Cancel
                </button>
                {tab === "Legacy Dashboard" && (
                  <select
                    aria-label="Dashboard range preset"
                    value={range.preset}
                    onChange={(event) => {
                      updatePreset(event.target.value)
                      if (event.target.value !== "custom") setDateOpen(false)
                    }}
                  >
                    <option value="7">Last 7 days</option>
                    <option value="28">Last 28 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="year">This year</option>
                    <option value="custom">Custom dates</option>
                  </select>
                )}
              </form>
            )}
          </div>
          <p className="dta-source">Completed workouts from Intervals.icu.</p>
          {error && (
            <div role="alert" className="dta-error">
              {error}{" "}
              {loaded &&
                `Showing the last successful range: ${dateLabel(loaded.start)} – ${dateLabel(loaded.end)}.`}
              <button type="button" onClick={refreshData}>
                Retry
              </button>
            </div>
          )}
          {loading && (
            <p className="dta-status" role="status">
              Loading analysis…
              {stale
                ? " Previous results remain visible until the selected range loads."
                : ""}
            </p>
          )}
          {tab === "Legacy Dashboard" ? (
            <DesktopDashboardCharts
              key={trainingCacheScope()}
              today={today}
              dashboardRange={range}
              globalSport={sport}
              refresh={refresh}
              libraryOpen={library}
              onLibraryClose={() => setLibrary(false)}
              legacyChartIds={preferences.charts}
              onWorkoutOpen={onWorkoutOpen}
            />
          ) : comparing ? (
            <Suspense fallback={<ChartSkeleton />}>
              <WorkoutReportCompare
                workouts={chosen}
                onBack={() => setComparing(false)}
                onWorkoutOpen={onWorkoutOpen}
              />
            </Suspense>
          ) : (
            <section
              className="dta-comparison"
              aria-label="Workout Comparison table"
            >
              <h2>{rows.length} Workouts</h2>
              <div className="dta-table-tools">
                <button
                  type="button"
                  aria-expanded={columnsOpen}
                  onClick={() => setColumnsOpen((value) => !value)}
                >
                  <Columns3 size={14} />
                  Columns
                </button>
                <button
                  type="button"
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((value) => !value)}
                >
                  <ListFilter size={14} />
                  Filters
                </button>
                <button
                  type="button"
                  onClick={exportRows}
                  disabled={!rows.length}
                >
                  <Download size={14} />
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => setComparing(true)}
                  disabled={chosen.length < 2 || chosen.length > 4}
                >
                  Compare {chosen.length ? `(${chosen.length})` : ""}
                </button>
              </div>
              {columnsOpen && (
                <fieldset className="dta-columns">
                  <legend>Visible columns</legend>
                  {comparisonColumns.map((column) => (
                    <label key={column.id}>
                      <input
                        type="checkbox"
                        checked={preferences.columns.includes(column.id)}
                        onChange={() =>
                          setPreferences((current) => ({
                            ...current,
                            columns: current.columns.includes(column.id)
                              ? current.columns.filter((id) => id !== column.id)
                              : [...current.columns, column.id],
                          }))
                        }
                      />
                      {column.label}
                    </label>
                  ))}
                </fieldset>
              )}
              {filtersOpen && (
                <label className="dta-filter">
                  Workout name or type
                  <input
                    aria-label="Filter comparison workouts"
                    type="search"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setSelected([])
                    }}
                  />
                </label>
              )}
              <div className="dta-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all comparison workouts"
                          checked={
                            rows.length > 0 &&
                            rows.every((workout) =>
                              selected.includes(workout.id)
                            )
                          }
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? rows.map((workout) => workout.id)
                                : []
                            )
                          }
                        />
                      </th>
                      <th
                        aria-sort={
                          sort.id === "date"
                            ? sort.direction === "asc"
                              ? "ascending"
                              : "descending"
                            : undefined
                        }
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSort((current) => ({
                              id: "date",
                              direction:
                                current.id === "date" &&
                                current.direction === "asc"
                                  ? "desc"
                                  : "asc",
                            }))
                          }
                        >
                          Date{" "}
                          {sort.id === "date"
                            ? sort.direction === "asc"
                              ? "↑"
                              : "↓"
                            : ""}
                        </button>
                      </th>
                      <th>Workout Name</th>
                      <th>Athlete</th>
                      <th>Type</th>
                      {columns.map((column) => (
                        <th
                          key={column.id}
                          aria-sort={
                            sort.id === column.id
                              ? sort.direction === "asc"
                                ? "ascending"
                                : "descending"
                              : undefined
                          }
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setSort((current) => ({
                                id: column.id,
                                direction:
                                  current.id === column.id &&
                                  current.direction === "asc"
                                    ? "desc"
                                    : "asc",
                              }))
                            }
                          >
                            {column.id === "duration_seconds"
                              ? "Duration (h:m:s)"
                              : column.label}
                            {column.id !== "duration_seconds" && column.unit
                              ? ` (${column.unit})`
                              : ""}{" "}
                            {sort.id === column.id
                              ? sort.direction === "asc"
                                ? "↑"
                                : "↓"
                              : ""}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((workout) => (
                      <tr key={workout.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${workout.title}`}
                            checked={selected.includes(workout.id)}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? [...current, workout.id]
                                  : current.filter((id) => id !== workout.id)
                              )
                            }
                          />
                        </td>
                        <td>{workout.workout_date}</td>
                        <td>
                          <button
                            type="button"
                            className="dta-workout-link"
                            onClick={() => onWorkoutOpen(workout)}
                            title={workout.title}
                          >
                            {workout.title}
                          </button>
                        </td>
                        <td>{context.athlete.name || "—"}</td>
                        <td>{calendarSportLabel(workout.sport)}</td>
                        {columns.map((column) => {
                          const value = column.value(workout)
                          return (
                            <td key={column.id}>
                              {value == null
                                ? "—"
                                : column.id === "duration_seconds"
                                  ? clock(value)
                                  : column.format(value, workout)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && !loading && (
                  <p className="dta-empty">
                    No completed workouts match this range and filter.
                  </p>
                )}
              </div>
              {chosen.length > 4 && (
                <p className="dta-data-note">
                  Select two to four workouts to compare recorded charts.
                </p>
              )}
              {chosen.length > 0 && (
                <p className="dta-data-note">
                  {chosen.length} selected · Duration{" "}
                  {selectedDurations.length
                    ? clock(
                        selectedDurations.reduce((sum, value) => sum + value, 0)
                      )
                    : "—"}
                  {selectedDurations.length < chosen.length &&
                    ` (${chosen.length - selectedDurations.length} unavailable)`}
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </section>
  )
}
