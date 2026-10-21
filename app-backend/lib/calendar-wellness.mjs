import { createHash, randomUUID } from "node:crypto";
import { calendarMetricFields } from "./calendar-metrics-model.mjs";
import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
import { validDate } from "./intervals.mjs";
import { athleteLocalDate } from "./athlete-date.mjs";
import { twelveWeekStart } from "./training-retention.mjs";

const fields = new Map(calendarMetricFields.map((field) => [field.key, field]));
const hydrationReads = new WeakMap();
const native = {
  weight: { field: "weight", factor: 0.45359237 },
  sleepHours: { field: "sleepSecs", factor: 3600 },
  bodyFat: { field: "bodyFat", factor: 1 },
  restingHR: { field: "restingHR", factor: 1 },
  hrv: { field: "hrv", factor: 1 },
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message, status = 400, code = "INVALID_METRICS") => {
  throw Object.assign(Error(message), { status, code });
};
const fresh = () => ({ revision: 0, entries: {}, pending: null, receipts: [] });
const recordLike = (value) => value && typeof value === "object" && !Array.isArray(value);
const numeric = (value) => typeof value === "number" && Number.isFinite(value);
const same = (actual, expected, integer = false) => {
  if (expected == null) return actual == null;
  if (numeric(expected) && numeric(actual))
    return integer ? actual === expected : Math.abs(actual - expected) <= 0.0001;
  return actual === expected;
};
const providerValue = (key, value) =>
  value == null
    ? null
    : key === "sleepHours"
      ? Math.round(value * 3600)
      : value * native[key].factor;
const metricDate = (date) => {
  try {
    return validDate(date);
  } catch {
    fail("Choose a valid metric date.");
  }
};
function validateInput(input) {
  if (!recordLike(input)) fail("Enter calendar metrics.");
  if (
    Object.keys(input).some(
      (key) => !["date", "revision", "operationId", "changes", "note"].includes(key)
    )
  )
    fail("Unsupported calendar metrics save field.");
  const date = metricDate(input.date);
  if (!/^[a-f0-9]{64}$/.test(input.revision || "")) fail("Reload calendar metrics before saving.");
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(input.operationId || ""))
    fail("Keep a stable metrics save identity.");
  if (!recordLike(input.changes)) fail("Enter changed metric fields.");
  const changes = {};
  for (const key of Object.keys(input.changes).sort()) {
    const field = fields.get(key),
      entry = input.changes[key];
    if (!field) fail(`Unsupported metric: ${key}`);
    if (entry === null) {
      changes[key] = { value: null, time: null };
      continue;
    }
    if (
      !recordLike(entry) ||
      Object.keys(entry).some((key) => !["value", "time"].includes(key)) ||
      !Object.hasOwn(entry, "value") ||
      !Object.hasOwn(entry, "time")
    )
      fail(`Enter ${field.label} and its time.`);
    const value = entry.value,
      time = entry.time ?? null;
    if (
      value !== null &&
      (field.kind === "number"
        ? !numeric(value) ||
          value < field.min ||
          value > field.max ||
          (field.step === 1 && !Number.isInteger(value))
        : !field.options.includes(value))
    )
      fail(`Enter a valid ${field.label}.`);
    if (time !== null && (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))
      fail(`Enter ${field.label} time as HH:mm.`);
    if (
      key === "sleepHours" &&
      value !== null &&
      Math.abs(value * 3600 - Math.round(value * 3600)) > 0.000001
    )
      fail("Sleep Hours must represent a whole number of seconds.");
    changes[key] = { value, time };
  }
  const hasNote = Object.hasOwn(input, "note");
  if (
    hasNote &&
    (typeof input.note !== "string" || input.note.length > 8000 || input.note.includes("\0"))
  )
    fail("Enter a note of 8,000 characters or fewer.");
  if (!Object.keys(changes).length && !hasNote) fail("Change a metric or note before saving.");
  return {
    date,
    revision: input.revision,
    operationId: input.operationId,
    changes,
    ...(hasNote ? { note: input.note } : {}),
  };
}

