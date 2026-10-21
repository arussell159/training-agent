import type { WorkoutSummaryValues } from "./training-context"
export type PlannedValueKey =
  | "duration_seconds"
  | "distance_meters"
  | "average_speed"
  | "average_power"
  | "normalized_power"
  | "calories"
  | "elevation_gain"
  | "elevation_loss"
  | "tss"
  | "intensity_factor"
  | "work_kj"
export type PlannedValuePresentation = "pace"
export type PlannedValueDraft = Record<PlannedValueKey, string> & {
  average_pace?: string
  average_speed_source?: "speed" | "pace" | "calculated"
  average_speed_exact?: string
}
export type PlannedValueRow = {
  key: PlannedValueKey
  label: string
  unit: string
  rowKey?: "average_pace"
  presentation?: PlannedValuePresentation
  planned?: false
}

const plannedValueKeys: PlannedValueKey[] = [
  "duration_seconds",
  "distance_meters",
  "average_speed",
  "average_power",
  "normalized_power",
  "calories",
  "elevation_gain",
  "elevation_loss",
  "tss",
  "intensity_factor",
  "work_kj",
]

const rowingSport = (sport: string) => /rowing/i.test(sport)
const swimSport = (sport: string) => /swim/i.test(sport)
const bikeSport = (sport: string) => /bike|ride|^brick$/i.test(sport)
const mountainBikeSport = (sport: string) =>
  /mountain.?bike|mtn.?bike/i.test(sport)
const dualSpeedSport = (sport: string) =>
  mountainBikeSport(sport) || /^brick$/i.test(sport)
const paceDistance = (sport: string, completed = false) =>
  rowingSport(sport)
    ? 500
    : swimSport(sport)
      ? completed
        ? 91.44
        : 100
      : 1609.344

// A background read can update untouched values, but must not replace typing
// that started while the provider revision was being loaded.
export function mergeLoadedPlannedDraft(
  current: PlannedValueDraft,
  baseline: PlannedValueDraft,
  remote: PlannedValueDraft
) {
  const merged = { ...remote }
  for (const key of Object.keys(current)) {
    if (
      (current as Record<string, string>)[key] !==
      (baseline as Record<string, string>)[key]
    )
      (merged as Record<string, string>)[key] = (
        current as Record<string, string>
      )[key]
  }
  // A typed presentation and its physical value form one edit. Never merge a
  // remote canonical speed with a local, incomplete or unrounded pace draft.
  if (
    speedDraftChanged(current, baseline) &&
    ("average_pace" in current ||
      "average_pace" in baseline ||
      "average_pace" in remote)
  ) {
    for (const key of [
      "average_speed",
      "average_pace",
      "average_speed_source",
      "average_speed_exact",
    ])
      (merged as Record<string, string | undefined>)[key] = (
        current as Record<string, string | undefined>
      )[key]
  }
  return merged
}
export function plannedValueRows(sport: string) {
  if (/^day[ -]?off$/i.test(sport))
    return [
      { key: "duration_seconds" as const, label: "Duration", unit: "h:m:s" },
    ] as PlannedValueRow[]
  const swim = swimSport(sport),
    bike = bikeSport(sport),
    rowing = rowingSport(sport)
  const strength = /strength|weight/i.test(sport)
  const noPace =
    strength || /^(?:Other|Sauna|Workout|Crosstrain|Custom)$/i.test(sport)
  const shortPace = swim || /^(?:NordicSki|XC[ -]?Ski)$/i.test(sport)
  const shortElevation = rowing || /^Walk$/i.test(sport)
  const mountainBike = mountainBikeSport(sport)
  const brick = /^brick$/i.test(sport)
  const rows: PlannedValueRow[] = [
    { key: "duration_seconds", label: "Duration", unit: "h:m:s" },
    ...(!strength
      ? [
          {
            key: "distance_meters" as const,
            label: "Distance",
            unit: swim ? "yds" : rowing ? "m" : "mi",
          },
        ]
      : []),
    ...(!noPace
      ? [
          {
            key: "average_speed" as const,
            label: bike ? "Average Speed" : "Average Pace",
            unit: bike
              ? "mph"
              : swim
                ? "sec/100y"
                : rowing
                  ? "sec/500m"
                  : "min/mi",
          },
        ]
      : []),
    ...(brick
      ? [
          {
            key: "average_speed" as const,
            rowKey: "average_pace" as const,
            presentation: "pace" as const,
            label: "Average Pace",
            unit: "min/mi",
          },
        ]
      : []),
    { key: "calories", label: "Calories", unit: "kcal" },
    ...(!noPace && !shortPace
      ? [
          {
            key: "elevation_gain" as const,
            label: "Elevation Gain",
            unit: rowing ? "m" : "ft",
          },
        ]
      : []),
    { key: "tss", label: "TSS", unit: "TSS" },
    { key: "intensity_factor", label: "IF", unit: "IF" },
  ]
  if (noPace || shortPace || shortElevation) return rows
  if (bike) {
    if (!mountainBike && !brick)
      rows.push({
        key: "normalized_power",
        label: "Normalized Power",
        unit: "W",
      })
  } else
    rows.push({ key: "elevation_loss", label: "Elevation Loss", unit: "ft" })
  if (brick)
    rows.push({
      key: "elevation_loss",
      label: "Elevation Loss",
      unit: "ft",
      planned: false,
    })
  rows.push({ key: "work_kj", label: "Work", unit: "kJ" })
  if (mountainBike)
    rows.push({
      key: "average_speed",
      rowKey: "average_pace",
      presentation: "pace",
      label: "Average Pace",
      unit: "min/mi",
    })
  return rows
}

