import { eventId, validDate } from "./intervals.mjs";
import { workoutRevision } from "./workout-editor.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import {
  readPlannedValues,
  validatePlannedValues,
  withPlannedValues,
} from "./planned-workout-values.mjs";
const fail = (message, status = 400, code = "INVALID_PLANNED_VALUES") => {
  throw Object.assign(new Error(message), { status, code });
};
function editable(event) {
  if (
    event?.category !== "WORKOUT" ||
    event.read_only ||
    event.readonly ||
    event.editable === false ||
    event.athlete_cannot_edit
  )
    fail("This planned workout is read-only in Intervals.icu.", 403, "READ_ONLY");
}
export async function loadPlannedWorkoutMetrics(request, id) {
  const event = await request(`/athlete/0/events/${eventId(id)}`);
  editable(event);
  return { event, revision: workoutRevision(event) };
}
export async function savePlannedWorkoutMetrics(request, id, input = {}) {
  const values = validatePlannedValues(input.values || {});
  if (!Object.keys(values).length && input.name == null && input.date == null && input.time == null)
    fail("Change a planned value before saving.");
  const path = `/athlete/0/events/${eventId(id)}`,
    current = await request(path);
  editable(current);
  const totals = { ...readPlannedValues(current.description), ...values };
  // Recalculate pace from revised time/distance unless pace was edited too.
  if (("duration_seconds" in values || "distance_meters" in values) && !("average_speed" in values))
    delete totals.average_speed;
  const patch = { description: withPlannedValues(current.description, totals) };
  if (input.name != null) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 200)
      fail("Enter a workout title under 200 characters.");
    patch.name = input.name.trim();
  }
  if (input.date != null || input.time != null) {
    const oldDate = String(current.start_date_local).slice(0, 10),
      date = input.date ?? oldDate;
    validDate(date);
    const time = input.time || "00:00";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail("Enter a valid start time.");
    patch.start_date_local = `${date}T${input.time == null ? String(current.start_date_local).slice(11) || "00:00:00" : time + ":00"}`;
    if (date !== oldDate && current.end_date_local) {
      const delta = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${oldDate}T00:00:00Z`);
      patch.end_date_local =
        new Date(Date.parse(String(current.end_date_local).slice(0, 10) + "T00:00:00Z") + delta)
          .toISOString()
          .slice(0, 10) + String(current.end_date_local).slice(10);
    }
  }
  for (const [key, field] of [
    ["duration_seconds", "time_target"],
    ["distance_meters", "distance_target"],
    ["tss", "load_target"],
  ])
    if (key in values) patch[field] = values[key];
  // Manual IF is an exact private planned value. ICU owns its independently
  // derived intensity, which may differ after native load/duration rounding.
  if ("work_kj" in values)
    patch.joules = values.work_kj == null ? null : Math.round(values.work_kj * 1000);
  if (providerWorkoutDescription(patch.description).length > 30000)
    fail("Workout text exceeds 30,000 characters.");
  const same = (event) =>
    Object.entries(patch).every(([key, value]) =>
      typeof value === "number"
        ? typeof event[key] === "number" &&
          Math.abs(event[key] - value) <= Math.max(1, value) * 1e-6
        : (event[key] ?? null) === value
    );
  const verify = (event) => {
    if (
      !same(event) ||
      [
        "id",
        "category",
        "type",
        "name",
        "start_date_local",
        "end_date_local",
        "paired_activity_id",
        "calendar_id",
        "uid",
        "external_id",
        "tags",
      ].some(
        (key) =>
          !(key in patch) &&
          JSON.stringify(event[key] ?? null) !== JSON.stringify(current[key] ?? null)
      ) ||
      JSON.stringify(event.workout_doc?.steps ?? []) !==
        JSON.stringify(current.workout_doc?.steps ?? [])
    )
      fail(
        "Intervals.icu did not confirm these planned values and preserved intervals. Your draft is retained; reload before retrying.",
        502,
        "SAVE_UNCONFIRMED"
      );
    return { event, workoutId: id, revision: workoutRevision(event), verified: true };
  };
  // Retrying a response lost after a successful PUT does not send a second write.
  if (same(current)) return verify(current);
  if (!input.revision || input.revision !== workoutRevision(current))
    fail(
      "This workout changed in Intervals.icu. Reload planned values before saving; your draft is retained.",
      409,
      "CONFLICT"
    );
  try {
    await request(path, { method: "PUT", body: JSON.stringify(patch) });
  } catch (error) {
    if (error.status >= 400 && error.status < 500) throw error;
  }
  return verify(await request(path));
}
