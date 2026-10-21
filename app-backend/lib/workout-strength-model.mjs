// Shared exact Strength prescription. No provider I/O or exercise library claims.
export const strengthBlockKinds = ["single", "circuit", "warmup", "cooldown", "superset"];
export const strengthSubtypes = Object.freeze([
  "Mobility",
  "Functional Fitness",
  "Yoga",
  "Rock Climbing",
  "Hybrid Strength",
  "Stretching",
]);
export const STRENGTH_MARKER = "\n\nStrength exercise prescription:\n";
export const strengthParameterFields = [
  { kind: "weight", label: "Weight", units: ["lb", "kg"], min: 0, max: 1000000 },
  { kind: "weightPerSide", label: "Weight/side", units: ["lb", "kg"], min: 0, max: 1000000 },
  { kind: "reps", label: "Reps", units: ["reps"], min: 0, max: 100000, integer: true },
  { kind: "repsPerSide", label: "Reps/side", units: ["reps"], min: 0, max: 100000, integer: true },
  { kind: "duration", label: "Duration", units: ["s"], min: 0, max: 86400 },
  {
    kind: "distance",
    label: "Distance",
    units: ["m", "km", "ft", "yd", "miles"],
    min: 0,
    max: 10000000,
  },
  { kind: "height", label: "Height", units: ["in"], min: 0, max: 10000 },
  { kind: "rpe", label: "RPE", units: ["rpe"], min: 1, max: 10, integer: true },
  { kind: "rir", label: "RIR", units: ["rir"], min: 0, max: 100, integer: true },
];
const fields = new Map(strengthParameterFields.map((field) => [field.kind, field]));
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, allowed) =>
  object(value) && Object.keys(value).every((key) => allowed.includes(key));
const text = (value, max, required = false) =>
  typeof value === "string" &&
  value.length <= max &&
  (!required || value.trim().length > 0) &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) &&
  !/Workout editor v1|training-agent-(?:manual-description|planned-values|workout-comments)-v1|Intervals\.icu device definition:/.test(
    value
  );
const uid = () => globalThis.crypto.randomUUID();

