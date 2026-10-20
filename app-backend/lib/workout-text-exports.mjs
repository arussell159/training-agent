import { Buffer } from "node:buffer";
import {
  expandSteps,
  roleNames,
  validateWorkout,
  walkNodes,
  workoutOutline,
} from "./workout-editor-model.mjs";

// Format references (encoders below are original implementations):
// https://support.trainerroad.com/hc/trainerroad-support/articles/201944204-creating-a-workout-from-an-erg-or-mrc-file
// https://forums.zwift.com/t/user-definable-slow-down-speed-up-watt-zones-within-created-workouts/8445/2
// https://forum.xertonline.com/t/xert-workout-tp-locked-not-adjusting-the-tp-in-zwift/48307
// https://raw.githubusercontent.com/GoldenCheetah/GoldenCheetah/master/src/Train/ZwoParser.cpp
const fail = (format, reason) => {
  throw Object.assign(
    Error(
      `${format.toUpperCase()} export: ${reason} Use FIT or Text to retain the complete prescription.`
    ),
    {
      status: 400,
      code: "WORKOUT_EXPORT_UNSUPPORTED",
    }
  );
};
const number = (value, format) => {
  if (!Number.isFinite(value) || value < 0 || value > 1e12)
    fail(format, "A converted value is outside the format's supported range.");
  const result = value.toFixed(9).replace(/\.?0+$/, "") || "0";
  if (value > 0 && Number(result) === 0)
    fail(format, "A converted value is smaller than the format's supported precision.");
  return result;
};
const xml = (value) =>
  String(value)
    .replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[character]
    )
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;")
    .replace(/\t/g, "&#9;");
// Course text is tab-delimited and section markers use brackets. Encode those
// characters for display rather than allowing user text to create file records.
const courseText = (value) =>
  String(value)
    .replace(/\r\n?|\n/g, " · ")
    .replace(/\t/g, " ")
    .replace(/\[/g, "［")
    .replace(/\]/g, "］");
const cue = (step) =>
  `${roleNames[step.role]}: ${step.label}${step.notes ? ` — ${step.notes}` : ""}`;
function ftpValue(model, format) {
  const ftp = model.thresholds?.ftp;
  if (!Number.isFinite(ftp) || ftp <= 0)
    fail(format, "Set your cycling FTP before converting between watts and percent FTP.");
  return ftp;
}
function powerValue(value, target, model, format) {
  if (format === "erg")
    return target.unit === "w" ? value : (value * ftpValue(model, format)) / 100;
  const percent = target.unit === "%ftp" ? value : (value * 100) / ftpValue(model, format);
  return format === "zwo" ? percent / 100 : percent;
}
function validate(model, format) {
  if (!["zwo", "mrc", "erg"].includes(format)) fail(String(format), "Choose ZWO, MRC or ERG.");
  const errors = validateWorkout(model);
  if (errors.length) fail(format, errors.join(". "));
  if (!["Ride", "VirtualRide"].includes(model.sport))
    fail(format, "This format supports cycling workouts with power targets.");
  // XML 1.0 and course-line readers cannot safely preserve these controls.
  const texts = [model.name, model.notes];
  walkNodes(model.steps, (node) => texts.push(node.label, node.notes));
  if (
    texts.some((text) =>
      [...text].some((character) => {
        const code = character.charCodeAt(0);
        return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
      })
    )
  )
    fail(format, "Remove control characters from workout text.");
  const flat = expandSteps(model.steps);
  for (const { step } of flat) {
    if (step.end.kind !== "time" || step.end.pressLap)
      fail(format, "Distance and lap-button endings cannot be converted to timed steps.");
    if (format === "zwo" && !Number.isInteger(step.end.value))
      fail(format, "ZWO duration must be a whole number of seconds.");
    const target = step.target;
    if (target.kind === "none") {
      if (format !== "zwo") fail(format, "Untargeted steps cannot be represented as fixed power.");
    } else {
      if (target.kind !== "power" || !["%ftp", "w"].includes(target.unit))
        fail(format, "Use numeric power targets; pace, heart rate and zones need another format.");
      if (target.mode === "range" && format !== "zwo")
        fail(format, "Power ranges cannot be represented by a single power curve.");
      if (target.mode === "range" && target.start > target.end)
        fail(format, "The lower power bound must not exceed the upper bound.");
    }
    if (step.cadence) {
      if (format !== "zwo") fail(format, "Cadence targets are not supported by this format.");
      if (step.cadence.start !== step.cadence.end || !Number.isInteger(step.cadence.start))
        fail(
          format,
          "Cadence ranges or fractional cadence cannot be represented by a single cadence target."
        );
    }
  }
  return flat;
}