export function createCalendarWellnessService({
  request,
  record,
  hydrationRecord = record,
  now = () => Date.now(),
  leaseMs = 240000,
}) {
  const stateFor = (date) => record(date, fresh);
  const indexFor = () => record("index", () => ({ dates: [] }));
  const checkedDates = (value) => {
    if (
      !recordLike(value) ||
      !Array.isArray(value.dates) ||
      value.dates.length > 20000 ||
      new Set(value.dates).size !== value.dates.length ||
      value.dates.some((date) => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    )
      fail("Saved metric dates could not be verified.", 502, "METRICS_STORAGE_INVALID");
    try {
      for (const date of value.dates) validDate(date);
    } catch {
      fail("Saved metric dates could not be verified.", 502, "METRICS_STORAGE_INVALID");
    }
    return value.dates;
  };
  async function ensureDate(date) {
    if (checkedDates(await indexFor().read()).includes(date)) return;
    await indexFor().update((value) => {
      const dates = checkedDates(value);
      if (!dates.includes(date)) {
        if (dates.length >= 20000)
          fail(
            "The metrics date index has reached its supported limit.",
            413,
            "METRICS_INDEX_LIMIT"
          );
        value.dates = [...dates, date].sort();
      }
    });
  }
  async function state(date, hydration = false) {
    const value = await (hydration ? hydrationRecord(date, fresh) : stateFor(date)).read();
    if (
      !recordLike(value) ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !recordLike(value.entries) ||
      !Array.isArray(value.receipts) ||
      value.receipts.length > 64
    )
      fail(
        "Saved metrics could not be verified. Reload before saving.",
        502,
        "METRICS_STORAGE_INVALID"
      );
    try {
      if (Object.keys(value.entries).length > fields.size) throw Error();
      for (const [key, entry] of Object.entries(value.entries)) {
        if (
          !recordLike(entry) ||
          !Object.hasOwn(entry, "value") ||
          !Object.hasOwn(entry, "time") ||
          entry.time === undefined ||
          Object.keys(entry).some((name) => !["value", "time", "nativeValue"].includes(name))
        )
          throw Error();
        validateInput({
          date,
          revision: "0".repeat(64),
          operationId: "storage-validation",
          changes: { [key]: { value: entry.value, time: entry.time } },
        });
        if (native[key]) {
          if (
            !Object.hasOwn(entry, "nativeValue") ||
            !same(
              entry.nativeValue,
              providerValue(key, entry.value),
              key === "sleepHours" || key === "restingHR"
            )
          )
            throw Error();
        } else if (Object.hasOwn(entry, "nativeValue")) throw Error();
      }
      if (new Set(value.receipts.map((receipt) => receipt?.id)).size !== value.receipts.length)
        throw Error();
      for (const receipt of value.receipts) {
        if (
          !recordLike(receipt) ||
          !/^[a-zA-Z0-9_-]{16,80}$/.test(receipt.id || "") ||
          !/^[a-f0-9]{64}$/.test(receipt.fingerprint || "") ||
          !numeric(receipt.completedAt) ||
          receipt.completedAt < 0
        )
          throw Error();
      }
      if (value.pending !== null) {
        const pending = value.pending;
        if (
          !recordLike(pending) ||
          !/^[a-f0-9-]{36}$/.test(pending.token || "") ||
          !numeric(pending.startedAt) ||
          pending.startedAt < 0 ||
          !recordLike(pending.patch)
        )
          throw Error();
        const original = validateInput({
          date,
          revision: pending.baseRevision,
          operationId: pending.id,
          changes: pending.changes,
          ...(Object.hasOwn(pending.patch, "comments") ? { note: pending.patch.comments } : {}),
        });
        if (
          hash(original) !== pending.fingerprint ||
          hash(expectedNative(original)) !== hash(pending.patch)
        )
          throw Error();
      }
    } catch {
      fail(
        "Saved metrics could not be verified. Reload before saving.",
        502,
        "METRICS_STORAGE_INVALID"
      );
    }
    return value;
  }
  async function provider(date) {
    let value;
    try {
      value = await request(`/athlete/0/wellness/${date}`);
    } catch (error) {
      if (error.status !== 404) throw error;
      return { id: date };
    }
    if (!recordLike(value) || typeof value.id !== "string")
      fail("The provider returned an invalid wellness record.", 502, "METRICS_PROVIDER_INVALID");
    if (value.id !== date)
      fail("The provider returned a different wellness date.", 502, "METRICS_DATE_MISMATCH");
    return { ...value, id: date };
  }
  function revision(value, stored) {
    // Include all provider properties: a concurrent imported update must be
    // visible even when it changes a field outside this reference form.
    const stable = Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]])
    );
    return hash([stable, stored.revision, stored.entries]);
  }
  function view(date, value, stored) {
    const entries = Object.fromEntries(
      calendarMetricFields.map(({ key }) => {
        const saved = stored.entries[key],
          mapping = native[key];
        const current = mapping ? value[mapping.field] : null;
        if (
          saved &&
          (!mapping ||
            same(
              current,
              saved.nativeValue,
              mapping.field === "sleepSecs" || mapping.field === "restingHR"
            ))
        )
          return [key, { value: saved.value, time: saved.time, source: "manual" }];
        return [
          key,
          {
            value: mapping && numeric(current) ? current / mapping.factor : null,
            time: null,
            source: mapping && numeric(current) ? "intervals" : "unavailable",
          },
        ];
      })
    );
    const note = typeof value.comments === "string" ? value.comments : "";
    return {
      date,
      revision: revision(value, stored),
      entries,
      note,
      recordExists: Boolean(
        note || Object.values(entries).some((entry) => entry.value !== null || entry.time !== null)
      ),
      providerUpdated: typeof value.updated === "string" ? value.updated : null,
      source: "intervals",
      locked: value.locked === true,
    };
  }
  const expectedNative = (input) => {
    const patch = {};
    for (const [key, entry] of Object.entries(input.changes))
      if (native[key]) patch[native[key].field] = providerValue(key, entry.value);
    if (Object.hasOwn(input, "note")) patch.comments = input.note;
    return patch;
  };
  const matches = (value, patch) =>
    Object.entries(patch).every(([key, expected]) =>
      key === "comments"
        ? String(value[key] ?? "") === expected
        : same(value[key], expected, key === "sleepSecs" || key === "restingHR")
    );
  async function finish(input, fingerprint, token, value) {
    try {
      await stateFor(input.date).update((stored) => {
        if (
          stored.receipts.some(
            (receipt) => receipt.id === input.operationId && receipt.fingerprint === fingerprint
          )
        )
          return;
        if (stored.pending?.token !== token)
          fail("Metrics changed while saving. Reload before retrying.", 409, "METRICS_CONFLICT");
        for (const [key, entry] of Object.entries(input.changes))
          stored.entries[key] = {
            ...entry,
            ...(native[key] ? { nativeValue: value[native[key].field] ?? null } : {}),
          };
        stored.revision++;
        stored.pending = null;
        stored.receipts = [
          ...stored.receipts,
          { id: input.operationId, fingerprint, completedAt: now() },
        ].slice(-64);
      });
    } catch (error) {
      if (error.code) throw error;
      fail(
        "The metrics metadata save could not be confirmed. Keep this draft and retry the same save.",
        502,
        "METRICS_WRITE_UNCONFIRMED"
      );
    }
    return {
      ...view(input.date, value, await state(input.date)),
      verified: true,
      providerRecord: value,
    };
  }
  async function load(date) {
    metricDate(date);
    const [value, stored] = await Promise.all([provider(date), state(date)]);
    return view(date, value, stored);
  }
  async function save(raw) {
    const input = validateInput(raw),
      fingerprint = hash(input);
    const initial = await state(input.date),
      value = await provider(input.date);
    const receipt = initial.receipts.find((receipt) => receipt.id === input.operationId);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        fail(
          "This metrics save identity was already used for different changes.",
          409,
          "METRICS_OPERATION_REUSED"
        );
      await ensureDate(input.date);
      return {
        ...view(input.date, value, initial),
        verified: true,
        replayed: true,
        providerRecord: value,
      };
    }
    const patch = expectedNative(input),
      pending = initial.pending;
    if (pending?.id === input.operationId && pending.fingerprint !== fingerprint)
      fail(
        "Keep the original metrics changes when retrying this save.",
        409,
        "METRICS_OPERATION_REUSED"
      );
    if (pending?.id === input.operationId && matches(value, patch))
      return finish(input, fingerprint, pending.token, value);
    if (pending && now() - pending.startedAt < leaseMs)
      fail(
        "Another metrics save is still being verified. Retry this same save shortly.",
        409,
        "METRICS_WRITE_BUSY"
      );
    if (pending && matches(value, pending.patch)) {
      // Recover the prior accepted operation's private fields before another
      // operation can supersede it. The caller's old revision then conflicts.
      await finish(
        { date: input.date, operationId: pending.id, changes: pending.changes },
        pending.fingerprint,
        pending.token,
        value
      );
      return save(raw);
    }
    if (
      pending &&
      !matches(value, pending.patch) &&
      pending.baseRevision !== revision(value, initial)
    )
      fail(
        "A previous metrics save is unconfirmed. Reload before making another change.",
        502,
        "METRICS_WRITE_UNCONFIRMED"
      );
    if (value.locked === true)
      fail(
        "This provider wellness record is locked. Unlock it in Intervals.icu before editing.",
        409,
        "METRICS_LOCKED"
      );
    if (revision(value, initial) !== input.revision)
      fail(
        "These metrics changed elsewhere. Reload before saving your draft.",
        409,
        "METRICS_CONFLICT"
      );
    // Index intent durably before any provider change. Empty failed intents do
    // not create visible entries, and no existing dates are pruned.
    await ensureDate(input.date);
    const token = randomUUID();
    await stateFor(input.date).update((stored) => {
      if (stored.revision !== initial.revision || stored.pending?.token !== initial.pending?.token)
        fail("Another metrics save started. Retry this same draft.", 409, "METRICS_WRITE_BUSY");
      stored.pending = {
        id: input.operationId,
        fingerprint,
        token,
        startedAt: now(),
        baseRevision: input.revision,
        patch,
        changes: input.changes,
      };
    });
    // Only changed native fields are ever sent. Subjective scale labels, times,
    // muscle mass and sleep stages remain lossless app metadata.
    const changed = Object.fromEntries(
      Object.entries(patch).filter(([key, expected]) =>
        key === "comments"
          ? String(value[key] ?? "") !== expected
          : !same(value[key], expected, key === "sleepSecs" || key === "restingHR")
      )
    );
    if (Object.keys(changed).length) {
      try {
        await request(`/athlete/0/wellness/${input.date}`, {
          method: "PUT",
          body: JSON.stringify(changed),
        });
      } catch (error) {
        if (error.status >= 400 && error.status < 500) {
          await stateFor(input.date).update((stored) => {
            if (stored.pending?.token === token) stored.pending = null;
          });
          throw error;
        }
        // An independent GET below reconciles a lost response; no blind replay.
      }
    }
    let verified;
    try {
      verified = await provider(input.date);
    } catch {
      fail(
        "The metrics save could not be confirmed. Keep this draft and retry the same save.",
        502,
        "METRICS_WRITE_UNCONFIRMED"
      );
    }
    if (!matches(verified, patch))
      fail(
        "Intervals.icu did not confirm the changed metrics. Keep this draft and retry the same save.",
        502,
        "METRICS_WRITE_UNCONFIRMED"
      );
    return finish(input, fingerprint, token, verified);
  }
  async function hydrateContext(context, bounds = {}) {
    const zone = context.athlete?.time_zone || "America/Chicago",
      instant = new Date(now()),
      today = athleteLocalDate(instant, zone);
    const display = context.display_range || {};
    const start =
      bounds.start ||
      (/^[1-9]\d{3}-\d{2}-\d{2}$/.test(display.start || "")
        ? display.start
        : twelveWeekStart(instant, zone));
    const end =
      bounds.end ||
      (/^(?!9999)[1-9]\d{3}-\d{2}-\d{2}$/.test(display.end || "")
        ? display.end
        : new Date(Date.parse(`${today}T12:00:00Z`) + 60 * 86400000).toISOString().slice(0, 10));
    validDate(start);
    validDate(end);
    const dates = checkedDates(await hydrationRecord("index", () => ({ dates: [] })).read()).filter(
      (date) => date >= start && date <= end
    );
    if (!dates.length) return context;
    const wellness = new Map(
      (context.wellness_history || []).map((value) => [value.date || value.id, value])
    );
    for (let index = 0; index < dates.length; index += 8) {
      const entries = await Promise.all(
        dates.slice(index, index + 8).map(async (date) => [date, await state(date, true)])
      );
      for (const [date, stored] of entries) {
        if (!Object.keys(stored.entries).length && !stored.receipts.length) continue;
        const providerRow = wellness.get(date) || { id: date, date };
        const row = view(date, providerRow, stored);
        wellness.set(date, {
          ...providerRow,
          id: date,
          date,
          calendar_metrics: row.entries,
          calendar_metrics_note: row.note,
        });
      }
    }
    return {
      ...context,
      wellness_history: [...wellness.values()].sort((a, b) =>
        String(a.date || a.id).localeCompare(String(b.date || b.id))
      ),
    };
  }
  return { load, save, hydrateContext };
}