export function validateStrengthPrescription(value) {
  const errors = [],
    ids = new Set();
  const identity = (id) => {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id))
      errors.push("Strength IDs must be unique and valid");
    ids.add(id);
  };
  if (
    !keys(value, ["version", "blocks", "subtype", "startTimeAssigned"]) ||
    value.version !== 1 ||
    !Array.isArray(value.blocks) ||
    value.blocks.length > 100
  )
    return ["Strength supports an explicit list of up to 100 exercise blocks"];
  if (value.subtype !== undefined && !strengthSubtypes.includes(value.subtype))
    errors.push("Choose an exact supported Strength subtype or None");
  if (Object.hasOwn(value, "startTimeAssigned") && typeof value.startTimeAssigned !== "boolean")
    errors.push("Strength start-time assignment must be true or false when supplied");
  let exerciseCount = 0;
  for (const block of value.blocks) {
    if (
      !keys(block, [
        "id",
        "kind",
        "title",
        "instructions",
        "notes",
        "timeSeconds",
        "recordMode",
        "exercises",
      ])
    ) {
      errors.push("Invalid Strength block");
      continue;
    }
    identity(block.id);
    if (
      !strengthBlockKinds.includes(block.kind) ||
      !text(block.title, 128) ||
      !text(block.instructions, 1000) ||
      !text(block.notes, 1000) ||
      block.recordMode !== "completion" ||
      (block.timeSeconds !== null &&
        (!Number.isInteger(block.timeSeconds) ||
          block.timeSeconds < 0 ||
          block.timeSeconds > 86400))
    )
      errors.push("Invalid Strength block details");
    if (
      !Array.isArray(block.exercises) ||
      !block.exercises.length ||
      block.exercises.length > 100 ||
      (block.kind === "single" && block.exercises.length !== 1)
    ) {
      errors.push("Strength blocks need exercises; Single Exercise needs exactly one");
      continue;
    }
    for (const exercise of block.exercises) {
      if (++exerciseCount > 200) {
        errors.push("Strength supports at most 200 exercises");
        break;
      }
      if (
        !keys(exercise, [
          "id",
          "title",
          "instructions",
          "notes",
          "parameters",
          "sets",
          "libraryExerciseId",
        ]) ||
        (exercise.libraryExerciseId !== undefined &&
          (typeof exercise.libraryExerciseId !== "string" ||
            !/^exercise:[A-Za-z0-9_-]{16,80}$/.test(exercise.libraryExerciseId)))
      ) {
        errors.push("Invalid Strength exercise");
        continue;
      }
      identity(exercise.id);
      if (
        !text(exercise.title, 128, true) ||
        !text(exercise.instructions, 1000) ||
        !text(exercise.notes, 1000)
      )
        errors.push(
          "Exercise title is required (128 characters); instructions and notes allow 1000 characters"
        );
      if (
        !Array.isArray(exercise.parameters) ||
        !exercise.parameters.length ||
        exercise.parameters.length > 12
      ) {
        errors.push("Exercises need 1–12 parameter columns");
        continue;
      }
      const columnIds = [];
      for (const parameter of exercise.parameters) {
        if (
          !keys(parameter, ["id", "kind", "unit"]) ||
          !fields.get(parameter.kind)?.units.includes(parameter.unit)
        ) {
          errors.push("Invalid Strength parameter or unit");
          continue;
        }
        identity(parameter.id);
        columnIds.push(parameter.id);
      }
      if (columnIds.length !== exercise.parameters.length) continue;
      if (!Array.isArray(exercise.sets) || !exercise.sets.length || exercise.sets.length > 15) {
        errors.push("Exercises need 1–15 sets");
        continue;
      }
      for (const set of exercise.sets) {
        if (
          !keys(set, ["id", "values"]) ||
          !keys(set.values, columnIds) ||
          Object.keys(set.values).length !== exercise.parameters.length
        ) {
          errors.push("Every set must contain exactly its exercise parameter columns");
          continue;
        }
        identity(set.id);
        for (const parameter of exercise.parameters) {
          const field = fields.get(parameter.kind),
            cell = set.values[parameter.id];
          if (
            cell !== null &&
            (!field ||
              typeof cell !== "number" ||
              !Number.isFinite(cell) ||
              cell < field.min ||
              cell > field.max ||
              (field.integer && !Number.isInteger(cell)))
          )
            errors.push(
              "Strength values must use their parameter's finite supported range; leave unknown values blank"
            );
        }
      }
    }
  }
  return [...new Set(errors)];
}
export const isStrengthPrescription = (value) => validateStrengthPrescription(value).length === 0;
export function newStrengthExercise(title = "") {
  const parameter = { id: uid(), kind: "reps", unit: "reps" };
  return {
    id: uid(),
    title,
    instructions: "",
    notes: "",
    parameters: [parameter],
    sets: Array.from({ length: 3 }, () => ({ id: uid(), values: { [parameter.id]: null } })),
  };
}
export function newStrengthBlock(kind = "single", exercise) {
  if (!strengthBlockKinds.includes(kind)) throw Error("Choose a supported Strength block");
  const initial = structuredClone(exercise || newStrengthExercise()),
    timed = ["circuit", "warmup", "cooldown"].includes(kind);
  if (!exercise && timed) initial.sets = initial.sets.slice(0, 1);
  return {
    id: uid(),
    kind,
    title:
      { circuit: "Circuit", warmup: "Warm Up", cooldown: "Cool Down", superset: "Superset" }[
        kind
      ] || "",
    instructions: "",
    notes: "",
    timeSeconds: timed ? 600 : kind === "single" ? 0 : null,
    recordMode: "completion",
    exercises: kind === "superset" ? [initial, newStrengthExercise()] : [initial],
  };
}
export function addStrengthParameter(exercise, kind = "reps", unit = fields.get(kind)?.units[0]) {
  if (!fields.get(kind)?.units.includes(unit) || exercise.parameters.length >= 12)
    throw Error("Choose a supported Strength parameter");
  const copy = structuredClone(exercise),
    parameter = { id: uid(), kind, unit };
  copy.parameters.push(parameter);
  copy.sets.forEach((set) => {
    set.values[parameter.id] = null;
  });
  return copy;
}
export function setStrengthValue(exercise, setId, parameterId, value) {
  const copy = structuredClone(exercise),
    index = copy.sets.findIndex((set) => set.id === setId);
  if (index < 0 || !copy.parameters.some((parameter) => parameter.id === parameterId))
    throw Error("Choose an existing Strength set and parameter");
  const field = fields.get(copy.parameters.find((parameter) => parameter.id === parameterId).kind);
  if (
    value !== null &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < field.min ||
      value > field.max ||
      (field.integer && !Number.isInteger(value)))
  )
    throw Error("Enter a supported Strength value or leave it blank");
  // Observed first-row edits propagate even over individual lower-row overrides.
  for (const [row, set] of copy.sets.entries())
    if (index === 0 || row === index) set.values[parameterId] = value;
  return copy;
}
export function copyStrengthPrescription(value) {
  const errors = validateStrengthPrescription(value);
  if (errors.length) throw Error(errors.join(". "));
  const copy = structuredClone(value);
  for (const block of copy.blocks) {
    block.id = uid();
    for (const exercise of block.exercises) {
      exercise.id = uid();
      const columns = new Map(exercise.parameters.map((parameter) => [parameter.id, uid()]));
      exercise.parameters.forEach((parameter) => {
        parameter.id = columns.get(parameter.id);
      });
      exercise.sets.forEach((set) => {
        set.id = uid();
        set.values = Object.fromEntries(
          Object.entries(set.values).map(([id, cell]) => [columns.get(id), cell])
        );
      });
    }
  }
  return copy;
}
export function strengthTotals(value) {
  const errors = validateStrengthPrescription(value);
  if (errors.length) throw Error(errors.join(". "));
  let exercises = 0,
    sets = 0,
    reps = 0,
    unknownReps = false,
    unknownVolume = false;
  const volume = { lb: 0, kg: 0 };
  for (const block of value.blocks)
    for (const exercise of block.exercises) {
      exercises++;
      sets += exercise.sets.length;
      const repColumns = exercise.parameters.filter((parameter) => parameter.kind === "reps"),
        weightColumns = exercise.parameters.filter((parameter) => parameter.kind === "weight");
      for (const set of exercise.sets) {
        // Duplicate and per-side prescriptions are exact data, but have no
        // established combined volume formula. Do not guess a doubling rule.
        const repetitions = repColumns.length === 1 ? set.values[repColumns[0].id] : null;
        if (repetitions === null) unknownReps = true;
        else reps += repetitions;
        if (
          repColumns.length !== 1 ||
          weightColumns.length !== 1 ||
          exercise.parameters.some((parameter) =>
            ["weightPerSide", "repsPerSide"].includes(parameter.kind)
          )
        ) {
          unknownVolume = true;
          continue;
        }
        const weight = set.values[weightColumns[0].id];
        if (weight === null || repetitions === null) unknownVolume = true;
        else volume[weightColumns[0].unit] += weight * repetitions;
      }
    }
  return {
    exercises,
    sets,
    reps: !exercises || unknownReps ? null : reps,
    volume: !exercises || unknownVolume ? null : volume,
    durationSeconds: null,
    tss: null,
    intensityFactor: null,
  };
}
const line = (value) =>
  String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