export function recordedValueRows(sport: string): Array<{
  label: string
  unit: string
  kind: "heartRate" | "power" | "pace"
}> {
  const heartRate = {
    label: "Heart Rate",
    unit: "bpm",
    kind: "heartRate" as const,
  }
  if (/^brick$/i.test(sport))
    return [
      { label: "Power", unit: "W", kind: "power" },
      { label: "Pace", unit: "min/mi", kind: "pace" },
      heartRate,
    ]
  if (bikeSport(sport))
    return [heartRate, { label: "Power", unit: "W", kind: "power" }]
  if (/run/i.test(sport))
    return [{ label: "Pace", unit: "min/mi", kind: "pace" }, heartRate]
  return [heartRate]
}
const round = (value: number, decimals: number) =>
  String(Number(value.toFixed(decimals)))
export function formatPlannedValue(
  key: PlannedValueKey,
  value: number | null | undefined,
  sport: string,
  completed = false,
  presentation?: PlannedValuePresentation
) {
  if (value == null || !Number.isFinite(value)) return ""
  const swim = swimSport(sport),
    rowing = rowingSport(sport)
  if (key === "duration_seconds") {
    const seconds = Math.round(value)
    return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
  }
  if (key === "average_speed") {
    if (bikeSport(sport) && presentation !== "pace")
      return (value * 2.2369362921).toFixed(1)
    if (value <= 0) return ""
    const seconds = Math.round(paceDistance(sport, completed) / value)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  }
  if (key === "distance_meters")
    return round(
      value / (swim ? (completed ? 0.9144 : 1) : rowing ? 1 : 1609.344),
      swim ? 0 : 2
    )
  if (key === "elevation_gain" || key === "elevation_loss")
    return round(value / (rowing ? 1 : 0.3048), 0)
  return round(
    value,
    key === "intensity_factor" ? 2 : key === "work_kj" ? 1 : 0
  )
}
export function plannedValueDraft(
  values: WorkoutSummaryValues | null | undefined,
  sport: string,
  sourceSport?: string
) {
  // Planned swims retain their historical yard-based storage contract. Only an
  // explicit sport change transfers those quantities to/from other sports' SI.
  const sourceScale =
    sourceSport && swimSport(sourceSport) !== swimSport(sport)
      ? swimSport(sourceSport)
        ? 0.9144
        : 1 / 0.9144
      : 1
  const draft = Object.fromEntries(
    plannedValueKeys.map((key) => [
      key,
      formatPlannedValue(
        key,
        values?.[key] != null &&
          (key === "distance_meters" || key === "average_speed")
          ? values[key] * sourceScale
          : values?.[key],
        sport
      ),
    ])
  ) as PlannedValueDraft
  if (dualSpeedSport(sport)) {
    const speed =
      values?.average_speed == null ? null : values.average_speed * sourceScale
    draft.average_pace = formatPlannedValue(
      "average_speed",
      speed,
      sport,
      false,
      "pace"
    )
    draft.average_speed_source = "calculated"
    if (speed != null && Number.isFinite(speed))
      draft.average_speed_exact = String(speed)
  }
  return draft
}
export function parsePlannedValue(
  key: PlannedValueKey,
  text: string,
  sport: string,
  presentation?: PlannedValuePresentation
): number | null {
  if (!text.trim()) return null
  const fail = () => {
    throw Error(
      `Enter a valid ${
        plannedValueRows(sport)
          .find((row) => row.key === key && row.presentation === presentation)
          ?.label.toLowerCase() || key.replaceAll("_", " ")
      }.`
    )
  }
  if (
    key === "duration_seconds" ||
    (key === "average_speed" && (!bikeSport(sport) || presentation === "pace"))
  ) {
    const pattern =
      key === "duration_seconds" ? /^\d+:\d{1,2}:\d{2}$/ : /^\d+:\d{2}$/
    if (!pattern.test(text.trim())) return fail()
    const parts = text.trim().split(":").map(Number)
    if (parts.slice(1).some((part) => part >= 60)) return fail()
    const seconds = parts.reduce((total, part) => total * 60 + part, 0)
    if (!Number.isFinite(seconds)) return fail()
    if (key === "duration_seconds") {
      if (seconds > 604800) return fail()
      return seconds
    }
    if (seconds <= 0) return fail()
    return paceDistance(sport) / seconds
  }
  if (!/^\d+(?:\.\d+)?$/.test(text.trim())) return fail()
  const value = Number(text)
  if (
    !Number.isFinite(value) ||
    value > 1e8 ||
    (key === "intensity_factor" && value > 5) ||
    (key === "tss" && !Number.isInteger(value))
  )
    return fail()
  if (key === "distance_meters")
    return value * (swimSport(sport) || rowingSport(sport) ? 1 : 1609.344)
  if (key === "elevation_gain" || key === "elevation_loss")
    return value * (rowingSport(sport) ? 1 : 0.3048)
  if (key === "average_speed") return value / 2.2369362921
  return value
}
export function changedPlannedValues(
  draft: PlannedValueDraft,
  saved: PlannedValueDraft,
  sport: string
) {
  return Object.fromEntries(
    plannedValueKeys
      .filter((key) =>
        key === "average_speed" && dualSpeedSport(sport)
          ? speedDraftChanged(draft, saved)
          : (draft[key] || "") !== (saved[key] || "")
      )
      .map((key) => [
        key,
        key === "average_speed" && dualSpeedSport(sport)
          ? draftSpeed(draft, sport)
          : parsePlannedValue(key, draft[key] || "", sport),
      ])
  ) as Partial<WorkoutSummaryValues>
}

