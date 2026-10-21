import {
  clone,
  chartSegments,
  convertTarget,
  distanceFactors,
  defaultTarget,
  expandSteps,
  newRepeat,
  newStep,
  paceFactors,
  stepMetrics,
  workoutTotals,
  type Target,
  type Step,
  type WorkoutModel,
  type WorkoutNode,
} from "../../../app-backend/lib/workout-editor-model.mjs"
import {
  sportZoneSettings,
  workoutZoneOptions,
  type SportZoneSettings,
} from "../../../app-backend/lib/workout-editor-zones.mjs"

// Slots use moveNode's pre-removal indices. Keep the source profile stationary
// while dragging so a changing layout cannot move the drop target underneath it.
export function desktopProfileDropSlot(
  blocks: ReadonlyArray<{ id: string; width: number }>,
  sourceId: string,
  fraction: number
): { index: number; position: number } | null {
  const source = blocks.findIndex((block) => block.id === sourceId)
  const total = blocks.reduce((sum, block) => sum + block.width, 0)
  if (source < 0 || total <= 0 || !Number.isFinite(fraction)) return null
  const point = Math.max(0, Math.min(1, fraction)) * total
  let offset = 0
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    if (point < offset + block.width)
      return index === source || index === source + 1
        ? null
        : { index, position: offset / total }
    offset += block.width
  }
  return source === blocks.length - 1
    ? null
    : { index: blocks.length, position: 1 }
}

export function desktopPaletteDropIndex(
  blocks: ReadonlyArray<{ width: number }>,
  fraction: number
): number {
  const total = blocks.reduce((sum, block) => sum + block.width, 0)
  if (!Number.isFinite(fraction) || total <= 0) return blocks.length
  const point = Math.max(0, Math.min(1, fraction)) * total
  let offset = 0
  for (let index = 0; index < blocks.length; index++) {
    if (point < offset + blocks[index].width) return index
    offset += blocks[index].width
  }
  return blocks.length
}

export function duplicateDesktopBlock(node: WorkoutNode): WorkoutNode {
  const copy = clone(node)
  const renew = (item: WorkoutNode) => {
    item.id = crypto.randomUUID()
    if (item.kind === "repeat") {
      item.steps.forEach(renew)
      if (item.recovery) renew(item.recovery)
      if (item.setRecovery) renew(item.setRecovery)
    }
  }
  renew(copy)
  return copy
}

export function desktopProfileRange(segment: {
  start: number
  end: number
  step: Step
}) {
  const target = segment.step.target
  let end = segment.end
  if (
    target.kind !== "none" &&
    target.mode === "range" &&
    target.start! > 0 &&
    target.end! > 0
  )
    end =
      segment.start *
      (paceFactors[target.unit]
        ? target.start! / target.end!
        : target.end! / target.start!)
  return {
    low: Math.min(segment.start, end),
    high: Math.max(segment.start, end),
  }
}
export function desktopBuilderTotals(model: WorkoutModel) {
  const totals = workoutTotals(model, {plannedDistanceTime: "whole-metres"})
  if (totals.load != null || totals.open || totals.unknownTime) return totals
  let load = 0
  let flat
  try {
    flat = expandSteps(model.steps)
  } catch {
    return totals
  }
  for (const { step } of flat) {
    if (step.role === "rest" && step.target.kind === "none") continue
    const target = step.target
    if (target.kind !== "pace") return totals
    const fraction = (value: number) =>
      target.unit === "%pace"
        ? value / 100
        : paceFactors[target.unit] && model.thresholds?.pace
          ? paceFactors[target.unit] / value / model.thresholds.pace
          : NaN
    const a = fraction(target.mode === "single" ? target.value! : target.start!)
    const b = fraction(target.mode === "single" ? target.value! : target.end!)
    const seconds = stepMetrics(step, model.thresholds).seconds
    if (
      ![a, b, seconds].every(
        (value) => value != null && Number.isFinite(value) && value > 0
      )
    )
      return totals
    load +=
      (seconds! / 3600) *
      (target.mode === "ramp"
        ? (a * a + a * b + b * b) / 3
        : ((a + b) / 2) ** 2) *
      100
  }
  return { ...totals, load }
}

