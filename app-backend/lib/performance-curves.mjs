import { createHash } from "node:crypto";
import { athleteLocalDate } from "./athlete-date.mjs";
import { validDate } from "./intervals.mjs";
import { recordedEffortBounds } from "./activity-analysis.mjs";

// Source contracts: https://intervals.icu/api/v1/docs and the public application's
// computePace: pace curve distance is metres, values are elapsed seconds.
export const POWER_DURATIONS = [5, 10, 30, 60, 300, 600, 1200, 3600];
export const PACE_DISTANCES = {
  Run: [
    400, 800, 804.672, 1000, 1500, 1609.344, 3000, 3218.688, 5000, 10000, 15000, 16093.44, 20000,
    21097.5, 30000, 42195,
  ],
  Swim: [
    100, 200, 400, 1000, 1500, 91.44, 182.88, 365.76, 548.64, 731.52, 914.4, 1931.2128, 3862.4256,
  ],
};
const HOME_DISTANCES = {
  Run: [400, 1000, 5000, 10000, 21097.5],
  Swim: [100, 200, 400, 1000, 1500].map((yards) => yards * 0.9144),
};
const numeric = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const positive = (value) => numeric(value) && value > 0;
const day = (value) => (typeof value === "string" ? value.slice(0, 10) : null);
const checkedDate = (value) => {
  try {
    return validDate(value);
  } catch {
    throw Object.assign(Error("Choose valid performance dates."), { status: 400 });
  }
};
const shift = (value, count) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
};
export function performanceType(type) {
  if (!["Ride", "Run", "Swim"].includes(type))
    throw Object.assign(Error("Choose Ride, Run or Swim."), { status: 400 });
  return type;
}
export function performanceActivityId(id) {
  if (typeof id !== "string" || !/^(i?[1-9]\d{0,29})$/.test(id))
    throw Object.assign(Error("Choose a valid recorded activity."), { status: 400 });
  return id;
}
export function performanceEffortSelection(type, duration, distance) {
  performanceType(type);
  const parse = (value) =>
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
        ? Number(value)
        : NaN;
  const durationSeconds = parse(duration),
    distanceMeters = parse(distance);
  if (
    type === "Ride"
      ? distance != null ||
        !Number.isSafeInteger(durationSeconds) ||
        durationSeconds < 1 ||
        durationSeconds > 86400
      : duration != null || !positive(distanceMeters) || distanceMeters > 100000
  )
    throw Object.assign(Error("Choose a valid recorded power or pace anchor."), { status: 400 });
  return {
    type,
    duration_seconds: type === "Ride" ? durationSeconds : null,
    distance_meters: type === "Ride" ? null : distanceMeters,
    unit: type === "Ride" ? "watts" : "m/s",
  };
}
export function performanceAccount(config) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        config.SETTINGS_SCOPE || "default",
        config.SUPABASE_URL || "",
        config.INTERVALS_API_KEY || "",
        config.INTERVALS_CLIENT_ID || "",
        config.INTERVALS_ACCESS_TOKEN || "",
        config.INTERVALS_ATHLETE_ID || "",
      ])
    )
    .digest("hex");
}
export function performanceWindow(oldest, newest, today) {
  checkedDate(today);
  if (oldest == null && newest == null) return { oldest: null, newest: today, token: "all" };
  checkedDate(oldest);
  checkedDate(newest);
  if (oldest < "1900-01-01" || newest > today || oldest > newest)
    throw Object.assign(Error("Choose a performance date range ending today or earlier."), {
      status: 400,
    });
  return { oldest, newest, token: `r.${oldest}.${newest}` };
}
export function performancePeriods(today, monthCount = 12) {
  checkedDate(today);
  if (!Number.isInteger(monthCount) || monthCount < 1 || monthCount > 24)
    throw Object.assign(Error("Choose between 1 and 24 performance months."), {
      status: 400,
    });
  const current = new Date(`${today}T12:00:00Z`);
  current.setUTCDate(current.getUTCDate() - ((current.getUTCDay() + 6) % 7));
  const monday = current.toISOString().slice(0, 10);
  const weeks = Array.from({ length: 4 }, (_, index) => {
    const start = shift(monday, -7 * index),
      end = index ? shift(start, 6) : today;
    return { start, end, label: start, token: `r.${start}.${end}` };
  });
  const [year, month] = today.split("-").map(Number);
  const months = Array.from({ length: monthCount }, (_, index) => {
    const start = new Date(Date.UTC(year, month - 1 - index, 1, 12)).toISOString().slice(0, 10);
    const end = index
      ? new Date(Date.UTC(year, month - index, 0, 12)).toISOString().slice(0, 10)
      : today;
    return { start, end, label: start.slice(0, 7), token: `r.${start}.${end}` };
  });
  return { weeks, months };
}
export function performanceAnchors(type) {
  performanceType(type);
  return type === "Ride"
    ? [5, 60, 300, 1200, 3600].map((duration_seconds) => ({
        duration_seconds,
        distance_meters: null,
        unit: "watts",
      }))
    : HOME_DISTANCES[type].map((distance_meters) => ({
        duration_seconds: null,
        distance_meters,
        unit: "m/s",
      }));
}
const sportMatches = (value, type) => {
  if (typeof value !== "string") return false;
  return type === "Ride"
    ? /ride|bike|cyclocross|handcycle|velomobile/i.test(value)
    : type === "Run"
      ? /run/i.test(value)
      : /swim/i.test(value);
};
export function performanceTotals(activities, type, start, end, truncated = false) {
  performanceType(type);
  const rows = new Map();
  let hidden = false;
  for (const activity of activities) {
    if (!activity || typeof activity !== "object") continue;
    const date = day(activity.start_date_local);
    if (!date || !activity.type) {
      hidden = true;
      continue;
    }
    try {
      validDate(date);
    } catch {
      hidden = true;
      continue;
    }
    if (date < start || date > end || !sportMatches(activity.type, type) || !activity.id) continue;
    const id = String(activity.id);
    if (!rows.has(id)) rows.set(id, activity);
  }
  const keys = ["duration_seconds", "distance_meters", "tss", "work_kj"];
  const sums = Object.fromEntries(keys.map((key) => [key, 0]));
  const known = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const row of rows.values()) {
    const values = {
      duration_seconds: numeric(row.moving_time) ? row.moving_time : row.elapsed_time,
      distance_meters: row.distance,
      tss: row.icu_training_load,
      work_kj: numeric(row.icu_joules) ? row.icu_joules / 1000 : null,
    };
    for (const key of keys)
      if (numeric(values[key])) {
        sums[key] += values[key];
        known[key]++;
      }
  }
  const incomplete = Object.fromEntries(
    keys.map((key) => [key, truncated || hidden || known[key] < rows.size])
  );
  for (const key of keys) if (rows.size && !known[key]) sums[key] = null;
  if (type !== "Ride") {
    sums.work_kj = null;
    incomplete.work_kj = false;
  }
  return { activities: rows.size, ...sums, incomplete };
}
function curveFor(payload, token) {
  if (!payload || !Array.isArray(payload.list) || payload.list.length > 100)
    throw Error("Intervals.icu performance curves are unavailable.");
  let curve = payload.list.find((value) => value?.id === token);
  if (!curve && token.startsWith("r.")) {
    const [, start, end] = token.split(".");
    curve = payload.list.find(
      (value) => day(value?.start_date_local) === start && day(value?.end_date_local) === end
    );
  }
  if (!curve) return { curve: null, activities: {} };
  const axis = curve.secs || curve.distance;
  const values = curve.values || curve.watts;
  if (
    !Array.isArray(axis) ||
    !Array.isArray(values) ||
    axis.length !== values.length ||
    axis.length > 10_000
  )
    throw Error("Intervals.icu performance curves are unavailable.");
  return {
    curve,
    activities:
      payload.activities &&
      typeof payload.activities === "object" &&
      !Array.isArray(payload.activities)
        ? payload.activities
        : {},
  };
}
function provenance(bundle, index, type) {
  const id =
    typeof bundle.curve?.activity_id?.[index] === "string" ? bundle.curve.activity_id[index] : null;
  const activity = id && Object.hasOwn(bundle.activities, id) ? bundle.activities[id] : null;
  // Curves can return compact activity metadata without a type. An explicit
  // mismatched type is never attributed to the selected sport.
  if (activity?.type && !sportMatches(activity.type, type)) return null;
  let date = day(activity?.start_date_local);
  try {
    if (date) validDate(date);
  } catch {
    date = null;
  }
  return {
    activity_id: id,
    date,
    name: typeof activity?.name === "string" ? activity.name.slice(0, 512) : null,
  };
}
function distanceIndex(axis, requested, nominal = false) {
  // Traditional mile/yard distances are sometimes represented as whole metres
  // by the source. Retain that source distance and its original elapsed time.
  const tolerance = nominal ? 0.5 : 0.01;
  return axis.findIndex((value) => positive(value) && Math.abs(value - requested) <= tolerance);
}
function effortIndices(curve, index) {
  const axis = curve.secs || curve.distance || curve.values;
  if (
    !Array.isArray(curve.start_index) ||
    !Array.isArray(curve.end_index) ||
    !Array.isArray(axis) ||
    curve.start_index.length !== axis.length ||
    curve.end_index.length !== axis.length
  )
    return {};
  const start = curve.start_index?.[index],
    end = curve.end_index?.[index];
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start
    ? { start_index: start, end_index: end }
    : {};
}
export function curvePeak(bundle, type, anchor, { nominal = false } = {}) {
  const empty = { ...anchor, value: null, estimated: false };
  const curve = bundle?.curve;
  if (!curve) return empty;
  const axis = type === "Ride" ? curve.secs : curve.distance;
  if (!Array.isArray(axis)) return empty;
  const index =
    type === "Ride"
      ? axis.indexOf(anchor.duration_seconds)
      : distanceIndex(axis, anchor.distance_meters, nominal);
  if (index < 0) return empty;
  const raw = (curve.values || curve.watts)?.[index];
  const detail = provenance(bundle, index, type);
  if (!detail || !(type === "Ride" ? numeric(raw) : positive(raw))) return empty;
  const value = type === "Ride" ? raw : axis[index] / raw;
  if (!numeric(value)) return empty;
  return {
    ...empty,
    value,
    ...detail,
    ...effortIndices(curve, index),
    ...(type === "Ride" ? {} : { distance_meters: axis[index], elapsed_seconds: raw }),
    ...(type === "Ride" && numeric(curve.watts_per_kg?.[index])
      ? { watts_per_kg: curve.watts_per_kg[index] }
      : {}),
  };
}
export function curveBestEfforts(bundle, type) {
  const anchors =
    type === "Ride"
      ? POWER_DURATIONS.map((duration_seconds) => ({
          duration_seconds,
          distance_meters: null,
          unit: "watts",
        }))
      : PACE_DISTANCES[type].map((distance_meters) => ({
          duration_seconds: null,
          distance_meters,
          unit: "m/s",
        }));
  return anchors.flatMap((anchor) => {
    const nominal =
      type !== "Ride" &&
      !Number.isInteger(anchor.distance_meters) &&
      anchor.distance_meters !== 21097.5;
    const peak = curvePeak(bundle, type, anchor, { nominal });
    if (peak.value === null) return [];
    return [
      {
        ...peak,
        sport: type === "Ride" ? "Bike" : type,
        kind: type === "Ride" ? "power" : "pace",
        ...(type === "Ride"
          ? {}
          : {
              requested_distance_meters: anchor.distance_meters,
              duration_seconds: peak.elapsed_seconds,
            }),
      },
    ];
  });
}