export function strengthPrescriptionText(value) {
  const errors = validateStrengthPrescription(value);
  if (errors.length) throw Error(errors.join(". "));
  const labels = {
      single: "Single Exercise",
      circuit: "Circuit",
      warmup: "Warm Up",
      cooldown: "Cool Down",
      superset: "Superset",
    },
    lines = ["Strength prescription"];
  if (value.subtype !== undefined) lines.push(`Subtype: ${value.subtype}`);
  for (const [index, block] of value.blocks.entries()) {
    lines.push(
      "",
      `${index + 1}. ${labels[block.kind]}${block.title ? `: ${line(block.title)}` : ""}`
    );
    if (block.instructions) lines.push(`Instructions: ${block.instructions}`);
    if (block.notes) lines.push(`Notes: ${block.notes}`);
    if (block.timeSeconds !== null) lines.push(`Block time: ${block.timeSeconds} seconds`);
    lines.push("Record: For Completion");
    for (const exercise of block.exercises) {
      lines.push(line(exercise.title));
      if (exercise.instructions) lines.push(`Instructions: ${exercise.instructions}`);
      if (exercise.notes) lines.push(`Coach notes: ${exercise.notes}`);
      for (const [index, set] of exercise.sets.entries())
        lines.push(
          `Set ${index + 1}: ${exercise.parameters.map((parameter) => `${fields.get(parameter.kind).label}: ${set.values[parameter.id] === null ? "—" : set.values[parameter.id]}${["reps", "rpe", "rir"].includes(parameter.unit) ? "" : ` ${parameter.unit}`}`).join("; ")}`
        );
    }
  }
  return lines.join("\n");
}
