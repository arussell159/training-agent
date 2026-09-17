import {
  clock,
  convertTarget,
  distanceFactors,
  expandSteps,
  importWorkout,
  paceFactors,
  round,
} from "./workout-editor-model.mjs";
import { sportZoneSettings } from "./workout-editor-zones.mjs";

// A read-only application projection. Never used by the provider serializer.
const number = (value) => String(round(value, 6));
const isRecovery = (node) => node.kind === "step" && ["rest", "recovery"].includes(node.role);
const isRest = (step) =>
  step.role === "rest" || (step.role === "recovery" && step.target.kind === "none");

function swimStyle(step) {
  const source = `${step.label || ""} ${step.notes || ""}`;
  const styles = [
    ...source.matchAll(
      /\b(FS|freestyle|front crawl|pull(?:ing)?|kick(?:ing)?|drill|back(?:stroke)?|breast(?:stroke)?|choice|butterfly|fly|IM)\b/gi
    ),
  ].map(([word]) => {
    if (/^(fs|freestyle|front crawl)$/i.test(word)) return "FS";
    if (/^pull/i.test(word)) return "Pull";
    if (/^kick/i.test(word)) return "Kick";
    if (/^back/i.test(word)) return "Back";
    if (/^breast/i.test(word)) return "Breast";
    if (/^(fly|butterfly)$/i.test(word)) return "Fly";
    if (/^im$/i.test(word)) return "IM";
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  });
  const equipment = [...source.matchAll(/\b(fins|paddles|snorkel|buoy)\b/gi)].map(([word]) =>
    word.toLowerCase()
  );
  return (
    [...new Set(styles)].join(" ") +
    (equipment.length ? ` with ${[...new Set(equipment)].join(" and ")}` : "")
  );
}

function targetText(target, model, settings) {
  if (target.kind === "none") return "";
  const setting = sportZoneSettings(settings, model.sport);
  const swimming = /swim/i.test(model.sport);
  const values = target.mode === "single" ? [target.value] : [target.start, target.end];
  const join = (items) => items.join(target.mode === "ramp" ? " → " : "–");
  if (target.unit.endsWith("_zone"))
    return `in ${join(values.map((n) => `Z${n}`))}${target.kind === "hr" ? " HR" : ""}`;
  const ftp = model.thresholds?.ftp || setting?.ftp;
  const thresholdPace = model.thresholds?.pace || setting?.threshold_pace;
  const boundaries = target.kind === "power" ? setting?.power_zones : setting?.pace_zones;
  const percent = (n) =>
    target.unit === "%ftp" || target.unit === "%pace"
      ? n
      : target.unit === "w" && ftp > 0
        ? (n / ftp) * 100
        : paceFactors[target.unit] && thresholdPace > 0
          ? (paceFactors[target.unit] / n / thresholdPace) * 100
          : null;
  let zone = "";
  if (Array.isArray(boundaries) && (target.kind === "power" || swimming)) {
    const zones = values.map((n) => {
      const p = percent(n);
      if (!(p >= 0) || p === null) return null;
      const index = boundaries.findIndex((high) => p <= high + 1e-6);
      return index < 0 ? null : index + 1;
    });
    if (zones.every((n) => n != null)) {
      zone = `in ${zones[0] === zones.at(-1) ? `Z${zones[0]}` : join(zones.map((n) => `Z${n}`))}`;
    }
  }
  let value;
  if (
    target.kind === "pace" &&
    (paceFactors[target.unit] ||
      (target.unit === "%pace" && thresholdPace > 0 && values.every((n) => n > 0)))
  ) {
    const unit = swimming ? "secs/100y" : "secs/mi";
    const displayed = target.unit === "%pace" ? null : convertTarget(target, unit);
    const paces = displayed
      ? displayed.mode === "single"
        ? [displayed.value]
        : [displayed.start, displayed.end]
      : values.map((n) => paceFactors[unit] / ((thresholdPace * n) / 100));
    value = `${join(paces.map(clock))} ${swimming ? "min/100y" : "min/mile"}`;
  } else {
    const suffix =
      {
        w: "W",
        "%ftp": "% FTP",
        "%pace": "% threshold pace",
        bpm: "bpm",
        "%hr": "% max HR",
        "%lthr": "% threshold HR",
      }[target.unit] || target.unit;
    value = `${join(values.map(number))} ${suffix}`;
  }
  return zone ? `${zone} (${value})` : `at ${value}`;
}

