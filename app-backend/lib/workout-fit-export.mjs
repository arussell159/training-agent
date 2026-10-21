import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { Encoder, Decoder, Stream, Profile } from "@garmin/fitsdk";
import {
  distanceFactors,
  paceFactors,
  expandSteps,
  stepLabel,
  validateWorkout,
} from "./workout-editor-model.mjs";

const unsupported = (message) => {
  throw Object.assign(new Error(message), { status: 400, code: "WORKOUT_EXPORT_UNSUPPORTED" });
};
// A FIT field definition has a one-byte size. UTF-8 prefixes must end at a
// character boundary; the text download retains the full human instructions.
function fitText(value) {
  let output = "";
  for (const letter of String(value || "").replaceAll("\0", "")) {
    if (Buffer.byteLength(output + letter, "utf8") > 254) break;
    output += letter;
  }
  return output;
}
function uint(value, label) {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded) || rounded < 0 || rounded >= 0xffffffff)
    unsupported(`${label} is outside the FIT file format's supported range. Use Text export.`);
  return rounded;
}
function targetFields(target, thresholds) {
  if (target.kind === "rpe")
    unsupported(
      "This FIT encoder cannot preserve numeric RPE targets. Use Text export to retain the prescription."
    );
  if (target.kind === "none") return { targetType: "open", targetValue: 0 };
  if (target.mode === "ramp")
    unsupported(
      "FIT cannot preserve a continuous target ramp. Choose ZWO, MRC or ERG for a timed power ramp, or Text for the complete prescription."
    );
  const values =
    target.mode === "single" ? [target.value, target.value] : [target.start, target.end];
  const type = { pace: "speed", power: "power", hr: "heartRate" }[target.kind];
  if (target.unit.endsWith("_zone")) {
    if (values[0] !== values[1])
      unsupported(
        "FIT supports one zone per step. Use numeric target bounds for a zone range, or export Text."
      );
    return { targetType: type, targetValue: values[0] };
  }
  let bounds;
  if (target.kind === "pace") {
    if (paceFactors[target.unit])
      bounds = values.map((value) => (paceFactors[target.unit] / value) * 1000);
    else if (target.unit === "%pace" && thresholds.pace > 0)
      bounds = values.map((value) => ((thresholds.pace * value) / 100) * 1000);
    else
      unsupported(
        "Set your threshold pace in Intervals.icu before exporting percentage-pace targets to FIT, or use absolute pace targets."
      );
  } else if (target.kind === "power") {
    if (target.unit === "w") bounds = values.map((value) => value + 1000);
    else if (target.unit === "%ftp" && values.every((value) => value < 1000)) bounds = values;
    else
      unsupported(
        "This power target cannot be represented in FIT. Use watts or a supported FTP percentage."
      );
  } else if (target.kind === "hr") {
    if (target.unit === "bpm") bounds = values.map((value) => value + 100);
    else if (target.unit === "%hr" && values.every((value) => value <= 100)) bounds = values;
    else if (target.unit === "%lthr" && thresholds.lthr > 0)
      bounds = values.map((value) => (thresholds.lthr * value) / 100 + 100);
    else
      unsupported(
        "Set your lactate-threshold heart rate in Intervals.icu before exporting %LTHR to FIT, or use bpm targets."
      );
  }
  if (!bounds) unsupported("This target cannot be represented in FIT. Use Text export.");
  return {
    targetType: type,
    targetValue: 0,
    customTargetValueLow: uint(Math.min(...bounds), "Target"),
    customTargetValueHigh: uint(Math.max(...bounds), "Target"),
  };
}

/** Encode standard FIT workout messages with Garmin's official SDK. The main
 * uint fields are intentional: the SDK ignores writes to dynamic subfields. */
