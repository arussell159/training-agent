import { createHash } from "node:crypto";
import { athleteLocalDate } from "./athlete-date.mjs";
import { validDate } from "./intervals.mjs";
import { performanceAccount } from "./performance-curves.mjs";
import {
  nativePowerCurveSelection,
  nativePowerSports,
  nativePowerSourceMatches,
} from "./native-power-curve-model.mjs";
import { projectTaggedActivityCurve } from "./tagged-activity-curves.mjs";
import { createChartReadCache, chartReadSubscriber } from "./chart-read-cache.mjs";
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
  message = "Recorded native power could not be verified. Please retry.",
  status = 502,
  code = "NATIVE_POWER_UNAVAILABLE"
) => {
  throw Object.assign(Error(message), { status, code });
};
const RESOURCE_LIMIT = Symbol("native-power-resource-limit"),
  limit = (message) => {
    throw Object.assign(Error(message), {
      status: 502,
      code: "NATIVE_POWER_UNAVAILABLE",
      [RESOURCE_LIMIT]: true,
    });
  };
const busy = () =>
  Object.assign(Error("Recorded native power is busy. Retry shortly."), {
    status: 429,
    code: "NATIVE_POWER_BUSY",
  });

export function nativePowerInventory(rows, selection) {
  if (!Array.isArray(rows) || rows.length > 10000) fail();
  const records = new Map(),
    conflicts = new Set();
  let invalidInventoryRecords = 0,
    partial = rows.length === 10000;
  for (const row of rows) {
    const id = typeof row?.id === "number" ? String(row.id) : row?.id,
      date = day(row?.start_date_local);
    if (
      !object(row) ||
      !nativeId(id) ||
      !date ||
      !nativePowerSports.includes(row.type) ||
      date < selection.start ||
      date > selection.end
    ) {
      invalidInventoryRecords++;
      partial = true;
      continue;
    }
    if (
      selection.nativeTypes.length &&
      !selection.nativeTypes.some((type) => nativePowerSourceMatches(row.type, type))
    )
      continue;
    if (
      (row.stream_types != null &&
        (!Array.isArray(row.stream_types) ||
          row.stream_types.some((value) => typeof value !== "string"))) ||
      (row.icu_ignore_power != null && typeof row.icu_ignore_power !== "boolean") ||
      (row.ignore_parts != null &&
        (!Array.isArray(row.ignore_parts) ||
          row.ignore_parts.length > 10000 ||
          row.ignore_parts.some(
            (part) =>
              !object(part) ||
              (part.power != null && typeof part.power !== "boolean") ||
              (part.power === true &&
                (!Number.isSafeInteger(part.start_index) ||
                  !Number.isSafeInteger(part.end_index) ||
                  part.start_index < 0 ||
                  part.end_index <= part.start_index))
          )))
    ) {
      invalidInventoryRecords++;
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
      hasPower: Array.isArray(row.stream_types) ? row.stream_types.includes("watts") : null,
      ignored: row.icu_ignore_power === true,
      ignoredParts: (row.ignore_parts || [])
        .filter((part) => part.power === true)
        .map((part) => ({ start: part.start_index, end: part.end_index })),
      revision: typeof row.icu_sync_date === "string" ? row.icu_sync_date : null,
    };
    if (records.has(id) && JSON.stringify(records.get(id)) !== JSON.stringify(value)) {
      conflicts.add(id);
      partial = true;
    } else records.set(id, value);
  }
  for (const id of conflicts) records.delete(id);
  const eligible = [];
  let excludedWithoutPower = 0,
    excludedIgnoredRecordings = 0,
    unknownLengthRecordings = 0,
    unknownStreamRecordings = 0;
  for (const record of records.values()) {
    if (record.ignored) excludedIgnoredRecordings++;
    else if (record.hasPower === false) excludedWithoutPower++;
    else {
      eligible.push(record);
      if (record.duration === null) unknownLengthRecordings++;
      if (record.hasPower === null) unknownStreamRecordings++;
    }
  }
  eligible.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return {
    eligible,
    records,
    partial: partial || unknownLengthRecordings > 0 || unknownStreamRecordings > 0,
    counts: {
      inventoryRecords: records.size,
      excludedWithoutPower,
      excludedIgnoredRecordings,
      unknownLengthRecordings,
      unknownStreamRecordings,
      invalidInventoryRecords,
      conflictingRecordings: conflicts.size,
    },
  };
}