function encodeZwo(model, flat) {
  const hasWatts = flat.some(({ step }) => step.target.unit === "w");
  const ftp = hasWatts ? ftpValue(model, "zwo") : null;
  if (ftp != null && !Number.isInteger(ftp))
    fail("zwo", "Fixed-watt targets require a whole-number FTP override.");
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<workout_file>",
    "  <author>Training Agent</author>",
    `  <name>${xml(model.name)}</name>`,
    `  <description>${xml([model.notes, workoutOutline(model)].filter(Boolean).join("\n\n"))}</description>`,
    "  <sportType>bike</sportType>",
    ...(ftp == null ? [] : [`  <ftpOverride>${number(ftp, "zwo")}</ftpOverride>`]),
    "  <tags/>",
    "  <workout>",
  ];
  for (const { step } of flat) {
    const target = step.target;
    const tag =
      target.kind === "none" ? "FreeRide" : target.mode === "ramp" ? "Ramp" : "SteadyState";
    const attrs = [`Duration="${number(step.end.value, "zwo")}"`];
    if (target.kind !== "none") {
      const value = (amount) => number(powerValue(amount, target, model, "zwo"), "zwo");
      if (target.mode === "single") attrs.push(`Power="${value(target.value)}"`);
      else attrs.push(`PowerLow="${value(target.start)}"`, `PowerHigh="${value(target.end)}"`);
    }
    if (step.cadence) attrs.push(`Cadence="${step.cadence.start}"`);
    lines.push(
      `    <${tag} ${attrs.join(" ")}>`,
      `      <textevent timeoffset="0" duration="${Math.min(10, step.end.value)}" message="${xml(cue(step))}"/>`,
      `    </${tag}>`
    );
  }
  lines.push("  </workout>", "</workout_file>", "");
  return Buffer.from(lines.join("\n"), "utf8");
}

function encodeCourse(model, flat, format) {
  const ftp = model.thresholds?.ftp;
  const name = courseText(model.name).replace(/[\\/]/g, "-");
  const description = courseText([model.notes, workoutOutline(model)].filter(Boolean).join("\n\n"));
  const lines = [
    "[COURSE HEADER]",
    "VERSION = 2",
    "UNITS = ENGLISH",
    `DESCRIPTION = ${description}`,
    `FILE NAME = ${name}.${format}`,
    ...(Number.isFinite(ftp) && ftp > 0 ? [`FTP = ${number(ftp, format)}`] : []),
    `MINUTES\t${format === "erg" ? "WATTS" : "PERCENT"}`,
    "[END COURSE HEADER]",
    "[COURSE DATA]",
  ];
  const messages = [];
  let elapsed = 0;
  for (const { step } of flat) {
    const target = step.target;
    const start = target.mode === "single" ? target.value : target.start;
    const end = target.mode === "single" ? target.value : target.end;
    const value = (amount) => number(powerValue(amount, target, model, format), format);
    // Duplicate boundary timestamps express an instantaneous change. Each
    // segment's two endpoints preserve steady values and linear ramps exactly.
    lines.push(`${number(elapsed / 60, format)}\t${value(start)}`);
    messages.push(
      `${number(elapsed, format)}\t${courseText(cue(step))}\t${number(Math.min(step.end.value, 10), format)}`
    );
    elapsed += step.end.value;
    lines.push(`${number(elapsed / 60, format)}\t${value(end)}`);
  }
  lines.push("[END COURSE DATA]", "[COURSE TEXT]", ...messages, "[END COURSE TEXT]", "");
  return Buffer.from(lines.join("\r\n"), "utf8");
}

/** Encode a supported workout locally; no network request or athlete defaults. */
export function encodeWorkoutTextFormat(model, format) {
  const flat = validate(model, format);
  return format === "zwo" ? encodeZwo(model, flat) : encodeCourse(model, flat, format);
}