export const desktopBuilderBlocks = [
  "Warm up",
  "Active",
  "Recovery",
  "Cool down",
  "Two Step Repeats",
  "Three Step Repeats",
  "Ramp Up",
  "Ramp Down",
] as const
export const desktopTargetUnits = [
  ["%ftp", "% Functional Threshold Power"],
  ["w", "Watts"],
  ["%hr", "% Maximum Heart Rate"],
  ["%lthr", "% Threshold Heart Rate"],
  ["bpm", "Heart rate (bpm)"],
  ["%pace", "% Threshold Pace"],
  ["secs/mi", "Pace (min/mi)"],
  ["secs/km", "Pace (min/km)"],
  ["secs/100y", "Pace (min/100yd)"],
  ["secs/100m", "Pace (min/100m)"],
  ["rpe", "RPE"],
] as const
export const targetKind = (unit: string): "power" | "pace" | "hr" | "rpe" =>
  unit === "rpe"
    ? "rpe"
    : unit === "%ftp" || unit === "w"
      ? "power"
      : /hr|lthr|bpm/.test(unit)
        ? "hr"
        : "pace"
export function normalizeRpeValue(value: number) {
  if (!Number.isFinite(value))
    throw Error("Enter a finite RPE value from 1 to 10.")
  return Math.max(1, Math.min(10, Math.round(value)))
}
export function editRpeTarget(
  target: Target,
  key: "value" | "start" | "end",
  value: number
): Target {
  if (target.kind !== "rpe") throw Error("Choose an RPE target first.")
  const next = normalizeRpeValue(value)
  if (target.mode === "single") return { ...target, value: next }
  return key === "start"
    ? { ...target, start: next, end: Math.max(next, target.end!) }
    : { ...target, end: next, start: Math.min(next, target.start!) }
}
export function reshapeRpeTarget(
  target: Target,
  mode: "single" | "range" | "ramp"
): Target {
  if (target.kind !== "rpe") throw Error("Choose an RPE target first.")
  if (mode === "ramp")
    throw Error(
      "RPE supports Target or Range. Use stepped blocks for changing effort."
    )
  if (target.mode === mode) return clone(target)
  if (mode === "single")
    return {
      kind: "rpe",
      unit: "rpe",
      mode,
      value: normalizeRpeValue((target.start! + target.end!) / 2),
    }
  return {
    kind: "rpe",
    unit: "rpe",
    mode,
    start: normalizeRpeValue(target.value! - 5),
    end: normalizeRpeValue(target.value! + 5),
  }
}
export function displayTarget(
  target: Target,
  unit: string,
  model: WorkoutModel,
  zones: SportZoneSettings[] = []
): Target {
  if (target.kind === "none" || target.unit === unit) return clone(target)
  if (target.kind !== targetKind(unit))
    throw Error(
      "Choose the new target type on each step before changing all workout units."
    )
  const setting = sportZoneSettings(zones, model.sport)
  const ftp = model.thresholds?.ftp || setting?.ftp
  const pace = model.thresholds?.pace || setting?.threshold_pace
  try {
    return convertTarget(target, unit, ftp)
  } catch {
    /* Resolve relative pace and zones below. */
  }
  let source = target
  if (target.unit.endsWith("_zone")) {
    if (target.kind === "hr")
      throw Error("Heart-rate zone conversion needs a configured threshold.")
    const boundaries =
      target.kind === "power" ? setting?.power_zones : setting?.pace_zones
    const low = target.mode === "single" ? target.value! : target.start!
    const high = target.mode === "single" ? target.value! : target.end!
    const start = low === 1 ? 0 : boundaries?.[low - 2]
    const end = boundaries?.[high - 1]
    if (start == null || end == null || end >= 999 || start <= 0)
      throw Error(
        "This zone needs a configured, bounded sport threshold to convert units."
      )
    source = {
      kind: target.kind,
      unit: target.kind === "power" ? "%ftp" : "%pace",
      mode: "range",
      start,
      end,
    }
    try {
      return convertTarget(source, unit, ftp)
    } catch {
      /* Relative pace below. */
    }
  }
  if (source.kind === "pace" && pace && pace > 0) {
    const convert = (value: number) =>
      source.unit === "%pace" && paceFactors[unit]
        ? paceFactors[unit] / ((pace * value) / 100)
        : paceFactors[source.unit] && unit === "%pace"
          ? (paceFactors[source.unit] / value / pace) * 100
          : NaN
    const fields =
      source.mode === "single"
        ? { value: convert(source.value!) }
        : { start: convert(source.start!), end: convert(source.end!) }
    if (Object.values(fields).every((n) => Number.isFinite(n) && n > 0)) {
      // Pace is reciprocal to speed. A range has unordered physical bounds,
      // while a ramp's start/end retain their execution direction.
      if (source.mode === "range" && fields.start! > fields.end!)
        [fields.start, fields.end] = [fields.end, fields.start]
      return { ...source, unit, ...fields }
    }
  }
  throw Error(
    "Your sport threshold is needed to convert these units. The original targets are retained."
  )
}

