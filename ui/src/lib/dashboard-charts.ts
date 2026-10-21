import { validDashboardTags } from "./dashboard-chart-tags.ts"
import type { PlannedWorkout } from "./training-context"
import { randomId } from "./random-id.ts"
import {
  dashboardChartSports,
  validDashboardChartSettings,
  type DashboardChartSettings,
  type DashboardChartSport,
  type DashboardChartRange,
} from "./dashboard-chart-settings.ts"
import type {
  AggregateMetric,
  AggregateMaximumMetric,
} from "./aggregate-analysis"
import {
  newDashboardPowerSettings,
  dashboardPowerTitle,
  type DashboardPowerSettings,
} from "./dashboard-power-curve.ts"
import {
  newMacronutrientSettings,
  validMacronutrientSettings,
  type MacronutrientSettings,
} from "./dashboard-macronutrients.ts"
import { dashboardHeartRateTitle } from "./dashboard-heart-rate-curve.ts"
import { dashboardCadenceTitle } from "./dashboard-cadence-curve.ts"
import { dashboardVelocityTitle } from "./dashboard-velocity-curve.ts"

type CatalogEntry = {
  id: string
  title: string
  metric?: AggregateMetric
  maximum?: AggregateMaximumMetric
  kind:
    | "sum"
    | "maximum"
    | "pace"
    | "performance"
    | "fitness-history"
    | "fitness-summary"
    | "power-curve"
    | "pace-curve"
    | "heart-rate-curve"
    | "cadence-curve"
    | "velocity-curve"
    | "macronutrients"
    | "zones"
    | "metrics"
    | "races"
    | "unavailable"
  basis?: "heartRate" | "power" | "pace"
  weekly?: boolean
  unavailable?: string
}
export const dashboardChartCatalog = [
  {
    id: "calories",
    title: "Calories by Time Period",
    kind: "sum",
    metric: "calories",
  },
  {
    id: "distance",
    title: "Distance By Week/Day",
    kind: "sum",
    metric: "distance_meters",
  },
  {
    id: "duration",
    title: "Duration By Week/Day",
    kind: "sum",
    metric: "duration_seconds",
  },
  {
    id: "elevation",
    title: "Elevation Gain By Week/Day",
    kind: "sum",
    metric: "elevation_gain",
  },
  { id: "fitness-history", title: "Fitness History", kind: "fitness-history" },
  { id: "fitness-summary", title: "Fitness Summary", kind: "fitness-summary" },
  {
    id: "kilojoules",
    title: "Kilojoules By Week/Day",
    kind: "sum",
    metric: "work_kj",
  },
  {
    id: "longest-distance",
    title: "Longest Workout (Distance)",
    kind: "maximum",
    maximum: "distance_meters",
  },
  {
    id: "longest-duration",
    title: "Longest Workout (Duration)",
    kind: "maximum",
    maximum: "duration_seconds",
  },
  {
    id: "macronutrients",
    title: "Macronutrients by Time Period",
    kind: "macronutrients",
  },
  { id: "metrics", title: "Metrics", kind: "metrics" },
  {
    id: "peak-cadence",
    title: "Peak Cadence",
    kind: "cadence-curve",
  },
  {
    id: "peak-hr",
    title: "Peak HR",
    kind: "heart-rate-curve",
  },
  {
    id: "peak-pace",
    title: "Peak Pace",
    kind: "velocity-curve",
  },
  {
    id: "peak-pace-distance",
    title: "Peak Pace by Distance",
    kind: "pace-curve",
  },
  {
    id: "peak-power",
    title: "Peak Power",
    kind: "power-curve",
  },
  {
    id: "peak-speed",
    title: "Peak Speed",
    kind: "velocity-curve",
  },
  { id: "performance", title: "Performance Management", kind: "performance" },
  {
    id: "power-profile",
    title: "Power Profile",
    kind: "unavailable",
    unavailable:
      "A verified power-duration profile for this date range is not available in these recorded summaries. A single maximum does not establish this curve.",
  },
  { id: "races", title: "Race Reports", kind: "races" },
  { id: "tss", title: "TSS By Week/Day", kind: "sum", metric: "tss" },
  {
    id: "hr-zones",
    title: "Time In HR Zones",
    kind: "zones",
    basis: "heartRate",
  },
  {
    id: "hr-zones-week",
    title: "Time In HR Zones By Week",
    kind: "zones",
    basis: "heartRate",
    weekly: true,
  },
  {
    id: "power-zones",
    title: "Time In Power Zones",
    kind: "zones",
    basis: "power",
  },
  {
    id: "power-zones-week",
    title: "Time In Power Zones By Week",
    kind: "zones",
    basis: "power",
    weekly: true,
  },
  {
    id: "speed-zones",
    title: "Time In Speed Zones",
    kind: "zones",
    basis: "pace",
  },
  {
    id: "speed-zones-week",
    title: "Time In Speed Zones By Week",
    kind: "zones",
    basis: "pace",
    weekly: true,
  },
] as const satisfies readonly CatalogEntry[]
export type DashboardChartType = (typeof dashboardChartCatalog)[number]["id"]
export type DashboardChartInstance = {
  id: string
  type: DashboardChartType
  settings: DashboardChartSettings
  metric?: string
  peakType?:
    "Heart Rate" | "Power" | "Cadence" | "Speed" | "Pace" | "Pace by Distance"
  reportType?:
    | "Planned Distance"
    | "Completed Distance"
    | "Planned Duration"
    | "Completed Duration"
  power?: DashboardPowerSettings
  pace?: DashboardPowerSettings
  hr?: DashboardPowerSettings
  cadence?: DashboardPowerSettings
  speed?: DashboardPowerSettings
  durationPace?: DashboardPowerSettings
  macronutrients?: MacronutrientSettings
  tags?: string[]
}
export type DashboardLayout = {
  version: 2
  instances: DashboardChartInstance[]
}
export const dashboardChartDefinition = (type: string) =>
  dashboardChartCatalog.find((entry) => entry.id === type) as
    CatalogEntry | undefined
