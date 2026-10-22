import { workoutRevision } from "./workout-editor.mjs";
import { validDate } from "./intervals.mjs";
import { workoutSports } from "./workout-editor-model.mjs";
import {
  readWorkoutCommentText,
  withWorkoutCommentText,
  stripWorkoutCommentText,
} from "./workout-comment-text.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import { loadNativeActivityComments } from "./native-workout-comments.mjs";

const fail = (message, status = 400, code = "INVALID_ACTIVITY") => {
  throw Object.assign(Error(message), { status, code });
};
export function completedActivityPath(id) {
  if (!/^activity:i?[1-9]\d*$/.test(id || "")) fail("Choose a completed activity.");
  return `/activity/${id.slice(9)}`;
}
// Only native authored summary fields are writable. Recorded streams, laps,
// normalized power and other calculated statistics never enter this patch.
const fields = {
  duration_seconds: "moving_time",
  distance_meters: "icu_distance",
  tss: "icu_training_load",
  calories: "calories",
  elevation_gain: "total_elevation_gain",
  rpe: "icu_rpe",
  feel: "feel",
};
export function validateCompletedValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    fail("Enter completed workout values.");
  for (const [key, value] of Object.entries(values)) {
    if (value === null && ["duration_seconds", "distance_meters"].includes(key))
      fail("Completed duration and distance cannot be blank. Enter a value or zero.");
    if (
      !(key in fields) ||
      (value !== null &&
        (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e8))
    )
      fail(`This completed value cannot be edited: ${key}`);
    if (
      value !== null &&
      key === "duration_seconds" &&
      (!Number.isInteger(value) || value > 604800)
    )
      fail("Duration must be whole seconds, up to seven days.");
    if (value !== null && key === "tss" && !Number.isInteger(value))
      fail("TSS must be a whole number.");
    if (value !== null && ["calories", "rpe", "feel"].includes(key) && !Number.isInteger(value))
      fail(`${key} must be a whole number.`);
    if (value !== null && key === "rpe" && value > 10) fail("RPE must be between 0 and 10.");
    if (value !== null && key === "feel" && value > 5) fail("Feel must be between 0 and 5.");
  }
  return values;
}
export function completedValues(activity) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [
      key,
      (key === "distance_meters"
        ? (activity.icu_distance ?? activity.distance)
        : activity[field]) ?? null,
    ])
  );
}
export function assertActivityEditable(activity) {
  if (!activity || !/^i?[1-9]\d*$/.test(String(activity.id || "")))
    fail("Activity not found.", 404);
  if (
    activity.read_only ||
    activity.readonly ||
    activity.editable === false ||
    activity.athlete_cannot_edit
  )
    fail("This Intervals.icu activity is read-only.", 403, "READ_ONLY");
  if (
    /strava/i.test(String(activity.source || activity.icu_source || "")) ||
    !activity.start_date_local ||
    !activity.type
  )
    fail(
      "This recording is unavailable or managed by Strava and cannot be edited through Intervals.icu.",
      403,
      "READ_ONLY"
    );
}
export function completedActivityPatch(existing, input = {}) {
  assertActivityEditable(existing);
  const patch = {};
  if (input.model?.sport != null) {
    if (!workoutSports.includes(input.model.sport)) fail("Choose a supported workout sport.");
    if (input.model.sport !== "Other" || workoutSports.includes(existing.type))
      patch.type = input.model.sport;
  }
  if (input.model?.date != null || input.time != null) {
    const date = validDate(input.model?.date ?? String(existing.start_date_local).slice(0, 10));
    let time = String(existing.start_date_local).slice(11) || "00:00:00";
    if (input.time != null) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) fail("Enter a valid start time.");
      time = `${input.time}:00`;
    }
    patch.start_date_local = `${date}T${time}`;
  }
  const name = input.model?.name ?? input.name;
  if (name != null) {
    if (typeof name !== "string" || !name.trim() || name.length > 200)
      fail("Enter a workout name under 200 characters.");
    patch.name = name.trim();
  }
  if (input.description != null) {
    if (typeof input.description !== "string" || input.description.length > 30000)
      fail("Enter a description under 30,000 characters.");
    // Legacy comments remain readable after a description edit. They are not
    // reposted as native messages merely because the activity was opened.
    patch.description = withWorkoutCommentText(
      input.description,
      readWorkoutCommentText(existing.description, `activity:${existing.id}`, true)
    );
    if (providerWorkoutDescription(patch.description).length > 30000)
      fail("Workout text exceeds the provider limit.");
  }
  if (input.completedValues != null)
    for (const [key, value] of Object.entries(validateCompletedValues(input.completedValues)))
      patch[fields[key]] = value;
  if (Object.hasOwn(patch, "moving_time") && patch.moving_time !== existing.moving_time)
    fail(
      "Existing activity duration is managed by Intervals.icu and cannot be changed through this integration. Its original duration and recorded data are retained.",
      400,
      "ACTIVITY_DURATION_READ_ONLY"
    );
  if (Object.hasOwn(patch, "moving_time") && patch.moving_time === null)
    fail("Completed duration cannot be blank. Enter a duration or zero.");
  return patch;
}
const samePatch = (activity, patch) =>
  Object.entries(patch).every(([key, value]) => {
    if (
      ["distance", "icu_distance", "total_elevation_gain"].includes(key) &&
      typeof value === "number" &&
      typeof (key === "icu_distance"
        ? (activity.icu_distance ?? activity.distance)
        : activity[key]) === "number"
    )
      return (
        Math.abs(
          (key === "icu_distance" ? (activity.icu_distance ?? activity.distance) : activity[key]) -
            value
        ) <= Math.max(1e-4, Math.abs(value) * 1e-7)
      );
    return JSON.stringify(activity[key] ?? null) === JSON.stringify(value ?? null);
  });