/** Presentation only: retain the prescription while showing its physical target. */
export function desktopTargetPresentation(
  target: Target,
  model: WorkoutModel,
  zones: SportZoneSettings[] = []
): { zoneId: string; physical: string } {
  if (target.kind === "none") return { zoneId: "", physical: "" }
  const setting = sportZoneSettings(zones, model.sport)
  const values =
    target.mode === "single" ? [target.value!] : [target.start!, target.end!]
  let zoneId = target.unit.endsWith("_zone") ? String(values[0]) : ""
  const relativeUnit =
    target.kind === "power" ? "%ftp" : target.kind === "pace" ? "%pace" : null
  const boundaries =
    target.kind === "power" ? setting?.power_zones : setting?.pace_zones
  if (!zoneId && relativeUnit && boundaries?.length) {
    try {
      const relative = displayTarget(target, relativeUnit, model, zones)
      if (relative.kind !== "none") {
        const upper =
          relative.mode === "single"
            ? relative.value!
            : Math.max(relative.start!, relative.end!)
        const index = boundaries.findIndex((high) => upper <= high)
        if (index >= 0) zoneId = String(index + 1)
      }
    } catch {
      /* No configured conversion means no inferred zone. */
    }
  }
  if (!target.unit.startsWith("%") || !relativeUnit)
    return { zoneId, physical: "" }
  try {
    const absoluteUnit =
      target.kind === "power"
        ? "w"
        : /swim/i.test(model.sport)
          ? "secs/100y"
          : "secs/mi"
    const absolute = displayTarget(target, absoluteUnit, model, zones)
    if (absolute.kind === "none") return { zoneId, physical: "" }
    const amounts =
      absolute.mode === "single"
        ? [absolute.value!]
        : [absolute.start!, absolute.end!].sort((a, b) => a - b)
    const format = (amount: number) => {
      if (absoluteUnit === "w") return String(Math.round(amount))
      const seconds = Math.round(amount)
      return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    }
    const suffix =
      absoluteUnit === "w"
        ? "W"
        : absoluteUnit === "secs/100y"
          ? "sec/100y"
          : "min/mi"
    return { zoneId, physical: `${amounts.map(format).join("-")} ${suffix}` }
  } catch {
    return { zoneId, physical: "" }
  }
}
export type DesktopBlockLength = {
  kind: "time" | "distance"
  unit: "s" | "m" | "km" | "mi" | "yd"
}
type DesktopBuilderPreferences = {
  length: DesktopBlockLength
  unit: string
  mode: "single" | "range"
}
const preferencesKey = (scope: string, sport: string) =>
  `desktop-workout-builder:${scope}:${sport}`
export function readDesktopBuilderPreferences(
  storage: Pick<Storage, "getItem">,
  scope: string,
  sport: string
): DesktopBuilderPreferences | null {
  try {
    const value = JSON.parse(
      storage.getItem(preferencesKey(scope, sport)) || "null"
    )
    if (
      !value ||
      !["single", "range"].includes(value.mode) ||
      !desktopTargetUnits.some(([unit]) => unit === value.unit)
    )
      return null
    if (
      value.length?.kind === "time"
        ? value.length.unit !== "s"
        : value.length?.kind !== "distance" ||
          !["m", "km", "mi", "yd"].includes(value.length.unit)
    )
      return null
    return value
  } catch {
    return null
  }
}
export function rememberDesktopBuilderPreferences(
  storage: Pick<Storage, "setItem">,
  scope: string,
  sport: string,
  value: DesktopBuilderPreferences
) {
  try {
    storage.setItem(preferencesKey(scope, sport), JSON.stringify(value))
  } catch {
    /* Optional browser preference. */
  }
}

