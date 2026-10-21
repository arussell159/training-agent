import { DashboardChartTagSettings } from "./dashboard-chart-tag-settings"
import { type ChartTagCatalog } from "@/lib/dashboard-chart-tags"
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Settings2,
  Trash2,
  X,
} from "lucide-react"
import {
  aggregateActivityHistory,
  aggregateFitnessSummary,
} from "@/lib/aggregate-analysis"
import {
  dashboardChartDatePresets,
  dashboardChartSports,
  resolveDashboardChartRange,
  type DashboardChartRange,
  type DashboardChartSettings,
} from "@/lib/dashboard-chart-settings"
import {
  chartInstanceTitle,
  dashboardChartCatalog,
  dashboardFitnessPeakTypes,
  dashboardFitnessReportTypes,
  dashboardChartDefinition,
  dashboardLayoutNamespace,
  filterDashboardWorkouts,
  insertDashboardChart,
  migratedDashboardLayout,
  moveDashboardChart,
  newDashboardChart,
  validDashboardLayout,
  type DashboardChartInstance,
  type DashboardChartType,
  type DashboardLayout,
} from "@/lib/dashboard-charts"
import {
  dashboardLayoutClient,
  sameDashboardLayout,
} from "@/lib/dashboard-layout-client"
import { loadTrainingHistoryRange } from "@/lib/training-history-range"
import {
  trainingCacheScope,
  type PlannedWorkout,
  type TrainingContext,
} from "@/lib/training-context"
import { randomId } from "@/lib/random-id"
import { calendarMetricFields } from "../../../app-backend/lib/calendar-metrics-model.mjs"
import { fitnessPeakEffortTarget } from "@/lib/fitness-history"
import { openActivityEffort } from "@/lib/activity-effort-navigation"
import {
  completedActivities,
  type ReportWorkout,
} from "@/lib/workout-reports-model"
import { FitnessHistorySkeleton } from "./loading-layouts"
import {
  dashboardChartSeries,
  dashboardPerformanceSeries,
  dashboardChartFormat,
  dashboardClock,
} from "@/lib/dashboard-chart-series"
import { DashboardPowerCurve } from "./dashboard-power-curve"
import { DashboardPaceCurve } from "./dashboard-pace-curve"
import { DashboardHeartRateCurve } from "./dashboard-heart-rate-curve"
import { recordedHeartRateRange } from "@/lib/dashboard-heart-rate-curve"
import { DashboardCadenceCurve } from "./dashboard-cadence-curve"
import { recordedCadenceRange } from "@/lib/dashboard-cadence-curve"
import { DashboardVelocityCurve } from "./dashboard-velocity-curve"
import { recordedVelocityRange } from "@/lib/dashboard-velocity-curve"
import { DashboardMacronutrients } from "./dashboard-macronutrients"
import {
  newMacronutrientSettings,
  type MacronutrientSettings,
} from "@/lib/dashboard-macronutrients"
import { recordedPaceRange } from "@/lib/dashboard-pace-curve"
import {
  newDashboardPowerSettings,
  recordedPowerRange,
  type DashboardPowerSettings,
} from "@/lib/dashboard-power-curve"
import "./desktop-dashboard-charts.css"
const FitnessHistoryCard = lazy(() =>
  import("./fitness-history-card").then((module) => ({
    default: module.FitnessHistoryCard,
  }))
)

const message = (error: unknown) =>
  error instanceof Error ? error.message : "The dashboard could not be updated."
const clock = dashboardClock
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  })
type CachedLayout = { layout: DashboardLayout; pending: boolean }
function cachedLayout(key: string, fallback: DashboardLayout): CachedLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null")
    if (
      validDashboardLayout(saved?.layout) &&
      typeof saved.pending === "boolean"
    )
      return saved
  } catch {
    /* Optional local draft cache. */
  }
  return { layout: fallback, pending: false }
}
function cacheLayout(key: string, value: CachedLayout) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* Server persistence remains authoritative. */
  }
}

