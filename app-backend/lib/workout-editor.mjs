import { createHash } from "node:crypto";
import { eventId, validDate } from "./intervals.mjs";
import { sportZoneSettings } from "./workout-editor-zones.mjs";
import {
  importWorkout,
  serializeWorkout,
  validateWorkout,
  verifyParsedWorkout,
} from "./workout-editor-model.mjs";

function fail(message, status = 400, code = "INVALID_WORKOUT") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}
export function workoutRevision(event) {
  const fields = [
    "id",
    "updated",
    "name",
    "description",
    "type",
    "category",
    "start_date_local",
    "end_date_local",
    "calendar_id",
    "uid",
    "external_id",
    "paired_activity_id",
    "workout_doc",
    "read_only",
    "readonly",
    "editable",
    "color",
    "tags",
    "description_locale",
    "hide_from_athlete",
    "custom_metadata",
    "indoor",
    "commute",
  ];
  const stable = (value) =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, stable(value[k])])
          )
        : value;
  return createHash("sha256")
    .update(JSON.stringify(stable(Object.fromEntries(fields.map((k) => [k, event[k] ?? null])))))
    .digest("hex");
}
function assertEditable(event) {
  if (event.category !== "WORKOUT")
    fail("Only planned WORKOUT calendar events can be edited here.", 403, "READ_ONLY");
  if (event.read_only || event.readonly || event.editable === false)
    fail(
      "This Intervals.icu calendar is read-only. Edit the workout in its source calendar.",
      403,
      "READ_ONLY"
    );
}
async function loadZoneSettings(request) {
  let zoneSettings = [],
    zoneError = "";
  try {
    const athlete = await request("/athlete/0");
    zoneSettings = (athlete.sportSettings || athlete.sport_settings || []).map((s) =>
      Object.fromEntries(
        [
          "types",
          "type",
          "ftp",
          "threshold_pace",
          "power_zones",
          "pace_zones",
          "power_zone_names",
          "pace_zone_names",
        ]
          .filter((key) => s[key] != null)
          .map((key) => [key, s[key]])
      )
    );
  } catch {
    zoneError = "Training zones could not be loaded. Reopen the editor to retry.";
  }
  return { zoneSettings, zoneError };
}
export async function loadNewWorkoutEditor(request, date) {
  validDate(date);
  const zones = await loadZoneSettings(request);
  const setting = sportZoneSettings(zones.zoneSettings, "Ride");
  return {
    ...zones,
    model: {
      version: 1,
      name: "New workout",
      sport: "Ride",
      date,
      notes: "",
      poolLength: "",
      steps: [],
      thresholds: { ftp: setting?.ftp || null, pace: setting?.threshold_pace || null },
    },
    revision: "new",
    scheduledTime: "00:00:00",
    issues: [],
    warnings: [],
    originalDescription: "",
    reviewRequired: false,
    ambiguousSwim: false,
    isNew: true,
  };
}

