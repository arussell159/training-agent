import { athleteLocalDate } from "./athlete-date.mjs";
import { validDate } from "./intervals.mjs";
import {
  taggedCurveSelection,
  chartTagKindPolicy,
  chartTagNativeSports,
  chartTagSportMatches,
  validChartTag,
  chartTagError,
} from "./chart-tags-model.mjs";
import { chartTagScope } from "./chart-tags.mjs";
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
const busy = () =>
  Object.assign(Error("Native tagged chart reads are busy. Retry shortly."), {
    status: 429,
    code: "CHART_TAG_BUSY",
  });
const RESOURCE_LIMIT = Symbol("tagged-chart-resource-limit");
const sizeLimit = (message) => {
  throw Object.assign(Error(message), {
    status: 502,
    code: "CHART_TAG_UNAVAILABLE",
    [RESOURCE_LIMIT]: true,
  });
};

export function mergeTaggedCurvePoints(
  results,
  { maxCharacters = 5_000_000, headerCharacters = 0 } = {}
) {
  if (headerCharacters > maxCharacters)
    sizeLimit("The tagged chart exceeds the safe response size. Choose a smaller date range.");
  const pointsBySecond = new Map(),
    costs = new Map();
  let characters = 0;
  for (const result of results) {
    if (!result.points.length) continue;
    const tagCharacters = JSON.stringify(result.record.tags).length;
    for (const point of result.points) {
      const previous = pointsBySecond.get(point.duration_seconds);
      if (
        previous &&
        (point.value === null || (previous.value !== null && point.value <= previous.value))
      )
        continue;
      if (!previous && pointsBySecond.size >= 10000)
        sizeLimit("The tagged chart has too many duration samples. Choose a smaller date range.");
      const pointCharacters =
        JSON.stringify(point).length + ',"sourceTags":'.length + tagCharacters;
      const next =
        characters -
        (costs.get(point.duration_seconds) || 0) +
        pointCharacters +
        (!previous && pointsBySecond.size > 0 ? 1 : 0);
      if (headerCharacters + next > maxCharacters)
        sizeLimit("The tagged chart exceeds the safe response size. Choose a smaller date range.");
      // Admission precedes both the repeated tag array copy and winner allocation.
      pointsBySecond.set(point.duration_seconds, { ...point, sourceTags: [...result.record.tags] });
      costs.set(point.duration_seconds, pointCharacters);
      characters = next;
    }
  }
  return {
    points: [...pointsBySecond.values()].sort((a, b) => a.duration_seconds - b.duration_seconds),
    characters,
  };
}

