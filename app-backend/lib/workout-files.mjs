import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { eventId, createIntervalsClient } from "./intervals.mjs";
import {
  serializeWorkout,
  validateWorkout,
  importWorkout,
  expandSteps,
} from "./workout-editor-model.mjs";
import { sportZoneSettings } from "./workout-editor-zones.mjs";
import { encodeWorkoutFit } from "./workout-fit-export.mjs";
import { encodeWorkoutTextFormat } from "./workout-text-exports.mjs";
import { readManualWorkoutDescription } from "./workout-manual-description.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const safeName = (value) =>
  String(value || "workout")
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .trim()
    .slice(0, 100) || "workout";

export function validateRecording(input = {}) {
  const name = safeName(input.name);
  const extension = name.match(/\.(fit|tcx|gpx)$/i)?.[1]?.toLowerCase();
  if (!extension) fail("Choose a FIT, TCX or GPX activity file.");
  if (
    typeof input.data !== "string" ||
    input.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)
  )
    fail("Choose an activity file smaller than 2 MB.");
  const bytes = Buffer.from(input.data, "base64");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES)
    fail("Choose an activity file smaller than 2 MB.");
  if (extension === "fit") {
    if (bytes.length < 12 || bytes.toString("ascii", 8, 12) !== ".FIT")
      fail("This file does not contain a valid FIT header.");
  } else {
    const xml = bytes.toString("utf8");
    if (
      /<!DOCTYPE|<!ENTITY/i.test(xml) ||
      !(extension === "tcx" ? /<(?:[\w-]+:)?TrainingCenterDatabase(?:\s|>)/ : /<gpx(?:\s|>)/).test(
        xml
      )
    )
      fail(`This file does not contain a valid ${extension.toUpperCase()} activity.`);
  }
  return { name, bytes, digest: createHash("sha256").update(bytes).digest("hex") };
}

async function providerFileRequest(config, pathname, options, fetchImpl) {
  if (!config.INTERVALS_API_KEY) fail("Connect Intervals.icu in Settings first.", 409);
  const response = await fetchImpl(`https://intervals.icu/api/v1${pathname}`, {
    ...options,
    signal: globalThis.AbortSignal.timeout(60_000),
    headers: {
      ...options.headers,
      Authorization: `Basic ${Buffer.from(`API_KEY:${config.INTERVALS_API_KEY}`).toString("base64")}`,
    },
  });
  if (!response.ok)
    fail(
      response.status === 401 || response.status === 403
        ? "Check your Intervals.icu connection in Settings."
        : response.status === 429
          ? "Intervals.icu is busy. Wait a moment and retry the same file."
          : "Intervals.icu could not process this file. Check the format and retry the same file.",
      response.status >= 400 && response.status < 500 ? response.status : 502
    );
  return response;
}

/** Intervals deduplicates activity uploads by file hash, including lost replies. */
export async function uploadWorkoutRecording(
  config,
  input,
  { fetchImpl = globalThis.fetch, request = createIntervalsClient(config, fetchImpl) } = {}
) {
  const file = validateRecording(input);
  const params = new globalThis.URLSearchParams({ external_id: `training-agent:${file.digest}` });
  let plannedId;
  if (input.workoutId) {
    plannedId = eventId(input.workoutId);
    const plan = await request(`/athlete/0/events/${plannedId}`);
    if (String(plan?.id) !== plannedId || plan.category !== "WORKOUT")
      fail("The planned workout could not be found.", 404);
    if (plan.paired_activity_id) {
      const prior = await request(`/activity/${plan.paired_activity_id}`);
      if (
        prior?.external_id === `training-agent:${file.digest}` &&
        String(prior.paired_event_id) === plannedId
      )
        return {
          verified: true,
          activityIds: [String(prior.id)],
          pairedWorkoutId: `event:${plannedId}`,
        };
      fail("This workout already has a recording. Upload to a new workout instead.", 409);
    }
    params.set("paired_event_id", plannedId);
  }
  const form = new globalThis.FormData();
  form.set(
    "file",
    new globalThis.Blob([file.bytes], { type: "application/octet-stream" }),
    file.name
  );
  const response = await providerFileRequest(
    config,
    `/athlete/0/activities?${params}`,
    { method: "POST", body: form },
    fetchImpl
  );
  const receipt = await response.json();
  const ids = [
    ...new Set(
      (receipt.activities || [])
        .map((value) => (typeof value === "string" ? value : value?.id))
        .concat(receipt.id || [])
        .filter(Boolean)
    ),
  ];
  if (!ids.length || ids.some((id) => !/^i?[1-9]\d*$/.test(String(id))))
    fail(
      "The upload was received but could not be verified. Retry the same file; duplicate files are detected automatically.",
      502
    );
  const activities = await Promise.all(ids.map((id) => request(`/activity/${id}`)));
  if (
    activities.some(
      (activity, index) =>
        String(activity?.id) !== String(ids[index]) ||
        !activity.start_date_local ||
        (receipt.icu_athlete_id &&
          String(activity.icu_athlete_id) !== String(receipt.icu_athlete_id))
    )
  )
    fail("The uploaded activity could not be verified. Retry the same file.", 502);
  if (plannedId && !activities.some((activity) => String(activity.paired_event_id) === plannedId))
    fail(
      "The recording was uploaded, but its workout link could not be verified. Refresh the calendar before retrying.",
      502
    );
  return {
    verified: true,
    activityIds: ids.map(String),
    pairedWorkoutId: plannedId ? `event:${plannedId}` : null,
  };
}