/** Match the reference's workout-wide controls, including nested recoveries. */
export function mapDesktopSteps(
  model: WorkoutModel,
  change: (step: Step) => Step
): WorkoutModel {
  const visit = (nodes: WorkoutNode[]): WorkoutNode[] =>
    nodes.map((node) =>
      node.kind === "step"
        ? change(clone(node))
        : {
            ...node,
            steps: visit(node.steps),
            ...(node.recovery
              ? { recovery: change(clone(node.recovery)) }
              : {}),
            ...(node.setRecovery
              ? { setRecovery: change(clone(node.setRecovery)) }
              : {}),
          }
    )
  return { ...model, steps: visit(model.steps) }
}

export function reshapeDesktopTarget(
  target: Target,
  mode: "single" | "range" | "ramp",
  model: WorkoutModel
): Target {
  if (target.kind === "rpe") return reshapeRpeTarget(target, mode)
  if (target.kind === "none" || target.mode === mode) return clone(target)
  if (target.mode !== "single" && mode !== "single") return { ...target, mode }
  const centre =
    target.mode === "single" ? target.value! : (target.start! + target.end!) / 2
  if (mode === "single")
    return { kind: target.kind, unit: target.unit, mode, value: centre }
  // TrainingPeaks changes percentage targets to a ten-point range. Absolute
  // controls retain the equivalent physical scale rather than using 5 watts.
  const half =
    target.unit === "w"
      ? (model.thresholds?.ftp || 100) * 0.05
      : paceFactors[target.unit]
        ? centre * 0.05
        : 5
  return {
    kind: target.kind,
    unit: target.unit,
    mode,
    start: Math.max(0.1, centre - half),
    end: centre + half,
  }
}

export function changeDesktopTargetShape(
  model: WorkoutModel,
  mode: "single" | "range",
  unit: string,
  zones: SportZoneSettings[] = []
): WorkoutModel {
  return mapDesktopSteps(model, (step) => ({
    ...step,
    target: reshapeDesktopTarget(
      displayTarget(step.target, unit, model, zones),
      mode,
      model
    ),
  }))
}

export function changeDesktopTargetUnit(
  model: WorkoutModel,
  unit: string,
  zones: SportZoneSettings[] = []
): WorkoutModel {
  if (!desktopTargetUnits.some(([value]) => value === unit))
    throw Error("Choose a supported intensity unit.")
  return mapDesktopSteps(model, (step) => {
    const target = step.target
    if (target.kind === "none") return step
    if ((target.kind === "rpe") !== (unit === "rpe"))
      throw Error(
        "RPE cannot be converted to or from power, heart rate or pace. Remove the existing targets before choosing a different intensity type."
      )
    // The reference reinterprets percentage prescriptions when selecting a
    // different intensity basis. Absolute units require a real conversion.
    const destinationKind = targetKind(unit)
    const basis = (kind: string) =>
      kind === "power" ? "%ftp" : kind === "pace" ? "%pace" : "%lthr"
    const percentages = target.unit.startsWith("%") && unit.startsWith("%")
    const relative =
      !percentages && target.kind !== destinationKind
        ? displayTarget(target, basis(target.kind), model, zones)
        : target
    const next = percentages
      ? ({ ...target, kind: destinationKind, unit } as Target)
      : target.kind !== destinationKind
        ? displayTarget(
            {
              ...relative,
              kind: destinationKind,
              unit: basis(destinationKind),
            } as Target,
            unit,
            model,
            zones
          )
        : displayTarget(target, unit, model, zones)
    if (
      next.kind !== "none" &&
      next.mode === "range" &&
      next.start! > next.end!
    )
      [next.start, next.end] = [next.end, next.start]
    return { ...step, target: next }
  })
}

