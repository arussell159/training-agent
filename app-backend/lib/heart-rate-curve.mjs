import { createHash } from "node:crypto";
import { athleteLocalDate } from "./athlete-date.mjs";
import { validDate } from "./intervals.mjs";
import { performanceAccount } from "./performance-curves.mjs";
import {
  heartRateCurveSelection,
  heartRateNativeSports,
  heartRateSportMatches,
} from "./heart-rate-curve-model.mjs";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const numeric = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const id = (value) => typeof value === "string" && /^i?[1-9]\d{0,29}$/.test(value);
const day = (value) => {
  try {
    return typeof value === "string" ? validDate(value.slice(0, 10)) : null;
  } catch {
    return null;
  }
};
const fail = (
  message = "Recorded heart-rate history could not be verified. Please retry.",
  status = 502,
  code = "HR_CURVE_UNAVAILABLE"
) => {
  throw Object.assign(Error(message), { status, code });
};
export function heartRateInventory(rows, selection) {
  if (!Array.isArray(rows) || rows.length > 10000) fail();
  const records = new Map(),
    conflicts = new Set();
  let partial = rows.length === 10000;
  for (const row of rows) {
    const sourceId = typeof row?.id === "number" ? String(row.id) : row?.id,
      date = day(row?.start_date_local);
    if (!object(row) || !id(sourceId) || !date || !heartRateNativeSports.includes(row.type)) {
      partial = true;
      continue;
    }
    if (date < selection.start || date > selection.end) {
      partial = true;
      continue;
    }
    const value = {
      id: sourceId,
      type: row.type,
      date,
      name: typeof row.name === "string" ? row.name.slice(0, 512) : null,
      ignored: row.icu_ignore_hr === true,
      duration: numeric(row.elapsed_time)
        ? row.elapsed_time
        : numeric(row.moving_time)
          ? row.moving_time
          : null,
    };
    if (records.has(sourceId) && JSON.stringify(records.get(sourceId)) !== JSON.stringify(value)) {
      conflicts.add(sourceId);
      partial = true;
    } else records.set(sourceId, value);
  }
  for (const conflict of conflicts) records.delete(conflict);
  return { records, partial };
}
export function projectHeartRateCurve(payload, selection, inventory, selected = "all") {
  if (
    !object(payload) ||
    !Array.isArray(payload.list) ||
    payload.list.length > 100 ||
    !object(payload.activities)
  )
    fail();
  const token = `r.${selection.start}.${selection.end}`,
    matches = payload.list.filter((curve) => curve?.id === token);
  if (matches.length > 1) fail();
  if (!matches.length) {
    if (payload.list.length) fail();
    return [];
  }
  const curve = matches[0],
    axis = curve.secs,
    values = curve.values;
  if (
    (curve.start_date_local != null && day(curve.start_date_local) !== selection.start) ||
    (curve.end_date_local != null && day(curve.end_date_local) !== selection.end) ||
    !Array.isArray(axis) ||
    axis.length > 10000 ||
    !Array.isArray(values) ||
    values.length !== axis.length ||
    axis.some(
      (seconds, index) =>
        !Number.isSafeInteger(seconds) || seconds < 1 || (index > 0 && seconds <= axis[index - 1])
    )
  )
    fail();
  for (const key of ["activity_id", "start_index", "end_index"])
    if (curve[key] != null && (!Array.isArray(curve[key]) || curve[key].length !== axis.length))
      fail();
  return axis.map((seconds, index) => {
    const sourceId = curve.activity_id?.[index],
      record = id(sourceId) ? inventory.records.get(sourceId) : null,
      compact =
        id(sourceId) && Object.hasOwn(payload.activities, sourceId)
          ? payload.activities[sourceId]
          : null;
    const compactValid =
      compact == null ||
      (object(compact) &&
        (compact.id == null || String(compact.id) === sourceId) &&
        (compact.start_date_local == null || day(compact.start_date_local) === record?.date) &&
        (compact.type == null || compact.type === record?.type) &&
        compact.icu_ignore_hr !== true);
    const known =
      record &&
      !record.ignored &&
      heartRateSportMatches(record.type, selected) &&
      compactValid &&
      (record.duration === null || record.duration >= seconds) &&
      numeric(values[index]);
    const point = {
      duration_seconds: seconds,
      value: known ? values[index] : null,
      activity_id: id(sourceId) ? sourceId : null,
      native_type: record?.type || null,
      date: record?.date || null,
      name: record?.name || null,
      estimated: false,
    };
    if (known && curve.start_index != null && curve.end_index != null) {
      const start = curve.start_index[index],
        end = curve.end_index[index];
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start) {
        point.start_index = start;
        point.end_index = end;
      }
    }
    return point;
  });
}