export async function exportWorkoutFile(config, input = {}, { fetchImpl = globalThis.fetch } = {}) {
  const format = String(input.format || "fit").toLowerCase();
  if (!["fit", "zwo", "mrc", "erg", "txt"].includes(format))
    fail("Choose a supported workout format.");
  const request = createIntervalsClient(config, fetchImpl);
  let description, model, name;
  if (input.model) {
    const errors = validateWorkout(input.model);
    if (errors.length) fail(errors.join(". "));
    if (!input.model.steps.length && format !== "txt")
      fail("Add device steps before exporting this workout format.");
    name = input.model.name;
    model = globalThis.structuredClone(input.model);
    description = serializeWorkout(model);
    if (format === "txt" && expandSteps(model.steps).some(({ step }) => step.target.kind === "rpe"))
      description = [name, providerWorkoutDescription(description)].join("\n\n");
    if (model.strength && format === "txt")
      description = [name, providerWorkoutDescription(description)].join("\n\n");
    if (model.unstructured && format === "txt")
      description = [name, model.notes].filter(Boolean).join("\n\n");
  } else {
    const id = eventId(input.workoutId);
    const event = await request(`/athlete/0/events/${id}`);
    if (String(event?.id) !== id || event.category !== "WORKOUT")
      fail("The workout could not be found.", 404);
    name = event.name;
    description = event.description || "";
    if (format === "txt") {
      const imported = importWorkout(event);
      if (imported.model.strength && !imported.issues.length)
        description = [name, providerWorkoutDescription(description)].join("\n\n");
      if (
        !imported.issues.length &&
        expandSteps(imported.model.steps).some(({ step }) => step.target.kind === "rpe")
      )
        description = [name, providerWorkoutDescription(description)].join("\n\n");
      if (imported.model.unstructured && !imported.issues.length)
        description = [name, readManualWorkoutDescription(event, imported.model)]
          .filter(Boolean)
          .join("\n\n");
    }
    if (format !== "txt") {
      const imported = importWorkout(event);
      if (imported.issues.length)
        fail(
          `This workout cannot be exported safely: ${imported.issues.join(". ")} Use Text to download its original prescription.`
        );
      model = imported.model;
    }
  }
  let lthr;
  if (model && format !== "txt") {
    if (!model.steps.length) fail("Add device steps before exporting this workout format.");
    const targets = expandSteps(model.steps).map(({ step }) => step.target);
    const needsPace =
      format === "fit" &&
      targets.some((target) => target.unit === "%pace") &&
      !(model.thresholds?.pace > 0);
    const needsFtp =
      !(model.thresholds?.ftp > 0) &&
      ((["zwo", "mrc"].includes(format) && targets.some((target) => target.unit === "w")) ||
        (format === "erg" && targets.some((target) => target.unit === "%ftp")));
    const needsHr = format === "fit" && targets.some((target) => target.unit === "%lthr");
    if (needsPace || needsFtp || needsHr) {
      try {
        const athlete = await request("/athlete/0");
        const setting = sportZoneSettings(
          athlete.sportSettings || athlete.sport_settings || [],
          model.sport
        );
        model.thresholds = {
          ...model.thresholds,
          ftp: model.thresholds?.ftp || setting?.ftp || null,
          pace: model.thresholds?.pace || setting?.threshold_pace || null,
        };
        lthr = setting?.lthr;
      } catch {
        // Encoders return an explicit missing-threshold error. Never substitute
        // a guessed FTP, pace, heart rate or midpoint when account reads fail.
      }
    }
  }
  const bytes =
    format === "txt"
      ? Buffer.from(description, "utf8")
      : format === "fit"
        ? encodeWorkoutFit(model, { lthr })
        : encodeWorkoutTextFormat(model, format);
  if (!bytes.length || bytes.length > 4 * 1024 * 1024)
    fail("The exported workout is empty or too large.", 502);
  return {
    name: `${safeName(name)}.${format}`,
    data: bytes.toString("base64"),
    type: format === "fit" ? "application/octet-stream" : "text/plain;charset=utf-8",
  };
}