export async function loadWorkoutEditor(request, id) {
  const event = await request(`/athlete/0/events/${eventId(id)}`);
  assertEditable(event);
  const { zoneSettings, zoneError } = await loadZoneSettings(request);
  const imported = importWorkout(event);
  const setting = sportZoneSettings(zoneSettings, imported.model.sport);
  imported.model.thresholds = {
    ftp: imported.model.thresholds?.ftp || setting?.ftp || null,
    pace: imported.model.thresholds?.pace || setting?.threshold_pace || null,
  };
  return {
    ...imported,
    zoneSettings,
    zoneError,
    revision: workoutRevision(event),
    scheduledTime: String(event.start_date_local).slice(11),
    id,
  };
}
function expectedPatch(existing, model) {
  validDate(model.date);
  const patch = {
    name: model.name.trim(),
    type: model.sport,
    description: serializeWorkout(model),
  };
  const old = String(existing.start_date_local).slice(0, 10);
  if (model.date !== old) {
    patch.start_date_local = model.date + String(existing.start_date_local).slice(10);
    if (existing.end_date_local) {
      const delta = Date.parse(`${model.date}T00:00:00Z`) - Date.parse(`${old}T00:00:00Z`);
      patch.end_date_local =
        new Date(Date.parse(`${String(existing.end_date_local).slice(0, 10)}T00:00:00Z`) + delta)
          .toISOString()
          .slice(0, 10) + String(existing.end_date_local).slice(10);
    }
  }
  return patch;
}
function assertVerified(model, event, existing, patch) {
  const errors = verifyParsedWorkout(model, event);
  for (const key of ["name", "type", "description"])
    if (event[key] !== patch[key]) errors.push(`The saved ${key} differs`);
  for (const key of [
    "id",
    "uid",
    "external_id",
    "calendar_id",
    "category",
    "paired_activity_id",
    "color",
    "start_date_local",
    "end_date_local",
    "tags",
    "description_locale",
    "hide_from_athlete",
    "custom_metadata",
    "indoor",
    "commute",
  ]) {
    if (JSON.stringify(event[key] ?? null) !== JSON.stringify(patch[key] ?? existing[key] ?? null))
      errors.push(`Event metadata ${key} changed unexpectedly`);
  }
  if (errors.length)
    fail(
      `The event may have been saved, but verification failed: ${errors.slice(0, 6).join("; ")}. Your draft is retained. Retry checks the existing event before writing.`,
      502,
      "VERIFICATION_FAILED"
    );
}
// Serialize mutations in this process. The provider exposes no documented
// conditional PUT/ETag, so cross-process writes still have a narrow race window.
const saves = new Map();
export async function saveWorkoutEditor(request, id, input, scope = "default") {
  const key = `${scope}:${eventId(id)}`,
    previous = saves.get(key) || Promise.resolve();
  const job = previous.catch(() => {}).then(() => save(request, id, input));
  saves.set(key, job);
  try {
    return await job;
  } finally {
    if (saves.get(key) === job) saves.delete(key);
  }
}
async function save(request, id, { model, revision } = {}) {
  const validation = validateWorkout(model);
  if (validation.length) fail(validation.join(". "));
  if (!revision || typeof revision !== "string") fail("Reload the event before saving");
  const path = `/athlete/0/events/${eventId(id)}`,
    existing = await request(path);
  assertEditable(existing);
  const patch = expectedPatch(existing, model);
  const matches =
    existing.name === patch.name &&
    existing.type === patch.type &&
    existing.description === patch.description &&
    String(existing.start_date_local).slice(0, 10) === model.date;
  // An uncertain previous PUT may already have succeeded. Verify that event
  // and return it; never create an event or blindly repeat the write.
  if (!matches) {
    if (workoutRevision(existing) !== revision)
      fail(
        "This workout changed in Intervals.icu after you opened it. Your draft is safe. Reload the remote version and review the differences before saving.",
        409,
        "CONFLICT"
      );
    const imported = importWorkout(existing);
    if (imported.issues.length) fail(imported.issues.join(". "));
    try {
      await request(path, { method: "PUT", body: JSON.stringify(patch) });
    } catch (error) {
      if ([401, 403].includes(error.status))
        fail(
          "Intervals.icu denied permission to update this event. Check the connected account and calendar write permissions.",
          403,
          "PERMISSION_DENIED"
        );
      // Resolve uncertain transport outcomes using a fresh read, never a POST.
      try {
        const readback = await request(path);
        assertVerified(model, readback, existing, patch);
        return {
          workoutId: id,
          event: readback,
          revision: workoutRevision(readback),
          verified: true,
        };
      } catch {
        fail(
          "Save could not be confirmed with Intervals.icu. Your draft is retained. Retry will check the existing event first.",
          502,
          "SAVE_UNCONFIRMED"
        );
      }
    }
  }
  const verified = await request(path);
  assertVerified(model, verified, existing, patch);
  return { workoutId: id, event: verified, revision: workoutRevision(verified), verified: true };
}

// A stable operation ID is attached to the event. An uncertain create can only
// reconcile on retry, so a delayed provider response cannot duplicate a workout.
export async function createWorkoutEditor(request, input = {}, scope = "default") {
  const { model, creationId } = input;
  const errors = validateWorkout(model);
  if (errors.length) fail(errors.join(". "));
  if (!/^[0-9a-f-]{36}$/i.test(creationId || "")) fail("A creation ID is required");
  const key = scope + ":create:" + creationId;
  const previous = saves.get(key) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(async () => {
      const externalId = "training-agent:editor:" + creationId;
      const body = {
        category: "WORKOUT",
        type: model.sport,
        name: model.name.trim(),
        start_date_local: model.date + "T00:00:00",
        description: serializeWorkout(model),
        external_id: externalId,
      };
      const find = async () => {
        const events = await request(
          "/athlete/0/events?oldest=" + model.date + "&newest=" + model.date
        );
        return (events || []).find((event) => event.external_id === externalId);
      };
      const verify = async (event) => {
        const saved = await request("/athlete/0/events/" + eventId("event:" + event.id));
        const errors = verifyParsedWorkout(model, saved);
        for (const key of Object.keys(body))
          if (saved[key] !== body[key]) errors.push("Saved " + key + " differs");
        if (errors.length)
          fail(
            "Creation could not be verified. Recheck this same draft before making changes.",
            502,
            "CREATE_UNCONFIRMED"
          );
        return {
          workoutId: "event:" + saved.id,
          event: saved,
          revision: workoutRevision(saved),
          verified: true,
        };
      };
      const existing = await find();
      if (existing) return verify(existing);
      if (input.reconcileOnly)
        fail(
          "Creation is not confirmed yet. Recheck this draft or refresh the calendar before starting another workout.",
          502,
          "CREATE_UNCONFIRMED"
        );
      let created;
      try {
        created = await request("/athlete/0/events", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } catch (error) {
        if ([400, 401, 403, 422].includes(error.status))
          fail(
            "Intervals.icu rejected creation. Check the workout and calendar permissions.",
            error.status,
            "CREATE_REJECTED"
          );
        try {
          const saved = await find();
          if (saved) return await verify(saved);
        } catch {
          /* Keep the uncertain draft. */
        }
        fail(
          "Creation could not be confirmed. Recheck uses the same draft and will not create another event.",
          502,
          "CREATE_UNCONFIRMED"
        );
      }
      if (!created?.id)
        fail(
          "Creation could not be confirmed. Recheck this same draft.",
          502,
          "CREATE_UNCONFIRMED"
        );
      return verify(created);
    });
  saves.set(key, job);
  try {
    return await job;
  } finally {
    if (saves.get(key) === job) saves.delete(key);
  }
}