function speedDraftChanged(draft: PlannedValueDraft, saved: PlannedValueDraft) {
  return ["average_speed", "average_pace", "average_speed_exact"].some(
    (key) =>
      ((draft as Record<string, string>)[key] || "") !==
      ((saved as Record<string, string>)[key] || "")
  )
}

export function hasPlannedValueChanges(
  draft: PlannedValueDraft,
  saved: PlannedValueDraft,
  sport: string
) {
  return (
    plannedValueKeys.some((key) => (draft[key] || "") !== (saved[key] || "")) ||
    (dualSpeedSport(sport) && speedDraftChanged(draft, saved))
  )
}

function draftSpeed(draft: PlannedValueDraft, sport: string): number | null {
  if (dualSpeedSport(sport)) {
    if (draft.average_speed_source === "pace")
      return parsePlannedValue(
        "average_speed",
        draft.average_pace || "",
        sport,
        "pace"
      )
    if (
      draft.average_speed_source === "calculated" &&
      draft.average_speed_exact != null
    ) {
      const speed = Number(draft.average_speed_exact)
      if (!Number.isFinite(speed) || speed < 0)
        throw Error("Enter a valid average speed.")
      if (
        draft.average_speed !==
          formatPlannedValue("average_speed", speed, sport) ||
        (draft.average_pace !== undefined &&
          draft.average_pace !==
            formatPlannedValue("average_speed", speed, sport, false, "pace"))
      )
        throw Error(
          "The speed and pace draft disagree. Edit either field to reconcile them."
        )
      return speed
    }
  }
  return parsePlannedValue("average_speed", draft.average_speed || "", sport)
}