const emptyHomePeak = (anchor) => ({ ...anchor, value: null, estimated: false, source: null });
const ignoredForPeaks = (activity, type) =>
  type === "Ride" ? activity?.icu_ignore_power === true : activity?.ignore_pace === true;
const missingActivityId = (peak) =>
  typeof peak.activity_id !== "string" || !/^(i?[1-9]\d{0,29})$/.test(peak.activity_id);
export function homeCurvePeak(bundle, type, anchor, period, inventory = new Map()) {
  const peak = curvePeak(bundle, type, anchor, { nominal: type === "Swim" });
  const activity = peak.activity_id && bundle?.activities?.[peak.activity_id];
  const recorded = peak.activity_id && inventory.get(peak.activity_id);
  if (
    peak.value === null ||
    ignoredForPeaks(activity, type) ||
    (recorded &&
      (!activityInPeriod(recorded, type, period) ||
        (peak.date && peak.date !== day(recorded.start_date_local)))) ||
    (activity?.start_date_local != null && !peak.date) ||
    (peak.date && (peak.date < period.start || peak.date > period.end))
  )
    return emptyHomePeak(anchor);
  return {
    ...peak,
    ...(recorded && !peak.date ? { date: day(recorded.start_date_local) } : {}),
    ...(recorded && peak.name == null && typeof recorded.name === "string"
      ? { name: recorded.name.slice(0, 512) }
      : {}),
    source: "intervals-curve",
  };
}
function activityInPeriod(activity, type, period) {
  if (!activity?.id || !sportMatches(activity.type, type) || ignoredForPeaks(activity, type))
    return false;
  const date = day(activity.start_date_local);
  try {
    validDate(date);
  } catch {
    return false;
  }
  return date >= period.start && date <= period.end;
}
function canCoverAnchor(activity, type, anchor) {
  if (type === "Ride") {
    const elapsed = numeric(activity.elapsed_time) ? activity.elapsed_time : activity.moving_time;
    // A missing length is unknown eligibility. An exact returned curve provides
    // evidence; only a known shorter recording rules an anchor out.
    return !numeric(elapsed) || elapsed >= anchor.duration_seconds;
  }
  return (
    !numeric(activity.distance) ||
    activity.distance >= anchor.distance_meters - (type === "Swim" ? 0.5 : 0.01)
  );
}
export function eligibleMissingPeak(activities, type, anchor, period) {
  return activities.some(
    (activity) => activityInPeriod(activity, type, period) && canCoverAnchor(activity, type, anchor)
  );
}
function validateActivityCurves(payload, type) {
  const axis = type === "Ride" ? payload?.secs : payload?.distances;
  if (
    !Array.isArray(axis) ||
    !axis.length ||
    axis.length > 10_000 ||
    axis.some((value) => !positive(value) || (type === "Ride" && !Number.isSafeInteger(value))) ||
    new Set(axis).size !== axis.length ||
    !Array.isArray(payload?.curves) ||
    payload.curves.length > 10_000 ||
    payload.curves.length * axis.length > 100_000
  )
    throw Error("Recorded activity curves are unavailable.");
  return payload;
}
export function normalizeActivityCurves(payload, type, activities, range) {
  validateActivityCurves(payload, type);
  const axis = type === "Ride" ? payload.secs : payload.distances;
  const known = new Map();
  const ignored = new Set(
    activities
      .filter((activity) => ignoredForPeaks(activity, type))
      .map((activity) => String(activity.id))
  );
  for (const activity of activities)
    if (activityInPeriod(activity, type, range) && !known.has(String(activity.id)))
      known.set(String(activity.id), activity);
  const records = new Map();
  let incomplete = false;
  for (const curve of payload.curves) {
    const id = typeof curve?.id === "string" ? curve.id : null,
      activity = id && known.get(id);
    if (ignored.has(id)) continue;
    if (!activity || records.has(id)) {
      incomplete = true;
      continue;
    }
    const values = type === "Ride" ? curve.watts : curve.secs;
    if (!Array.isArray(values) || values.length !== axis.length) {
      incomplete = true;
      continue;
    }
    const date = day(activity.start_date_local),
      sourceDate = day(curve.start_date_local);
    if (curve.start_date_local != null && sourceDate !== date) {
      incomplete = true;
      continue;
    }
    if (curve.type != null && !sportMatches(curve.type, type)) {
      incomplete = true;
      continue;
    }
    records.set(id, {
      id,
      date,
      activity,
      values,
      ...(Array.isArray(curve.start_index) &&
      Array.isArray(curve.end_index) &&
      curve.start_index.length === axis.length &&
      curve.end_index.length === axis.length
        ? { start_index: curve.start_index, end_index: curve.end_index }
        : {}),
      weight: curve.weight,
      name: typeof activity.name === "string" ? activity.name.slice(0, 512) : null,
    });
  }
  const anchors = axis.map((value) =>
    type === "Ride" ? { duration_seconds: value } : { distance_meters: value }
  );
  for (const [id, activity] of known) {
    const record = records.get(id);
    if (
      anchors.some(
        (anchor, index) =>
          canCoverAnchor(activity, type, anchor) &&
          (!record ||
            !(type === "Ride" ? numeric(record.values[index]) : positive(record.values[index])) ||
            (type !== "Ride" &&
              numeric(activity.elapsed_time) &&
              record.values[index] > activity.elapsed_time))
      )
    )
      incomplete = true;
  }
  return { axis, records: [...records.values()], incomplete };
}
export function activityCurvePeak(bundle, type, anchor, period) {
  const index =
    type === "Ride"
      ? bundle.axis.indexOf(anchor.duration_seconds)
      : distanceIndex(bundle.axis, anchor.distance_meters, type === "Swim");
  if (index < 0) return emptyHomePeak(anchor);
  let best = emptyHomePeak(anchor);
  for (const record of bundle.records) {
    if (
      record.date < period.start ||
      record.date > period.end ||
      !canCoverAnchor(record.activity, type, anchor)
    )
      continue;
    const raw = record.values[index];
    if (!(type === "Ride" ? numeric(raw) : positive(raw))) continue;
    // A recorded segment cannot be longer than a known whole recording's elapsed time.
    if (
      type !== "Ride" &&
      numeric(record.activity.elapsed_time) &&
      raw > record.activity.elapsed_time
    )
      continue;
    const value = type === "Ride" ? raw : bundle.axis[index] / raw;
    if (!numeric(value) || (best.value !== null && value <= best.value)) continue;
    best = {
      ...anchor,
      value,
      estimated: false,
      source: "calculated-activity-curves",
      activity_id: record.id,
      date: record.date,
      name: record.name,
      ...effortIndices(record, index),
      ...(type === "Ride" ? {} : { distance_meters: bundle.axis[index], elapsed_seconds: raw }),
      ...(type === "Ride" && positive(record.weight) ? { watts_per_kg: raw / record.weight } : {}),
    };
  }
  return best;
}