function ChartSettings({
  instance,
  today,
  dashboardRange,
  onClose,
  onApply,
}: {
  instance: DashboardChartInstance
  today: string
  dashboardRange: DashboardChartRange
  onClose: () => void
  onApply: (
    settings: DashboardChartSettings,
    metric?: string,
    peakType?: DashboardChartInstance["peakType"],
    reportType?: DashboardChartInstance["reportType"],
    power?: DashboardPowerSettings,
    macronutrients?: MacronutrientSettings,
    tags?: string[]
  ) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(() => structuredClone(instance.settings)),
    [metric, setMetric] = useState(instance.metric || "weight"),
    [peakType, setPeakType] = useState<
      NonNullable<DashboardChartInstance["peakType"]>
    >(instance.peakType || "Pace by Distance"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const [reportType, setReportType] = useState<
    NonNullable<DashboardChartInstance["reportType"]>
  >(instance.reportType || "Planned Distance")
  const [power, setPower] = useState(() =>
    structuredClone(
      (instance.type === "peak-pace-distance"
        ? instance.pace
        : instance.type === "peak-hr"
          ? instance.hr
          : instance.type === "peak-cadence"
            ? instance.cadence
            : instance.type === "peak-speed"
              ? instance.speed
              : instance.type === "peak-pace"
                ? instance.durationPace
                : instance.power) || newDashboardPowerSettings(dashboardRange)
    )
  )
  const [macronutrients, setMacronutrients] = useState(() =>
    structuredClone(instance.macronutrients || newMacronutrientSettings())
  )
  const [tags, setTags] = useState<string[]>(() => [...(instance.tags || [])])
  const [tagCatalog, setTagCatalog] = useState<ChartTagCatalog | null>(null)
  const tagAvailable = [
    "peak-power",
    "peak-hr",
    "peak-cadence",
    "peak-speed",
    "peak-pace",
  ].includes(instance.type)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => {
    first.current?.focus()
  }, [])
  const definition = dashboardChartDefinition(instance.type)!
  const fixedHistory = definition.kind === "fitness-history"
  const athleteWide = ["performance", "fitness-summary", "metrics"].includes(
    definition.kind
  )
  const periodAvailable =
    ["sum", "maximum", "pace", "metrics"].includes(definition.kind) ||
    (definition.kind === "zones" && !!definition.weekly)
  const averageAvailable = ["sum", "maximum", "pace", "metrics"].includes(
    definition.kind
  )
  const patch = (value: Partial<DashboardChartSettings>) => {
    setDraft((current) => ({ ...current, ...value }))
    setError("")
  }
  const apply = async (close: boolean) => {
    if (busy) return
    try {
      if (
        tagAvailable &&
        tags.length &&
        (!tagCatalog || tags.some((tag) => !tagCatalog.tags.includes(tag)))
      )
        throw Error(
          "Selected recording tags must be verified. Reload tags or explicitly clear the selection."
        )
      resolveDashboardChartRange(draft, today, dashboardRange)
      if (
        [
          "peak-power",
          "peak-pace-distance",
          "peak-hr",
          "peak-cadence",
          "peak-speed",
          "peak-pace",
        ].includes(instance.type)
      ) {
        const recordedRange =
          instance.type === "peak-pace-distance"
            ? recordedPaceRange
            : instance.type === "peak-hr"
              ? recordedHeartRateRange
              : instance.type === "peak-cadence"
                ? recordedCadenceRange
                : ["peak-speed", "peak-pace"].includes(instance.type)
                  ? recordedVelocityRange
                  : recordedPowerRange
        recordedRange(
          resolveDashboardChartRange(draft, today, dashboardRange),
          today
        )
        if (power.comparison)
          recordedRange(
            resolveDashboardChartRange(
              power.comparisonRange,
              today,
              dashboardRange
            ),
            today
          )
      }
    } catch (reason) {
      setError(message(reason))
      return
    }
    setBusy(true)
    setError("")
    try {
      if (
        await onApply(
          draft,
          instance.type === "metrics" ? metric : undefined,
          fixedHistory ? peakType : undefined,
          instance.type === "fitness-summary" ? reportType : undefined,
          [
            "peak-power",
            "peak-pace-distance",
            "peak-hr",
            "peak-cadence",
            "peak-speed",
            "peak-pace",
          ].includes(instance.type)
            ? power
            : undefined,
          instance.type === "macronutrients" ? macronutrients : undefined,
          tagAvailable ? [...tags] : undefined
        )
      ) {
        if (close) onClose()
      } else
        setError(
          "Changes remain in this dashboard. Retry Apply to confirm them on the server."
        )
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="ddc-settings"
      role="dialog"
      aria-label={`Settings for ${chartInstanceTitle(instance)}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation()
          if (!busy) onClose()
        }
      }}
    >
      <header>
        <h3>Chart Settings</h3>
        <button
          type="button"
          aria-label="Close chart settings"
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <label>
        Custom Title:
        <input
          aria-label="Custom Title"
          ref={first}
          value={draft.title}
          maxLength={500}
          disabled={busy}
          placeholder={definition.title}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </label>
      {definition.kind === "unavailable" ? (
        <p className="dta-data-note">
          {definition.unavailable} Only the chart title and layout can be
          changed until this source is supported.
        </p>
      ) : definition.kind === "macronutrients" ? null : athleteWide ? (
        <p className="dta-data-note">
          {definition.kind === "fitness-summary"
            ? "Reports use each workout’s canonical planned or completed values and dates. They include every sport; dashboard sport filters do not change this report."
            : "This chart uses athlete-wide daily records. Sport filters do not change those records."}
        </p>
      ) : (
        <fieldset disabled={busy}>
          <legend>Workout Types</legend>
          <label>
            <input
              type="checkbox"
              checked={draft.sports.length === dashboardChartSports.length}
              onChange={(event) =>
                patch({
                  sports: event.target.checked ? [...dashboardChartSports] : [],
                })
              }
            />
            All
          </label>
          <div className="ddc-sports">
            {dashboardChartSports.map((sport) => (
              <label key={sport}>
                <input
                  type="checkbox"
                  checked={draft.sports.includes(sport)}
                  onChange={(event) =>
                    patch({
                      sports: event.target.checked
                        ? [...draft.sports, sport]
                        : draft.sports.filter((item) => item !== sport),
                    })
                  }
                />
                {sport}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {fixedHistory && (
        <p className="dta-data-note">
          Fitness History retains the provider’s current history windows. Custom
          dates are unavailable for this source. Power uses fixed-duration Bike
          curves; Pace by Distance uses recorded Run/Swim distance efforts.
        </p>
      )}
      {definition.kind === "pace-curve" && (
        <p className="dta-data-note">
          Recorded pace by distance is available for Run or Swim individually.
          Other and combined workout types are unavailable.
        </p>
      )}
      {definition.kind === "power-curve" && (
        <p className="dta-data-note">
          Power uses native recorded watts across the selected workout types.
          Individual Brick, Custom, Day off and Race cannot be separated from
          native recordings. Missing streams and incomplete coverage remain
          unavailable.
        </p>
      )}
      {definition.kind === "heart-rate-curve" && (
        <p className="dta-data-note">
          All uses the provider’s combined native heart-rate curve. Bike, Run
          and Swim use provider sport families. Brick, Custom, Day off and Race
          cannot be separated from recorded native data; individual or mixed
          selections containing them are unavailable.
        </p>
      )}
      {definition.kind === "cadence-curve" && (
        <p className="dta-data-note">
          Cadence uses recorded native RPM without running-step doubling or
          sport normalization. All includes available native recording types;
          individual Brick, Custom, Day off and Race cannot be separated.
        </p>
      )}
      {definition.kind === "velocity-curve" && (
        <p className="dta-data-note">
          Speed and duration-based pace use the provider’s native reported
          velocity precision. Zero speed has no finite pace. All includes
          available native recording types; Brick, Custom, Day off and Race
          cannot be separated individually.
        </p>
      )}
      {tagAvailable && (
        <DashboardChartTagSettings
          tags={tags}
          onChange={setTags}
          onCatalog={setTagCatalog}
          disabled={busy}
        />
      )}
      {!fixedHistory && definition.kind !== "unavailable" && (
        <>
          <label>
            Date Range
            <select
              disabled={busy || fixedHistory}
              value={draft.preset}
              onChange={(event) =>
                patch({
                  preset: event.target
                    .value as DashboardChartSettings["preset"],
                })
              }
            >
              {dashboardChartDatePresets.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="ddc-date-inputs">
            <label>
              From
              <input
                type="date"
                disabled={
                  busy ||
                  fixedHistory ||
                  !["custom", "through-today", "through-next-week"].includes(
                    draft.preset
                  )
                }
                value={draft.start}
                onChange={(event) => patch({ start: event.target.value })}
              />
            </label>
            <label>
              To
              <input
                type="date"
                disabled={busy || fixedHistory || draft.preset !== "custom"}
                value={draft.end}
                onChange={(event) => patch({ end: event.target.value })}
              />
            </label>
          </div>
        </>
      )}
      {[
        "peak-power",
        "peak-pace-distance",
        "peak-hr",
        "peak-cadence",
        "peak-speed",
        "peak-pace",
      ].includes(instance.type) && (
        <>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={power.comparison}
              onChange={(event) =>
                setPower((current) => ({
                  ...current,
                  comparison: event.target.checked,
                }))
              }
            />
            Comparison
          </label>
          <fieldset
            className="ddc-power-comparison"
            disabled={busy || !power.comparison}
          >
            <label>
              Comparison Date Range
              <select
                value={power.comparisonRange.preset}
                onChange={(event) =>
                  setPower((current) => ({
                    ...current,
                    comparisonRange: {
                      ...current.comparisonRange,
                      preset: event.target
                        .value as DashboardPowerSettings["comparisonRange"]["preset"],
                    },
                  }))
                }
              >
                {dashboardChartDatePresets.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="ddc-date-inputs">
              <label>
                Comparison From
                <input
                  type="date"
                  disabled={
                    busy ||
                    !power.comparison ||
                    !["custom", "through-today", "through-next-week"].includes(
                      power.comparisonRange.preset
                    )
                  }
                  value={power.comparisonRange.start}
                  onChange={(event) =>
                    setPower((current) => ({
                      ...current,
                      comparisonRange: {
                        ...current.comparisonRange,
                        start: event.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label>
                Comparison To
                <input
                  type="date"
                  disabled={
                    busy ||
                    !power.comparison ||
                    power.comparisonRange.preset !== "custom"
                  }
                  value={power.comparisonRange.end}
                  onChange={(event) =>
                    setPower((current) => ({
                      ...current,
                      comparisonRange: {
                        ...current.comparisonRange,
                        end: event.target.value,
                      },
                    }))
                  }
                />
              </label>
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Display as</legend>
            {(["chart", "grid"] as const).map((display) => (
              <label key={display}>
                <input
                  type="radio"
                  name={"power-display-" + instance.id}
                  checked={power.display === display}
                  onChange={() =>
                    setPower((current) => ({ ...current, display }))
                  }
                />
                {display === "chart" ? "Chart" : "Grid"}
              </label>
            ))}
          </fieldset>
        </>
      )}
      {fixedHistory && (
        <label>
          Peak Type
          <select
            value={peakType}
            disabled={busy}
            onChange={(event) =>
              setPeakType(
                event.target.value as NonNullable<
                  DashboardChartInstance["peakType"]
                >
              )
            }
          >
            {dashboardFitnessPeakTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      )}
      {instance.type === "fitness-summary" && (
        <label>
          Select Report Type
          <select
            disabled={busy}
            value={reportType}
            onChange={(event) =>
              setReportType(
                event.target.value as NonNullable<
                  DashboardChartInstance["reportType"]
                >
              )
            }
          >
            {dashboardFitnessReportTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      )}
      {instance.type === "metrics" && (
        <label>
          Metric
          <select
            disabled={busy}
            value={metric}
            onChange={(event) => setMetric(event.target.value)}
          >
            {calendarMetricFields
              .filter((field) => field.kind === "number")
              .map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                  {field.unit ? ` (${field.unit})` : ""}
                </option>
              ))}
          </select>
        </label>
      )}
      {definition.kind === "macronutrients" && (
        <>
          <fieldset disabled={busy}>
            <legend>Group by</legend>
            {(["day", "week", "month"] as const).map((period) => (
              <label key={period}>
                <input
                  type="radio"
                  name={`dateGrouping-${instance.id}`}
                  checked={macronutrients.period === period}
                  onChange={() =>
                    setMacronutrients((current) => ({ ...current, period }))
                  }
                />
                {{ day: "Day", week: "Week", month: "Month" }[period]}
              </label>
            ))}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Display by</legend>
            {(["calories", "percentage"] as const).map((display) => (
              <label key={display}>
                <input
                  type="radio"
                  name={`displayBy-${instance.id}`}
                  checked={macronutrients.display === display}
                  onChange={() =>
                    setMacronutrients((current) => ({ ...current, display }))
                  }
                />
                Display by {display === "calories" ? "Calories" : "Percentage"}
              </label>
            ))}
          </fieldset>
        </>
      )}
      {periodAvailable && (
        <fieldset disabled={busy}>
          <legend>By</legend>
          {(["day", "week"] as const).map((period) => (
            <label key={period}>
              <input
                type="radio"
                name={`period-${instance.id}`}
                checked={draft.period === period}
                onChange={() => patch({ period })}
              />
              {period === "day" ? "Day" : "Week"}
            </label>
          ))}
        </fieldset>
      )}
      {averageAvailable && (
        <label>
          <input
            type="checkbox"
            disabled={busy}
            checked={draft.showAverage}
            onChange={(event) => patch({ showAverage: event.target.checked })}
          />
          Show Average
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button type="button" disabled={busy} onClick={() => void apply(false)}>
          {busy ? "Saving…" : "Apply"}
        </button>
        <button type="button" disabled={busy} onClick={() => void apply(true)}>
          Apply &amp; Close
        </button>
      </footer>
    </div>
  )
}

type Loaded = { context: TrainingContext; range: DashboardChartRange }
function ChartData({
  instance,
  today,
  dashboardRange,
  globalSport,
  refresh,
  onWorkoutOpen,
}: {
  instance: DashboardChartInstance
  today: string
  dashboardRange: DashboardChartRange
  globalSport: string
  refresh: number
  onWorkoutOpen: (workout: PlannedWorkout) => void
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0)
  const definition = dashboardChartDefinition(instance.type)!
  let range: DashboardChartRange | undefined,
    rangeProblem = ""
  try {
    range = resolveDashboardChartRange(instance.settings, today, dashboardRange)
  } catch (reason) {
    rangeProblem = message(reason)
  }
  const start = range?.start,
    end = range?.end
  useEffect(() => {
    if (
      !start ||
      !end ||
      [
        "unavailable",
        "fitness-history",
        "power-curve",
        "pace-curve",
        "heart-rate-curve",
        "cadence-curve",
        "velocity-curve",
      ].includes(definition.kind)
    ) {
      setBusy(false)
      return
    }
    const controller = new AbortController()
    setBusy(true)
    setError("")
    void loadTrainingHistoryRange(start, end, {
      signal: controller.signal,
      force: refresh > 0 || retry > 0,
    })
      .then((context) => {
        if (!controller.signal.aborted)
          setLoaded({ context, range: { start, end } })
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(message(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [start, end, refresh, retry, definition.kind])
  const analysis = useMemo(
    () =>
      loaded && definition.kind !== "macronutrients"
        ? aggregateActivityHistory(
            filterDashboardWorkouts(
              completedActivities([
                ...loaded.context.planned,
                ...loaded.context.history,
              ] as ReportWorkout[]),
              instance.settings.sports,
              globalSport
            ),
            { ...loaded.range, period: instance.settings.period, sport: "all" }
          )
        : null,
    [
      loaded,
      definition.kind,
      instance.settings.sports,
      instance.settings.period,
      globalSport,
    ]
  )
  const stale =
    !!loaded && (loaded.range.start !== start || loaded.range.end !== end)
  if (rangeProblem) return <p role="alert">{rangeProblem}</p>
  if (definition.kind === "velocity-curve")
    return (
      <DashboardVelocityCurve
        instance={instance}
        today={today}
        dashboardRange={dashboardRange}
        refresh={refresh}
        globalSport={globalSport}
        onWorkoutOpen={onWorkoutOpen}
      />
    )
  if (definition.kind === "cadence-curve")
    return (
      <DashboardCadenceCurve
        instance={instance}
        today={today}
        dashboardRange={dashboardRange}
        refresh={refresh}
        globalSport={globalSport}
        onWorkoutOpen={onWorkoutOpen}
      />
    )
  if (definition.kind === "heart-rate-curve")
    return (
      <DashboardHeartRateCurve
        instance={instance}
        today={today}
        dashboardRange={dashboardRange}
        refresh={refresh}
        globalSport={globalSport}
        onWorkoutOpen={onWorkoutOpen}
      />
    )
  if (definition.kind === "power-curve")
    return (
      <DashboardPowerCurve
        onWorkoutOpen={onWorkoutOpen}
        instance={instance}
        today={today}
        dashboardRange={dashboardRange}
        refresh={refresh}
        globalSport={globalSport}
      />
    )
  if (definition.kind === "pace-curve")
    return (
      <DashboardPaceCurve
        instance={instance}
        today={today}
        dashboardRange={dashboardRange}
        refresh={refresh}
        globalSport={globalSport}
      />
    )
  if (definition.kind === "fitness-history") {
    const selected = instance.settings.sports.filter(
      (sport) =>
        globalSport === "all" ||
        (globalSport === "bike"
          ? sport === "Bike"
          : globalSport.toLowerCase() === sport.toLowerCase())
    )
    const sources = selected.flatMap<{
      sport: "Ride" | "Run" | "Swim"
      label: string
    }>((sport) =>
      instance.peakType === "Power" && sport === "Bike"
        ? [{ sport: "Ride" as const, label: "Bike power" }]
        : (!instance.peakType || instance.peakType === "Pace by Distance") &&
            (sport === "Run" || sport === "Swim")
          ? [
              {
                sport: sport as "Run" | "Swim",
                label: sport + " pace by distance",
              },
            ]
          : []
    )
    const unsupported = selected.length - sources.length
    return (
      <>
        <p className="dta-data-note">
          Current provider history windows; dashboard dates do not change this
          source.
        </p>
        {sources.map((source) => (
          <div key={source.sport}>
            <h3>{source.label}</h3>
            <Suspense fallback={<FitnessHistorySkeleton />}>
              <FitnessHistoryCard
                sport={source.sport}
                hideSportSelector
                onEffortOpen={(peak, sport) => {
                  const target = fitnessPeakEffortTarget(peak, sport)
                  if (target) openActivityEffort(target)
                }}
              />
            </Suspense>
          </div>
        ))}
        {(!sources.length || unsupported > 0) && (
          <p className="dta-empty">
            {!selected.length
              ? "No selected workout types match the dashboard filter."
              : "Verified " +
                (instance.peakType || "Pace by Distance") +
                " curves are unavailable for " +
                unsupported +
                " selected workout types. Change Peak Type or workout types to view supported provider curves."}
          </p>
        )}
      </>
    )
  }
  if (definition.kind === "unavailable")
    return <p className="dta-empty">{definition.unavailable}</p>
  const status = (
    <>
      {busy && (
        <p role="status">
          Loading chart…{loaded ? " Previous data remains visible." : ""}
        </p>
      )}
      {error && (
        <p role="alert">
          {error} Previous results are retained.{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry chart
          </button>
        </p>
      )}
      {stale && (
        <p className="dta-data-note">
          Displayed data: {loaded!.range.start} – {loaded!.range.end}
        </p>
      )}
    </>
  )
  if (!loaded) return status
  const title = chartInstanceTitle(instance)
  const format = (value: number) => dashboardChartFormat(instance, value)
  if (definition.kind === "macronutrients")
    return (
      <>
        {status}
        <DashboardMacronutrients
          history={loaded.context.wellness_history || []}
          range={loaded.range}
          settings={instance.macronutrients || newMacronutrientSettings()}
          title={title}
        />
      </>
    )
  if (!analysis) return status
  if (definition.kind === "zones") {
    const groups =
      definition.basis === "heartRate"
        ? analysis.heartRateZones
        : definition.basis === "power"
          ? analysis.powerZones
          : analysis.paceZones
    const missing =
      definition.basis === "heartRate"
        ? analysis.missingHeartRateZones
        : definition.basis === "power"
          ? analysis.missingPowerZones
          : analysis.missingPaceZones
    return (
      <>
        {status}
        {!groups.length && (
          <p className="dta-empty">No recorded zone totals in this range.</p>
        )}
        {groups.map((group) => (
          <div className="dta-zone-group" key={group.key}>
            <h3>
              {group.sport} · {group.activities} workouts
            </h3>
            <p className="dta-data-note">
              {"boundaries_bpm" in group
                ? `${group.boundaries_bpm.join(" / ")} bpm`
                : `${group.boundaries_percent.join(" / ")} ${group.unit}`}{" "}
              · recorded zone scheme
            </p>
            {(definition.weekly
              ? group.periods
              : [
                  {
                    key: "all",
                    start: loaded.range.start,
                    end: loaded.range.end,
                    seconds: group.seconds,
                  },
                ]
            ).map((period) => (
              <div key={period.key}>
                {definition.weekly && (
                  <h4>
                    {period.start} – {period.end}
                  </h4>
                )}
                {period.seconds.map((seconds, index) => (
                  <div className="dta-zone" key={index}>
                    <span>Zone {index + 1}</span>
                    <div>
                      <i
                        style={{
                          width: `${Math.max(...period.seconds) ? (seconds / Math.max(...period.seconds)) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <strong>{clock(seconds)}</strong>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        {missing > 0 && (
          <small className="dta-data-note">
            {missing} workouts have no recorded zone totals. Different
            historical zone schemes remain separate.
          </small>
        )}
      </>
    )
  }
  if (definition.kind === "races")
    return (
      <>
        {status}
        {analysis.records.filter((row) => /^RACE/.test(row.category || ""))
          .length ? (
          <ul>
            {analysis.records
              .filter((row) => /^RACE/.test(row.category || ""))
              .map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => onWorkoutOpen(row)}>
                    {row.date} · {row.title}
                  </button>
                </li>
              ))}
          </ul>
        ) : (
          <p className="dta-empty">
            No recorded race activities in this range. Planned race entries are
            not results.
          </p>
        )}
      </>
    )
  if (definition.kind === "fitness-summary") {
    const report = instance.reportType || "Planned Distance",
      rows = aggregateFitnessSummary(
        [
          ...loaded.context.planned,
          ...loaded.context.history,
        ] as PlannedWorkout[],
        { ...loaded.range, reportType: report }
      ).rows,
      duration = report.endsWith("Duration"),
      formatReport = (value: number) =>
        duration
          ? clock(value)
          : (value / 1609.344).toLocaleString("en-US", {
              maximumFractionDigits: 1,
            }) + " mi",
      known = rows.filter((row) => row.value != null && row.value > 0),
      colors = [
        "#176b91",
        "#bd1818",
        "#43a2c6",
        "#618e3d",
        "#986cab",
        "#df8c25",
      ],
      total = known.reduce((sum, row) => sum + (row.value || 0), 0)
    return (
      <>
        {status}
        <p className="dta-data-note">
          {report} by sport. Only available canonical measurements contribute;
          unknown targets remain unknown.
        </p>
        {known.length ? (
          <div
            className="dta-chart"
            role="img"
            aria-label={report + " by sport"}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart accessibilityLayer>
                <Pie
                  data={known}
                  dataKey="value"
                  nameKey="sport"
                  outerRadius="75%"
                  label={(props) =>
                    props.percent && props.percent >= 0.05
                      ? (props.percent * 100).toFixed(1) + "%"
                      : ""
                  }
                >
                  {known.map((row, index) => (
                    <Cell
                      key={row.sport}
                      fill={colors[index % colors.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) =>
                    typeof value === "number" ? formatReport(value) : "—"
                  }
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="dta-empty">
            {rows.length
              ? "No positive known measurements for this report."
              : "No " +
                (report.startsWith("Planned") ? "planned" : "completed") +
                " workouts in this date range."}
          </p>
        )}
        {rows.length > 0 && (
          <ul className="ddc-summary-values">
            {rows.map((row) => (
              <li key={row.sport}>
                {row.sport}: {row.value == null ? "—" : formatReport(row.value)}
                {row.missing > 0
                  ? " (" + row.missing + " unknown measurements)"
                  : ""}
                {row.value != null && total > 0
                  ? " · " + ((row.value / total) * 100).toFixed(1) + "%"
                  : ""}
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }
  if (definition.kind === "performance") {
    const rows = dashboardPerformanceSeries(
      loaded.context.wellness_history || [],
      loaded.range
    )
    const available = rows.filter(
      (row) => row.fitness != null || row.fatigue != null || row.form != null
    )
    return (
      <>
        {status}
        <p className="dta-data-note">
          Athlete-wide daily provider CTL, ATL and TSB; no sport-specific load
          is inferred.
        </p>
        {available.length ? (
          <div
            className="dta-chart"
            role="img"
            aria-label="Daily provider fitness, fatigue and form"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="#e9e9e9" />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fontSize: 10 }}
                  minTickGap={35}
                />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                {(
                  [
                    ["fitness", "Fitness (CTL)", "#377cca"],
                    ["fatigue", "Fatigue (ATL)", "#c951aa"],
                    ["form", "Form (TSB)", "#e9ad30"],
                  ] as const
                ).map(([key, name, color]) => (
                  <Line
                    key={key}
                    dataKey={key}
                    name={name}
                    stroke={color}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="dta-empty">
            No daily fitness measurements in this range.
          </p>
        )}
      </>
    )
  }
  const {
    rows: metricRows,
    values,
    mean,
  } = dashboardChartSeries(
    instance,
    analysis,
    loaded.context.wellness_history || [],
    loaded.range
  )
  return (
    <>
      {status}
      {definition.kind === "metrics" && (
        <p className="dta-data-note">
          {calendarMetricFields.find((field) => field.key === instance.metric)
            ?.label || "Weight"}
          : athlete-wide{" "}
          {instance.settings.period === "week"
            ? "last recorded snapshot each week"
            : "daily snapshots"}
          ; missing values stay unknown.
        </p>
      )}
      {instance.settings.showAverage && (
        <p title="Arithmetic mean of available displayed period values">
          Average: {mean == null ? "—" : format(mean)}
        </p>
      )}
      <div
        className="dta-chart"
        role="img"
        aria-label={`${title}, ${metricRows.length} ${instance.settings.period} values`}
      >
        {values.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={metricRows}
              margin={{ top: 10, right: 20, bottom: 12, left: 4 }}
              accessibilityLayer
            >
              <CartesianGrid vertical={false} stroke="#e9e9e9" />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fontSize: 10, fill: "#666" }}
                minTickGap={24}
                tickLine={false}
              />
              <YAxis
                tickFormatter={format}
                tick={{ fontSize: 9, fill: "#666" }}
                width={66}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                labelFormatter={(value) => String(value)}
                formatter={(value) => [
                  typeof value === "number" ? format(value) : "—",
                  title,
                ]}
              />
              {instance.settings.showAverage && mean != null && (
                <ReferenceLine
                  y={mean}
                  stroke="#7c939e"
                  strokeDasharray="4 3"
                />
              )}
              <Bar
                dataKey="value"
                fill={definition.metric === "tss" ? "#bd0909" : "#175c82"}
                maxBarSize={45}
                name={title}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="dta-empty">No recorded measurements in this range.</p>
        )}
      </div>
      {metricRows.some((row) => row.missing > 0) && (
        <small className="dta-data-note">
          Available measurements are shown; some workouts are missing this
          metric.
        </small>
      )}
    </>
  )
}

export function DesktopDashboardCharts({
  today,
  dashboardRange,
  globalSport,
  refresh,
  libraryOpen,
  onLibraryClose,
  legacyChartIds,
  onWorkoutOpen,
}: {
  today: string
  dashboardRange: DashboardChartRange
  globalSport: string
  refresh: number
  libraryOpen: boolean
  onLibraryClose: () => void
  legacyChartIds: readonly string[]
  onWorkoutOpen: (workout: PlannedWorkout) => void
}) {
  const namespace = dashboardLayoutNamespace(trainingCacheScope()),
    key = `training-agent:${namespace}:v2`,
    client = useMemo(
      () => dashboardLayoutClient(namespace, trainingCacheScope),
      [namespace]
    )
  const [initial] = useState(() =>
    cachedLayout(key, migratedDashboardLayout(legacyChartIds, dashboardRange))
  )
  const [layout, setLayout] = useState(initial.layout),
    [status, setStatus] = useState(
      initial.pending
        ? "Local dashboard changes await server confirmation."
        : "Loading saved dashboard…"
    ),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [settingsId, setSettingsId] = useState<string | null>(null)
  const current = useRef(layout),
    epoch = useRef(0),
    alive = useRef(true),
    pending = useRef(initial.pending)
  const settingsTrigger = useRef<HTMLButtonElement | null>(null)
  const closeSettings = () => {
    setSettingsId(null)
    queueMicrotask(() => settingsTrigger.current?.focus())
  }
  useEffect(() => {
    alive.current = true
    const controller = new AbortController(),
      revision = epoch.current
    void client
      .load(controller.signal)
      .then((saved) => {
        if (
          controller.signal.aborted ||
          epoch.current !== revision ||
          pending.current
        )
          return
        if (saved) {
          current.current = saved
          setLayout(saved)
          cacheLayout(key, { layout: saved, pending: false })
        }
        setStatus(
          saved
            ? "Dashboard loaded from server."
            : "Default dashboard. Changes save to this connection."
        )
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(message(reason))
          setStatus("Local dashboard retained.")
        }
      })
    return () => {
      alive.current = false
      controller.abort()
    }
  }, [client, key])
  const persist = async (next: DashboardLayout) => {
    const revision = ++epoch.current
    current.current = next
    pending.current = true
    setLayout(next)
    setStatus("Saving dashboard…")
    setError("")
    cacheLayout(key, { layout: next, pending: true })
    try {
      await client.save(next)
      if (epoch.current === revision) {
        pending.current = false
        if (sameDashboardLayout(cachedLayout(key, next).layout, next))
          cacheLayout(key, { layout: next, pending: false })
        if (alive.current) setStatus("Dashboard saved to server.")
      }
      return true
    } catch (reason) {
      if (epoch.current === revision && alive.current) {
        setError(message(reason))
        setStatus("Local changes retained; server save is unconfirmed.")
      }
      return false
    }
  }
  const mutate = (operation: () => DashboardLayout) => {
    try {
      void persist(operation())
    } catch (reason) {
      setError(message(reason))
    }
  }
  const add = (type: DashboardChartType, index?: number) =>
    mutate(() =>
      insertDashboardChart(
        current.current,
        newDashboardChart(type, dashboardRange),
        index
      )
    )
  const drop = (event: DragEvent, index: number) => {
    event.preventDefault()
    try {
      const payload = JSON.parse(
        event.dataTransfer.getData("application/x-training-chart")
      )
      if (payload.instance && typeof payload.instance === "string")
        mutate(() =>
          moveDashboardChart(
            current.current,
            payload.instance,
            index >
              current.current.instances.findIndex(
                (instance) => instance.id === payload.instance
              )
              ? index - 1
              : index
          )
        )
      else if (
        typeof payload.type === "string" &&
        dashboardChartDefinition(payload.type)
      )
        add(payload.type, index)
    } catch {
      /* Ignore unrelated drag payloads. */
    }
  }
  const settingsInstance = layout.instances.find(
    (instance) => instance.id === settingsId
  )
  return (
    <div className="ddc-workspace">
      <p className="ddc-save-status" role="status">
        {status}
      </p>
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => void persist(current.current)}>
            Retry dashboard save
          </button>
        </p>
      )}
      {libraryOpen && (
        <aside
          className="dta-library ddc-library"
          id="dta-library"
          aria-label="Charts Library"
        >
          <header>
            <h2>Charts Library</h2>
            <button
              type="button"
              aria-label="Close charts library"
              onClick={onLibraryClose}
            >
              <X size={16} />
            </button>
          </header>
          <p>Drag charts to dashboard</p>
          <label className="ddc-search">
            Search charts
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="ddc-library-list">
            {dashboardChartCatalog
              .filter((item) =>
                item.title.toLowerCase().includes(search.toLowerCase())
              )
              .map((item) => (
                <div
                  className="ddc-library-tile"
                  key={item.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy"
                    event.dataTransfer.setData(
                      "application/x-training-chart",
                      JSON.stringify({ type: item.id })
                    )
                  }}
                >
                  <GripVertical size={15} />
                  <span>{item.title}</span>
                  <button
                    type="button"
                    aria-label={`Add ${item.title}`}
                    disabled={layout.instances.length >= 100}
                    onClick={() => add(item.id)}
                  >
                    Add
                  </button>
                </div>
              ))}
          </div>
          <button
            type="button"
            onClick={() =>
              mutate(() => migratedDashboardLayout(undefined, dashboardRange))
            }
          >
            Reset chart layout
          </button>
        </aside>
      )}
      <div
        className="dta-chart-grid"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/x-training-chart"))
            event.preventDefault()
        }}
        onDrop={(event) => {
          if (event.target === event.currentTarget)
            drop(event, layout.instances.length)
        }}
      >
        {layout.instances.map((instance, index) => (
          <section
            key={instance.id}
            className="dta-card ddc-instance"
            data-chart-instance={instance.id}
            aria-label={chartInstanceTitle(instance)}
            onDragOver={(event) => {
              if (
                event.dataTransfer.types.includes(
                  "application/x-training-chart"
                )
              )
                event.preventDefault()
            }}
            onDrop={(event) => {
              event.stopPropagation()
              drop(event, index)
            }}
          >
            <header className="ddc-card-header">
              <button
                type="button"
                className="ddc-grip"
                draggable
                aria-label={`Drag ${chartInstanceTitle(instance)}`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move"
                  event.dataTransfer.setData(
                    "application/x-training-chart",
                    JSON.stringify({ instance: instance.id })
                  )
                }}
              >
                <GripVertical size={16} />
              </button>
              <h2>{chartInstanceTitle(instance)}</h2>
              <div className="ddc-card-actions">
                <button
                  type="button"
                  aria-label={`Move ${chartInstanceTitle(instance)} up`}
                  disabled={index === 0}
                  onClick={() =>
                    mutate(() =>
                      moveDashboardChart(
                        current.current,
                        instance.id,
                        index - 1
                      )
                    )
                  }
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${chartInstanceTitle(instance)} down`}
                  disabled={index === layout.instances.length - 1}
                  onClick={() =>
                    mutate(() =>
                      moveDashboardChart(
                        current.current,
                        instance.id,
                        index + 1
                      )
                    )
                  }
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Duplicate ${chartInstanceTitle(instance)}`}
                  onClick={() =>
                    mutate(() =>
                      insertDashboardChart(
                        current.current,
                        { ...structuredClone(instance), id: randomId() },
                        index + 1
                      )
                    )
                  }
                >
                  <Copy size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Configure ${chartInstanceTitle(instance)}`}
                  onClick={(event) => {
                    settingsTrigger.current = event.currentTarget
                    setSettingsId(instance.id)
                  }}
                >
                  <Settings2 size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${chartInstanceTitle(instance)}`}
                  onClick={() =>
                    mutate(() => ({
                      ...current.current,
                      instances: current.current.instances.filter(
                        (item) => item.id !== instance.id
                      ),
                    }))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </header>
            <ChartData
              instance={instance}
              today={today}
              dashboardRange={dashboardRange}
              globalSport={globalSport}
              refresh={refresh}
              onWorkoutOpen={onWorkoutOpen}
            />
            {settingsInstance?.id === instance.id && (
              <ChartSettings
                key={instance.id}
                instance={instance}
                today={today}
                dashboardRange={dashboardRange}
                onClose={closeSettings}
                onApply={(
                  settings,
                  metric,
                  peakType,
                  reportType,
                  power,
                  macronutrients,
                  tags
                ) =>
                  persist({
                    ...current.current,
                    instances: current.current.instances.map((item) =>
                      item.id === instance.id
                        ? {
                            ...item,
                            settings: structuredClone(settings),
                            ...(tags ? { tags: [...tags] } : {}),
                            ...(metric ? { metric } : {}),
                            ...(peakType ? { peakType } : {}),
                            ...(reportType ? { reportType } : {}),
                            ...(macronutrients
                              ? {
                                  macronutrients:
                                    structuredClone(macronutrients),
                                }
                              : {}),
                            ...(power
                              ? instance.type === "peak-pace-distance"
                                ? { pace: power }
                                : instance.type === "peak-hr"
                                  ? { hr: power }
                                  : instance.type === "peak-cadence"
                                    ? { cadence: power }
                                    : instance.type === "peak-speed"
                                      ? { speed: power }
                                      : instance.type === "peak-pace"
                                        ? { durationPace: power }
                                        : { power }
                              : {}),
                          }
                        : item
                    ),
                  })
                }
              />
            )}
          </section>
        ))}
        {!layout.instances.length && (
          <p className="dta-empty">
            Add charts from the Charts Library to build your dashboard.
          </p>
        )}
      </div>
    </div>
  )
}
