import { createHash } from "node:crypto";
import { athleteLocalDate } from "./athlete-date.mjs";
import { validDate } from "./intervals.mjs";
import { performanceAccount } from "./performance-curves.mjs";
import {
  cadenceCurveSelection,
  cadenceNativeSports,
  cadenceSourceMatches,
} from "./cadence-curve-model.mjs";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const numeric = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const nativeId = (value) => typeof value === "string" && /^i?[1-9]\d{0,29}$/.test(value);
const day = (value) => {
  try {
    return typeof value === "string" ? validDate(value.slice(0, 10)) : null;
  } catch {
    return null;
  }
};
const fail = (
  message = "Recorded cadence could not be verified. Please retry.",
  status = 502,
  code = "CADENCE_CURVE_UNAVAILABLE"
) => {
  throw Object.assign(Error(message), { status, code });
};
export function cadenceInventory(rows, selection) {
  if (!Array.isArray(rows) || rows.length > 10000) fail();
  const records = new Map(),
    conflicts = new Set();
  let partial = rows.length === 10000,
    excludedWithoutCadence = 0;
  for (const row of rows) {
    const id = typeof row?.id === "number" ? String(row.id) : row?.id,
      date = day(row?.start_date_local);
    if (!object(row) || !nativeId(id) || !date || !cadenceNativeSports.includes(row.type)) {
      partial = true;
      continue;
    }
    if (date < selection.start || date > selection.end) {
      partial = true;
      continue;
    }
    if (
      selection.nativeTypes.length &&
      !selection.nativeTypes.some((type) => cadenceSourceMatches(row.type, type))
    )
      continue;
    if (
      row.stream_types != null &&
      (!Array.isArray(row.stream_types) ||
        row.stream_types.some((type) => typeof type !== "string"))
    ) {
      partial = true;
      continue;
    }
    const value = {
      id,
      type: row.type,
      date,
      name: typeof row.name === "string" ? row.name.slice(0, 512) : null,
      duration: numeric(row.elapsed_time)
        ? row.elapsed_time
        : numeric(row.moving_time)
          ? row.moving_time
          : null,
      hasCadence: Array.isArray(row.stream_types) ? row.stream_types.includes("cadence") : null,
      revision: typeof row.icu_sync_date === "string" ? row.icu_sync_date : null,
    };
    if (records.has(id) && JSON.stringify(records.get(id)) !== JSON.stringify(value)) {
      conflicts.add(id);
      partial = true;
    } else records.set(id, value);
  }
  for (const id of conflicts) records.delete(id);
  const eligible = [];
  for (const row of records.values()) {
    if (row.hasCadence === false) excludedWithoutCadence++;
    else eligible.push(row);
  }
  eligible.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { records, eligible, partial, excludedWithoutCadence };
}
export function projectCadenceActivityCurve(payload, record) {
  if (!Array.isArray(payload) || payload.length > 16) fail();
  if (!payload.length) return { missing: true, points: [], partial: false };
  const candidates = payload.filter(
    (curve) =>
      object(curve) &&
      curve.stream_type === "cadence" &&
      (curve.after_kj == null || curve.after_kj === 0)
  );
  if (candidates.length !== 1) fail();
  const curve = candidates[0],
    axis = curve.secs,
    values = curve.values;
  if (
    !Array.isArray(axis) ||
    axis.length > 10000 ||
    !Array.isArray(values) ||
    values.length !== axis.length ||
    axis.some(
      (seconds, index) =>
        !Number.isSafeInteger(seconds) || seconds < 1 || (index > 0 && seconds <= axis[index - 1])
    ) ||
    (curve.start_date_local != null && day(curve.start_date_local) !== record.date) ||
    (curve.end_date_local != null && day(curve.end_date_local) !== record.date)
  )
    fail();
  for (const key of ["activity_id", "start_index", "end_index", "watts"])
    if (curve[key] != null && (!Array.isArray(curve[key]) || curve[key].length !== axis.length))
      fail();
  if (curve.watts != null && curve.watts.some((value, index) => !Object.is(value, values[index])))
    fail();
  let partial = false;
  const points = axis.map((seconds, index) => {
    const known =
      numeric(values[index]) &&
      (record.duration === null || record.duration >= seconds) &&
      (curve.activity_id?.[index] == null || String(curve.activity_id[index]) === record.id);
    if (!known) partial = true;
    const point = {
      duration_seconds: seconds,
      value: known ? values[index] : null,
      activity_id: record.id,
      native_type: record.type,
      date: record.date,
      name: record.name,
      estimated: false,
    };
    if (known && curve.start_index != null && curve.end_index != null) {
      const start = curve.start_index[index],
        end = curve.end_index[index];
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start) {
        point.start_index = start;
        point.end_index = end;
      } else partial = true;
    } else if ((curve.start_index != null) !== (curve.end_index != null)) partial = true;
    return point;
  });
  return { points, missing: axis.length === 0, partial };
}
function subscriber(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export function createCadenceCurveService({
  request,
  now = Date.now,
  ttl = 30 * 60_000,
  failureTtl = 60_000,
  maxEntries = 64,
  maxRecordings = 128,
  maxSourceEntries = 512,
} = {}) {
  if (!Number.isSafeInteger(maxRecordings) || maxRecordings < 1 || maxRecordings > 128)
    throw Error("Choose a bounded cadence recording cap.");
  const cache = new Map(),
    sources = new Map();
  let active = 0;
  const cachedRead = (map, key, fn, lifetime = () => ttl) => {
    const found = map.get(key);
    if (found && (found.expires === null || found.expires > now())) return found.promise;
    if (found) map.delete(key);
    const limit = map === cache ? maxEntries : maxSourceEntries;
    if (map.size >= limit) {
      const idle = [...map].find(([, entry]) => entry.expires !== null);
      if (!idle) fail("Recorded cadence is busy. Try again shortly.", 429, "CADENCE_CURVE_BUSY");
      map.delete(idle[0]);
    }
    const entry = { expires: null, promise: null };
    entry.promise = Promise.resolve()
      .then(fn)
      .then(
        (value) => {
          entry.expires = now() + lifetime(value);
          return value;
        },
        (error) => {
          entry.expires = now() + failureTtl;
          throw error;
        }
      );
    map.set(key, entry);
    return entry.promise;
  };
  return {
    clear() {
      cache.clear();
      sources.clear();
    },
    async load(config, input, { actor, timeZone = "America/Chicago", signal } = {}) {
      if (
        !object(actor) ||
        typeof actor.id !== "string" ||
        !actor.id ||
        typeof actor.origin !== "string"
      )
        fail("Sign in to load recorded cadence.", 401, "CADENCE_CURVE_AUTH");
      const today = athleteLocalDate(new Date(now()), timeZone),
        selection = cadenceCurveSelection(input, today);
      if (!config.INTERVALS_API_KEY) fail("Connect Intervals.icu to load recorded cadence.", 503);
      if (signal?.aborted) throw signal.reason;
      const account = createHash("sha256")
          .update(JSON.stringify([performanceAccount(config), actor.id, actor.origin]))
          .digest("hex"),
        key = JSON.stringify([account, today, selection]);
      const promise = cachedRead(
        cache,
        key,
        async () => {
          if (active >= 4)
            fail("Recorded cadence is busy. Try again shortly.", 429, "CADENCE_CURVE_BUSY");
          active++;
          try {
            const client = request(config),
              deadline = AbortSignal.timeout(60_000),
              fields =
                "id,type,start_date_local,name,moving_time,elapsed_time,stream_types,icu_sync_date",
              inventory = cadenceInventory(
                await client(
                  `/athlete/0/activities?${new URLSearchParams({ oldest: selection.start, newest: selection.end, fields, limit: "10000" })}`,
                  { signal: deadline }
                ),
                selection
              ),
              chosen = inventory.eligible.slice(0, maxRecordings),
              results = [];
            for (let index = 0; index < chosen.length; index += 4) {
              results.push(
                ...(await Promise.all(
                  chosen.slice(index, index + 4).map(async (record) => {
                    try {
                      const sourceKey = JSON.stringify([account, record]),
                        projected = await cachedRead(
                          sources,
                          sourceKey,
                          async () =>
                            projectCadenceActivityCurve(
                              await client(
                                `/activity/${record.id}/power-curves.json?types=cadence&fatigue=normal`,
                                { signal: deadline }
                              ),
                              record
                            ),
                          (value) => (value.partial || value.missing ? failureTtl : ttl)
                        );
                      return { record, ...structuredClone(projected) };
                    } catch {
                      return { record, failed: true, points: [], partial: true };
                    }
                  })
                ))
              );
            }
            if (chosen.length && results.every((result) => result.failed)) fail();
            const map = new Map();
            for (const result of results)
              for (const point of result.points) {
                if (!map.has(point.duration_seconds) && map.size >= 10000) fail();
                const previous = map.get(point.duration_seconds);
                if (
                  !previous ||
                  (point.value !== null &&
                    (previous.value === null || point.value > previous.value))
                )
                  map.set(point.duration_seconds, point);
              }
            const points = [...map.values()].sort(
                (a, b) => a.duration_seconds - b.duration_seconds
              ),
              unknownPoints = points.filter((point) => point.value === null).length,
              failedRecordings = results.filter((row) => row.failed).length,
              missingRecordings = results.filter((row) => row.missing).length,
              skippedForCap = Math.max(0, inventory.eligible.length - chosen.length),
              partial =
                inventory.partial ||
                skippedForCap > 0 ||
                failedRecordings > 0 ||
                missingRecordings > 0 ||
                unknownPoints > 0 ||
                results.some((row) => row.partial);
            return {
              version: 1,
              kind: "cadence",
              unit: "rpm",
              source: "intervals-activity-cadence-curves",
              unitPolicy: "native-rpm",
              tagsSupported: false,
              selection: { sport: selection.sport, nativeTypes: selection.nativeTypes },
              window: { oldest: selection.start, newest: selection.end },
              points,
              coverage: {
                status: partial ? "partial" : "available-recordings",
                inventoryRecords: inventory.records.size,
                eligibleRecordings: inventory.eligible.length,
                fetchedRecordings: chosen.length,
                failedRecordings,
                missingRecordings,
                skippedForCap,
                excludedWithoutCadence: inventory.excludedWithoutCadence,
                unknownPoints,
              },
              warning: cadenceCurveWarning(
                partial,
                { skippedForCap, failedRecordings, missingRecordings, unknownPoints },
                maxRecordings
              ),
            };
          } catch (error) {
            if (error?.code?.startsWith("CADENCE_")) throw error;
            fail();
          } finally {
            active--;
          }
        },
        (value) => (value.coverage.status === "partial" ? failureTtl : ttl)
      );
      return structuredClone(await subscriber(promise, signal));
    },
  };
}

export function cadenceCurveWarning(partial, counts = {}, maxRecordings = 128) {
  const base =
    "Cadence is shown as recorded RPM; running values are not doubled into steps per minute.";
  if (!partial) return base;
  const noun = (value, text) => value + " " + text + (value === 1 ? "" : "s");
  const details = [
    [
      "skippedForCap",
      (value) => noun(value, "recording") + " omitted by the " + maxRecordings + "-recording limit",
    ],
    ["failedRecordings", (value) => noun(value, "recording") + " could not load"],
    [
      "missingRecordings",
      (value) => noun(value, "recording") + (value === 1 ? " has no curve" : " have no curve"),
    ],
    ["unknownPoints", (value) => noun(value, "duration sample") + " unavailable"],
    [
      "unknownMembershipRecordings",
      (value) => noun(value, "recording tag membership") + " unavailable",
    ],
    ["unknownLengthRecordings", (value) => noun(value, "recording length") + " unavailable"],
    ["unknownStreamRecordings", (value) => noun(value, "recording stream list") + " unavailable"],
    ["invalidInventoryRecords", (value) => noun(value, "invalid recording row") + " excluded"],
    [
      "conflictingRecordings",
      (value) =>
        value +
        (value === 1
          ? " conflicting recording identity excluded"
          : " conflicting recording identities excluded"),
    ],
  ].flatMap(([key, label]) => (counts[key] > 0 ? [label(counts[key])] : []));
  const note =
    "Partial coverage: " +
    (details.join("; ") || "some recording details are unavailable") +
    ". Try a smaller date range or refresh later.";
  return base ? base + " " + note : note;
}
