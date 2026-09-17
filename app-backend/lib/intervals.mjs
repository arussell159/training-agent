import { athleteLocalDate } from "./athlete-date.mjs";
import {
  readableDescription,
  readEditorModel,
  workoutTotals,
  clock,
} from "./workout-editor-model.mjs";

export function createIntervalsClient(config, fetchImpl = fetch) {
  const key = config.INTERVALS_API_KEY;
  if (!key) throw new Error("Connect Intervals.icu in Settings first");
  return async (pathname, options = {}) => {
    if (!pathname.startsWith("/") || pathname.includes(".."))
      throw new Error("Invalid Intervals.icu path");
    const response = await fetchImpl(`https://intervals.icu/api/v1${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
        Authorization: `Basic ${Buffer.from(`API_KEY:${key}`).toString("base64")}`,
      },
    });
    if (!response.ok) {
      const error = new Error(
        `Intervals.icu request failed (${response.status}). ${response.status === 401 || response.status === 403 ? "Check your API key in Settings." : response.status === 429 ? "Rate limit reached; wait before refreshing." : "Refresh before retrying any change."}`
      );
      error.status = response.status;
      throw error;
    }
    const text = await response.text();
    return text ? redactSecrets(JSON.parse(text)) : null;
  };
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/api[_-]?key|token|secret|password|authorization/i.test(key))
        .map(([key, item]) => [key, redactSecrets(item)])
    );
  return value;
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error("Choose a valid calendar date");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new Error("Choose a valid calendar date");
  return value;
}

export function eventId(id) {
  const match = String(id).match(/^event:(\d+)$/);
  if (!match)
    throw new Error(
      "Only Intervals.icu calendar events can be changed; completed activities are read-only."
    );
  return match[1];
}

function sport(type) {
  return /Ride|Bike/i.test(type || "")
    ? "Bike"
    : /Run/i.test(type || "")
      ? "Run"
      : /Swim/i.test(type || "")
        ? "Swim"
        : /Weight|Strength/i.test(type || "")
          ? "Strength"
          : type || "Other";
}
function duration(seconds) {
  const minutes = Math.round(Number(seconds || 0) / 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}h ${String(minutes % 60).padStart(2, "0")}m`;
}
function pace(speed, distance, unit) {
  if (!(Number(speed) > 0)) return null;
  const seconds = Math.round(distance / speed);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} ${unit}`;
}

function appWorkoutDoc(doc, type) {
  if (!doc || !/Swim/i.test(type || "") || !/y$/i.test(String(doc.options?.pool_length || "")))
    return doc;
  const normalize = (steps) =>
    (steps || []).map((step) =>
      step.steps
        ? { ...step, steps: normalize(step.steps) }
        : step.distance > 0 && step.pace?.units === "secs"
          ? { ...step, distance_units: "yards" }
          : step
    );
  return { ...doc, steps: normalize(doc.steps) };
}

export function mapIntervalsWorkout(item, today, activity = null, isActivity = false) {
  const actual = isActivity ? item : activity;
  const editorModel = !isActivity ? readEditorModel(item.description) : null;
  if (editorModel)
    editorModel.thresholds = { ftp: item.icu_ftp || null, pace: item.icu_threshold_pace || null };
  const editorTotals = editorModel ? workoutTotals(editorModel) : null;
  const plannedTimeLabel = editorTotals
    ? `${editorTotals.open ? "Open · ≈ " : editorTotals.unknownTime ? "At least " : editorTotals.estimated ? "≈ " : ""}${clock(editorTotals.seconds)}`
    : null;
  const description = readableDescription(item.description)
    .replace(/^\*\*(Warm Up:|Main Set:|Warm Down:)\*\*$/gm, "$1")
    .trim();
  const date = String(item.start_date_local || "").slice(0, 10);
  validDate(date);
  const minutes = Math.round(Number(item.moving_time || item.workout_doc?.duration || 0) / 60);
  const actualMinutes = actual ? Math.round(Number(actual.moving_time || 0) / 60) : 0;
  const local = new Date(`${date}T12:00:00Z`);
  const summary = (value) => {
    if (!value) return null;
    const durationSeconds = value.moving_time ?? value.workout_doc?.duration ?? null;
    const distanceMeters = value.distance ?? value.workout_doc?.distance ?? null;
    return {
      duration_seconds: durationSeconds,
      distance_meters: distanceMeters,
      average_speed:
        value.average_speed ??
        (distanceMeters > 0 && durationSeconds > 0 ? distanceMeters / durationSeconds : null),
      max_speed: value.max_speed ?? null,
      calories: value.calories ?? null,
      elevation_gain: value.total_elevation_gain ?? null,
      elevation_loss: value.total_elevation_loss ?? null,
      tss: value.icu_training_load ?? value.load_target ?? null,
      intensity_factor: value.icu_intensity != null ? value.icu_intensity / 100 : null,
      work_kj: value.icu_joules != null ? value.icu_joules / 1000 : null,
      average_power: value.icu_average_watts ?? value.workout_doc?.average_watts ?? null,
      average_hr: value.average_heartrate ?? null,
      max_hr: value.max_heartrate ?? null,
      average_cadence: value.average_cadence ?? null,
      elapsed_time_seconds: value.elapsed_time ?? (value === actual ? null : durationSeconds),
      elapsed_speed:
        value.elapsed_time > 0 && distanceMeters > 0
          ? distanceMeters / value.elapsed_time
          : value !== actual && durationSeconds > 0 && distanceMeters > 0
            ? distanceMeters / durationSeconds
            : null,
    };
  };
  return {
    id: `${isActivity ? "activity" : "event"}:${item.id}`,
    provider: "intervals",
    editable: !isActivity,
    activity_id: actual?.id || null,
    activity_file_type: actual?.file_type || null,
    category: item.category || "ACTIVITY",
    workout_date: date,
    day: local.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
    date: local.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    sport: sport(item.type),
    title: item.name || `${sport(item.type)} ${isActivity ? "activity" : "event"}`,
    duration: duration(item.moving_time || item.workout_doc?.duration),
    distance_meters: actual?.distance ?? item.distance ?? item.workout_doc?.distance ?? null,
    plannedDurationMinutes: isActivity ? 0 : minutes,
    actualDurationMinutes: actualMinutes,
    goal: description,
    details: description,
    status: actual ? "completed" : date === today ? "today" : "upcoming",
    completed: Boolean(actual),
    load: item.icu_training_load ?? item.load_target ?? 0,
    planned: {
      duration_minutes: isActivity ? 0 : minutes,
      tss: isActivity ? 0 : (item.icu_training_load ?? item.load_target ?? 0),
    },
    completed_data: actual
      ? {
          duration_minutes: actualMinutes,
          tss: actual.icu_training_load ?? 0,
          distance: actual.distance,
          avg_hr: actual.average_heartrate,
          avg_power: actual.icu_average_watts,
          power_watts: actual.icu_average_watts,
          normalized_power: actual.icu_weighted_avg_watts,
          rpe: actual.icu_rpe,
          pace_seconds_per_unit:
            actual.distance > 0 ? actual.moving_time / actual.distance : undefined,
        }
      : {},
    // Calendar dates are local all-day values, not UTC timestamps.
    scheduled_start_at: null,
    structure: item.workout_doc ? JSON.stringify(appWorkoutDoc(item.workout_doc, item.type)) : null,
    source_updated_at: item.updated || null,
    source: "intervals",
    measurement_quality: {
      power_available: actual?.icu_average_watts != null,
      heart_rate_available: actual?.average_heartrate != null,
    },
    workout_summary: { planned: isActivity ? null : summary(item), completed: summary(actual) },
    ...(editorModel ? { editor_model: editorModel, planned_time_label: plannedTimeLabel } : {}),
    raw: item,
    raw_activity: actual || null,
  };
}

export async function fetchIntervalsContext(
  request,
  { now = new Date(), timeZone = "America/Chicago", range } = {}
) {
  const syncStartedAt = new Date().toISOString();
  const athlete = await request("/athlete/0");
  timeZone = athlete.timezone || athlete.time_zone || timeZone;
  const today = athleteLocalDate(now, timeZone);
  const shift = (days) =>
    new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const query = `oldest=${range?.start || shift(-89)}&newest=${range?.end || shift(60)}`;
  const [activities, events, wellness, currentWellness] = await Promise.all([
    request(`/athlete/0/activities?${query}`),
    request(`/athlete/0/events?${query}`),
    request(
      `/athlete/0/wellness?oldest=${range ? new Date(Date.parse(`${range.start}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10) : shift(-89)}&newest=${range?.end || today}`
    ),
    range ? request(`/athlete/0/wellness?oldest=${today}&newest=${today}`) : Promise.resolve(null),
  ]);
  const matches = pairIntervalsWorkouts(events || [], activities || []);
  const paired = new Set([...matches.values()].map((a) => String(a.id)));
  const sessions = [
    ...(events || []).map((e) => mapIntervalsWorkout(e, today, matches.get(String(e.id)))),
    ...(activities || [])
      .filter((a) => !paired.has(String(a.id)))
      .map((a) => mapIntervalsWorkout(a, today, null, true)),
  ].sort((a, b) => a.workout_date.localeCompare(b.workout_date));
  const settings = athlete.sportSettings || athlete.sport_settings || [];
  const find = (pattern) =>
    settings.find((s) => (s.types || [s.type]).some((t) => pattern.test(t || ""))) || {};
  const bike = find(/Ride/),
    run = find(/Run/),
    swim = find(/Swim/);
  const latest =
    [...(currentWellness || wellness || [])]
      .filter((w) => w.id <= today)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .at(-1) || {};
  return {
    athlete: {
      id: String(athlete.id),
      name: athlete.name || [athlete.first_name, athlete.last_name].filter(Boolean).join(" "),
      time_zone: timeZone,
      sport_settings: settings,
      thresholds: settings,
      zones: {
        bike_ftp: bike.ftp ?? null,
        run_threshold_pace: pace(run.threshold_pace, 1609.344, "min/mi"),
        swim_css: pace(swim.threshold_pace, 91.44, "min/100 yd"),
        threshold_hr: run.lthr ?? bike.lthr ?? null,
      },
    },
    metrics: {
      fitness: latest.ctl ?? null,
      fatigue: latest.atl ?? null,
      form: latest.ctl != null && latest.atl != null ? latest.ctl - latest.atl : null,
    },
    wellness: {
      hrv: latest.hrv ?? null,
      resting_hr: latest.restingHR ?? null,
      sleep: latest.sleepSecs ?? null,
    },
    wellness_history: (wellness || []).map((w) => ({ ...w, date: w.id })),
    performance: (wellness || []).map((w) => ({
      ...w,
      workoutDay: w.id,
      ctl: w.ctl,
      atl: w.atl,
      tsb: w.ctl != null && w.atl != null ? w.ctl - w.atl : null,
    })),
    history: sessions.filter((w) => w.workout_date <= today),
    planned: sessions.filter((w) => w.workout_date >= today),
    source: "intervals",
    synced_at: new Date().toISOString(),
    retention_days: 90,
    sync_started_at: syncStartedAt,
    cached_ranges: [{ start: range?.start || shift(-89), end: range?.end || shift(60) }],
  };
}

// Provider links win. Only infer a match when both sides uniquely agree on the
// local day, discipline and non-empty workout title; never guess by proximity.
export function pairIntervalsWorkouts(events, activities) {
  const byId = new Map(activities.map((a) => [String(a.id), a]));
  const matches = new Map(),
    used = new Set();
  const reserved = new Set(
    events.filter((e) => e.paired_activity_id != null).map((e) => String(e.paired_activity_id))
  );
  for (const event of events) {
    const activity =
      byId.get(String(event.paired_activity_id)) ||
      activities.find((a) => String(a.paired_event_id) === String(event.id));
    if (activity && !used.has(String(activity.id))) {
      matches.set(String(event.id), activity);
      used.add(String(activity.id));
    }
  }
  const key = (item) => {
    const title = String(item.name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    const day = String(item.start_date_local || "").slice(0, 10);
    return title && /^\d{4}-\d{2}-\d{2}$/.test(day) && item.type
      ? `${day}|${sport(item.type)}|${title}`
      : null;
  };
  const availableEvents = events.filter(
    (e) => e.category === "WORKOUT" && e.paired_activity_id == null && !matches.has(String(e.id))
  );
  const availableActivities = activities.filter(
    (a) => a.paired_event_id == null && !used.has(String(a.id)) && !reserved.has(String(a.id))
  );
  for (const event of availableEvents) {
    const signature = key(event);
    if (!signature || availableEvents.filter((e) => key(e) === signature).length !== 1) continue;
    const candidates = availableActivities.filter((a) => key(a) === signature);
    if (candidates.length === 1) matches.set(String(event.id), candidates[0]);
  }
  return matches;
}

export async function moveIntervalsEvent(request, id, date) {
  validDate(date);
  const path = `/athlete/0/events/${eventId(id)}`;
  const existing = await request(path);
  const old = String(existing.start_date_local).slice(0, 10);
  validDate(old);
  const delta = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${old}T00:00:00Z`);
  const patch = { start_date_local: date + String(existing.start_date_local).slice(10) };
  if (existing.end_date_local) {
    const endDate = String(existing.end_date_local).slice(0, 10);
    validDate(endDate);
    patch.end_date_local =
      new Date(Date.parse(`${endDate}T00:00:00Z`) + delta).toISOString().slice(0, 10) +
      String(existing.end_date_local).slice(10);
  }
  await request(path, { method: "PUT", body: JSON.stringify(patch) });
  const verified = await request(path);
  if (
    verified.start_date_local !== patch.start_date_local ||
    (patch.end_date_local && verified.end_date_local !== patch.end_date_local)
  )
    throw new Error("Intervals.icu did not confirm the move. Refresh before retrying.");
  return { workoutId: id, date, verified: true, event: verified };
}

export async function changeIntervalsEvent(request, id, action) {
  const path = `/athlete/0/events/${eventId(id)}`;
  if (!["copy", "delete"].includes(action)) throw new Error("Invalid calendar action");
  const original = await request(path);
  if (action === "delete") {
    await request(path, { method: "DELETE" });
    try {
      await request(path);
    } catch (error) {
      if (error.status === 404) return { workoutId: id, verified: true, action };
      throw error;
    }
    throw new Error("Intervals.icu did not confirm deletion. Refresh before retrying.");
  }
  const fields = [
    "category",
    "type",
    "name",
    "description",
    "start_date_local",
    "end_date_local",
    "moving_time",
    "icu_training_load",
    "color",
  ];
  const body = Object.fromEntries(
    fields.filter((f) => Object.hasOwn(original, f)).map((f) => [f, original[f]])
  );
  const created = await request("/athlete/0/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!created?.id || String(created.id) === eventId(id))
    throw new Error("Copy could not be confirmed. Refresh before retrying.");
  const verified = await request(`/athlete/0/events/${created.id}`);
  if (verified.name !== original.name || verified.start_date_local !== original.start_date_local)
    throw new Error("Copy could not be confirmed. Refresh before retrying.");
  return { workoutId: `event:${created.id}`, verified: true, action, event: verified };
}

export async function createIntervalsRaceEvent(request, { name, date, priority, externalId } = {}) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Enter a race name");
  validDate(date);
  const cleanPriority = String(priority || "").toUpperCase();
  if (!["A", "B", "C"].includes(cleanPriority)) throw new Error("Choose race priority A, B or C");
  const body = {
    category: `RACE_${cleanPriority}`,
    type: "Other",
    name: cleanName,
    start_date_local: `${date}T00:00:00`,
    ...(externalId ? { external_id: String(externalId) } : {}),
  };
  const sameDay = externalId
    ? await request(`/athlete/0/events?oldest=${date}&newest=${date}`)
    : [];
  const prior = Array.isArray(sameDay)
    ? sameDay.find((event) => event.external_id === externalId)
    : null;
  const created =
    prior || (await request("/athlete/0/events", { method: "POST", body: JSON.stringify(body) }));
  if (!created?.id)
    throw new Error("Intervals.icu did not confirm the race event. Refresh before retrying.");
  const verified = await request(`/athlete/0/events/${created.id}`);
  if (
    verified.name !== body.name ||
    verified.category !== body.category ||
    String(verified.start_date_local).slice(0, 10) !== date
  ) {
    throw new Error("Intervals.icu did not confirm the race event. Refresh before retrying.");
  }
  return verified;
}

export async function updateIntervalsRaceEvent(request, id, { name, date, priority } = {}) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Enter a race name");
  validDate(date);
  const cleanPriority = String(priority || "").toUpperCase();
  if (!["A", "B", "C"].includes(cleanPriority)) throw new Error("Choose race priority A, B or C");
  const path = `/athlete/0/events/${eventId(id)}`;
  const existing = await request(path);
  if (!/^RACE(?:_[ABC])?$/.test(String(existing.category || "")))
    throw new Error("Only race events can be edited here");
  const originalDate = String(existing.start_date_local || "").slice(0, 10);
  validDate(originalDate);
  const suffix = String(existing.start_date_local || "").slice(10) || "T00:00:00";
  const body = {
    name: cleanName,
    category: `RACE_${cleanPriority}`,
    start_date_local: `${date}${suffix}`,
  };
  if (existing.end_date_local) {
    const delta = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${originalDate}T00:00:00Z`);
    const endDate = String(existing.end_date_local).slice(0, 10);
    body.end_date_local =
      new Date(Date.parse(`${endDate}T00:00:00Z`) + delta).toISOString().slice(0, 10) +
      String(existing.end_date_local).slice(10);
  }
  await request(path, { method: "PUT", body: JSON.stringify(body) });
  const verified = await request(path);
  if (
    verified.name !== cleanName ||
    verified.category !== body.category ||
    String(verified.start_date_local).slice(0, 10) !== date
  )
    throw new Error("Intervals.icu did not confirm the race update. Refresh before retrying.");
  return verified;
}