function sectionFor(node) {
  const steps = node.kind === "step" ? [node] : expandSteps([node]).map(({ step }) => step);
  const work = steps.filter((step) => !isRecovery(step));
  if (work.length && work.every((step) => step.role === "warmup")) return "Warm Up";
  if (work.length && work.every((step) => step.role === "cooldown")) return "Warm Down";
  return "Main Set";
}

export function formatWorkoutDescription(model, settings = []) {
  if (!model?.steps?.length) return "";
  // Apply the same expansion limits as the editor before walking nested input.
  expandSteps(model.steps);
  const swimming = /swim/i.test(model.sport);
  const amount = (step) => {
    if (step.end.kind === "distance") {
      const metres = step.end.value * distanceFactors[step.end.unit];
      return swimming
        ? `${number(metres / distanceFactors.yd)} yd`
        : `${number(metres / distanceFactors.mi)} mi`;
    }
    if (step.end.kind === "lap" && !(step.end.value > 0)) return "Until lap press";
    return isRest(step) ? `${number(step.end.value)} secs` : `${number(step.end.value / 60)} mins`;
  };
  const describe = (step, repeated = false) => {
    if (isRest(step)) {
      const restAmount =
        step.end.kind === "time" || step.end.kind === "lap"
          ? `${number(step.end.value)} ${repeated ? "sec rests" : "secs rest"}`
          : `${amount(step)} ${repeated ? "rests" : "rest"}`;
      return [restAmount, targetText(step.target, model, settings)].filter(Boolean).join(" ");
    }
    const text = [
      amount(step),
      swimming ? swimStyle(step).trim() : "",
      targetText(step.target, model, settings),
      step.role === "recovery" ? "recovery" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const cadence = step.cadence
      ? ` at ${step.cadence.start === step.cadence.end ? step.cadence.start : `${step.cadence.start}–${step.cadence.end}`} rpm`
      : "";
    return text + cadence;
  };
  // Group only equivalent adjacent prescriptions, never different progression
  // targets, recoveries, strokes, cadence, or lap-ending behavior.
  const key = (node) => JSON.stringify(node, (name, value) => (name === "id" ? undefined : value));
  const unitsFor = (nodes) => {
    const units = [];
    for (let i = 0; i < nodes.length; i++) {
      const parts = [nodes[i]];
      if (!isRecovery(nodes[i]) && isRecovery(nodes[i + 1] || {})) parts.push(nodes[++i]);
      units.push(parts);
    }
    return units;
  };
  const distanceTotal = (nodes) => {
    const leaves = expandSteps(nodes).map(({ step }) => step);
    if (
      !leaves.some((step) => step.end.kind === "distance") ||
      leaves.some((step) => step.end.kind !== "distance" && !isRest(step))
    )
      return "";
    const metres = leaves.reduce(
      (sum, step) =>
        sum + (step.end.kind === "distance" ? step.end.value * distanceFactors[step.end.unit] : 0),
      0
    );
    return swimming
      ? `${number(metres / distanceFactors.yd)} yd`
      : `${number(metres / distanceFactors.mi)} mi`;
  };
  const renderRepeated = (nodes, count, indent = "") => {
    const units = unitsFor(nodes);
    if (units.length === 1 && units[0].every((n) => n.kind === "step")) {
      const parts = units[0];
      const text = parts.map((s) => describe(s, count > 1)).join(" + ");
      return [
        `${indent}${count > 1 || (swimming && parts.length > 1) ? `${count} x (${text})` : text}`,
      ];
    }
    if (count === 1) return renderSequence(nodes, indent);
    const distance = distanceTotal(nodes);
    return [
      `${indent}Repeat ${count} sets${distance ? ` of ${distance}` : ""} as below:`,
      ...renderSequence(nodes, indent + "  ", true),
    ];
  };
  const renderRepeat = (node, indent) => {
    if (node.sets > 1) {
      const inner = { ...node, sets: 1, setRecovery: null };
      if (node.setRecovery) {
        return [
          ...renderRepeated([inner, node.setRecovery], node.sets - 1, indent),
          ...renderRepeat(inner, indent),
        ];
      }
      return renderRepeated([inner], node.sets, indent);
    }
    const cycle = [...node.steps, ...(node.recovery ? [node.recovery] : [])];
    if (
      swimming &&
      node.repetitions === 1 &&
      node.steps.length > 1 &&
      node.steps.every((step) => step.kind === "step")
    ) {
      const parts = [
        ...node.steps,
        ...(node.recovery && node.finalRecovery ? [node.recovery] : []),
      ];
      return [`${indent}1 x (${parts.map((step) => describe(step)).join(" + ")})`];
    }
    if (node.recovery && !node.finalRecovery) {
      return [
        ...(node.repetitions > 1 ? renderRepeated(cycle, node.repetitions - 1, indent) : []),
        ...renderSequence(node.steps, indent),
      ];
    }
    return renderRepeated(cycle, node.repetitions, indent);
  };
  const renderSequence = (nodes, indent = "", repeated = false) => {
    const units = unitsFor(nodes),
      lines = [];
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      let count = 1;
      while (i + count < units.length && key(unit) === key(units[i + count])) count++;
      i += count - 1;
      if (unit.every((node) => node.kind === "step")) {
        const text = unit.map((step) => describe(step, count > 1 || repeated)).join(" + ");
        lines.push(
          `${indent}${count > 1 || (swimming && unit.length > 1) ? `${count} x (${text})` : text}`
        );
      } else if (count > 1) {
        const distance = distanceTotal(unit);
        lines.push(
          `${indent}Repeat ${count} sets${distance ? ` of ${distance}` : ""} as below:`,
          ...renderSequence(unit, indent + "  ")
        );
      } else {
        for (const node of unit)
          lines.push(
            ...(node.kind === "repeat"
              ? renderRepeat(node, indent)
              : [`${indent}+ ${describe(node)}`])
          );
      }
    }
    return lines;
  };
  const sections = [];
  for (const node of model.steps) {
    const title = isRecovery(node) && sections.length ? sections.at(-1).title : sectionFor(node);
    if (sections.at(-1)?.title !== title) sections.push({ title, nodes: [] });
    sections.at(-1).nodes.push(node);
  }
  return sections
    .map(({ title, nodes }) => `${title}:\n${renderSequence(nodes).join("\n")}`)
    .join("\n\n");
}