export function mergeNativePowerPoints(
  results,
  { maxCharacters = 5_000_000, headerCharacters = 0 } = {}
) {
  if (headerCharacters > maxCharacters)
    limit("Recorded power exceeds the safe response size. Choose a smaller date range.");
  const points = new Map(),
    costs = new Map();
  let characters = 0;
  for (const result of results)
    for (const point of result.points) {
      const previous = points.get(point.duration_seconds);
      if (
        previous &&
        (point.value === null || (previous.value !== null && point.value <= previous.value))
      )
        continue;
      if (!previous && points.size >= 10000)
        limit("Recorded power has too many durations. Choose a smaller date range.");
      const cost = JSON.stringify(point).length,
        next =
          characters -
          (costs.get(point.duration_seconds) || 0) +
          cost +
          (!previous && points.size ? 1 : 0);
      if (headerCharacters + next > maxCharacters)
        limit("Recorded power exceeds the safe response size. Choose a smaller date range.");
      points.set(point.duration_seconds, { ...point });
      costs.set(point.duration_seconds, cost);
      characters = next;
    }
  return {
    points: [...points.values()].sort((a, b) => a.duration_seconds - b.duration_seconds),
    characters,
  };
}

export function createNativePowerCurveService({
  request,
  now = Date.now,
  ttl = 30 * 60_000,
  failureTtl = 60_000,
  maxEntries = 64,
  maxSourceEntries = 512,
  maxRecordings = 128,
  maxResponseCharacters = 5_000_000,
  maxProcessedSourcePoints = 100_000,
  maxSourceCachePoints = 100_000,
  maxWindowCacheCharacters = 10_000_000,
} = {}) {
  if (!Number.isSafeInteger(maxRecordings) || maxRecordings < 1 || maxRecordings > 128)
    throw Error("Choose a bounded native power recording cap.");
  for (const value of [
    maxResponseCharacters,
    maxProcessedSourcePoints,
    maxSourceCachePoints,
    maxWindowCacheCharacters,
  ])
    if (!Number.isSafeInteger(value) || value < 1)
      throw Error("Choose positive bounded native power resource limits.");
  const weights = new WeakMap(),
    windows = createChartReadCache({
      now,
      ttl,
      failureTtl,
      maxEntries,
      maxWeight: maxWindowCacheCharacters,
      weight: (value) => weights.get(value) || 0,
      busy,
    }),
    sources = createChartReadCache({
      now,
      ttl,
      failureTtl,
      maxEntries: maxSourceEntries,
      maxWeight: maxSourceCachePoints,
      weight: (value) => value.points.length,
      busy,
    });
  let active = 0;
  return {
    clear() {
      windows.clear();
      sources.clear();
    },
    async load(config, input, { actor, timeZone = "America/Chicago", signal } = {}) {
      if (
        !actor?.id ||
        typeof actor.id !== "string" ||
        !actor.origin ||
        typeof actor.origin !== "string"
      )
        fail("Sign in to load recorded native power.", 401, "NATIVE_POWER_AUTH");
      const today = athleteLocalDate(new Date(now()), timeZone),
        selection = nativePowerCurveSelection(input, today);
      if (!config.INTERVALS_API_KEY)
        fail("Connect Intervals.icu to load recorded native power.", 503);
      if (signal?.aborted) throw signal.reason;
      const account = createHash("sha256")
        .update(JSON.stringify([performanceAccount(config), actor.id, actor.origin]))
        .digest("hex");
      return structuredClone(
        await chartReadSubscriber(
          windows.read(
            JSON.stringify([account, today, selection]),
            async () => {
              if (active >= 4) throw busy();
              active++;
              try {
                const client = request(config),
                  deadline = AbortSignal.timeout(60_000),
                  fields =
                    "id,type,start_date_local,name,moving_time,elapsed_time,stream_types,icu_sync_date,icu_ignore_power,ignore_parts";
                const inventory = nativePowerInventory(
                    await client(
                      `/athlete/0/activities?${new URLSearchParams({ oldest: selection.start, newest: selection.end, fields, limit: "10000" })}`,
                      { signal: deadline }
                    ),
                    selection
                  ),
                  chosen = inventory.eligible.slice(0, maxRecordings),
                  results = [];
                let processed = 0;
                for (let index = 0; index < chosen.length; index += 4) {
                  const batch = await Promise.allSettled(
                    chosen.slice(index, index + 4).map(async (record) => {
                      try {
                        const projected = await sources.read(
                          JSON.stringify([account, record]),
                          async () => {
                            // This pure per-record parser has no tag/catalog or membership dependency.
                            return projectTaggedActivityCurve(
                              await client(`/activity/${record.id}/power-curve.json`, {
                                signal: deadline,
                              }),
                              record,
                              "power"
                            );
                          },
                          (value) => (value.partial || value.missing ? failureTtl : ttl)
                        );
                        if (processed + projected.points.length > maxProcessedSourcePoints)
                          limit(
                            "Recorded power exceeds the safe source-point budget. Choose a smaller date range."
                          );
                        processed += projected.points.length;
                        return { ...projected, record };
                      } catch (error) {
                        if (error?.[RESOURCE_LIMIT]) throw error;
                        return { record, points: [], failed: true, partial: true };
                      }
                    })
                  );
                  const rejected = batch.find((value) => value.status === "rejected");
                  if (rejected) throw rejected.reason;
                  results.push(...batch.map((value) => value.value));
                }
                if (chosen.length && results.every((value) => value.failed)) fail();
                const failedRecordings = results.filter((value) => value.failed).length,
                  missingRecordings = results.filter((value) => value.missing).length,
                  skippedForCap = Math.max(0, inventory.eligible.length - chosen.length),
                  partial =
                    inventory.partial ||
                    failedRecordings > 0 ||
                    missingRecordings > 0 ||
                    skippedForCap > 0 ||
                    results.some((value) => value.partial);
                const output = {
                  version: 1,
                  kind: "power",
                  unit: "W",
                  source: "intervals-activity-power-curves",
                  unitPolicy: "native-watts",
                  valuePolicy: "native-reported",
                  tagsSupported: false,
                  selection: { sport: selection.sport, nativeTypes: selection.nativeTypes },
                  window: { oldest: selection.start, newest: selection.end },
                  points: [],
                  coverage: {
                    status: partial ? "partial" : "available-recordings",
                    ...inventory.counts,
                    eligibleRecordings: inventory.eligible.length,
                    fetchedRecordings: chosen.length,
                    failedRecordings,
                    missingRecordings,
                    skippedForCap,
                    unknownPoints: 0,
                  },
                  warning: nativePowerCurveWarning(
                    partial,
                    { ...inventory.counts, skippedForCap, failedRecordings, missingRecordings },
                    maxRecordings
                  ),
                };
                const headerCharacters = JSON.stringify({
                    ...output,
                    coverage: { ...output.coverage, unknownPoints: 10000 },
                    warning: [
                      output.warning,
                      nativePowerCurveWarning(
                        true,
                        { ...output.coverage, unknownPoints: 10000 },
                        maxRecordings
                      ),
                    ].sort((a, b) => b.length - a.length)[0],
                  }).length,
                  merged = mergeNativePowerPoints(results, {
                    maxCharacters: maxResponseCharacters,
                    headerCharacters,
                  });
                output.points = merged.points;
                output.coverage.unknownPoints = merged.points.filter(
                  (point) => point.value === null
                ).length;
                output.warning = nativePowerCurveWarning(partial, output.coverage, maxRecordings);
                weights.set(
                  output,
                  JSON.stringify({ ...output, points: [] }).length + merged.characters
                );
                return output;
              } catch (error) {
                if (error?.code?.startsWith("NATIVE_POWER_")) throw error;
                fail();
              } finally {
                active--;
              }
            },
            (value) => (value.coverage.status === "partial" ? failureTtl : ttl)
          ),
          signal
        )
      );
    },
  };
}

export function nativePowerCurveWarning(partial, counts = {}, maxRecordings = 128) {
  const base = "";
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
