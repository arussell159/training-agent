import { workoutRevisionInput } from "./workout-revision-input.mjs";
import { createHash } from "node:crypto";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import {
  readPlannedValues,
  withPlannedValues,
  validatePlannedValues,
} from "./planned-workout-values.mjs";
import { readWorkoutCommentText, withWorkoutCommentText } from "./workout-comment-text.mjs";
import { appendWorkoutComment } from "./workout-comments.mjs";
import { eventId, validDate } from "./intervals.mjs";
import { sportZoneSettings } from "./workout-editor-zones.mjs";
import {
  hasManualWorkoutDescription,
  readManualWorkoutDescription,
  serializeManualWorkout,
} from "./workout-manual-description.mjs";
import {
  importWorkout,
  DEFINITION_MARKER,
  readableDescription,
  serializeWorkout,
  validateWorkout,
  verifyParsedWorkout,
  workoutSports,
  workoutProviderWarnings,
  workoutDefinitionSuffix,
} from "./workout-editor-model.mjs";

function fail(message, status = 400, code = "INVALID_WORKOUT") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}
export function workoutRevision(event) {
  return createHash("sha256").update(workoutRevisionInput(event)).digest("hex");
}
export function assertEditable(event) {
  if (event.category !== "WORKOUT")
    fail("Only planned WORKOUT calendar events can be edited here.", 403, "READ_ONLY");
  if (event.read_only || event.readonly || event.editable === false || event.athlete_cannot_edit)
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
export async function loadNewWorkoutEditor(
  request,
  date,
  { sport = "Ride", name = "New workout" } = {}
) {
  validDate(date);
  if (!workoutSports.includes(sport)) fail("Choose a supported workout sport.");
  if (typeof name !== "string" || !name.trim() || name.length > 200)
    fail("Enter a workout name under 200 characters.");
  const zones = await loadZoneSettings(request);
  const setting = sportZoneSettings(zones.zoneSettings, sport);
  return {
    ...zones,
    model: {
      version: 1,
      name: name.trim(),
      sport,
      date,
      notes: "",
      poolLength: sport === "Swim" ? "25y" : "",
      ...(sport === "Swim" ? { swimUnitMode: "explicit" } : {}),
      steps: [],
      thresholds: { ftp: setting?.ftp || null, pace: setting?.threshold_pace || null },
    },
    revision: "new",
    scheduledTime: "00:00:00",
    issues: [],
    warnings: [],
    originalDescription: "",
    manualDescription: "",
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
  if (!imported.issues.length) imported.warnings.push(...workoutProviderWarnings(imported.model));
  const setting = sportZoneSettings(zoneSettings, imported.model.sport);
  imported.model.thresholds = {
    ftp: imported.model.thresholds?.ftp || setting?.ftp || null,
    pace: imported.model.thresholds?.pace || setting?.threshold_pace || null,
  };
  return {
    ...imported,
    descriptionOverride: editorDescriptionOverride(event, imported.model),
    manualDescription: readManualWorkoutDescription(event),
    zoneSettings,
    zoneError,
    revision: workoutRevision(event),
    scheduledTime: String(event.start_date_local).slice(11),
    plannedValues: readPlannedValues(event.description),
    comments: readWorkoutCommentText(event.description, id, true),
    event,
    id,
  };
}
export function editorDescriptionOverride(event, originalModel) {
  if (hasManualWorkoutDescription(event.description)) return readManualWorkoutDescription(event);
  if (!String(event.description || "").includes(DEFINITION_MARKER)) return undefined;
  const head = readableDescription(event.description);
  return head === readableDescription(serializeWorkout(originalModel)) ? undefined : head;
}
export function expectedPatch(existing, model, input = {}) {
  validDate(model.date);
  const values = {
    ...readPlannedValues(existing.description),
    ...validatePlannedValues(input.values || {}),
  };
  if (input.comment != null && typeof input.comment !== "string") fail("Enter a valid comment.");
  let comments = readWorkoutCommentText(existing.description, `event:${existing.id}`, true);
  if (input.comment?.trim())
    comments = appendWorkoutComment(comments, {
      workoutId: `event:${existing.id}`,
      body: input.comment,
      type: "pre",
      creationId: input.commentId,
    }).comments;
  const manual =
    model.unstructured === true ||
    input.descriptionMode === "manual" ||
    hasManualWorkoutDescription(existing.description);
  let description = manual
    ? serializeManualWorkout(model, input.description ?? readManualWorkoutDescription(existing))
    : serializeWorkout(model);
  const override =
    input.description ?? editorDescriptionOverride(existing, importWorkout(existing).model);
  if (!manual && override != null) {
    if (typeof override !== "string" || override.length > 30000)
      fail("Enter a description under 30,000 characters.");
    description = override + workoutDefinitionSuffix(description);
  }
  const patch = {
    name: model.name.trim(),
    type: model.sport,
    description: withWorkoutCommentText(withPlannedValues(description, values), comments),
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
  if (input.time != null) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) fail("Enter a valid start time.");
    patch.start_date_local = `${model.date}T${input.time}:00`;
    if (existing.end_date_local) {
      const duration =
        Date.parse(`${existing.end_date_local}Z`) - Date.parse(`${existing.start_date_local}Z`);
      if (Number.isFinite(duration) && duration >= 0)
        patch.end_date_local = new Date(Date.parse(`${patch.start_date_local}Z`) + duration)
          .toISOString()
          .slice(0, 19);
    }
  }
  for (const [key, field] of [
    ["duration_seconds", "time_target"],
    ["distance_meters", "distance_target"],
    ["tss", "load_target"],
  ])
    if (key in (input.values || {})) patch[field] = values[key];
  // ICU derives icu_intensity from its own rounded load/duration. Exact manual
  // IF belongs to the verified private planned-values document, not this native field.
  if ("work_kj" in (input.values || {}))
    patch.joules = values.work_kj == null ? null : Math.round(values.work_kj * 1000);
  if (providerWorkoutDescription(patch.description).length > 30000)
    fail("Workout text exceeds the 30,000 character export limit.");
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
  for (const key of ["time_target", "distance_target", "load_target", "icu_intensity", "joules"])
    if (key in patch && event[key] !== patch[key]) errors.push(`Saved ${key} differs`);
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
async function save(request, id, input = {}) {
  const { model, revision } = input;
  const validation = validateWorkout(model);
  if (validation.length) fail(validation.join(". "));
  if (!revision || typeof revision !== "string") fail("Reload the event before saving");
  const path = `/athlete/0/events/${eventId(id)}`,
    existing = await request(path);
  assertEditable(existing);
  const patch = expectedPatch(existing, model, input);
  const matches = Object.entries(patch).every(
    ([key, value]) => JSON.stringify(existing[key] ?? null) === JSON.stringify(value ?? null)
  );
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
      if (error.status === 429) {
        error.code = "PROVIDER_REJECTED";
        throw error;
      }
      if ([400, 404, 409, 422].includes(error.status))
        fail(
          error.status === 404
            ? "This workout no longer exists in Intervals.icu. Your draft is retained."
            : error.status === 409
              ? "Intervals.icu reported a conflicting workout update. Reload the workout before retrying. Your draft is retained."
              : error.status === 429
                ? "Intervals.icu temporarily limited workout updates. Wait a moment and retry. Your draft is retained."
                : `Intervals.icu rejected the workout update (${error.status}). Check the workout fields before retrying. Your draft is retained.`,
          error.status,
          "PROVIDER_REJECTED"
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
          warnings: workoutProviderWarnings(model),
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
  return {
    workoutId: id,
    event: verified,
    revision: workoutRevision(verified),
    verified: true,
    warnings: workoutProviderWarnings(model),
  };
}

// A stable operation ID is attached to the event. An uncertain create can only
// reconcile on retry, so a delayed provider response cannot duplicate a workout.
export async function createWorkoutEditor(request, input = {}, scope = "default") {
  const { model, creationId } = input;
  const errors = validateWorkout(model);
  if (errors.length) fail(errors.join(". "));
  if (!/^[0-9a-f-]{36}$/i.test(creationId || "")) fail("A creation ID is required");
  const values = validatePlannedValues(input.values || {});
  if (input.comment != null && typeof input.comment !== "string") fail("Enter a valid comment.");
  const time = input.time || "00:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail("Enter a valid start time.");
  const key = scope + ":create:" + creationId;
  const previous = saves.get(key) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(async () => {
      const externalId = "training-agent:editor:" + creationId;
      const find = async () => {
        const events = await request(
          "/athlete/0/events?oldest=" + model.date + "&newest=" + model.date
        );
        return (events || []).find((event) => event.external_id === externalId);
      };
      const existing = await find();
      const savedComments = readWorkoutCommentText(
        existing?.description,
        `event:${existing?.id || 1}`,
        true
      );
      const previousComment = savedComments.find(
        (comment) => comment.id === `comment-${creationId}`
      );
      const comments = input.comment?.trim()
        ? appendWorkoutComment(
            [],
            {
              workoutId: "event:1",
              body: input.comment,
              type: "pre",
              creationId,
            },
            previousComment ? new Date(previousComment.created_at) : new Date()
          ).comments
        : [];
      const body = {
        category: "WORKOUT",
        type: model.sport,
        name: model.name.trim(),
        start_date_local: `${model.date}T${time}:00`,
        description: withWorkoutCommentText(
          withPlannedValues(
            input.descriptionMode === "manual" || model.unstructured === true
              ? serializeManualWorkout(
                  model,
                  input.description ?? (model.unstructured === true ? model.notes : "")
                )
              : input.description != null
                ? typeof input.description !== "string" || input.description.length > 30000
                  ? fail("Enter a description under 30,000 characters.")
                  : input.description + workoutDefinitionSuffix(serializeWorkout(model))
                : serializeWorkout(model),
            values
          ),
          comments
        ),
        external_id: externalId,
      };
      for (const [key, field] of [
        ["duration_seconds", "time_target"],
        ["distance_meters", "distance_target"],
        ["tss", "load_target"],
      ])
        if (key in values) body[field] = values[key];
      // Exact manual IF is retained in private planned values above. ICU owns
      // its derived icu_intensity; assigning it cannot establish an exact IF.
      if ("work_kj" in values)
        body.joules = values.work_kj == null ? null : Math.round(values.work_kj * 1000);
      if (providerWorkoutDescription(body.description).length > 30000)
        fail("Workout text exceeds the 30,000 character export limit");
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
          warnings: workoutProviderWarnings(model),
        };
      };
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
        if (error.status === 429) {
          error.code = "CREATE_REJECTED";
          throw error;
        }
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