export function changeDesktopStepLength(
  step: Step,
  kind: "time" | "distance",
  unit: string,
  model: WorkoutModel
): Step {
  if (kind === "distance" && !distanceFactors[unit])
    throw Error("Choose a supported distance unit.")
  if (step.end.kind === kind) {
    if (kind === "time" || step.end.unit === unit) return clone(step)
    return {
      ...step,
      end: {
        ...step.end,
        unit,
        value: Number(
          (
            (step.end.value * distanceFactors[step.end.unit]) /
            distanceFactors[unit]
          ).toFixed(unit === "m" || unit === "yd" ? 2 : 5)
        ),
      },
    }
  }
  const metrics = stepMetrics(step, model.thresholds)
  const amount = kind === "time" ? metrics.seconds : metrics.distance
  if (amount == null || !Number.isFinite(amount) || amount <= 0)
    throw Error(
      `Enter a pace target and sport threshold to convert this step to ${kind === "time" ? "duration" : "distance"}. Its original length has been kept.`
    )
  return {
    ...step,
    end: {
      ...step.end,
      kind,
      unit: kind === "time" ? "s" : unit,
      value:
        kind === "time"
          ? Math.round(amount)
          : Number(
              (amount / distanceFactors[unit]).toFixed(
                unit === "m" || unit === "yd" ? 2 : 5
              )
            ),
    },
  }
}
export function builderBlock(
  name: string,
  model: WorkoutModel,
  unit: string,
  mode: "single" | "range",
  length: DesktopBlockLength = /swim/i.test(model.sport)
    ? { kind: "distance", unit: "yd" }
    : { kind: "time", unit: "s" }
): WorkoutNode[] {
  const swimming = /swim/i.test(model.sport)
  const paceTargets = targetKind(unit) === "pace"
  const recoveryLow = paceTargets ? 0.75 : 0.5
  const make = (
    role: "warmup" | "active" | "recovery" | "cooldown",
    low: number,
    high: number,
    seconds: number,
    meters: number,
    rpeUpper?: number
  ) => {
    const step = newStep(model.sport, role)
    // New reference swim blocks are prescribed by distance with the lap
    // switch off. Imported/saved lap choices remain untouched by insertion.
    if (swimming) step.end.pressLap = false
    step.label = {
      warmup: "Warm up",
      active: "Active",
      recovery: "Recovery",
      cooldown: "Cool down",
    }[role]
    const kind = targetKind(unit)
    const centre = paceFactors[unit]
      ? paceFactors[unit] /
        (model.thresholds?.pace || (/swim/i.test(model.sport) ? 1 : 3))
      : unit === "w"
        ? model.thresholds?.ftp || 250
        : unit === "bpm"
          ? 150
          : 100
    const intensity = (amount: number) =>
      centre * (paceFactors[unit] ? 1 / amount : amount)
    const a = intensity(low),
      b = intensity(high)
    step.target =
      mode === "range"
        ? {
            kind,
            unit,
            mode,
            start: Math.round(Math.min(a, b)),
            end: Math.round(Math.max(a, b)),
          }
        : { kind, unit, mode, value: Math.round(intensity((low + high) / 2)) }
    if (unit === "rpe") {
      const high =
        rpeUpper ??
        (role === "warmup" || role === "cooldown"
          ? 5
          : role === "recovery"
            ? 7
            : /Repeats/.test(name)
              ? 10
              : 8)
      step.target =
        mode === "range"
          ? { kind: "rpe", unit: "rpe", mode, start: 1, end: high }
          : { kind: "rpe", unit: "rpe", mode, value: 1 }
    }
    if (unit !== "rpe" && defaultTarget(model.sport).kind === "none")
      step.target = { kind: "none" }
    if (length?.kind === "distance") {
      const selectedUnit = length.unit === "s" ? "m" : length.unit
      const divisor =
        selectedUnit === "km"
          ? 1000
          : selectedUnit === "mi"
            ? 1609.344
            : selectedUnit === "yd"
              ? swimming ? 1 : 0.9144
              : 1
      step.end = {
        ...step.end,
        kind: "distance",
        unit: selectedUnit,
        value: Number(
          (meters / divisor).toFixed(
            selectedUnit === "m" || selectedUnit === "yd" ? 0 : 3
          )
        ),
      }
    } else if (length?.kind === "time" || step.end.kind === "time")
      step.end = { ...step.end, kind: "time", unit: "s", value: seconds }
    return step
  }
  if (/Repeats/.test(name)) {
    const three = name.startsWith("Three")
    const steps = [
      {
        ...make(
          "active",
          paceTargets ? 1.05 : three ? 0.75 : 0.85,
          paceTargets ? 1.15 : three ? 0.85 : 0.95,
          three ? 180 : 360,
          swimming ? (three ? 75 : 200) : 2000,
          three ? 9 : 10
        ),
        label: "Hard",
      },
      ...(three
        ? [
            {
              ...make(
                "active",
                paceTargets ? 1.1 : 0.9,
                paceTargets ? 1.2 : 1,
                60,
                swimming ? 25 : 1000
              ),
              label: "Harder",
            },
          ]
        : []),
      {
        ...make(
          "recovery",
          recoveryLow,
          recoveryLow + 0.1,
          three ? 60 : 180,
          swimming ? 50 : 1000
        ),
        label: "Easy",
      },
    ]
    return [{ ...newRepeat(steps), repetitions: three ? 3 : 4 }]
  }
  if (/Ramp/.test(name)) {
    const ascending = paceTargets
      ? [0.75, 0.85, 0.95, 1.05]
      : [0.55, 0.65, 0.75, 0.85]
    const ranges = name === "Ramp Up" ? ascending : ascending.toReversed()
    const rpeRanges = name === "Ramp Up" ? [7, 8, 9, 10] : [10, 9, 8, 7]
    return [
      {
        ...newRepeat(
          ranges.map((low, index) => {
            const step = make(
              "active",
              low,
              low + 0.1,
              180,
              swimming ? 100 : 1000,
              rpeRanges[index]
            )
            return unit === "rpe" ? { ...step, label: "" } : step
          })
        ),
        label: "Ramp",
        repetitions: 1,
      },
    ]
  }
  const role =
    name === "Warm up"
      ? "warmup"
      : name === "Cool down"
        ? "cooldown"
        : name === "Recovery"
          ? "recovery"
          : "active"
  const low =
    role === "active"
      ? paceTargets
        ? 1.05
        : 0.7
      : role === "recovery"
        ? recoveryLow
        : paceTargets
          ? 0.7
          : 0.4
  const step = make(
    role,
    low,
    low + 0.1,
    role === "warmup" ? 1200 : role === "recovery" ? 300 : 600,
    swimming
      ? role === "warmup" ? 600 : role === "recovery" ? 100 : 200
      : role === "warmup" ? 3000 : role === "active" ? 8000 : 5000
  )
  return [step]
}