export async function loadCompletedWorkoutEditor(request, id) {
  const activity = await request(completedActivityPath(id));
  assertActivityEditable(activity);
  const legacy = readWorkoutCommentText(activity.description, id, true);
  const comments = [...(await loadNativeActivityComments(request, id)), ...legacy];
  const description = stripWorkoutCommentText(activity.description);
  const model = completedWorkoutModel(activity);
  return {
    id,
    model,
    event: activity,
    activity,
    revision: workoutRevision(activity),
    completedValues: completedValues(activity),
    completedEditableFields: Object.keys(fields).filter((key) => key !== "duration_seconds"),
    completedReadOnlyReasons: {
      duration_seconds:
        "Existing activity duration is managed by Intervals.icu. You can enter duration when creating a manual completion.",
    },
    originalDescription: description,
    manualDescription: description,
    descriptionOverride: description,
    scheduledTime: String(activity.start_date_local).slice(11, 16),
    comments,
    zoneSettings: [],
    zoneError: "",
    issues: [],
    warnings: [],
    reviewRequired: false,
    ambiguousSwim: false,
    isCompleted: true,
  };
}
export function completedWorkoutModel(activity) {
  return {
    version: 1,
    unstructured: true,
    name: activity.name || "Completed workout",
    sport: workoutSports.includes(activity.type) ? activity.type : "Other",
    date: validDate(String(activity.start_date_local).slice(0, 10)),
    notes: stripWorkoutCommentText(activity.description).slice(0, 12000),
    poolLength: "",
    steps: [],
    thresholds: {},
  };
}
export async function saveCompletedWorkout(request, id, input) {
  const path = completedActivityPath(id),
    before = await request(path);
  const patch = completedActivityPatch(before, input);
  if (!samePatch(before, patch)) {
    if (input.revision !== workoutRevision(before))
      fail(
        "This activity changed outside the app. Reopen it to review the new version; your draft is retained.",
        409,
        "CONFLICT"
      );
    let transportError;
    try {
      await request(path, { method: "PUT", body: JSON.stringify(patch) });
    } catch (error) {
      if (error.status >= 400 && error.status < 500) throw error;
      transportError = error;
    }
    const after = await request(path);
    if (!samePatch(after, patch)) {
      if (transportError) throw transportError;
      fail(
        `Intervals.icu has not confirmed these activity fields: ${Object.keys(patch)
          .filter((key) => !samePatch(after, { [key]: patch[key] }))
          .join(", ")}. Your draft is retained.`,
        502,
        "VERIFICATION_FAILED"
      );
    }
    for (const field of [
      "workout_doc",
      "intervals",
      "laps",
      "streams",
      "file_type",
      "paired_event_id",
      "external_id",
    ])
      if (JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null))
        fail(
          "Recorded activity data changed during verification. Reload before editing again.",
          409,
          "CONFLICT"
        );
    return { workoutId: id, event: after, revision: workoutRevision(after), verified: true };
  }
  return { workoutId: id, event: before, revision: workoutRevision(before), verified: true };
}
export async function completePlannedWorkout(request, eventId, event, input) {
  const values = validateCompletedValues(input.completedValues || {});
  if (!(values.duration_seconds > 0))
    fail("Enter a completed duration before completing the workout.");
  if (!/^event:[1-9]\d*$/.test(eventId)) fail("Save the planned workout before completing it.");
  const completionExternalId = `training-agent:completion:${eventId.slice(6)}`;
  if (!event.paired_activity_id) {
    const date = String(event.start_date_local).slice(0, 10);
    // Event has no reverse activity link in the official API. Request only the
    // three ownership/link fields for this one day: no descriptions, streams,
    // full-history refresh or encrypted metadata reads are needed.
    const candidates = await request(
      `/athlete/0/activities?oldest=${date}&newest=${date}T23:59:59&fields=id,paired_event_id,external_id`
    );
    const matches = (Array.isArray(candidates) ? candidates : []).filter(
      (activity) =>
        String(activity.paired_event_id) === eventId.slice(6) ||
        activity.external_id === completionExternalId
    );
    if (matches.length > 1)
      fail(
        "This plan has multiple recording matches. Review its activities before completing it.",
        409,
        "CONFLICT"
      );
    if (matches[0]) event = { ...event, paired_activity_id: matches[0].id };
  }
  if (event.paired_activity_id) {
    const id = `activity:${event.paired_activity_id}`;
    const activity = await request(completedActivityPath(id));
    if (
      activity.external_id !== completionExternalId ||
      !samePatch(activity, completedActivityPatch(activity, input))
    )
      fail(
        "This plan already has a recorded activity. Reopen its completed values before editing; a second activity will not be created.",
        409,
        "CONFLICT"
      );
    return {
      workoutId: eventId,
      event,
      activity,
      activityId: id,
      revision: workoutRevision(await request(`/athlete/0/events/${eventId.slice(6)}`)),
      verified: true,
    };
  }
  const activity = {
    name: event.name || input.model?.name || "Completed workout",
    type: event.type || input.model?.sport || "Other",
    start_date_local: event.start_date_local,
    description: input.description ?? providerWorkoutDescription(event.description),
    external_id: completionExternalId,
    paired_event_id: Number(eventId.slice(6)),
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [fields[key], value])),
  };
  const created = await request("/athlete/0/activities/manual/bulk", {
    method: "POST",
    body: JSON.stringify([activity]),
  });
  const value = Array.isArray(created) ? created[0] : null;
  if (!value?.id)
    fail("Manual completion has not returned an activity identity.", 502, "COMPLETION_UNCONFIRMED");
  let verified = await request(completedActivityPath(`activity:${value.id}`));
  if (String(verified.paired_event_id) !== eventId.slice(6)) {
    if (verified.paired_event_id != null)
      fail(
        "The manual activity is linked to a different plan. Review it before retrying.",
        409,
        "CONFLICT"
      );
    await request(completedActivityPath(`activity:${value.id}`), {
      method: "PUT",
      body: JSON.stringify({ paired_event_id: Number(eventId.slice(6)) }),
    });
    verified = await request(completedActivityPath(`activity:${value.id}`));
  }
  if (!samePatch(verified, activity))
    fail(
      `Intervals.icu has not confirmed these completed fields: ${Object.keys(activity)
        .filter((key) => !samePatch(verified, { [key]: activity[key] }))
        .join(", ")}.`,
      502,
      "COMPLETION_UNCONFIRMED"
    );
  const paired = await request(`/athlete/0/events/${eventId.slice(6)}`);
  return {
    workoutId: eventId,
    event: { ...paired, paired_activity_id: verified.id },
    activity: verified,
    activityId: `activity:${verified.id}`,
    revision: workoutRevision(paired),
    verified: true,
  };
}