export function encodeWorkoutFit(model, { lthr } = {}) {
  if (!model?.steps?.length) throw Error("Add device steps before exporting a FIT workout.");
  const errors = validateWorkout(model);
  if (errors.length) unsupported(errors.join(". "));
  const steps = expandSteps(model.steps).map(({ step }, index) => {
    const manual = step.end.kind === "lap" || step.end.pressLap;
    const durationType = manual ? "open" : step.end.kind === "distance" ? "distance" : "time";
    const durationValue = manual
      ? 0
      : uint(
          step.end.value *
            (step.end.kind === "distance" ? distanceFactors[step.end.unit] * 100 : 1000),
          "Step duration"
        );
    return {
      messageIndex: index,
      wktStepName: fitText(step.label),
      notes: fitText(
        [manual ? `Planned: ${stepLabel(step)}` : "", step.notes].filter(Boolean).join("\n")
      ),
      durationType,
      durationValue,
      intensity: step.role,
      ...targetFields(step.target, { ...model.thresholds, lthr }),
      ...(step.cadence
        ? {
            secondaryTargetType: "cadence",
            secondaryTargetValue: 0,
            secondaryCustomTargetValueLow: uint(
              Math.min(step.cadence.start, step.cadence.end),
              "Cadence"
            ),
            secondaryCustomTargetValueHigh: uint(
              Math.max(step.cadence.start, step.cadence.end),
              "Cadence"
            ),
          }
        : {}),
    };
  });
  const sports = {
    Run: ["running", "generic"],
    VirtualRun: ["running", "virtualActivity"],
    TrailRun: ["running", "trail"],
    Ride: ["cycling", "generic"],
    VirtualRide: ["cycling", "virtualActivity"],
    MountainBikeRide: ["cycling", "mountain"],
    Swim: ["swimming", "lapSwimming"],
    WeightTraining: ["training", "strengthTraining"],
    Walk: ["walking", "generic"],
    Rowing: ["rowing", "generic"],
    NordicSki: ["crossCountrySkiing", "generic"],
    Workout: ["training", "cardioTraining"],
    Other: ["generic", "generic"],
  };
  const mapping = sports[model.sport];
  if (!mapping) unsupported("This sport cannot be represented in FIT. Use Text export.");
  const [sport, subSport] = mapping;
  const encoder = new Encoder();
  // The name and definition identify the workout; repeated downloads receive
  // the same serial number while editing its prescription changes the identity.
  const serialNumber =
    createHash("sha256").update(JSON.stringify(model)).digest().readUInt32LE(0) || 1;
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: "workout",
    manufacturer: "development",
    product: 1,
    serialNumber,
    timeCreated: new Date(`${model.date}T00:00:00Z`),
  });
  const pool = model.poolLength?.match(/^(\d+(?:\.\d+)?)(m|y)$/);
  const poolLength = pool ? Number(pool[1]) * (pool[2] === "y" ? 0.9144 : 1) : 0;
  if (pool && (!(poolLength > 0) || poolLength >= 655.35))
    unsupported("Pool length is outside the FIT file format's supported range.");
  encoder.onMesg(Profile.MesgNum.WORKOUT, {
    sport,
    subSport,
    numValidSteps: steps.length,
    wktName: fitText(model.name),
    wktDescription: fitText(model.notes),
    ...(pool ? { poolLength, poolLengthUnit: pool[2] === "y" ? "statute" : "metric" } : {}),
  });
  for (const step of steps) encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, step);
  const bytes = Buffer.from(encoder.close());
  const decoder = new Decoder(Stream.fromBuffer(bytes));
  if (!decoder.isFIT() || !decoder.checkIntegrity())
    throw Object.assign(new Error("The FIT workout failed file-integrity verification."), {
      status: 500,
    });
  const decoded = decoder.read({
    expandSubFields: false,
    expandComponents: false,
    mergeHeartRates: false,
  });
  if (decoded.errors.length || decoded.messages.workoutStepMesgs?.length !== steps.length)
    throw Object.assign(new Error("The FIT workout failed step verification."), { status: 500 });
  return bytes;
}