/** A stepped ramp executes each stage once; its count never means repeats. */
export function resizeDesktopRamp(
  node: WorkoutNode,
  count: number
): WorkoutNode {
  if (
    node.kind !== "repeat" ||
    node.label !== "Ramp" ||
    node.repetitions !== 1 ||
    node.sets !== 1
  )
    throw Error("Select a stepped ramp.")
  if (!Number.isInteger(count) || count < 2 || count > 100)
    throw Error("A stepped ramp needs 2 to 100 stages.")
  const first = node.steps[0],
    last = node.steps.at(-1)
  if (!first || first.kind !== "step" || !last || last.kind !== "step")
    throw Error("A stepped ramp needs individual stages.")
  const from = first.target,
    to = last.target
  if (from.kind !== to.kind || from.unit !== to.unit || from.mode !== to.mode)
    throw Error(
      "Ramp endpoints must use the same target type, units and shape."
    )
  const steps = Array.from({ length: count }, (_, index) => {
    const existing =
      index === 0
        ? first
        : index === count - 1
          ? last
          : index < node.steps.length - 1
            ? node.steps[index]
            : null
    const step = structuredClone(existing?.kind === "step" ? existing : first)
    if (!existing) {
      step.id = crypto.randomUUID()
      step.notes = ""
    }
    const fraction = index / (count - 1)
    const interpolate = (a: number, b: number) =>
      Math.round(a + (b - a) * fraction)
    step.target =
      from.kind === "none"
        ? { kind: "none" }
        : {
            ...from,
            ...(from.mode === "single"
              ? { value: interpolate(from.value!, to.value!) }
              : {
                  start: interpolate(from.start!, to.start!),
                  end: interpolate(from.end!, to.end!),
                }),
          }
    return step
  })
  return { ...node, steps }
}