export function eventWorkoutDescription(event, settings = []) {
  if (!event?.workout_doc?.steps?.length) return null;
  try {
    const imported = importWorkout(event);
    if (imported.issues.length) return null;
    return formatWorkoutDescription(imported.model, settings) || null;
  } catch {
    return null;
  }
}

// Also covers previously cached workouts without requiring a provider write or
// a forced sync. The original structure and all model objects stay untouched.
export function appWorkoutDescription(workout, settings = []) {
  if (!workout || workout.status === "completed" || workout.completed || workout.activity_id)
    return null;
  if (workout.app_description_version === 1 && typeof workout.details === "string")
    return workout.details;
  try {
    if (workout.raw?.workout_doc) return eventWorkoutDescription(workout.raw, settings);
    if (workout.editor_model) return formatWorkoutDescription(workout.editor_model, settings);
    const doc =
      typeof workout.structure === "string" ? JSON.parse(workout.structure) : workout.structure;
    const sport = workout.sport === "Bike" ? "Ride" : workout.sport;
    return eventWorkoutDescription(
      {
        type: sport,
        name: workout.title || "Workout",
        start_date_local: workout.workout_date || "2000-01-01",
        description: "",
        workout_doc: Array.isArray(doc) ? { steps: doc } : doc,
      },
      settings
    );
  } catch {
    return null;
  }
}
