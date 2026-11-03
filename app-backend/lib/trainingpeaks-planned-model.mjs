import { validateWorkout } from "./workout-editor-model.mjs";

const day = (value) => {
  const text = String(value || "").slice(0, 10);
  const timestamp = Date.parse(`${text}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) &&
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === text
    ? text
    : null;
};
const number = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const sports = {
  1: ["Swim", "Swim"],
  2: ["Bike", "Ride"],
  3: ["Run", "Run"],
  4: ["Brick", "Workout"],
  5: ["Crosstrain", "Workout"],
  6: ["Race", "Workout"],
  8: ["Bike", "MountainBikeRide"],
  9: ["Strength", "WeightTraining"],
  10: ["Other", "Other"],
  11: ["Nordic Ski", "NordicSki"],
  12: ["Rowing", "Rowing"],
  13: ["Walk", "Walk"],
  29: ["Strength", "WeightTraining"],
  100: ["Other", "Other"],
};
const targets = {
  percentOfFtp: ["power", "%ftp"],
  percentOfThresholdHr: ["hr", "%lthr"],
  percentOfMaxHr: ["hr", "%hr"],
  percentOfThresholdPace: ["pace", "%pace"],
  watts: ["power", "w"],
  heartRate: ["hr", "bpm"],
};
function modelFor(row, date, sport, warnings) {
  let source = row.structure;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      warnings.push("TrainingPeaks returned an unreadable interval structure.");
      return null;
    }
  }
  if (!source?.structure?.length) return null;
  if (source.structure.length > 1000) throw Error("TrainingPeaks interval structure is too large.");
  const targetType = targets[source.primaryIntensityMetric];
  let nodes = 0;
  function step(item, id, ramp = null) {
    if (++nodes > 3000) throw Error("TrainingPeaks interval structure is too large.");
    const role =
      {
        warmUp: "warmup",
        coolDown: "cooldown",
        rest: "rest",
        recovery: "recovery",
        active: "active",
        other: "other",
      }[item.intensityClass] || "other";
    const value = number(item.length?.value);
    const units = {
      second: ["time", "s"],
      meter: ["distance", "m"],
      kilometer: ["distance", "km"],
      yard: ["distance", "yd"],
      mile: ["distance", "mi"],
    }[item.length?.unit];
    if (!units || !(value > 0))
      throw Error("An imported interval uses an unsupported length unit.");
    let target = { kind: "none" };
    const primary = item.targets?.find((t) => t.unit !== "roundOrStridePerMinute");
    if (primary && primary.minValue === 0 && (primary.maxValue ?? 0) === 0 && role === "rest") {
      target = { kind: "none" };
    } else if (primary && targetType) {
      const from = number(primary.minValue),
        to = number(primary.maxValue ?? primary.minValue);
      if (from === undefined || to === undefined || to < from)
        throw Error("An imported interval has an invalid target.");
      target = {
        kind: targetType[0],
        unit: targetType[1],
        ...(ramp
          ? {
              mode: "ramp",
              start: ramp === "rampDown" ? to : from,
              end: ramp === "rampDown" ? from : to,
            }
          : from === to
            ? { mode: "single", value: from }
            : { mode: "range", start: from, end: to }),
      };
    } else if (primary)
      throw Error("The imported intensity unit is not supported for an exact interval chart.");
    const cadence = item.targets?.find((t) => t.unit === "roundOrStridePerMinute");
    return {
      id,
      kind: "step",
      label: String(item.name || "Interval").slice(0, 100),
      notes: String(item.notes || "").slice(0, 2000),
      role,
      end: {
        kind: units[0],
        value,
        unit: units[1],
        ...(item.openDuration ? { pressLap: true } : {}),
      },
      target,
      cadence: cadence
        ? { start: cadence.minValue, end: cadence.maxValue ?? cadence.minValue }
        : null,
    };
  }
  try {
    const steps = source.structure.flatMap((block, index) => {
      if (!Array.isArray(block.steps) || block.steps.length > 1000)
        throw Error("An imported interval block is invalid.");
      const children = block.steps.map((item, child) =>
        step(
          item,
          `tp-${row.workoutId}-${index}-${child}`,
          ["rampUp", "rampDown"].includes(block.type) ? block.type : null
        )
      );
      if (block.type === "repetition") {
        const repetitions = block.length?.value;
        if (
          !Number.isInteger(repetitions) ||
          repetitions < 1 ||
          repetitions > 100 ||
          block.length.unit !== "repetition"
        )
          throw Error("An imported repeat count is invalid.");
        return [
          {
            id: `tp-${row.workoutId}-${index}`,
            kind: "repeat",
            label: "Repeats",
            notes: "",
            repetitions,
            sets: 1,
            steps: children,
            recovery: null,
            finalRecovery: true,
            setRecovery: null,
          },
        ];
      }
      if (!["step", "rampUp", "rampDown"].includes(block.type))
        throw Error("An imported interval block type is unsupported.");
      return children;
    });
    const model = {
      version: 1,
      name: row.title,
      sport,
      date,
      notes: String(row.description || "").slice(0, 2000),
      poolLength: "",
      ...(sport === "Swim" ? { swimUnitMode: "explicit" } : {}),
      steps,
    };
    const issues = validateWorkout(model);
    if (issues.length)
      throw Error("The imported interval structure cannot be represented exactly.");
    return model;
  } catch (error) {
    warnings.push(error.message);
    return null;
  }
}

export function normalizeTrainingPeaksPlan(row, { athleteId, today }) {
  if (
    !row ||
    !Number.isSafeInteger(row.workoutId) ||
    row.workoutId < 1 ||
    row.athleteId !== athleteId
  )
    throw Error("TrainingPeaks returned a workout for an unexpected athlete.");
  // Completed activities remain owned by the existing recording provider.
  if (row.completed === true || number(row.totalTime) > 0 || number(row.distance) > 0) return null;
  if (row.isHidden || row.workoutTypeValueId === 7) return null;
  const date = day(row.workoutDay);
  if (!date || typeof row.title !== "string" || !row.title.trim() || row.title.length > 200)
    throw Error("TrainingPeaks returned invalid planned workout metadata.");
  if (
    row.description != null &&
    (typeof row.description !== "string" || row.description.length > 50000)
  )
    throw Error("TrainingPeaks returned an invalid workout description.");
  const [sport, canonicalSport] = sports[row.workoutTypeValueId] || ["Other", "Other"];
  const warnings = [],
    model = modelFor(row, date, canonicalSport, warnings);
  const seconds =
    number(row.totalTimePlanned) === undefined
      ? undefined
      : Math.round(row.totalTimePlanned * 3600);
  const minutes = seconds === undefined ? undefined : Math.round(seconds / 60);
  const values = Object.fromEntries(
    Object.entries({
      duration_seconds: seconds,
      distance_meters: number(row.distancePlanned),
      tss: number(row.tssPlanned),
      intensity_factor: number(row.ifPlanned),
      average_speed: number(row.velocityPlanned),
    }).filter(([, value]) => value !== undefined)
  );
  const dateObject = new Date(`${date}T12:00:00Z`);
  return {
    id: `trainingpeaks:${row.workoutId}`,
    source: "trainingpeaks",
    trainingpeaks_id: row.workoutId,
    external_url: `https://app.trainingpeaks.com/athlete/workout/${row.workoutId}`,
    read_only: true,
    structure_read_only: true,
    workout_date: date,
    planned_workout_date: date,
    day: dateObject.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    date: dateObject.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    sport,
    title: row.title,
    goal: row.description || "",
    details: row.description || "",
    manual_description: row.description || "",
    duration:
      minutes === undefined
        ? "—"
        : minutes < 60
          ? `${minutes}m`
          : `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
    status: date === today ? "today" : "upcoming",
    completed: false,
    ...(seconds === undefined ? {} : { plannedDurationMinutes: seconds / 60 }),
    ...(values.distance_meters === undefined ? {} : { distance_meters: values.distance_meters }),
    ...(values.tss === undefined ? {} : { load: values.tss }),
    planned: { ...values, ...(seconds === undefined ? {} : { duration_minutes: seconds / 60 }) },
    workout_summary: { planned: values, completed: null },
    ...(model ? { editor_model: model } : {}),
    structure: model ? JSON.stringify({ steps: model.steps }) : null,
    ...(warnings.length ? { trainingpeaks_warnings: warnings } : {}),
    ...(typeof row.startTimePlanned === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(row.startTimePlanned)
      ? {
          planned_time_label: row.startTimePlanned.slice(11, 16),
          scheduled_start_at: row.startTimePlanned,
        }
      : {}),
  };
}

export function overlayTrainingPeaksSnapshot(context, snapshot, today) {
  if (!snapshot?.activatedDay || !Array.isArray(snapshot.workouts)) return context;
  const keep = (row) =>
    !String(row.id || "").startsWith("trainingpeaks:") &&
    (row.completed ||
      row.status === "completed" ||
      row.category === "NOTE" ||
      row.calendar_annotation_key ||
      row.calendar_event_key ||
      row.workout_date < snapshot.activatedDay ||
      // Preserve a new, explicit app save after cutover. A source refresh must
      // never make a successfully saved workout disappear from its own app.
      (row.app_updated_at &&
        row.app_updated_at >= (snapshot.activatedAt || `${snapshot.activatedDay}T00:00:00.000Z`)));
  const plans = snapshot.workouts;
  return {
    ...context,
    history: [
      ...(context.history || []).filter(keep),
      ...plans.filter((w) => w.workout_date <= today),
    ],
    planned: [
      ...(context.planned || []).filter(keep),
      ...plans.filter((w) => w.workout_date >= today),
    ],
    planned_source: "trainingpeaks",
    planned_sync: {
      lastSyncedAt: snapshot.lastSyncedAt || null,
      lastAttemptAt: snapshot.lastAttemptAt || null,
      reconnectRequired: Boolean(snapshot.reconnectRequired),
      error: snapshot.error || null,
      rangeStart: snapshot.rangeStart,
      rangeEnd: snapshot.rangeEnd,
    },
  };
}