export function calendarWellnessService(config, request, fetchImpl = fetch) {
  const connection = providerConnection(config);
  // Only context decoration can reuse these short-lived private snapshots.
  // Form revision reads and every mutation still use fresh encrypted-store reads.
  const cacheKey = hash([
    connection,
    config.SUPABASE_URL,
    config.SUPABASE_SECRET_KEY,
    config.SETTINGS_ENCRYPTION_KEY,
  ]);
  let scopes = hydrationReads.get(fetchImpl);
  if (!scopes) hydrationReads.set(fetchImpl, (scopes = new Map()));
  const record = (date, initial) =>
    createEncryptedRecordStore(
      config,
      `${connection}:${date}`,
      {
        namespace: "calendar-wellness",
        name: "CALENDAR_WELLNESS",
        fresh: initial,
        timestampCas: true,
      },
      fetchImpl
    );
  const hydrationRecord = (date, initial) => ({
    read: async () => {
      let cache = scopes.get(cacheKey);
      if (!cache) {
        scopes.set(cacheKey, (cache = new Map()));
        if (scopes.size > 32) scopes.delete(scopes.keys().next().value);
      }
      let entry = cache.get(date);
      if (!entry || entry.expires <= Date.now()) {
        const current = { expires: Infinity, promise: null };
        current.promise = record(date, initial)
          .read()
          .then((value) => {
            current.expires = Date.now() + 2000;
            return value;
          })
          .catch((error) => {
            if (cache.get(date) === current) cache.delete(date);
            throw error;
          });
        cache.set(date, (entry = current));
        if (cache.size > 512) cache.delete(cache.keys().next().value);
      }
      return structuredClone(await entry.promise);
    },
  });
  const service = createCalendarWellnessService({
    request,
    record,
    hydrationRecord,
  });
  return {
    ...service,
    save: async (input) => {
      scopes.delete(cacheKey);
      try {
        return await service.save(input);
      } finally {
        scopes.delete(cacheKey);
      }
    },
    hydrateContext: async (context, bounds) => {
      const owner = context.provider_connection || context.cache_scope;
      if (owner && owner !== connection) return context;
      return service.hydrateContext(context, bounds);
    },
  };
}

export function projectCalendarWellness(context, date, providerRecord, row) {
  const wellness = {
    ...providerRecord,
    id: date,
    date,
    calendar_metrics: row.entries,
    calendar_metrics_note: row.note,
  };
  const rows = new Map(
    (context.wellness_history || []).map((value) => [value.date || value.id, value])
  );
  rows.set(date, wellness);
  const today = athleteLocalDate(new Date(), context.athlete?.time_zone || "America/Chicago");
  return {
    ...context,
    ...(date === today
      ? {
          wellness: {
            ...(context.wellness || {}),
            hrv: providerRecord.hrv ?? null,
            resting_hr: providerRecord.restingHR ?? null,
            sleep: providerRecord.sleepSecs ?? null,
          },
        }
      : {}),
    wellness_history: [...rows.values()].sort((a, b) =>
      String(a.date || a.id).localeCompare(String(b.date || b.id))
    ),
  };
}