export function plannedDraftValue(
  draft: PlannedValueDraft,
  key: PlannedValueKey,
  sport: string,
  presentation?: PlannedValuePresentation
) {
  if (key !== "average_speed" || presentation !== "pace")
    return draft[key] || ""
  if (draft.average_pace !== undefined) return draft.average_pace
  try {
    return formatPlannedValue(
      key,
      draftSpeed(draft, sport),
      sport,
      false,
      "pace"
    )
  } catch {
    return ""
  }
}

function synchronizeSpeed(
  draft: PlannedValueDraft,
  speed: number | null,
  sport: string,
  source: "speed" | "pace" | "calculated"
) {
  draft.average_speed_source = source
  draft.average_speed_exact = speed == null ? undefined : String(speed)
  if (source !== "speed")
    draft.average_speed = formatPlannedValue("average_speed", speed, sport)
  if (source !== "pace")
    draft.average_pace = formatPlannedValue(
      "average_speed",
      speed,
      sport,
      false,
      "pace"
    )
}

export function withCalculatedPlannedValues(
  current: PlannedValueDraft,
  values: Partial<WorkoutSummaryValues>,
  sport: string,
  nativePresentation = false
): PlannedValueDraft {
  const next = { ...current }
  for (const key of plannedValueKeys)
    if (key in values) {
      next[key] = formatPlannedValue(key, values[key], sport)
      if (nativePresentation && values[key] != null) {
        if(key === "intensity_factor")next[key]=values[key]!.toFixed(2)
        if(key === "average_speed" && !bikeSport(sport) && /^\d:\d{2}$/.test(next[key]))next[key]=`0${next[key]}`
      }
    }
  if (dualSpeedSport(sport) && "average_speed" in values)
    synchronizeSpeed(next, values.average_speed ?? null, sport, "calculated")
  return next
}

// Recalculate the third planned value from the two inputs the athlete supplies.
// Incomplete typing stays untouched; calculation never reformats the active field.
export function updatePlannedValueDraft(
  current: PlannedValueDraft,
  key: PlannedValueKey,
  text: string,
  sport: string,
  automatic = true,
  presentation?: PlannedValuePresentation
) {
  const next = { ...current, [key]: text }
  if (dualSpeedSport(sport) && key === "average_speed") {
    if (presentation === "pace") next.average_pace = text
    next.average_speed_source = presentation === "pace" ? "pace" : "speed"
    next.average_speed_exact = undefined
    try {
      const speed = parsePlannedValue(key, text, sport, presentation)
      synchronizeSpeed(next, speed, sport, next.average_speed_source)
    } catch {
      // Keep the active text and the other view's last valid value. Saving must
      // validate the active source instead of silently using that old value.
      if (presentation === "pace") next.average_speed = current.average_speed
      return next
    }
  }
  if (
    !automatic ||
    !["duration_seconds", "distance_meters", "average_speed"].includes(key)
  )
    return next
  if (!plannedValueRows(sport).some((row) => row.key === "average_speed"))
    return next
  const read = (field: PlannedValueKey) => {
    try {
      const raw = next[field] || ""
      const value =
        field === "average_speed"
          ? draftSpeed(next, sport)
          : parsePlannedValue(
              field,
              field === "duration_seconds" && /^\d+:[0-5]\d$/.test(raw)
                ? `0:${raw}`
                : raw,
              sport
            )
      return value != null && value > 0 ? value : null
    } catch {
      return null
    }
  }
  if (read(key) == null) return next
  const duration = read("duration_seconds"),
    distance = read("distance_meters"),
    speed = read("average_speed")
  let target: PlannedValueKey, value: number
  if (key !== "duration_seconds" && distance && speed) {
    target = "duration_seconds"
    value = distance / speed
  } else if (key === "duration_seconds" && duration && distance) {
    target = "average_speed"
    value = distance / duration
  } else if (key !== "distance_meters" && duration && speed) {
    target = "distance_meters"
    value = duration * speed
  } else if (duration && distance) {
    target = "average_speed"
    value = distance / duration
  } else return next
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    (target === "duration_seconds" && value > 604800)
  )
    return next
  next[target] = formatPlannedValue(target, value, sport)
  if (target === "average_speed" && dualSpeedSport(sport))
    synchronizeSpeed(next, value, sport, "calculated")
  return next
}
