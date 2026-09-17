// Shared by the browser and the authenticated backend. No provider writes here.
export const DEFINITION_MARKER = "\n\nIntervals.icu device definition:\n";
const DATA_MARKER = "\n\n```\nWorkout editor v1\n";
export const roles = ["warmup", "active", "recovery", "rest", "cooldown", "other"];
export const roleNames = {
  warmup: "Warm Up",
  active: "Work",
  recovery: "Recovery",
  rest: "Rest",
  cooldown: "Cool Down",
  other: "Other",
};
export const distanceFactors = { m: 1, km: 1000, mi: 1609.344, yd: 0.9144 };
export const paceFactors = {
  "secs/mi": 1609.344,
  "secs/km": 1000,
  "secs/100y": 91.44,
  "secs/100m": 100,
  "secs/500m": 500,
  "secs/400m": 400,
  "secs/250m": 250,
};
export const targetUnits = {
  power: ["w", "%ftp", "power_zone"],
  pace: [
    "secs/mi",
    "secs/km",
    "secs/100y",
    "secs/100m",
    "secs/500m",
    "secs/400m",
    "secs/250m",
    "%pace",
    "pace_zone",
  ],
  hr: ["bpm", "%hr", "%lthr", "hr_zone"],
};
export const uid = () => globalThis.crypto.randomUUID();
export const clone = (value) => structuredClone(value);
export const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
export const clock = (value) => {
  const n = Math.round(value);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
export function defaultTarget(sport) {
  return /swim/i.test(sport)
    ? { kind: "pace", unit: "secs/100y", mode: "single", value: 120 }
    : /run/i.test(sport)
      ? { kind: "pace", unit: "secs/mi", mode: "single", value: 540 }
      : { kind: "power", unit: "w", mode: "single", value: 150 };
}
export function newStep(sport, role = "active") {
  return {
    id: uid(),
    kind: "step",
    label: roleNames[role],
    notes: "",
    role,
    end: {
      kind: /swim/i.test(sport) && role !== "rest" ? "distance" : "time",
      value: /swim/i.test(sport) && role !== "rest" ? 100 : 300,
      unit: /swim/i.test(sport) && role !== "rest" ? "yd" : "s",
      ...(/swim/i.test(sport) && role !== "rest" ? { pressLap: true } : {}),
    },
    target: role === "rest" ? { kind: "none" } : defaultTarget(sport),
    cadence: null,
  };
}
export function copyNodes(nodes) {
  return nodes.map((node) => ({
    ...clone(node),
    id: uid(),
    ...(node.kind === "repeat"
      ? {
          steps: copyNodes(node.steps),
          recovery: node.recovery ? copyNodes([node.recovery])[0] : null,
          setRecovery: node.setRecovery ? copyNodes([node.setRecovery])[0] : null,
        }
      : {}),
  }));
}
export function newRepeat(steps) {
  return {
    id: uid(),
    kind: "repeat",
    label: "Repeats",
    notes: "",
    repetitions: 3,
    sets: 1,
    steps,
    recovery: null,
    finalRecovery: true,
    setRecovery: null,
  };
}
export function walkNodes(nodes, fn, parent = null) {
  for (const node of nodes) {
    fn(node, parent);
    if (node.kind === "repeat") {
      walkNodes(node.steps, fn, node);
      if (node.recovery) fn(node.recovery, node);
      if (node.setRecovery) fn(node.setRecovery, node);
    }
  }
}
export function findNode(nodes, id) {
  let result;
  walkNodes(nodes, (n) => {
    if (n.id === id) result = n;
  });
  return result;
}
export function updateNodes(nodes, ids, change) {
  return nodes.map((n) => {
    const next = ids.includes(n.id) ? change(clone(n)) : clone(n);
    if (next.kind === "repeat") {
      next.steps = updateNodes(next.steps, ids, change);
      if (next.recovery) next.recovery = updateNodes([next.recovery], ids, change)[0];
      if (next.setRecovery) next.setRecovery = updateNodes([next.setRecovery], ids, change)[0];
    }
    return next;
  });
}
export function removeNodes(nodes, ids) {
  return nodes
    .filter((n) => !ids.includes(n.id))
    .map((n) =>
      n.kind === "repeat"
        ? {
            ...n,
            steps: removeNodes(n.steps, ids),
            recovery: n.recovery && !ids.includes(n.recovery.id) ? n.recovery : null,
            setRecovery: n.setRecovery && !ids.includes(n.setRecovery.id) ? n.setRecovery : null,
          }
        : n
    );
}
export function insertNodes(nodes, parentId, index, added) {
  if (!parentId) {
    const next = [...nodes];
    next.splice(index, 0, ...added);
    return next;
  }
  return updateNodes(nodes, [parentId], (n) => {
    if (n.kind === "repeat") n.steps.splice(index, 0, ...added);
    return n;
  });
}
export function moveNode(nodes, id, parentId, index) {
  const node = findNode(nodes, id);
  if (!node) return nodes;
  let cyclic = id === parentId;
  if (node.kind === "repeat")
    walkNodes(node.steps, (n) => {
      if (n.id === parentId) cyclic = true;
    });
  if (cyclic) return nodes;
  const siblings = parentId ? findNode(nodes, parentId)?.steps : nodes;
  if (!siblings) return nodes;
  const old = siblings.findIndex((n) => n.id === id);
  return insertNodes(
    removeNodes(nodes, [id]),
    parentId,
    old >= 0 && old < index ? index - 1 : index,
    [node]
  );
}
// Recovery is represented explicitly, so omitting the final recovery never
// changes the work count. Nested sets expand only at the provider boundary.
export function expandSteps(nodes, limit = 5000) {
  const out = [];
  const emit = (step, group, iteration) => {
    if (out.length >= limit) throw Error(`Workouts are limited to ${limit} executed steps`);
    out.push({ step, group, iteration });
  };
  const visit = (items, group = null, iteration = 1, depth = 0) => {
    if (depth > 6) throw Error("Repeat nesting is limited to six levels");
    for (const node of items) {
      if (node.kind === "step") emit(node, group, iteration);
      else
        for (let set = 0; set < node.sets; set++) {
          for (let rep = 0; rep < node.repetitions; rep++) {
            visit(node.steps, node.id, rep + 1, depth + 1);
            if (node.recovery && (node.finalRecovery || rep < node.repetitions - 1))
              emit(node.recovery, node.id, rep + 1);
          }
          if (node.setRecovery && set < node.sets - 1) emit(node.setRecovery, node.id, set + 1);
        }
    }
  };
  visit(nodes);
  return out;
}
export function validateWorkout(model) {
  const errors = [],
    ids = new Set();
  if (model?.version !== 1 || !Array.isArray(model.steps))
    return ["Invalid workout editor document"];
  if (typeof model.name !== "string" || !model.name.trim() || model.name.length > 200)
    errors.push("Enter a workout name under 200 characters");
  if (
    !["Ride", "VirtualRide", "Run", "VirtualRun", "TrailRun", "Swim", "Other"].includes(model.sport)
  )
    errors.push("Unsupported sport");
  const parsedDate = new Date(`${model.date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(model.date) ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== model.date
  )
    errors.push("Choose a valid date");
  if (!model.steps.length) errors.push("Add at least one step");
  if (typeof model.notes !== "string" || model.notes.length > 12000)
    errors.push("Workout instructions must be text under 12,000 characters");
  if (model.poolLength && !/^\d+(?:\.\d+)?(?:m|y)$/.test(model.poolLength))
    errors.push("Pool length must be a number followed by m or y");
  let count = 0;
  const positive = (n) => Number.isFinite(n) && n > 0;
  const visit = (nodes, depth = 0) => {
    if (depth > 6 || count > 500) {
      errors.push("Too many nested steps");
      return;
    }
    for (const n of nodes) {
      count++;
      if (!n || typeof n !== "object") {
        errors.push("Invalid workout step");
        continue;
      }
      if (ids.has(n.id) || typeof n.id !== "string") errors.push("Step IDs must be unique");
      ids.add(n.id);
      if (
        typeof n.label !== "string" ||
        typeof n.notes !== "string" ||
        n.label.length > 200 ||
        n.notes.length > 2000
      )
        errors.push("Step labels or notes are invalid");
      if (n.kind === "repeat") {
        if (
          typeof n.finalRecovery !== "boolean" ||
          (n.recovery && n.recovery.kind !== "step") ||
          (n.setRecovery && n.setRecovery.kind !== "step")
        )
          errors.push(
            "Repeat recovery must be a single interval with an explicit final-recovery choice"
          );
        if (![n.repetitions, n.sets].every((v) => Number.isInteger(v) && v >= 1 && v <= 100))
          errors.push("Repeat and set counts must be 1–100");
        if (!Array.isArray(n.steps) || !n.steps.length)
          errors.push("Repeat groups need at least one step");
        else visit(n.steps, depth + 1);
        if (n.recovery) visit([n.recovery], depth + 1);
        if (n.setRecovery) visit([n.setRecovery], depth + 1);
      } else if (n.kind === "step") {
        if (!roles.includes(n.role)) errors.push("Invalid step role");
        if (!["time", "distance", "lap"].includes(n.end?.kind) || !positive(n.end?.value))
          errors.push("Every step needs a positive duration, distance or lap estimate");
        if (n.end?.kind === "distance" ? !distanceFactors[n.end.unit] : n.end?.unit !== "s")
          errors.push("Invalid end-condition unit");
        if (n.end?.pressLap != null && typeof n.end.pressLap !== "boolean")
          errors.push("Lap-button ending must be enabled or disabled");
        const t = n.target;
        if (
          !t ||
          (t.kind !== "none" &&
            (!targetUnits[t.kind]?.includes(t.unit) ||
              !["single", "range", "ramp"].includes(t.mode)))
        )
          errors.push("Unsupported intensity target");
        else if (t.kind !== "none") {
          const values = t.mode === "single" ? [t.value] : [t.start, t.end];
          if (!values.every((v) => positive(v) || (t.kind === "power" && v === 0)))
            errors.push("Target values must be valid positive numbers");
          if (
            t.unit.includes("zone") &&
            (!values.every((v) => Number.isInteger(v) && v >= 1 && v <= 10) || t.mode === "ramp")
          )
            errors.push("Zones must be whole numbers 1–10; use numeric targets for ramps");
        }
        if (n.cadence && (!positive(n.cadence.start) || !positive(n.cadence.end)))
          errors.push("Cadence must be positive");
      } else errors.push("Unsupported step type");
    }
  };
  visit(model.steps);
  if (!errors.length)
    try {
      expandSteps(model.steps);
    } catch (e) {
      errors.push(e.message);
    }
  return [...new Set(errors)];
}
export function convertTarget(target, unit, ftp) {
  if (target.kind === "none" || target.unit === unit) return clone(target);
  let factor;
  if (paceFactors[target.unit] && paceFactors[unit])
    factor = paceFactors[unit] / paceFactors[target.unit];
  else if (target.unit === "w" && unit === "%ftp" && ftp > 0) factor = 100 / ftp;
  else if (target.unit === "%ftp" && unit === "w" && ftp > 0) factor = ftp / 100;
  else
    throw Error(
      "These units require a new prescription. Choose the target type and enter new values."
    );
  return {
    ...target,
    unit,
    ...(target.mode === "single"
      ? { value: target.value * factor }
      : { start: target.start * factor, end: target.end * factor }),
  };
}
export function targetLabel(t) {
  if (t.kind === "none") return "No target";
  const fmt = (v) =>
    t.unit.includes("zone") ? `Z${v}` : paceFactors[t.unit] ? clock(v) : `${round(v, 1)}`;
  const unit = paceFactors[t.unit]
    ? t.unit.replace("secs", "min")
    : t.unit.includes("zone")
      ? t.kind === "hr"
        ? "HR"
        : t.kind
      : t.unit;
  return `${t.mode === "single" ? fmt(t.value) : `${fmt(t.start)}${t.mode === "ramp" ? " → " : "–"}${fmt(t.end)}`} ${unit}`;
}
export function stepLabel(n) {
  if (n.kind === "repeat")
    return `${n.sets > 1 ? `${n.sets} sets · ` : ""}${n.repetitions} repetitions`;
  return `${n.end.kind === "distance" ? `${round(n.end.value)} ${n.end.unit}` : `${clock(n.end.value)}${n.end.kind === "lap" ? " estimated" : ""}`}${n.end.kind === "lap" || n.end.pressLap ? " · press lap" : ""} · ${targetLabel(n.target)}`;
}
function targetSpeed(target, thresholds) {
  if (target.kind !== "pace") return null;
  const v = target.mode === "single" ? target.value : (target.start + target.end) / 2;
  return paceFactors[target.unit]
    ? paceFactors[target.unit] / v
    : target.unit === "%pace" && thresholds?.pace > 0
      ? (thresholds.pace * v) / 100
      : null;
}
export function stepMetrics(step, thresholds = {}) {
  const speed = targetSpeed(step.target, thresholds);
  const distance =
    step.end.kind === "distance"
      ? step.end.value * distanceFactors[step.end.unit]
      : step.role === "rest"
        ? 0
        : speed
          ? step.end.value * speed
          : null;
  const seconds = step.end.kind === "distance" ? (speed ? distance / speed : null) : step.end.value;
  return { seconds, distance, estimated: step.end.kind !== "time", open: step.end.kind === "lap" };
}
export function workoutTotals(model) {
  let seconds = 0,
    distance = 0,
    work = 0,
    recovery = 0,
    rest = 0,
    unknownTime = false,
    unknownDistance = false,
    estimated = false,
    open = false,
    load = 0,
    loadKnown = true;
  let flat;
  try {
    flat = expandSteps(model.steps);
  } catch {
    return {
      seconds: 0,
      distance: 0,
      work: 0,
      recovery: 0,
      rest: 0,
      unknownTime: true,
      unknownDistance: true,
      estimated: true,
      open: false,
      load: null,
      executedSteps: 0,
      repetitions: 0,
    };
  }
  for (const { step } of flat) {
    const m = stepMetrics(step, model.thresholds);
    seconds += m.seconds || 0;
    distance += m.distance || 0;
    unknownTime ||= m.seconds == null;
    unknownDistance ||= m.distance == null;
    estimated ||= m.estimated;
    open ||= m.open;
    if (step.role === "rest") rest += m.seconds || 0;
    else if (step.role === "recovery") recovery += m.seconds || 0;
    else work += m.seconds || 0;
    const t = step.target,
      ftp = model.thresholds?.ftp;
    if (step.role === "rest" && t.kind === "none") continue;
    if (
      t.kind !== "power" ||
      !["w", "%ftp"].includes(t.unit) ||
      (t.unit === "w" && !(ftp > 0)) ||
      m.seconds == null ||
      m.open
    ) {
      loadKnown = false;
      continue;
    }
    const a = (t.mode === "single" ? t.value : t.start) / (t.unit === "w" ? ftp : 100),
      b = (t.mode === "single" ? t.value : t.end) / (t.unit === "w" ? ftp : 100);
    const meanSquare = t.mode === "ramp" ? (a * a + a * b + b * b) / 3 : ((a + b) / 2) ** 2;
    load += (m.seconds / 3600) * meanSquare * 100;
  }
  let repetitions = 0;
  const countRepeats = (nodes, factor = 1) =>
    nodes.forEach((n) => {
      if (n.kind === "repeat") {
        const executions = factor * n.repetitions * n.sets;
        repetitions += executions;
        countRepeats(n.steps, executions);
      }
    });
  countRepeats(model.steps);
  return {
    seconds,
    distance,
    work,
    recovery,
    rest,
    unknownTime,
    unknownDistance,
    estimated,
    open,
    load: loadKnown && !open ? load : null,
    executedSteps: flat.length,
    repetitions,
  };
}
export function chartSegments(model) {
  const flat = expandSteps(model.steps),
    pureDistance = flat.length > 0 && flat.every(({ step }) => step.end.kind === "distance");
  let estimated = false,
    placeholder = false;
  const segments = flat.map(({ step, group, iteration }, index) => {
    const metrics = stepMetrics(step, model.thresholds);
    estimated ||= metrics.estimated;
    const width = pureDistance ? metrics.distance : metrics.seconds;
    if (width == null) placeholder = true;
    const score = (value) => {
      const t = step.target;
      if (t.kind === "none") return step.role === "rest" ? 0.04 : 0.25;
      if (paceFactors[t.unit])
        return (
          paceFactors[t.unit] /
          value /
          (model.thresholds?.pace || (/swim/i.test(model.sport) ? 1 : 3))
        );
      if (t.unit.includes("zone")) return value / 5;
      if (t.kind === "power") return value / (t.unit === "w" ? model.thresholds?.ftp || 250 : 100);
      if (t.kind === "hr") return value / (t.unit === "bpm" ? 180 : 100);
      return value / 100;
    };
    const t = step.target;
    const start = score(t.mode === "single" ? t.value : t.start),
      end = t.mode === "ramp" ? score(t.end) : start;
    return {
      step,
      group,
      iteration,
      index,
      width: Math.max(0.001, width ?? 60),
      estimated: metrics.estimated || width == null,
      start,
      end,
    };
  });
  return {
    segments,
    axis: pureDistance
      ? "Distance (metres)"
      : placeholder
        ? "Estimated time (seconds); unknown steps shown as 60s placeholders"
        : estimated
          ? "Estimated time (seconds)"
          : "Time (seconds)",
    estimated,
    placeholder,
  };
}
function safeLine(text) {
  return String(text || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}
function targetText(t) {
  if (t.kind === "none") return "";
  const value = (n) =>
    t.unit.includes("zone") ? `Z${n}` : paceFactors[t.unit] ? clock(n) : round(n);
  const numbers = t.mode === "single" ? value(t.value) : `${value(t.start)}-${value(t.end)}`;
  const suffix =
    {
      w: "w",
      "%ftp": "%",
      bpm: "bpm",
      "%hr": "% HR",
      "%lthr": "% LTHR",
      "%pace": "% Pace",
      power_zone: "",
      pace_zone: " Pace",
      hr_zone: " HR",
    }[t.unit] ?? `${t.unit.replace("secs", "")} Pace`;
  return `${t.mode === "ramp" ? "ramp " : ""}${numbers}${suffix}`;
}
function nativeStep(step) {
  const amount =
    step.end.kind === "distance"
      ? `${round(step.end.value, 6)}${{ m: "mtr", km: "km", yd: "y", mi: "mi" }[step.end.unit]}`
      : `${round(step.end.value)}s`;
  // Text prompts precede the prescription; detailed instructions are kept in
  // the readable outline and lossless editor data, away from parser tokens.
  return `- ${step.end.kind === "lap" || step.end.pressLap ? "Press lap " : ""}${amount} ${targetText(step.target)}${step.cadence ? ` ${step.cadence.start === step.cadence.end ? step.cadence.start : `${step.cadence.start}-${step.cadence.end}`}rpm` : ""} intensity=${step.role === "other" ? "active" : step.role}`
    .replace(/ +/g, " ")
    .trim();
}
export function nativeWorkoutText(model) {
  const blocks = [];
  for (const node of model.steps) {
    if (node.kind === "step") {
      blocks.push(nativeStep(node));
      continue;
    }
    // ICU has one native repeat level. Preserve top-level repeats; expand
    // only nested sets and the explicitly omitted last recovery.
    if (node.sets === 1 && (!node.recovery || node.finalRecovery)) {
      blocks.push(
        `${node.repetitions}x\n${expandSteps([
          ...node.steps,
          ...(node.recovery ? [node.recovery] : []),
        ])
          .map(({ step }) => nativeStep(step))
          .join("\n")}`
      );
    } else
      blocks.push(
        expandSteps([node])
          .map(({ step }) => nativeStep(step))
          .join("\n\n")
      );
  }
  return `${model.poolLength && model.sport === "Swim" ? `Pool length: ${model.poolLength}\n\n` : ""}${blocks.join("\n\n")}`;
}
export function workoutOutline(model) {
  const lines = [];
  let section = "";
  const describe = (n, indent = "") => {
    if (n.kind === "step")
      lines.push(
        `${indent}${safeLine(n.label)}: ${stepLabel(n)}${n.cadence ? ` · ${n.cadence.start}–${n.cadence.end} rpm` : ""}${n.notes ? ` — ${safeLine(n.notes)}` : ""}`
      );
    else {
      lines.push(
        `${indent}${safeLine(n.label)}: ${stepLabel(n)}${n.notes ? ` — ${safeLine(n.notes)}` : ""}`
      );
      n.steps.forEach((s) => describe(s, `${indent}  `));
      if (n.recovery) {
        lines.push(
          `${indent}  Recovery ${n.finalRecovery ? "after every repetition" : "between repetitions only"}:`
        );
        describe(n.recovery, `${indent}    `);
      }
      if (n.setRecovery && n.sets > 1) {
        lines.push(`${indent}  Recovery between sets:`);
        describe(n.setRecovery, `${indent}    `);
      }
    }
  };
  for (const n of model.steps) {
    const next =
      n.kind === "step" && n.role === "warmup"
        ? "Warm Up"
        : n.kind === "step" && n.role === "cooldown"
          ? "Cool Down"
          : "Main Set";
    if (next !== section) {
      if (lines.length) lines.push("");
      lines.push(`${next}:`);
      section = next;
    }
    describe(n);
  }
  return lines.join("\n");
}
export function serializeWorkout(model) {
  const errors = validateWorkout(model);
  if (errors.length) throw Error(errors.join(". "));
  // Fenced blocks are ignored by the ICU workout parser. Human instructions
  // and editor-only grouping are preserved without generating phantom steps.
  const description = `${workoutOutline(model)}${model.notes ? `\n\nCoaching notes:\n${model.notes}` : ""}`;
  const data = { ...model };
  delete data.thresholds;
  const native = nativeWorkoutText(model);
  const text = `\`\`\`\n${description.replaceAll("```", "'''")}\n\`\`\`${DEFINITION_MARKER}${native}${DATA_MARKER}${JSON.stringify(data)}\n\`\`\``;
  if (text.length > 30000) throw Error("Workout text exceeds the 30,000 character export limit");
  return text;
}
export function readableDescription(description) {
  const head = String(description || "").split(DEFINITION_MARKER)[0];
  return head.startsWith("```\n") && head.endsWith("\n```") ? head.slice(4, -4) : head;
}
export function readEditorModel(description) {
  try {
    const text = String(description || ""),
      index = text.indexOf(DATA_MARKER);
    if (index < 0) return null;
    const model = JSON.parse(text.slice(index + DATA_MARKER.length).split("\n```")[0]);
    if (
      validateWorkout(model).length ||
      nativeWorkoutText(model) !== text.split(DEFINITION_MARKER)[1]?.split(DATA_MARKER)[0]
    )
      return null;
    return model;
  } catch {
    return null;
  }
}
function fromTarget(t, kind, ramp, paceUnit) {
  if (!t) return { kind: "none" };
  const unit =
    t.units === "secs"
      ? paceUnit
      : t.units === "%"
        ? kind === "power"
          ? "%ftp"
          : kind === "hr"
            ? "%hr"
            : "%pace"
        : t.units;
  return {
    kind,
    unit,
    mode: ramp ? "ramp" : t.value != null ? "single" : "range",
    ...(t.value != null ? { value: t.value } : { start: t.start, end: t.end }),
  };
}
export function importWorkout(event) {
  const issues = [],
    warnings = [],
    originalDescription = String(event.description || ""),
    doc = event.workout_doc;
  const base = {
    version: 1,
    name: event.name || "Workout",
    sport: event.type || "Other",
    date: String(event.start_date_local || "").slice(0, 10),
    notes: "",
    poolLength: doc?.options?.pool_length || (/swim/i.test(event.type) ? "25y" : ""),
    steps: [],
    thresholds: { ftp: event.icu_ftp || null, pace: event.icu_threshold_pace || null },
  };
  const index = originalDescription.indexOf(DATA_MARKER);
  if (index >= 0) {
    try {
      const saved = JSON.parse(
        originalDescription.slice(index + DATA_MARKER.length).split("\n```")[0]
      );
      const model = {
        ...saved,
        name: base.name,
        sport: base.sport,
        date: base.date,
        thresholds: base.thresholds,
      };
      const native = originalDescription.split(DEFINITION_MARKER)[1]?.split(DATA_MARKER)[0];
      if (native !== nativeWorkoutText(model))
        issues.push(
          "The remote workout text changed outside this editor. Its stored editor structure no longer matches; resolve it in Intervals.icu before editing."
        );
      const parsedIssues = verifyParsedWorkout(model, event);
      issues.push(...parsedIssues);
      return {
        model,
        issues: [...issues, ...validateWorkout(model)],
        warnings,
        originalDescription: readableDescription(originalDescription),
        reviewRequired: false,
        ambiguousSwim: false,
      };
    } catch {
      issues.push("The stored editor structure is damaged. It cannot safely be overwritten.");
    }
  }
  if (!Array.isArray(doc?.steps) || !doc.steps.length)
    issues.push(
      "This event has no parsed workout steps. Add a supported structured workout in Intervals.icu first."
    );
  const swim = /swim/i.test(base.sport),
    yards = /y$/.test(base.poolLength);
  let ambiguousSwim = false;
  const allowed = new Set([
    "duration",
    "distance",
    "distance_units",
    "reps",
    "steps",
    "power",
    "pace",
    "hr",
    "cadence",
    "ramp",
    "text",
    "warmup",
    "cooldown",
    "intensity",
    "press_lap",
  ]);
  const parse = (nodes, depth = 0) => {
    if (depth > 6) {
      issues.push("Repeats deeper than six levels cannot be edited");
      return [];
    }
    return (nodes || []).map((s) => {
      for (const key of Object.keys(s))
        if (!allowed.has(key) && s[key] != null && s[key] !== false)
          issues.push(`Unsupported step field “${key}” must be resolved before editing`);
      if (s.steps)
        return {
          ...newRepeat(parse(s.steps, depth + 1)),
          repetitions: s.reps ?? 1,
          label: s.text?.replace(/\s*\d+x\s*$/, "").trim() || "Repeats",
        };
      const kinds = ["power", "pace", "hr"].filter((k) => s[k]);
      if (kinds.length > 1)
        issues.push("Steps prescribing multiple target types at once cannot be edited safely");
      const role =
        s.intensity === "interval"
          ? "active"
          : s.intensity || (s.warmup ? "warmup" : s.cooldown ? "cooldown" : "active");
      if (swim && yards && s.distance && s.pace?.units === "secs") ambiguousSwim = true;
      const paceUnit = swim ? (yards ? "secs/100y" : "secs/100m") : null;
      if (s.pace?.units === "secs" && !paceUnit)
        issues.push("An absolute pace has no explicit units; resolve it in Intervals.icu first");
      for (const key of [...kinds, ...(s.cadence ? ["cadence"] : [])])
        for (const field of Object.keys(s[key]))
          if (!["value", "start", "end", "units"].includes(field))
            issues.push(`Unsupported ${key} target field “${field}”`);
      const target = fromTarget(s[kinds[0]], kinds[0], s.ramp, paceUnit);
      const end =
        s.distance > 0
          ? {
              kind: "distance",
              value: s.distance,
              unit: s.distance_units === "yards" ? "yd" : "m",
              ...(s.press_lap ? { pressLap: true } : {}),
            }
          : { kind: s.press_lap ? "lap" : "time", value: s.duration || 0, unit: "s" };
      // Pool work defaults to lap-button ending without discarding its planned
      // distance. Explicit provider lap settings and timed rests stay intact.
      if (swim && role !== "rest" && s.press_lap == null && end.kind !== "lap") end.pressLap = true;
      return {
        id: uid(),
        kind: "step",
        label: s.text || roleNames[role] || "Step",
        notes: "",
        role,
        end,
        target,
        cadence: s.cadence
          ? { start: s.cadence.value ?? s.cadence.start, end: s.cadence.value ?? s.cadence.end }
          : null,
      };
    });
  };
  base.steps = parse(doc?.steps);
  if (Array.isArray(doc?.locales) && doc.locales.length)
    issues.push("Localized workout prompts cannot be safely rewritten by this editor");
  const checkCadence = (nodes) =>
    (nodes || []).forEach((step) => {
      if (step.steps) checkCadence(step.steps);
      if (step.cadence?.units && step.cadence.units !== "rpm")
        issues.push(`Cadence units “${step.cadence.units}” are not supported for export`);
    });
  checkCadence(doc?.steps);
  // Provider workout_doc drops free-form words after the prescription. Recover
  // those from the corresponding native lines as step instructions.
  const source = originalDescription.includes(DEFINITION_MARKER)
    ? originalDescription.split(DEFINITION_MARKER)[1]
    : originalDescription;
  const sourceLines = source.split("\n").filter((line) => /^\s*-\s+/.test(line));
  const leaves = [];
  walkNodes(base.steps, (node) => {
    if (node.kind === "step") leaves.push(node);
  });
  if (sourceLines.length === leaves.length)
    sourceLines.forEach((line, i) => {
      const step = leaves[i];
      const amount = line.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(mtr|meters|yards|yrd|km|mi|y)\b/i);
      if (amount && step.end.kind === "distance") {
        const unit = { mtr: "m", meters: "m", yards: "yd", yrd: "yd", y: "yd", km: "km", mi: "mi" }[
          amount[2].toLowerCase()
        ];
        step.end = { ...step.end, kind: "distance", value: Number(amount[1]), unit };
      }
      const leftover = line
        .replace(/^\s*-\s*/, "")
        .replace(/\bPress lap\b/gi, "")
        .replace(/\bintensity=\w+/gi, "")
        .replace(/\d+:\d{2}(?:-\d+:\d{2})?\/(?:100y|100m|500m|400m|250m|km|mi)\s*Pace/gi, "")
        .replace(/\d+:\d{2}(?:-\d+:\d{2})?\s*Pace/gi, "")
        .replace(/\bZ\d+(?:-Z\d+)?(?:\s+(?:HR|Pace))?/gi, "")
        .replace(
          /\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?\s*(?:%\s*(?:HR|LTHR|Pace)?|rpm|bpm|watts|w\b|mtr\b|meters\b|yards\b|yrd\b|km\b|mi\b|y\b|h\b|m\b|s\b)/gi,
          ""
        )
        .replace(/\bramp\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (leftover && leftover !== step.label) step.notes = leftover;
    });
  const recoveries = (nodes) =>
    nodes.forEach((node) => {
      if (node.kind !== "repeat") return;
      recoveries(node.steps);
      const last = node.steps.at(-1);
      if (node.steps.length > 1 && last.kind === "step" && ["recovery", "rest"].includes(last.role))
        node.recovery = node.steps.pop();
    });
  recoveries(base.steps);
  for (const key of Object.keys(doc?.options || {}))
    if (key !== "pool_length") issues.push(`Workout option “${key}” cannot be safely rewritten`);
  // Retain coaching prose while replacing old interval instructions with the
  // generated outline. Saving does not require a separate import review.
  const prose = readableDescription(originalDescription);
  const paragraphs = prose.split(/\n\s*\n/);
  base.notes = paragraphs
    .filter(
      (p) =>
        !/^(?:\*\*)?(?:Warm ?Up|Main Set|Warm Down|Cool ?Down)\s*:/i.test(p.trim()) &&
        !/^\s*(?:-|\d+x\s*$|Pool length:)/m.test(p)
    )
    .join("\n\n")
    .trim();
  if (ambiguousSwim)
    warnings.push(
      "This legacy swim mixes metre tokens and yard-pool pace. Confirm the intended distance units before saving."
    );
  return {
    model: base,
    issues: [...new Set([...issues, ...validateWorkout(base)])],
    warnings,
    originalDescription,
    reviewRequired: false,
    ambiguousSwim,
  };
}
function providerLeaves(steps, out = [], depth = 0) {
  if (depth > 6) throw Error("Provider repeat nesting exceeds the supported limit");
  for (const s of steps || []) {
    if (s.steps) {
      if (!Number.isInteger(s.reps) || s.reps < 1 || s.reps > 100)
        throw Error("Provider repeat count is invalid");
      for (let i = 0; i < s.reps; i++) providerLeaves(s.steps, out, depth + 1);
    } else {
      if (out.length >= 5000) throw Error("Provider workout is too large");
      out.push(s);
    }
  }
  return out;
}
// Compare semantic execution, including every repeat and recovery, using the
// parsed response. Text equality alone is never a successful verification.
export function verifyParsedWorkout(model, event) {
  const errors = [],
    intended = expandSteps(model.steps);
  let actual;
  try {
    actual = providerLeaves(event.workout_doc?.steps);
  } catch (e) {
    return [e.message];
  }
  if (actual.length !== intended.length)
    return [`Intervals.icu parsed ${actual.length} steps; expected ${intended.length}`];
  const near = (a, b, tolerance = 0.02) => Number.isFinite(a) && Math.abs(a - b) <= tolerance;
  intended.forEach(({ step }, i) => {
    const a = actual[i],
      e = step.end,
      label = `Step ${i + 1}`;
    if (e.kind === "distance") {
      if (!near(Number(a.distance), e.value * distanceFactors[e.unit], 0.6))
        errors.push(`${label}: distance was not parsed as prescribed`);
    } else if (!near(Number(a.duration), e.value, 0.6))
      errors.push(`${label}: duration was not parsed as prescribed`);
    if (Boolean(a.press_lap) !== (e.kind === "lap" || Boolean(e.pressLap)))
      errors.push(`${label}: lap ending was not retained`);
    const t = step.target,
      key = t.kind;
    const parsedKinds = ["power", "pace", "hr"].filter((k) => a[k]);
    if (t.kind === "none") {
      if (parsedKinds.length) errors.push(`${label}: an unprescribed target was added`);
    } else {
      if (parsedKinds.length !== 1 || !a[key]) errors.push(`${label}: target type differs`);
      else {
        const parsed = fromTarget(
          a[key],
          key,
          a.ramp,
          model.sport === "Swim" ? (/y$/.test(model.poolLength) ? "secs/100y" : "secs/100m") : null
        );
        let normalized = parsed;
        if (parsed.unit !== t.unit && paceFactors[parsed.unit] && paceFactors[t.unit])
          normalized = convertTarget(parsed, t.unit);
        if (
          normalized.unit !== t.unit ||
          normalized.mode !== t.mode ||
          !(t.mode === "single"
            ? near(normalized.value, t.value, paceFactors[t.unit] ? 1 : 0.05)
            : near(normalized.start, t.start, paceFactors[t.unit] ? 1 : 0.05) &&
              near(normalized.end, t.end, paceFactors[t.unit] ? 1 : 0.05))
        )
          errors.push(`${label}: target values, units or ramp differ`);
      }
    }
    if (Boolean(a.ramp) !== (t.mode === "ramp")) errors.push(`${label}: ramp was not retained`);
    const role =
      a.intensity === "interval"
        ? "active"
        : a.intensity || (a.warmup ? "warmup" : a.cooldown ? "cooldown" : "active");
    if (role !== (step.role === "other" ? "active" : step.role))
      errors.push(`${label}: role differs`);
    if (
      step.cadence
        ? !a.cadence ||
          !near(a.cadence.value ?? a.cadence.start, step.cadence.start) ||
          !near(a.cadence.value ?? a.cadence.end, step.cadence.end)
        : Boolean(a.cadence)
    )
      errors.push(`${label}: cadence differs`);
  });
  const totals = workoutTotals(model);
  if (
    !totals.estimated &&
    !totals.unknownTime &&
    !near(Number(event.workout_doc?.duration), totals.seconds, 1)
  )
    errors.push("Parsed workout total duration differs");
  if (
    intended.every(({ step }) => step.end.kind === "distance" || step.role === "rest") &&
    !near(Number(event.workout_doc?.distance), totals.distance, 1)
  )
    errors.push("Parsed workout total distance differs");
  const parsedDuration = actual.reduce((sum, step) => sum + Number(step.duration || 0), 0);
  if (!near(Number(event.workout_doc?.duration), parsedDuration, Math.max(1, actual.length)))
    errors.push("Parsed duration total does not match the parsed steps");
  if (
    event.moving_time != null &&
    !near(Number(event.moving_time), Number(event.workout_doc?.duration), 1)
  )
    errors.push("Calendar duration does not match the parsed workout");
  return [...new Set(errors)];
}
export const templateNames = [
  "Warm Up",
  "Cool Down",
  "Steady Effort",
  "Recovery",
  "Rest",
  "Ramp Up",
  "Ramp Down",
  "Work + Recovery Repeats",
  "Over-Unders",
  "Progressive Intervals",
];
export function makeTemplate(name, sport) {
  const role =
    { "Warm Up": "warmup", "Cool Down": "cooldown", Recovery: "recovery", Rest: "rest" }[name] ||
    "active";
  const step = newStep(sport, role);
  step.label = name;
  if (name === "Rest") step.end.value = 30;
  if (name.startsWith("Ramp")) {
    const t = defaultTarget(sport);
    if (t.unit.includes("zone")) {
      t.unit = "%pace";
      t.value = 90;
    }
    const a = t.value * (t.kind === "pace" && paceFactors[t.unit] ? 1.15 : 0.7),
      b = t.value;
    step.target = {
      kind: t.kind,
      unit: t.unit,
      mode: "ramp",
      start: name === "Ramp Up" ? a : b,
      end: name === "Ramp Up" ? b : a,
    };
  }
  if (name === "Work + Recovery Repeats") {
    const g = newRepeat([step]);
    step.label = "Work";
    g.recovery = newStep(sport, /swim/i.test(sport) ? "rest" : "recovery");
    g.recovery.end = { kind: "time", value: 60, unit: "s" };
    return [g];
  }
  if (name === "Over-Unders" || name === "Progressive Intervals") {
    const nodes = [0, 1, ...(name === "Progressive Intervals" ? [2] : [])].map((i) => {
      const s = newStep(sport);
      s.label = name === "Over-Unders" ? (i ? "Over" : "Under") : `Progression ${i + 1}`;
      s.target.value = s.target.unit.includes("zone")
        ? 2 + i
        : round(s.target.value * (paceFactors[s.target.unit] ? 1.1 - i * 0.1 : 0.85 + i * 0.15));
      return s;
    });
    return name === "Over-Unders" ? [{ ...newRepeat(nodes), label: name }] : nodes;
  }
  return [step];
}