export const chartInstanceTitle = (instance: DashboardChartInstance) =>
  instance.settings.title.trim() ||
  (["peak-speed", "peak-pace"].includes(instance.type)
    ? dashboardVelocityTitle(
        instance.settings.sports,
        instance.type === "peak-pace" ? "pace" : "speed"
      )
    : "") ||
  (instance.type === "peak-power"
    ? dashboardPowerTitle(instance.settings.sports)
    : "") ||
  (instance.type === "peak-cadence"
    ? dashboardCadenceTitle(instance.settings.sports)
    : "") ||
  (instance.type === "longest-distance"
    ? `Longest Workout (Distance): ${instance.settings.sports.length === dashboardChartSports.length ? "All Workout Types" : instance.settings.sports.join(", ") || "No Workout Types"}`
    : "") ||
  (instance.type === "peak-hr"
    ? dashboardHeartRateTitle(instance.settings.sports)
    : "") ||
  (instance.type === "macronutrients"
    ? `Macronutrients by ${
        { day: "Day", week: "Week", month: "Month" }[
          (instance.macronutrients || newMacronutrientSettings()).period
        ]
      }`
    : "") ||
  (instance.type === "peak-pace-distance" &&
  instance.settings.sports.length === 1
    ? `Peak Pace by Distance: ${instance.settings.sports[0]}`
    : "") ||
  (instance.type === "fitness-summary"
    ? `Fitness Summary: ${instance.reportType || "Planned Distance"}`
    : "") ||
  dashboardChartDefinition(instance.type)?.title ||
  "Chart"
export const dashboardLayoutNamespace = (scope: string) =>
  `desktopDashboard:${scope}`
export const dashboardFitnessPeakTypes = [
  "Heart Rate",
  "Power",
  "Cadence",
  "Speed",
  "Pace",
  "Pace by Distance",
] as const
export const dashboardFitnessReportTypes = [
  "Planned Distance",
  "Completed Distance",
  "Planned Duration",
  "Completed Duration",
] as const

