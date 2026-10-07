import { athleteLocalDate } from "./athlete-date.mjs";
import { mapIntervalsWorkout, pairIntervalsWorkouts, validDate } from "./intervals.mjs";

const day = (value) => String(value || "").slice(0, 10);
const compact = ({ raw, raw_activity, ...workout }) => ({
  ...workout,
  recorded_start_local: raw_activity?.start_date_local || workout.recorded_start_local || null,
  device_name: raw_activity?.device_name || workout.device_name || null,
});
const dated = (row) => {
  try {
    return Boolean(validDate(day(row?.start_date_local)));
  } catch {
    return false;
  }
};

export function historicalRange(start, end) {
  validDate(start);
  validDate(end);
  if (end < start || Date.parse(end) - Date.parse(start) > 31 * 86400000)
    throw Error("Calendar range must be between 1 and 32 days.");
  return { start, end };
}

export async function fetchHistoricalWorkout(request, id, { now = new Date() } = {}) {
  const match = /^(activity:i[1-9]\d*|event:[1-9]\d*)$/.exec(String(id));
  if (!match) {
    const error = new Error("Choose a valid Intervals.icu workout.");
    error.status = 400;
    throw error;
  }
  const [kind, providerId] = id.split(":");
  const item = await request(
    kind === "activity" ? `/activity/${providerId}` : `/athlete/0/events/${providerId}`
  );
  if (!item || !dated(item)) {
    const error = new Error("This workout is unavailable from Intervals.icu.");
    error.status = 404;
    throw error;
  }
  const today = athleteLocalDate(now, "America/Chicago");
  if (kind === "activity") return compact(mapIntervalsWorkout(item, today, null, true));
  const date = day(item.start_date_local);
  const activities = (
    (await request(
      `/athlete/0/activities?${new URLSearchParams({ oldest: date, newest: date })}`
    )) || []
  ).filter(dated);
  const paired = pairIntervalsWorkouts([item], activities).get(String(item.id));
  return compact(mapIntervalsWorkout(item, today, paired || null, false));
}

/** Read-only history: never merge old dates into the bounded live snapshot. */
export async function fetchHistoricalCalendar(request, range, { context, now = new Date() } = {}) {
  range = historicalRange(range.start, range.end);
  const query = new URLSearchParams({ oldest: range.start, newest: range.end });
  const [activities, events, wellness] = await Promise.all([
    request(`/athlete/0/activities?${query}`),
    request(`/athlete/0/events?${query}`),
    request(`/athlete/0/wellness?${query}`),
  ]);
  const recorded = (activities || []).filter(dated),
    planned = (events || []).filter(dated);
  const matches = pairIntervalsWorkouts(planned, recorded);
  const paired = new Set([...matches.values()].map((row) => String(row.id)));
  const athlete = context?.athlete || { time_zone: "America/Chicago" };
  const today = athleteLocalDate(now, athlete.time_zone || "America/Chicago");
  const rows = [
    ...planned.map((row) =>
      mapIntervalsWorkout(
        row,
        today,
        matches.get(String(row.id)),
        false,
        athlete.sport_settings || []
      )
    ),
    ...recorded
      .filter((row) => !paired.has(String(row.id)))
      .map((row) => mapIntervalsWorkout(row, today, null, true)),
  ]
    .map(compact)
    .filter((row) => row.workout_date >= range.start && row.workout_date <= range.end);
  return {
    athlete,
    metrics: context?.metrics || {},
    wellness: context?.wellness || {},
    history: rows.filter((row) => row.workout_date <= today),
    planned: rows.filter((row) => row.workout_date >= today),
    wellness_history: (wellness || []).map((row) => ({ ...row, date: row.id })),
    source: "intervals",
    context_scope: "range",
    display_range: range,
    cached_ranges: [range],
    full_history_available: true,
    synced_at: now.toISOString(),
  };
}

// Report summaries deliberately omit activity streams, interval arrays and FIT data.
const reportFields = [
  "id",
  "start_date_local",
  "name",
  "type",
  "moving_time",
  "elapsed_time",
  "distance",
  "average_speed",
  "max_speed",
  "calories",
  "total_elevation_gain",
  "total_elevation_loss",
  "icu_training_load",
  "icu_intensity",
  "icu_joules",
  "icu_average_watts",
  "icu_weighted_avg_watts",
  "max_watts",
  "max_cadence",
  "average_heartrate",
  "max_heartrate",
  "average_cadence",
  "average_temp",
  "average_weather_temp",
  "average_temperature",
  "temperature",
  "average_humidity",
  "relative_humidity",
  "humidity",
  "start_latlng",
  "start_latitude",
  "start_longitude",
  "latitude",
  "longitude",
  "device_name",
  "file_type",
].join(",");

/** Descending bounded pages; complete the boundary day so equal timestamps cannot skip records. */
export async function fetchWorkoutHistoryPage(
  request,
  { start = "0001-01-01", end, before, now = new Date(), pageSize = 200 } = {}
) {
  end ||= athleteLocalDate(now, "America/Chicago");
  validDate(start);
  validDate(end);
  if (before) validDate(before);
  if (end < start) throw Error("History end must not precede its start.");
  const newest = before && before < end ? before : end;
  if (newest < start)
    return { workouts: [], next_before: null, complete: true, range: { start, end } };
  const query = new URLSearchParams({
    oldest: start,
    newest,
    limit: String(pageSize),
    fields: reportFields,
  });
  const page = (await request(`/athlete/0/activities?${query}`)) || [];
  const rows = page
    .filter(dated)
    .filter((row) => day(row.start_date_local) >= start && day(row.start_date_local) <= newest);
  const boundary = rows.map((row) => day(row.start_date_local)).sort()[0];
  let next = null;
  if (page.length >= pageSize && boundary) {
    const boundaryQuery = new URLSearchParams({
      oldest: boundary,
      newest: boundary,
      fields: reportFields,
    });
    rows.push(...((await request(`/athlete/0/activities?${boundaryQuery}`)) || []).filter(dated));
    if (boundary > start)
      next = new Date(Date.parse(`${boundary}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  }
  const workouts = [...new Map(rows.map((row) => [String(row.id), row])).values()]
    .sort((a, b) => String(b.start_date_local).localeCompare(String(a.start_date_local)))
    .map((row) => compact(mapIntervalsWorkout(row, end, null, true)));
  return { workouts, next_before: next, complete: next === null, range: { start, end } };
}