export async function fetchPersonalActivityRecords(request, today) {
  const ranges = [];
  const currentYear = Number(today.slice(0, 4));
  for (let year = 2000; year <= currentYear; year += 5)
    ranges.push({
      oldest: `${year}-01-01`,
      newest: year + 4 >= currentYear ? today : `${year + 4}-12-31`,
    });
  const fields =
    "id,type,start_date_local,name,sub_type,distance,moving_time,elapsed_time,total_elevation_gain,icu_achievements";
  const records = new Map();
  for (let index = 0; index < ranges.length; index += 3) {
    const batches = await Promise.all(
      ranges
        .slice(index, index + 3)
        .map((range) =>
          request(`/athlete/0/activities?${new URLSearchParams({ ...range, fields })}`)
        )
    );
    for (const rows of batches) {
      if (!Array.isArray(rows) || rows.length > 30_000)
        throw Error("Intervals.icu activity statistics are unavailable.");
      for (const item of rows) {
        const date = day(item?.start_date_local),
          id = item?.id == null ? null : String(item.id);
        try {
          validDate(date);
        } catch {
          continue;
        }
        const duration = positive(item.moving_time) ? item.moving_time : item.elapsed_time;
        if (!id || records.has(id) || date > today || !positive(duration)) continue;
        records.set(id, {
          id,
          date,
          sport: item.type || "Other",
          name: typeof item.name === "string" ? item.name : "",
          subtype: item.sub_type || "",
          distance_meters: numeric(item.distance) ? item.distance : 0,
          duration_seconds: duration,
          elevation_meters: numeric(item.total_elevation_gain) ? item.total_elevation_gain : 0,
          achievements: (Array.isArray(item.icu_achievements) ? item.icu_achievements : [])
            .filter((value) => value && typeof value === "object")
            .map((value) => ({
              type: value.type,
              distance: value.distance,
              secs: value.secs,
              watts: value.watts,
              pace: value.pace,
              value: value.value,
            })),
        });
      }
    }
  }
  return [...records.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Process-local, account-isolated read cache; no database reads, writes or migrations. */
export function createPerformanceHistory({
  request,
  now = Date.now,
  ttl = 30 * 60_000,
  failureTtl = 60_000,
  maxEntries = 256,
} = {}) {
  const entries = new Map();
  let active = 0;
  const find = (key) => {
    const entry = entries.get(key);
    if (entry && (entry.expiresAt === null || entry.expiresAt > now())) return entry;
    entries.delete(key);
    return null;
  };
  const busy = () =>
    Object.assign(Error("Performance history is busy. Please try again shortly."), { status: 429 });
  const reserve = (count) => {
    // Reserve the whole batch synchronously before creating provider promises.
    // Pending readers are never evicted or left with half-registered curves.
    if (count > maxEntries) throw busy();
    while (entries.size + count > maxEntries) {
      const idle = [...entries].find(([, value]) => value.expiresAt !== null);
      if (!idle) throw busy();
      entries.delete(idle[0]);
    }
  };
  const put = (key, entry) => entries.set(key, entry);
  const run = async (fn) => {
    if (active >= 12) throw busy();
    active++;
    try {
      return await fn();
    } finally {
      active--;
    }
  };
  const load = (key, fn, lifetime = () => ttl) => {
    const cached = find(key);
    if (cached) return cached.promise;
    reserve(1);
    const entry = { expiresAt: null, promise: null };
    entry.promise = Promise.resolve()
      .then(() => run(fn))
      .then(
        (value) => {
          entry.expiresAt = now() + lifetime(value);
          return value;
        },
        (error) => {
          entry.expiresAt = now() + failureTtl;
          throw error;
        }
      );
    put(key, entry);
    return entry.promise;
  };
  async function curves(config, type, tokens, today, partial = false) {
    const account = performanceAccount(config),
      prefix = `${account}:${today}:${type}:curve:`;
    const unique = [...new Set(tokens)];
    const selected = new Map(unique.map((token) => [token, find(prefix + token)]));
    const missing = unique.filter((token) => !selected.get(token));
    if (missing.length) {
      reserve(missing.length);
      const query = new URLSearchParams({
        type,
        curves: missing.join(","),
        newest: `${today}T23:59:59`,
        now: today,
        includeRanks: "false",
        subMaxEfforts: "0",
        ...(type === "Ride" ? {} : { gap: "false" }),
      });
      const endpoint = type === "Ride" ? "power-curves" : "pace-curves";
      const batch = Promise.resolve().then(() =>
        run(() => request(config)(`/athlete/0/${endpoint}?${query}`))
      );
      for (const token of missing) {
        const entry = { expiresAt: null, promise: null };
        entry.promise = batch
          .then((value) => curveFor(value, token))
          .then(
            (value) => {
              entry.expiresAt = now() + ttl;
              return value;
            },
            (error) => {
              entry.expiresAt = now() + failureTtl;
              throw error;
            }
          );
        put(prefix + token, entry);
        selected.set(token, entry);
      }
    }
    const tasks = unique.map(async (token) => [token, await selected.get(token).promise]);
    if (partial) {
      const results = await Promise.allSettled(tasks);
      return {
        bundles: new Map(
          results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
        ),
        failed: results.some((result) => result.status === "rejected"),
      };
    }
    return new Map(await Promise.all(tasks));
  }
  return {
    clear() {
      entries.clear();
    },
    async effort(
      config,
      id,
      { type, duration_seconds, distance_meters, revision = "", loadBundle } = {}
    ) {
      performanceActivityId(id);
      const anchor = performanceEffortSelection(type, duration_seconds, distance_meters);
      if (typeof revision !== "string" || revision.length > 256)
        throw Object.assign(Error("Choose a valid recording revision."), { status: 400 });
      const unavailable = (reason) => ({
        available: false,
        activity_id: id,
        ...anchor,
        value: null,
        elapsed_seconds: null,
        start_index: null,
        end_index: null,
        start_seconds: null,
        end_seconds: null,
        chart_start_seconds: null,
        chart_end_seconds: null,
        source: "intervals-activity-curve",
        reason,
      });
      if (!config.INTERVALS_API_KEY)
        return unavailable("Connect Intervals.icu to view recorded efforts.");
      if (typeof loadBundle !== "function") throw Error("Recorded effort loading is unavailable.");
      const prefix = `${performanceAccount(config)}:${id}:${type}:effort:${revision}`;
      try {
        return structuredClone(
          await load(
            `${prefix}:${JSON.stringify(anchor)}`,
            async () => {
              const [curve, bundle] = await Promise.all([
                load(
                  `${prefix}:curve`,
                  async () => {
                    const payload = await request(config)(
                      `/activity/${id}/${type === "Ride" ? "power-curve.json" : "pace-curve.json?gap=false"}`
                    );
                    const axis = type === "Ride" ? payload?.secs : payload?.distance;
                    validateActivityCurves(
                      { [type === "Ride" ? "secs" : "distances"]: axis, curves: [] },
                      type
                    );
                    const values = payload?.values || payload?.watts;
                    if (
                      !Array.isArray(values) ||
                      values.length !== axis.length ||
                      (payload.id != null &&
                        /^i?\d+$/.test(String(payload.id)) &&
                        String(payload.id) !== id) ||
                      (Array.isArray(payload.activity_id) &&
                        payload.activity_id.some((value) => value != null && value !== id))
                    )
                      throw Error("Recorded effort curve is unavailable.");
                    return payload;
                  },
                  (value) => {
                    const axis = type === "Ride" ? value.secs : value.distance;
                    return axis.every(
                      (_, index) => effortIndices(value, index).start_index !== undefined
                    )
                      ? ttl
                      : failureTtl;
                  }
                ),
                Promise.resolve().then(() => loadBundle()),
              ]);
              const activity = bundle?.activity;
              if (String(activity?.id) !== id || !sportMatches(activity?.type, type))
                return unavailable("The recorded activity does not match this effort.");
              if (ignoredForPeaks(activity, type))
                return unavailable(
                  "This activity's power or pace recording is excluded by its provider settings."
                );
              if (!canCoverAnchor(activity, type, anchor))
                return unavailable("The recording cannot contain this effort.");
              const axis = type === "Ride" ? curve.secs : curve.distance;
              const peak = curvePeak(
                {
                  curve: { ...curve, activity_id: axis.map(() => id) },
                  activities: { [id]: activity },
                },
                type,
                anchor,
                { nominal: type === "Swim" }
              );
              if (
                peak.value === null ||
                peak.start_index === undefined ||
                peak.end_index === undefined
              )
                return unavailable(
                  "Intervals.icu did not provide exact recorded positions for this effort."
                );
              if (
                type !== "Ride" &&
                numeric(activity.elapsed_time) &&
                peak.elapsed_seconds > activity.elapsed_time
              )
                return unavailable("The recorded effort exceeds the activity's elapsed time.");
              const bounds = recordedEffortBounds(
                activity,
                bundle.streams,
                peak.start_index,
                peak.end_index
              );
              if (!bounds)
                return unavailable("Exact recording timestamps are unavailable for this effort.");
              return {
                available: true,
                ...peak,
                elapsed_seconds: type === "Ride" ? anchor.duration_seconds : peak.elapsed_seconds,
                ...bounds,
                source: "intervals-activity-curve",
              };
            },
            (value) => (value.available ? ttl : failureTtl)
          )
        );
      } catch (error) {
        throw Object.assign(
          Error("The exact recorded effort is unavailable. Please try again shortly."),
          { status: error.status === 429 ? 429 : 503 }
        );
      }
    },
    async history(config, type, { timeZone = "America/Chicago" } = {}) {
      performanceType(type);
      const instant = new Date(now()),
        today = athleteLocalDate(instant, timeZone),
        periods = performancePeriods(today, 24),
        anchors = performanceAnchors(type);
      if (!config.INTERVALS_API_KEY)
        return { configured: false, asOf: today, type, anchors, weeks: [], months: [] };
      const account = performanceAccount(config),
        oldest = periods.months.at(-1).start;
      const fields =
        "id,type,start_date_local,name,moving_time,elapsed_time,distance,icu_training_load,icu_joules,icu_ignore_power,ignore_pace";
      const [activities, aggregate] = await Promise.all([
        load(`${account}:${today}:history-activities`, async () => {
          const value = await request(config)(
            `/athlete/0/activities?${new URLSearchParams({ oldest, newest: today, fields, limit: "10000" })}`
          );
          if (!Array.isArray(value))
            throw Error("Intervals.icu performance totals are unavailable.");
          return value.slice(0, 10000);
        }),
        curves(
          config,
          type,
          [...periods.weeks, ...periods.months].map((period) => period.token).concat("all"),
          today,
          true
        ).catch((error) => {
          if (error.status === 429) throw error;
          return { bundles: new Map(), failed: true };
        }),
      ]);
      const { bundles } = aggregate;
      const inventory = new Map();
      for (const activity of activities)
        if (activity?.id && !inventory.has(String(activity.id)))
          inventory.set(String(activity.id), activity);
      const row = ({ token, ...period }) => ({
        ...period,
        ...performanceTotals(
          activities,
          type,
          period.start,
          period.end,
          activities.length >= 10000
        ),
        peaks: anchors.map((anchor) =>
          homeCurvePeak(bundles.get(token), type, anchor, period, inventory)
        ),
      });
      const weeks = periods.weeks.map(row),
        months = periods.months.map(row),
        rows = [...weeks, ...months];
      const missing = anchors.filter((anchor, index) =>
        rows.some(
          (period) =>
            (period.peaks[index].value === null || missingActivityId(period.peaks[index])) &&
            eligibleMissingPeak(activities, type, anchor, period)
        )
      );
      let peaksError = aggregate.failed
        ? "Some Intervals.icu period curves were unavailable; recorded activity curves were checked where possible."
        : null;
      let bulkIncomplete = false;
      if (missing.length) {
        const query = new URLSearchParams({
          oldest: `${oldest}T00:00:00`,
          newest: `${today}T23:59:59`,
          type,
          ...(type === "Ride"
            ? { secs: missing.map((anchor) => anchor.duration_seconds).join(",") }
            : {
                distances: missing.map((anchor) => anchor.distance_meters).join(","),
                gap: "false",
              }),
        });
        const endpoint = type === "Ride" ? "activity-power-curves" : "activity-pace-curves";
        try {
          const payload = await load(
            `${account}:${today}:${type}:activity-curves:${query}`,
            async () =>
              validateActivityCurves(await request(config)(`/athlete/0/${endpoint}?${query}`), type)
          );
          // Membership is checked against the current cached inventory even when
          // a previous bulk result still has a few seconds of cache lifetime.
          const measured = normalizeActivityCurves(payload, type, activities, {
            start: oldest,
            end: today,
          });
          bulkIncomplete = measured.incomplete;
          if (bulkIncomplete)
            peaksError =
              "Some recorded activity curves were incomplete. Available measured peaks remain visible.";
          for (const period of rows)
            period.peaks = period.peaks.map((peak, index) => {
              if (
                (peak.value !== null && !missingActivityId(peak)) ||
                !eligibleMissingPeak(activities, type, anchors[index], period)
              )
                return peak;
              const candidate = activityCurvePeak(measured, type, anchors[index], period);
              if (peak.value === null) return candidate;
              // Attribute an authoritative aggregate only to an identical real
              // effort. A nearby value or a different native distance is not proof.
              if (
                candidate.value !== peak.value ||
                (type !== "Ride" && candidate.distance_meters !== peak.distance_meters)
              )
                return peak;
              return {
                ...peak,
                activity_id: candidate.activity_id,
                date: candidate.date,
                name: candidate.name,
                start_index: candidate.start_index ?? null,
                end_index: candidate.end_index ?? null,
              };
            });
        } catch {
          peaksError =
            "Some recorded power or pace peaks are unavailable. Available period curves and activity totals remain visible.";
        }
      }
      const inventoryIncomplete =
        activities.length >= 10000 ||
        activities.some((activity) => {
          if (!activity?.id || !activity.type) return true;
          try {
            validDate(day(activity.start_date_local));
            return false;
          } catch {
            return true;
          }
        });
      if (inventoryIncomplete && !peaksError)
        peaksError =
          "Some recorded activities were unavailable. Calculated peaks may cover only available recordings.";
      if (
        !peaksError &&
        rows.some((period) =>
          period.peaks.some((peak) => peak.value !== null && missingActivityId(peak))
        )
      )
        peaksError =
          "Some measured peaks do not identify their source activity. Exact matching recordings were checked where available.";
      const partial =
        inventoryIncomplete ||
        bulkIncomplete ||
        rows.some((period) =>
          period.peaks.some(
            (peak, index) =>
              peak.value === null && eligibleMissingPeak(activities, type, anchors[index], period)
          )
        );
      return structuredClone({
        configured: true,
        asOf: today,
        type,
        anchors,
        weeks,
        months: months.slice(0, 12),
        comparisonMonths: months.slice(12),
        peakCoverage: partial ? "partial" : "complete",
        ...(peaksError ? { peaksError } : {}),
        source: "intervals",
        synced_at: instant.toISOString(),
      });
    },
    async personal(config, { oldest, newest, timeZone = "America/Chicago" } = {}) {
      const instant = new Date(now()),
        today = athleteLocalDate(instant, timeZone),
        window = performanceWindow(oldest, newest, today),
        account = performanceAccount(config);
      const recordsTask = load(`${account}:${today}:personal-records`, () =>
        fetchPersonalActivityRecords(request(config), today)
      );
      const tasks = ["Ride", "Run", "Swim"].map(async (type) =>
        curveBestEfforts(
          (await curves(config, type, [window.token], today)).get(window.token),
          type
        )
      );
      const [records, settled] = await Promise.all([recordsTask, Promise.allSettled(tasks)]);
      const bestEfforts = settled.flatMap((value) =>
        value.status === "fulfilled" ? value.value : []
      );
      const failed = settled.some((value) => value.status === "rejected");
      return structuredClone({
        records,
        today,
        bestEfforts,
        bestEffortsWindow: { oldest: window.oldest, newest: window.newest },
        ...(failed
          ? {
              bestEffortsError:
                "Some Intervals.icu power or pace best efforts are unavailable. Activity statistics remain available.",
            }
          : {}),
        source: "intervals",
        synced_at: instant.toISOString(),
      });
    },
  };
}