export function newDashboardChart(
  type: DashboardChartType,
  range: DashboardChartRange,
  id = randomId()
): DashboardChartInstance {
  const definition = dashboardChartDefinition(type)
  if (!definition) throw Error("Choose a supported dashboard chart.")
  return {
    id,
    type,
    settings: {
      ...range,
      title: "",
      sports: [...dashboardChartSports],
      preset: "dashboard",
      period: "week",
      showAverage: true,
    },
    ...(type === "metrics" ? { metric: "weight" } : {}),
    ...(type === "macronutrients"
      ? { macronutrients: newMacronutrientSettings() }
      : {}),
    ...(type === "peak-hr" ? { hr: newDashboardPowerSettings(range) } : {}),
    ...(type === "peak-cadence"
      ? { cadence: newDashboardPowerSettings(range) }
      : {}),
    ...(type === "peak-speed"
      ? { speed: newDashboardPowerSettings(range) }
      : {}),
    ...(type === "peak-pace"
      ? { durationPace: newDashboardPowerSettings(range) }
      : {}),
    ...(type === "peak-power"
      ? { power: newDashboardPowerSettings(range) }
      : {}),
    ...(type === "peak-pace-distance"
      ? {
          pace: newDashboardPowerSettings(range),
          settings: {
            ...range,
            title: "",
            sports: ["Run"],
            preset: "dashboard",
            period: "week",
            showAverage: false,
          } as DashboardChartSettings,
        }
      : {}),
    ...(type === "fitness-summary"
      ? { reportType: "Planned Distance" as const }
      : {}),
    ...(type === "fitness-history"
      ? {
          peakType: "Pace by Distance" as const,
          settings: {
            ...range,
            title: "",
            sports: ["Run"],
            preset: "dashboard",
            period: "week",
            showAverage: true,
          } as DashboardChartSettings,
        }
      : {}),
  }
}
export function validDashboardLayout(value: unknown): value is DashboardLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const layout = value as DashboardLayout
  return (
    layout.version === 2 &&
    Array.isArray(layout.instances) &&
    layout.instances.length <= 100 &&
    new Set(layout.instances.map((instance) => instance?.id)).size ===
      layout.instances.length &&
    layout.instances.every(
      (instance) =>
        instance &&
        typeof instance.id === "string" &&
        /^[a-zA-Z0-9_-]{1,100}$/.test(instance.id) &&
        !!dashboardChartDefinition(instance.type) &&
        validDashboardChartSettings(instance.settings) &&
        (instance.tags === undefined ||
          (validDashboardTags(instance.tags) &&
            [
              "peak-power",
              "peak-hr",
              "peak-cadence",
              "peak-speed",
              "peak-pace",
            ].includes(instance.type))) &&
        (instance.metric === undefined ||
          [
            "weight",
            "sleepHours",
            "bodyFat",
            "restingHR",
            "hrv",
            "muscleMass",
            "deepSleepHours",
            "remSleepHours",
          ].includes(instance.metric)) &&
        (instance.peakType === undefined ||
          dashboardFitnessPeakTypes.includes(instance.peakType)) &&
        (instance.reportType === undefined ||
          dashboardFitnessReportTypes.includes(instance.reportType)) &&
        (instance.macronutrients === undefined ||
          validMacronutrientSettings(instance.macronutrients)) &&
        [
          instance.power,
          instance.pace,
          instance.hr,
          instance.cadence,
          instance.speed,
          instance.durationPace,
        ].every(
          (curve) =>
            curve === undefined ||
            (!!curve &&
              typeof curve === "object" &&
              !Array.isArray(curve) &&
              typeof curve.comparison === "boolean" &&
              ["chart", "grid"].includes(curve.display) &&
              validDashboardChartSettings({
                ...curve.comparisonRange,
                title: "",
                sports: [],
                period: "day",
                showAverage: false,
              }))
        )
    )
  )
}
export function migratedDashboardLayout(
  ids: readonly string[] | undefined,
  range: DashboardChartRange
): DashboardLayout {
  const defaults = [
    "duration",
    "tss",
    "performance",
    "run",
    "bike",
    "swim",
    "zones",
    "fitness",
  ]
  const instances = [...new Set(ids || defaults)].flatMap((id) => {
    const type =
      (
        {
          run: "distance",
          bike: "distance",
          swim: "distance",
          zones: "hr-zones",
          fitness: "fitness-history",
        } as Record<string, DashboardChartType>
      )[id] || (id as DashboardChartType)
    if (!dashboardChartDefinition(type)) return []
    const instance = newDashboardChart(type, range, `legacy-${id}`)
    const titles: Record<string, string> = {
      duration: "Total Duration",
      tss: "TSS by Week",
      performance: "Performance Management - All Workout Types",
      run: "Run Distance",
      bike: "Bike Distance",
      swim: "Swim Distance",
    }
    instance.settings.title = titles[id] || ""
    if (["run", "bike", "swim"].includes(id))
      instance.settings.sports =
        id === "run" ? ["Run"] : id === "swim" ? ["Swim"] : ["Bike", "Mtn Bike"]
    return [instance]
  })
  return { version: 2, instances }
}
export function moveDashboardChart(
  layout: DashboardLayout,
  id: string,
  index: number
): DashboardLayout {
  const source = layout.instances.findIndex((instance) => instance.id === id)
  if (source < 0 || !Number.isInteger(index)) return layout
  const target = Math.max(0, Math.min(layout.instances.length - 1, index))
  if (source === target) return layout
  const instances = [...layout.instances],
    [instance] = instances.splice(source, 1)
  instances.splice(target, 0, instance)
  return { ...layout, instances }
}
export function insertDashboardChart(
  layout: DashboardLayout,
  instance: DashboardChartInstance,
  index = layout.instances.length
): DashboardLayout {
  if (layout.instances.length >= 100)
    throw Error("This dashboard supports up to 100 chart instances.")
  if (layout.instances.some((item) => item.id === instance.id))
    throw Error("This chart instance is already on the dashboard.")
  const instances = [...layout.instances]
  instances.splice(Math.max(0, Math.min(instances.length, index)), 0, instance)
  const next = { ...layout, instances }
  if (!validDashboardLayout(next))
    throw Error("The chart settings are invalid.")
  return next
}
export function dashboardWorkoutSport(
  workout: PlannedWorkout
): DashboardChartSport {
  const variant = workout.editor_model?.variant || workout.display_variant
  if (variant === "brick") return "Brick"
  if (variant === "day-off") return "Day off"
  if (variant === "custom") return "Custom"
  if (/^RACE/.test(workout.category || "")) return "Race"
  const actual =
    workout.activity_type ||
    workout.provider_type ||
    workout.editor_model?.sport ||
    workout.sport
  if (/mountain.?bike|mtn.?bike/i.test(actual)) return "Mtn Bike"
  if (/ride|bike|cycl/i.test(actual)) return "Bike"
  if (/run/i.test(actual)) return "Run"
  if (/swim/i.test(actual)) return "Swim"
  if (/weight|strength/i.test(actual)) return "Strength"
  if (/nordic|xc.?ski/i.test(actual)) return "XC-Ski"
  if (/row/i.test(actual)) return "Rowing"
  if (/walk/i.test(actual)) return "Walk"
  if (/^workout$|crosstrain/i.test(actual)) return "Crosstrain"
  return "Other"
}
export function filterDashboardWorkouts(
  workouts: readonly PlannedWorkout[],
  sports: readonly DashboardChartSport[],
  globalSport = "all"
) {
  const selected = new Set(sports)
  return workouts.filter((workout) => {
    const sport = dashboardWorkoutSport(workout)
    if (!selected.has(sport)) return false
    if (globalSport === "all") return true
    if (globalSport === "bike") return sport === "Bike" || sport === "Mtn Bike"
    const label =
      (
        {
          run: "Run",
          swim: "Swim",
          WeightTraining: "Strength",
          NordicSki: "XC-Ski",
          Workout: "Crosstrain",
        } as Record<string, string>
      )[globalSport] || globalSport
    return sport === label
  })
}