function wait(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export function createHeartRateCurveService({
  request,
  now = Date.now,
  ttl = 30 * 60_000,
  failureTtl = 60_000,
  maxEntries = 64,
} = {}) {
  const cache = new Map();
  let active = 0;
  return {
    clear() {
      cache.clear();
    },
    async load(config, input, { actor, timeZone = "America/Chicago", signal } = {}) {
      if (
        !object(actor) ||
        typeof actor.id !== "string" ||
        !actor.id ||
        typeof actor.origin !== "string"
      )
        fail("Sign in to load recorded heart-rate history.", 401, "HR_CURVE_AUTH");
      const today = athleteLocalDate(new Date(now()), timeZone),
        selection = heartRateCurveSelection(input, today);
      if (!config.INTERVALS_API_KEY)
        fail("Connect Intervals.icu to load recorded heart-rate history.", 503);
      if (signal?.aborted) throw signal.reason;
      const key = createHash("sha256")
          .update(
            JSON.stringify([performanceAccount(config), actor.id, actor.origin, selection, today])
          )
          .digest("hex"),
        cached = cache.get(key);
      if (cached && (cached.expires === null || cached.expires > now()))
        return structuredClone(await wait(cached.promise, signal));
      if (cached) cache.delete(key);
      if (cache.size >= maxEntries) {
        const idle = [...cache].find(([, entry]) => entry.expires !== null);
        if (!idle)
          fail("Recorded heart-rate history is busy. Try again shortly.", 429, "HR_CURVE_BUSY");
        cache.delete(idle[0]);
      }
      if (active >= 4)
        fail("Recorded heart-rate history is busy. Try again shortly.", 429, "HR_CURVE_BUSY");
      const entry = { expires: null, promise: null };
      active++;
      entry.promise = Promise.resolve()
        .then(async () => {
          const client = request(config),
            deadline = AbortSignal.timeout(60_000),
            fields = "id,type,start_date_local,name,moving_time,elapsed_time,icu_ignore_hr",
            inventory = heartRateInventory(
              await client(
                `/athlete/0/activities?${new URLSearchParams({ oldest: selection.start, newest: selection.end, fields, limit: "10000" })}`,
                { signal: deadline }
              ),
              selection
            ),
            types = selection.nativeTypes.length ? selection.nativeTypes : ["all"],
            results = [];
          for (let i = 0; i < types.length; i += 4) {
            results.push(
              ...(await Promise.all(
                types.slice(i, i + 4).map(async (type) => {
                  const query = new URLSearchParams({
                    curves: `r.${selection.start}.${selection.end}`,
                    newest: `${selection.end}T23:59:59`,
                    now: today,
                    subMaxEfforts: "0",
                    ...(type === "all" ? {} : { type }),
                  });
                  try {
                    return {
                      type,
                      points: projectHeartRateCurve(
                        await client(`/athlete/0/hr-curves.json?${query}`, { signal: deadline }),
                        selection,
                        inventory,
                        type
                      ),
                    };
                  } catch {
                    return { type, failed: true, points: [] };
                  }
                })
              ))
            );
          }
          if (results.every((result) => result.failed)) fail();
          const byDuration = new Map();
          for (const result of results)
            for (const point of result.points) {
              const previous = byDuration.get(point.duration_seconds);
              if (
                !previous ||
                (point.value !== null && (previous.value === null || point.value > previous.value))
              )
                byDuration.set(point.duration_seconds, point);
            }
          const points = [...byDuration.values()].sort(
              (a, b) => a.duration_seconds - b.duration_seconds
            ),
            unknownPoints = points.filter((point) => point.value === null).length,
            failedSelections = results
              .filter((result) => result.failed)
              .map((result) => result.type),
            partial =
              inventory.partial ||
              unknownPoints > 0 ||
              failedSelections.length > 0 ||
              results.some((result) => result.points.some((point) => point.value === null));
          return {
            version: 1,
            kind: "heartRate",
            unit: "bpm",
            source: "intervals-hr-curve",
            selection: { sport: selection.sport, nativeTypes: selection.nativeTypes },
            window: { oldest: selection.start, newest: selection.end },
            points,
            coverage: {
              status: partial ? "partial" : "native-aggregate",
              inventoryRecords: inventory.records.size,
              verifiedPoints: points.length - unknownPoints,
              unknownPoints,
              failedSelections,
            },
            warning: heartRateCurveWarning(partial, { unknownPoints, failedSelections }),
          };
        })
        .catch((error) => {
          if (error?.code?.startsWith("HR_CURVE_")) throw error;
          fail();
        })
        .then(
          (value) => {
            entry.expires = now() + ttl;
            return value;
          },
          (error) => {
            entry.expires = now() + failureTtl;
            throw error;
          }
        )
        .finally(() => {
          active--;
        });
      cache.set(key, entry);
      return structuredClone(await wait(entry.promise, signal));
    },
  };
}

export function heartRateCurveWarning(partial, counts = {}) {
  if (!partial) return "";
  const details = [];
  if (counts.unknownPoints > 0)
    details.push(
      counts.unknownPoints +
        (counts.unknownPoints === 1
          ? " duration sample unavailable"
          : " duration samples unavailable")
    );
  const failed = Array.isArray(counts.failedSelections) ? counts.failedSelections.length : 0;
  if (failed)
    details.push(
      failed + (failed === 1 ? " selected sport could not load" : " selected sports could not load")
    );
  return (
    "Partial coverage: " +
    (details.join("; ") || "some recording details are unavailable") +
    ". Try a smaller date range or refresh later."
  );
}