export function taggedCurveInventory(rows, selection) {
  if (!Array.isArray(rows) || rows.length > 10000) chartTagError();
  const records = new Map(),
    conflicts = new Set(),
    policy = chartTagKindPolicy[selection.kind];
  let invalidInventoryRecords = 0,
    partial = rows.length === 10000;
  for (const row of rows) {
    const id = typeof row?.id === "number" ? String(row.id) : row?.id,
      date = day(row?.start_date_local);
    if (
      !object(row) ||
      !nativeId(id) ||
      !date ||
      !chartTagNativeSports.includes(row.type) ||
      date < selection.start ||
      date > selection.end
    ) {
      invalidInventoryRecords++;
      partial = true;
      continue;
    }
    if (
      selection.nativeTypes.length &&
      !selection.nativeTypes.some((type) => chartTagSportMatches(row.type, type))
    )
      continue;
    const flags = [policy.ignore, ...(selection.kind === "velocity" ? ["ignore_pace"] : [])].filter(
      Boolean
    );
    if (
      (row.stream_types != null &&
        (!Array.isArray(row.stream_types) ||
          row.stream_types.some((type) => typeof type !== "string"))) ||
      flags.some((flag) => row[flag] != null && typeof row[flag] !== "boolean") ||
      (policy.part &&
        row.ignore_parts != null &&
        (!Array.isArray(row.ignore_parts) ||
          row.ignore_parts.length > 10000 ||
          row.ignore_parts.some(
            (part) =>
              !object(part) ||
              (part[policy.part] != null && typeof part[policy.part] !== "boolean") ||
              (part[policy.part] === true &&
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
    const tags =
      Array.isArray(row.tags) &&
      row.tags.length <= 1000 &&
      row.tags.every(validChartTag) &&
      new Set(row.tags).size === row.tags.length
        ? [...row.tags]
        : null;
    const record = {
      id,
      type: row.type,
      date,
      name: typeof row.name === "string" ? row.name.slice(0, 512) : null,
      duration: numeric(row.elapsed_time)
        ? row.elapsed_time
        : numeric(row.moving_time)
          ? row.moving_time
          : null,
      revision: typeof row.icu_sync_date === "string" ? row.icu_sync_date : null,
      tags,
      ignored: flags.some((flag) => row[flag] === true),
      ignoredParts: policy.part
        ? (row.ignore_parts || [])
            .filter((part) => part[policy.part] === true)
            .map((part) => ({ start: part.start_index, end: part.end_index }))
        : [],
      hasStream: Array.isArray(row.stream_types) ? row.stream_types.includes(policy.stream) : null,
    };
    if (records.has(id) && JSON.stringify(records.get(id)) !== JSON.stringify(record)) {
      conflicts.add(id);
      partial = true;
    } else records.set(id, record);
  }
  for (const id of conflicts) records.delete(id);
  const eligible = [];
  let matchedRecordings = 0,
    unmatchedRecordings = 0,
    unknownMembershipRecordings = 0,
    excludedWithoutStream = 0,
    excludedIgnoredRecordings = 0;
  for (const record of records.values()) {
    if (record.tags === null) {
      unknownMembershipRecordings++;
      partial = true;
      continue;
    }
    if (!record.tags.some((tag) => selection.tags.includes(tag))) {
      unmatchedRecordings++;
      continue;
    }
    matchedRecordings++;
    if (record.ignored) excludedIgnoredRecordings++;
    else if (record.hasStream === false) excludedWithoutStream++;
    else eligible.push(record);
  }
  eligible.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return {
    records,
    eligible,
    partial,
    counts: {
      inventoryRecords: records.size,
      matchedRecordings,
      unmatchedRecordings,
      unknownMembershipRecordings,
      excludedWithoutStream,
      excludedIgnoredRecordings,
      invalidInventoryRecords,
      conflictingRecordings: conflicts.size,
    },
  };
}

export function projectTaggedActivityCurve(payload, record, kind) {
  const policy = chartTagKindPolicy[kind];
  let curve;
  if (["cadence", "velocity"].includes(kind)) {
    if (!Array.isArray(payload) || payload.length > 16) chartTagError();
    if (!payload.length) return { points: [], missing: true, partial: false };
    const candidates = payload.filter(
      (value) =>
        object(value) &&
        value.stream_type === policy.stream &&
        (value.after_kj == null || value.after_kj === 0)
    );
    if (candidates.length !== 1) chartTagError();
    curve = candidates[0];
  } else {
    if (!object(payload)) chartTagError();
    curve = payload;
    const streams =
      kind === "heartRate" ? ["heartrate", "fixed_heartrate"] : ["watts", "fixed_watts"];
    if (
      (curve.stream_type != null && !streams.includes(curve.stream_type)) ||
      (curve.after_kj != null && curve.after_kj !== 0)
    )
      chartTagError();
  }
  const axis = curve.secs,
    values = curve.values;
  if (
    !Array.isArray(axis) ||
    axis.length > 10000 ||
    !Array.isArray(values) ||
    axis.length !== values.length ||
    axis.some(
      (value, index) =>
        !Number.isSafeInteger(value) || value < 1 || (index > 0 && value <= axis[index - 1])
    ) ||
    (curve.start_date_local != null && day(curve.start_date_local) !== record.date) ||
    (curve.end_date_local != null && day(curve.end_date_local) !== record.date)
  )
    chartTagError();
  for (const key of [
    "activity_id",
    "start_index",
    "end_index",
    ...(kind === "heartRate" ? [] : ["watts"]),
  ])
    if (curve[key] != null && (!Array.isArray(curve[key]) || curve[key].length !== axis.length))
      chartTagError();
  if (
    kind !== "heartRate" &&
    curve.watts != null &&
    curve.watts.some((value, index) => !Object.is(value, values[index]))
  )
    chartTagError();
  let partial = false;
  const points = axis.map((seconds, index) => {
    const start = curve.start_index?.[index],
      end = curve.end_index?.[index],
      pair = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start;
    const ignoredSegment =
      record.ignoredParts.length > 0 &&
      (!pair || record.ignoredParts.some((part) => start <= part.end && end >= part.start));
    const known =
      numeric(values[index]) &&
      !record.ignored &&
      !ignoredSegment &&
      (record.duration === null || seconds <= record.duration) &&
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
    if (known && pair) {
      point.start_index = start;
      point.end_index = end;
    } else if ((curve.start_index != null || curve.end_index != null) && !pair) partial = true;
    return point;
  });
  return { points, missing: axis.length === 0, partial };
}

export function createTaggedActivityCurvesService({
  request,
  catalog,
  now = Date.now,
  ttl = 30 * 60_000,
  membershipTtl = 60_000,
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
    throw Error("Choose a bounded tagged recording cap.");
  for (const limit of [
    maxResponseCharacters,
    maxProcessedSourcePoints,
    maxSourceCachePoints,
    maxWindowCacheCharacters,
  ])
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw Error("Choose positive bounded tagged chart resource limits.");
  const responseWeights = new WeakMap();
  const windows = createChartReadCache({
      now,
      ttl,
      failureTtl,
      maxEntries,
      busy,
      maxWeight: maxWindowCacheCharacters,
      weight: (value) => responseWeights.get(value) || 0,
    }),
    sources = createChartReadCache({
      now,
      ttl,
      failureTtl,
      maxEntries: maxSourceEntries,
      busy,
      maxWeight: maxSourceCachePoints,
      weight: (value) => value.points.length,
    });
  let active = 0;
  return {
    clear() {
      windows.clear();
      sources.clear();
    },
    async load(config, input, { actor, timeZone = "America/Chicago", signal } = {}) {
      const scope = chartTagScope(config, actor),
        today = athleteLocalDate(new Date(now()), timeZone),
        selection = taggedCurveSelection(input, today);
      if (scope !== selection.tagScope)
        chartTagError(
          "The native recording-tag account changed. Reload tags and review the retained filter.",
          409,
          "CHART_TAG_ACCOUNT_CHANGED"
        );
      if (signal?.aborted) throw signal.reason;
      const current = await catalog.load(config, { actor, signal });
      if (current.accountScope !== scope) chartTagError();
      if (
        current.revision !== selection.tagRevision ||
        selection.tags.some((tag) => !current.tags.includes(tag))
      )
        chartTagError(
          "The native recording-tag catalog changed. Reload tags or explicitly clear the retained filter.",
          409,
          "CHART_TAG_SELECTION_CHANGED"
        );
      return structuredClone(
        await chartReadSubscriber(
          windows.read(
            JSON.stringify([scope, today, selection, current.revision]),
            async () => {
              if (active >= 4) throw busy();
              active++;
              try {
                const client = request(config),
                  deadline = AbortSignal.timeout(60_000),
                  fields =
                    "id,type,start_date_local,name,moving_time,elapsed_time,stream_types,icu_sync_date,tags,icu_ignore_hr,icu_ignore_power,ignore_velocity,ignore_pace,ignore_parts";
                const inventory = taggedCurveInventory(
                    await client(
                      `/athlete/0/activities?${new URLSearchParams({ oldest: selection.start, newest: selection.end, fields, limit: "10000" })}`,
                      { signal: deadline }
                    ),
                    selection
                  ),
                  chosen = inventory.eligible.slice(0, maxRecordings),
                  results = [];
                let processedSourcePoints = 0;
                const consumePoints = (count) => {
                  if (processedSourcePoints + count > maxProcessedSourcePoints)
                    sizeLimit(
                      "The tagged chart exceeds the safe source-point budget. Choose a smaller date range."
                    );
                  processedSourcePoints += count;
                };
                for (let index = 0; index < chosen.length; index += 4) {
                  const batch = await Promise.allSettled(
                    chosen.slice(index, index + 4).map(async (record) => {
                      try {
                        const sourceRecord = { ...record };
                        delete sourceRecord.tags;
                        const sourceKey = JSON.stringify([scope, selection.kind, sourceRecord]);
                        const result = await sources.read(
                          sourceKey,
                          async () => {
                            const endpoint =
                              selection.kind === "heartRate"
                                ? `/activity/${record.id}/hr-curve.json`
                                : selection.kind === "power"
                                  ? `/activity/${record.id}/power-curve.json`
                                  : `/activity/${record.id}/power-curves.json?types=${chartTagKindPolicy[selection.kind].stream}&fatigue=normal`;
                            const projected = projectTaggedActivityCurve(
                              await client(endpoint, { signal: deadline }),
                              sourceRecord,
                              selection.kind
                            );
                            return projected;
                          },
                          (value) => (value.partial || value.missing ? failureTtl : ttl)
                        );
                        consumePoints(result.points.length);
                        return { ...result, record };
                      } catch (error) {
                        if (error?.[RESOURCE_LIMIT]) throw error;
                        return { record, failed: true, partial: true, points: [] };
                      }
                    })
                  );
                  const rejected = batch.find((item) => item.status === "rejected");
                  if (rejected) throw rejected.reason;
                  results.push(...batch.map((item) => item.value));
                }
                if (chosen.length && results.every((value) => value.failed)) chartTagError();
                const failedRecordings = results.filter((value) => value.failed).length,
                  missingRecordings = results.filter((value) => value.missing).length,
                  skippedForCap = Math.max(0, inventory.eligible.length - chosen.length);
                const partial =
                  inventory.partial ||
                  failedRecordings > 0 ||
                  missingRecordings > 0 ||
                  skippedForCap > 0 ||
                  results.some((value) => value.partial);
                const policy = chartTagKindPolicy[selection.kind],
                  output = {
                    version: 2,
                    kind: selection.kind,
                    unit: policy.unit,
                    source: "intervals-tagged-activity-curves",
                    unitPolicy: policy.unitPolicy,
                    valuePolicy: "native-reported",
                    tagsSupported: true,
                    accountScope: scope,
                    catalogRevision: current.revision,
                    selection: {
                      sport: selection.sport,
                      nativeTypes: selection.nativeTypes,
                      tags: selection.tags,
                      tagMatch: "any",
                    },
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
                    warning: taggedCurveWarning(
                      selection.kind,
                      partial,
                      { ...inventory.counts, skippedForCap, failedRecordings, missingRecordings },
                      maxRecordings
                    ),
                  };
                // Reserve the maximum unknown-point digit count without serializing any points.
                const headerCharacters = JSON.stringify({
                  ...output,
                  coverage: { ...output.coverage, unknownPoints: 10000 },
                  warning: [
                    output.warning,
                    taggedCurveWarning(
                      selection.kind,
                      true,
                      { ...output.coverage, unknownPoints: 10000 },
                      maxRecordings
                    ),
                  ].sort((a, b) => b.length - a.length)[0],
                }).length;
                const merged = mergeTaggedCurvePoints(results, {
                  maxCharacters: maxResponseCharacters,
                  headerCharacters,
                });
                output.points = merged.points;
                output.coverage.unknownPoints = merged.points.filter(
                  (point) => point.value === null
                ).length;
                output.warning = taggedCurveWarning(
                  selection.kind,
                  partial,
                  output.coverage,
                  maxRecordings
                );
                const exactCharacters =
                  JSON.stringify({ ...output, points: [] }).length + merged.characters;
                responseWeights.set(output, exactCharacters);
                return output;
              } catch (error) {
                if (error?.code?.startsWith("CHART_TAG_")) throw error;
                chartTagError();
              } finally {
                active--;
              }
            },
            (value) =>
              Math.min(membershipTtl, value.coverage.status === "partial" ? failureTtl : ttl)
          ),
          signal
        )
      );
    },
  };
}

export function taggedCurveWarning(kind, partial, counts = {}, maxRecordings = 128) {
  const base =
    kind === "cadence"
      ? "Cadence is shown as recorded RPM; running values are not doubled into steps per minute."
      : kind === "velocity"
        ? "Speed uses the provider’s reported precision; rounded speed values can make pace less precise."
        : "";
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