/** Round zone presets on selection, keeping the user's selected intensity basis. */
export function desktopWorkoutZoneOptions(
  model: WorkoutModel,
  zones: SportZoneSettings[],
  preferredUnit: string
) {
  const setting=sportZoneSettings(zones,model.sport)
  const power=/ride|bike/i.test(model.sport),threshold=power?setting?.ftp:setting?.threshold_pace
  const boundaries=power?setting?.power_zones:setting?.pace_zones
  const distance=/swim/i.test(model.sport)?91.44:1609.344
  const pace=(seconds:number)=>`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`
  return workoutZoneOptions(zones, model.sport, preferredUnit).map(option => {
    const index=Number(option.id)-1,low=index?boundaries?.[index-1]:0,high=boundaries?.[index]
    let label=option.label
    if(threshold && low != null && high != null) {
      if(power)label=`Zone ${index+1} | ${index?Math.round(threshold*low/100)+1:0} - ${Math.round(threshold*high/100)} W`
      else if(low>0)label=`Zone ${index+1} | ${pace(Math.round(distance/(threshold*high/100)))} - ${pace(Math.round(distance/(threshold*low/100)))} ${/swim/i.test(model.sport)?"sec/100y":"min/mi"}`
      const name=(power?setting?.power_zone_names:setting?.pace_zone_names)?.[index]
      if(name)label+=` · ${name}`
    }
    const target = option.target
    if (target.kind === "none" || target.mode !== "range") return {...option,label}
    return {...option,label, target: {...target, start: Math.round(Math.min(target.start!, target.end!)), end: Math.round(Math.max(target.start!, target.end!))} as Target}
  })
}

/** Use the entered distance scale and fit the entire prescribed workout. */
export function desktopProfileAxis(model: WorkoutModel) {
  const chart = chartSegments(model)
  const actual = chart.segments.reduce((sum, segment) => sum + segment.width, 0) || 1
  const distance = chart.axis.startsWith("Distance")
  const unit = distance ? chart.segments[0]?.step.end.unit || "m" : "s"
  const factor = distance ? distanceFactors[unit] || 1 : 1
  return {actual, maximum: actual, factor, unit, distance}
}

/** Native distance charts use ordinary 1/2/5 ticks, rather than ten arbitrary fractions. */
export function desktopDistanceTicks(maximum: number, factor = 1) {
  const distance = maximum / factor
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(factor) || factor <= 0) return [0]
  const raw = distance / 5
  const decade = 10 ** Math.floor(Math.log10(raw))
  const error = raw / decade
  const interval = decade * (error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1)
  return Array.from({length: Math.min(12, Math.floor(distance / interval + 1e-9) + 1)}, (_, index) => Number((index * interval).toPrecision(12)) * factor)
}

/** Fit observed profiles to 20-point intensity bands with 20% headroom and a 100% minimum. */
export function desktopProfileMaximum(segments: ReturnType<typeof chartSegments>["segments"]) {
  if (segments.some(segment => segment.step.target.kind === "rpe") && segments.every(segment => ["none", "rpe"].includes(segment.step.target.kind))) return 1
  const peak = Math.max(0, ...segments.flatMap(segment => [segment.start, segment.end, desktopProfileRange(segment).high]))
  return Math.max(1, Math.ceil(peak * 5 - 1e-9) / 5 * 1.2)
}

/** Keep chart labels bounded even while a very large numeric draft is visible. */
export function desktopProfileTicks(maximum: number, rpe = false) {
  if (rpe) return [0, 0.25, 0.5, 0.75, 1]
  if (!Number.isFinite(maximum) || maximum <= 0) return [0, 0.5, 1]
  const interval = maximum <= 1 ? 0.25 : Math.max(0.5, Math.ceil(maximum / 6 * 2) / 2)
  return Array.from({length: Math.min(8, Math.floor(maximum / interval) + 1)}, (_, index) => index * interval)
}
