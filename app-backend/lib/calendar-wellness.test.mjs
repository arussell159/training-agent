import test from "node:test";
import assert from "node:assert/strict";
import {
  createCalendarWellnessService,
  calendarWellnessService,
  projectCalendarWellness,
} from "./calendar-wellness.mjs";
import { calendarMetricFields, isCalendarMetricsEntries } from "./calendar-metrics-model.mjs";
import { projectTrainingContext } from "./fast-context.mjs";

const date = "2026-10-20",
  id = "f11379c5-9391-41fe-af50-b3b535146af3";
const initial = () => ({
  id: date,
  updated: "2026-10-20T08:00:00Z",
  weight: 80,
  restingHR: 50,
  hrv: 60,
  sleepSecs: 27000,
  bodyFat: 15,
  fatigue: 2,
  soreness: 3,
  stress: 1,
  sleepQuality: 2,
  comments: "Imported note",
  steps: 5000,
  ctl: 40,
  atl: 50,
  customImported: "retain",
});
function memory(options = {}) {
  const data = new Map();
  const record = (key, fresh) => ({
    read: async () => structuredClone(data.get(key) ?? fresh()),
    update: async (change) => {
      const before = structuredClone(data.get(key) ?? fresh()),
        next = structuredClone(before),
        result = change(next);
      if (options.failAll || (options.failIndex && key === "index"))
        throw Error("Synthetic storage outage");
      if (options.failCommit && before.pending && !next.pending && next.receipts.length) {
        options.failCommit = false;
        throw Error("Lost sidecar commit");
      }
      data.set(key, next);
      return structuredClone(result);
    },
  });
  return { record, data };
}
function provider(options = {}) {
  let row = options.empty ? null : initial();
  const calls = [];
  const request = async (path, config = {}) => {
    calls.push({ path, ...config });
    assert.equal(path, `/athlete/0/wellness/${date}`);
    if (config.method === "PUT") {
      if (options.reject) throw Object.assign(Error("Forbidden"), { status: 403 });
      if (options.wait) await options.wait;
      if (!options.ignore)
        row = {
          ...(row || { id: date }),
          ...JSON.parse(config.body),
          updated: "2026-10-20T09:00:00Z",
        };
      if (options.lost) throw Error("Lost provider reply");
    }
    if (!row) throw Object.assign(Error("Not found"), { status: 404 });
    return structuredClone(row);
  };
  return {
    request,
    calls,
    row: () => structuredClone(row),
    set: (value) => {
      row = structuredClone(value);
    },
  };
}
const create = (p, store, extra = {}) =>
  createCalendarWellnessService({ request: p.request, record: store.record, ...extra });
const input = (revision, changes, extra = {}) => ({
  date,
  revision,
  operationId: id,
  changes,
  ...extra,
});

test("reference catalog retains all fourteen exact fields, labels, units and distinct subjective scales", () => {
  assert.equal(calendarMetricFields.length, 14);
  assert.deepEqual(calendarMetricFields.find((field) => field.key === "sleepQuality").options, [
    "Horrible",
    "Poor",
    "Bad",
    "Average",
    "Good",
    "Better",
    "Best",
  ]);
  assert.equal(calendarMetricFields.find((field) => field.key === "soreness").options.length, 10);
  assert.equal(
    calendarMetricFields.find((field) => field.key === "overallFeeling").options.length,
    10
  );
  assert.deepEqual(
    calendarMetricFields.find((field) => field.key === "yesterdayTraining").options,
    ["Worse than normal", "Normal", "Better than normal", "RestDay"]
  );
});

test("imports use explicit native units without inventing equivalent subjective labels or measurement times", async () => {
  const p = provider(),
    store = memory(),
    row = await create(p, store).load(date);
  assert.ok(Math.abs(row.entries.weight.value - 80 / 0.45359237) < 1e-10);
  assert.equal(row.entries.sleepHours.value, 7.5);
  assert.deepEqual(row.entries.restingHR, { value: 50, time: null, source: "intervals" });
  assert.deepEqual(row.entries.fatigue, { value: null, time: null, source: "unavailable" });
  assert.equal(row.note, "Imported note");
  assert.equal(isCalendarMetricsEntries(row.entries), true);
  assert.equal(
    p.calls.some((call) => call.method),
    false
  );
});

test("mixed saves send only five changed native measurements and explicit prose while preserving every imported field", async () => {
  const p = provider(),
    store = memory(),
    service = create(p, store),
    before = await service.load(date);
  const changes = {
    weight: { value: 180.25, time: "07:15" },
    sleepHours: { value: 8, time: "07:00" },
    bodyFat: { value: 16, time: null },
    restingHR: { value: 55, time: "06:59" },
    hrv: { value: 0, time: "06:58" },
    sleepQuality: { value: "Best", time: "07:00" },
    fatigue: { value: "Very High", time: null },
    soreness: { value: "Moderately Low", time: null },
    stress: { value: "Low", time: null },
    yesterdayTraining: { value: "RestDay", time: null },
    overallFeeling: { value: "Superior", time: null },
    muscleMass: { value: 150, time: "07:15" },
    deepSleepHours: { value: 2, time: null },
    remSleepHours: { value: 1.5, time: null },
  };
  const result = await service.save(
    input(before.revision, changes, { note: "Plain personal note" })
  );
  assert.equal(result.verified, true);
  const writes = p.calls.filter((call) => call.method === "PUT");
  assert.equal(writes.length, 1);
  const patch = JSON.parse(writes[0].body);
  assert.deepEqual(patch, {
    weight: 180.25 * 0.45359237,
    sleepSecs: 28800,
    bodyFat: 16,
    restingHR: 55,
    hrv: 0,
    comments: "Plain personal note",
  });
  const raw = p.row();
  for (const key of [
    "fatigue",
    "soreness",
    "stress",
    "sleepQuality",
    "steps",
    "ctl",
    "atl",
    "customImported",
  ])
    assert.equal(raw[key], initial()[key]);
  assert.doesNotMatch(
    writes[0].body,
    /Moderately|Superior|RestDay|muscle|deep|remSleep|07:15|Workout editor/
  );
  const restarted = await create(p, store).load(date);
  for (const [key, entry] of Object.entries(changes))
    assert.deepEqual(restarted.entries[key], { ...entry, source: "manual" });
  assert.equal(restarted.note, "Plain personal note");
  assert.equal(restarted.revision, result.revision);
});

test("omission preserves imported data, zero is measured, and explicit null clears only that metric", async () => {
  const p = provider(),
    store = memory(),
    service = create(p, store),
    before = await service.load(date);
  const saved = await service.save(
    input(before.revision, { hrv: { value: 0, time: "00:00" }, bodyFat: null })
  );
  assert.deepEqual(JSON.parse(p.calls.find((call) => call.method === "PUT").body), {
    bodyFat: null,
    hrv: 0,
  });
  assert.equal(p.row().weight, 80);
  assert.equal(p.row().comments, "Imported note");
  assert.deepEqual(saved.entries.bodyFat, { value: null, time: null, source: "manual" });
  assert.deepEqual(saved.entries.hrv, { value: 0, time: "00:00", source: "manual" });
});

test("subjective-only dates persist without provider writes and survive context hydration and compact projection", async () => {
  const p = provider({ empty: true }),
    store = memory(),
    service = create(p, store, { now: () => Date.parse(`${date}T12:00:00Z`) }),
    before = await service.load(date);
  const saved = await service.save(
    input(before.revision, {
      overallFeeling: { value: "Best", time: "11:22" },
      muscleMass: { value: 145, time: "07:00" },
    })
  );
  assert.equal(
    p.calls.some((call) => call.method),
    false
  );
  assert.equal(saved.recordExists, true);
  const context = {
    athlete: { id: "synthetic", time_zone: "America/Chicago" },
    metrics: {},
    history: [],
    planned: [],
    wellness_history: [{ id: "2026-10-19", date: "2026-10-19", steps: 444 }],
    display_range: { start: "2026-10-19", end: date },
  };
  const hydrated = await create(p, store).hydrateContext(context, {
    start: "2026-10-19",
    end: date,
  });
  assert.equal(hydrated.wellness_history[0].steps, 444);
  const day = hydrated.wellness_history.find((row) => row.date === date);
  assert.equal(day.calendar_metrics.overallFeeling.value, "Best");
  assert.equal(day.calendar_metrics.muscleMass.time, "07:00");
  const compact = projectTrainingContext(hydrated, "full", new Date(`${date}T12:00:00Z`));
  assert.equal(
    compact.wellness_history.find((row) => row.date === date).calendar_metrics.overallFeeling.value,
    "Best"
  );
  const older = await service.hydrateContext(context, { start: "2025-01-01", end: "2025-02-01" });
  assert.equal(
    older.wellness_history.some((row) => row.date === date),
    false
  );
});

test("repeated save identities never repeat native writes and cannot be reused for changed payloads", async () => {
  const p = provider(),
    store = memory(),
    service = create(p, store),
    before = await service.load(date);
  const draft = input(before.revision, { restingHR: { value: 54, time: "07:00" } });
  await service.save(draft);
  const replay = await create(p, store).save(draft);
  assert.equal(replay.replayed, true);
  assert.equal(p.calls.filter((call) => call.method === "PUT").length, 1);
  await assert.rejects(
    service.save({ ...draft, changes: { restingHR: { value: 56, time: "07:00" } } }),
    (error) => error.code === "METRICS_OPERATION_REUSED"
  );
});

test("lost provider replies and lost sidecar commits reconcile from independent native readback after restart", async () => {
  for (const options of [{ lost: true }, { failCommit: true }]) {
    const p = provider({ lost: options.lost }),
      store = memory({ failCommit: options.failCommit }),
      service = create(p, store),
      before = await service.load(date);
    const draft = input(before.revision, {
      weight: { value: 185, time: "07:05" },
      fatigue: { value: "Extreme", time: "09:00" },
    });
    if (options.failCommit)
      await assert.rejects(
        service.save(draft),
        (error) => error.code === "METRICS_WRITE_UNCONFIRMED"
      );
    else assert.equal((await service.save(draft)).verified, true);
    const recovered = await create(p, store).save(draft);
    assert.equal(recovered.verified, true);
    assert.equal(recovered.entries.fatigue.value, "Extreme");
    assert.equal(recovered.entries.weight.time, "07:05");
    assert.equal(p.calls.filter((call) => call.method === "PUT").length, 1);
  }
});

test("stale provider revisions and locked records fail before any native change", async () => {
  for (const lock of [false, true]) {
    const p = provider(),
      store = memory(),
      service = create(p, store),
      before = await service.load(date);
    p.set({
      ...p.row(),
      ...(lock ? { locked: true } : { steps: 6000, updated: "2026-10-20T08:30:00Z" }),
    });
    await assert.rejects(
      service.save(input(before.revision, { weight: { value: 180, time: null } })),
      (error) => error.code === (lock ? "METRICS_LOCKED" : "METRICS_CONFLICT")
    );
    assert.equal(
      p.calls.some((call) => call.method),
      false
    );
  }
});

test("another active writer cannot overwrite the same date while the first provider request is pending", async () => {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const p = provider({ wait }),
    store = memory(),
    one = create(p, store),
    two = create(p, store),
    before = await one.load(date);
  const saving = one.save(input(before.revision, { restingHR: { value: 55, time: null } }));
  while (!p.calls.some((call) => call.method === "PUT"))
    await new Promise((resolve) => setTimeout(resolve, 1));
  await assert.rejects(
    two.save(
      input(
        before.revision,
        { hrv: { value: 70, time: null } },
        { operationId: "different-operation-12345" }
      )
    ),
    (error) => error.code === "METRICS_WRITE_BUSY"
  );
  release();
  assert.equal((await saving).verified, true);
  assert.equal(p.row().hrv, 60);
});

test("storage or index failure prevents provider commits and wrong readback never reports success", async () => {
  for (const broken of ["failAll", "failIndex"]) {
    const p = provider(),
      store = memory({ [broken]: true }),
      service = create(p, store),
      before = await service.load(date);
    await assert.rejects(
      service.save(input(before.revision, { weight: { value: 190, time: null } })),
      /storage outage/
    );
    assert.equal(
      p.calls.some((call) => call.method),
      false
    );
  }
  const p = provider({ ignore: true }),
    store = memory(),
    service = create(p, store),
    before = await service.load(date);
  await assert.rejects(
    service.save(input(before.revision, { restingHR: { value: 60, time: null } })),
    (error) => error.code === "METRICS_WRITE_UNCONFIRMED"
  );
  assert.equal((await service.load(date)).entries.restingHR.value, 50);
});

test("native external changes win over stale manual values and timestamps while local scale entries survive", async () => {
  const p = provider(),
    store = memory(),
    service = create(p, store),
    before = await service.load(date);
  await service.save(
    input(before.revision, {
      weight: { value: 185, time: "07:05" },
      soreness: { value: "Moderate", time: "09:00" },
    })
  );
  p.set({ ...p.row(), weight: 90, comments: "Remote note", updated: "2026-10-20T10:00:00Z" });
  const fresh = await create(p, store).load(date);
  assert.ok(Math.abs(fresh.entries.weight.value - 90 / 0.45359237) < 1e-10);
  assert.equal(fresh.entries.weight.time, null);
  assert.equal(fresh.entries.weight.source, "intervals");
  assert.equal(fresh.entries.soreness.value, "Moderate");
  assert.equal(fresh.note, "Remote note");
});

test("all reference bounds, scale labels, date/time, note and provider-only fields are validated before writes", async () => {
  const p = provider(),
    store = memory(),
    service = create(p, store),
    before = await service.load(date),
    writes = () => p.calls.filter((call) => call.method).length;
  for (const changes of [
    { weight: { value: 1001, time: null } },
    { bodyFat: { value: 81, time: null } },
    { hrv: { value: 201, time: null } },
    { restingHR: { value: 9, time: null } },
    { restingHR: { value: 55.5, time: null } },
    { sleepHours: { value: 25, time: null } },
    { sleepHours: { value: 0.0001, time: null } },
    { fatigue: { value: 3, time: null } },
    { stress: { value: "unknown", time: null } },
    { weight: { value: 185, time: "24:00" } },
    { weight: { value: 185 } },
    { ctl: { value: 80, time: null } },
  ])
    await assert.rejects(
      service.save(input(before.revision, changes)),
      (error) => error.code === "INVALID_METRICS"
    );
  await assert.rejects(
    service.save(input(before.revision, {}, { note: "x".repeat(8001) })),
    /8,000/
  );
  await assert.rejects(
    service.save(input(before.revision, { hrv: null }, { date: "2026-02-30" })),
    (error) => error.code === "INVALID_METRICS"
  );
  assert.equal(writes(), 0);
});

test("independent encrypted record stores and dates cannot share manual metrics", async () => {
  const p = provider(),
    one = memory(),
    two = memory(),
    a = create(p, one),
    before = await a.load(date);
  await a.save(input(before.revision, { overallFeeling: { value: "Best", time: "12:00" } }));
  assert.equal((await create(p, two).load(date)).entries.overallFeeling.value, null);
  assert.equal((await a.load(date)).entries.overallFeeling.value, "Best");
  const context = projectCalendarWellness(
    { athlete: {}, wellness_history: [{ date: "2026-10-19", steps: 4 }] },
    date,
    p.row(),
    await a.load(date)
  );
  assert.equal(context.wellness_history.find((row) => row.date === "2026-10-19").steps, 4);
  assert.equal(
    context.wellness_history.find((row) => row.date === date).calendar_metrics.overallFeeling.value,
    "Best"
  );
});

test("metric dates retain athlete-local calendar identity across leap days and daylight-saving boundaries", async () => {
  const store = memory(),
    rows = new Map(),
    paths = [];
  const service = createCalendarWellnessService({
    record: store.record,
    request: async (path, options = {}) => {
      paths.push(path);
      const date = path.split("/").at(-1);
      if (options.method === "PUT")
        rows.set(date, { id: date, ...(rows.get(date) || {}), ...JSON.parse(options.body) });
      return structuredClone(rows.get(date) || { id: date });
    },
  });
  for (const day of ["2024-02-29", "2026-03-08", "2026-11-01"]) {
    const loaded = await service.load(day);
    const saved = await service.save({
      date: day,
      revision: loaded.revision,
      operationId: `metrics-${day}-identity`,
      changes: { weight: { value: 180, time: "01:30" } },
    });
    assert.equal(saved.date, day);
    assert.equal(saved.entries.weight.time, "01:30");
    assert.ok(paths.includes(`/athlete/0/wellness/${day}`));
  }
  await assert.rejects(service.load("2026-02-29"), (error) => error.code === "INVALID_METRICS");
  assert.equal(rows.size, 3);
});

test("expired confirmed operations recover their private fields before a different stale draft can supersede them", async () => {
  let clock = 0;
  const p = provider(),
    store = memory({ failCommit: true }),
    service = create(p, store, { now: () => clock, leaseMs: 10 }),
    before = await service.load(date);
  const first = input(before.revision, {
    weight: { value: 185, time: "07:05" },
    overallFeeling: { value: "Best", time: "10:00" },
  });
  await assert.rejects(service.save(first), (error) => error.code === "METRICS_WRITE_UNCONFIRMED");
  const later = await service.load(date);
  clock = 20;
  await assert.rejects(
    service.save(
      input(
        later.revision,
        { hrv: { value: 70, time: null } },
        { operationId: "second-metrics-operation" }
      )
    ),
    (error) => error.code === "METRICS_CONFLICT"
  );
  const recovered = await service.load(date);
  assert.equal(recovered.entries.overallFeeling.value, "Best");
  assert.equal(recovered.entries.weight.time, "07:05");
  assert.equal(p.row().hrv, 60);
});

test("context hydration refuses to mix metadata into a different provider connection", async () => {
  const context = {
    provider_connection: "another-connection",
    wellness_history: [{ date, weight: 80 }],
  };
  const service = calendarWellnessService(
    { INTERVALS_API_KEY: "synthetic-only" },
    async () => {
      throw Error("Unexpected provider access");
    },
    async () => {
      throw Error("Unexpected database access");
    }
  );
  assert.equal(await service.hydrateContext(context), context);
});

test("malformed successful provider responses fail closed before any write", async () => {
  for (const response of [null, [], "", {}, { id: null }]) {
    let writes = 0;
    const service = createCalendarWellnessService({
      record: memory().record,
      request: async (_path, options = {}) => {
        if (options.method) writes++;
        return response;
      },
    });
    await assert.rejects(
      service.load(date),
      (error) => error.code === "METRICS_PROVIDER_INVALID" && error.status === 502
    );
    await assert.rejects(
      service.save(input("0".repeat(64), { weight: null })),
      (error) => error.code === "METRICS_PROVIDER_INVALID"
    );
    assert.equal(writes, 0);
  }
});

test("corrupt saved entries, receipts, pending operations and date indexes never reach a public row", async () => {
  const p = provider(),
    baseline = memory(),
    service = create(p, baseline),
    loaded = await service.load(date);
  await service.save(input(loaded.revision, { overallFeeling: { value: "Best", time: "09:00" } }));
  const good = structuredClone(baseline.data.get(date));
  for (const corrupt of [
    (value) => {
      value.entries.overallFeeling.value = "Not a real label";
    },
    (value) => {
      value.entries.overallFeeling.time = "25:00";
    },
    (value) => {
      value.entries.weight = { value: 180, time: null, nativeValue: 1 };
    },
    (value) => {
      value.receipts[0].fingerprint = "invalid";
    },
    (value) => {
      value.pending = { id, token: "x", patch: { weight: 82 } };
    },
    (value) => {
      value.revision = -1;
    },
  ]) {
    const store = memory(),
      value = structuredClone(good);
    corrupt(value);
    store.data.set(date, value);
    store.data.set("index", { dates: [date] });
    const invalid = create(p, store);
    await assert.rejects(invalid.load(date), (error) => error.code === "METRICS_STORAGE_INVALID");
    await assert.rejects(
      invalid.hydrateContext({ athlete: {}, wellness_history: [] }, { start: date, end: date }),
      (error) => error.code === "METRICS_STORAGE_INVALID"
    );
  }
  for (const dates of [[date, date], ["2026-02-30"]]) {
    const store = memory();
    store.data.set("index", { dates });
    await assert.rejects(
      create(p, store).hydrateContext({ athlete: {} }, { start: date, end: date }),
      (error) => error.code === "METRICS_STORAGE_INVALID"
    );
  }
});

test("a day containing only explicit clears remains an empty metric record", async () => {
  const p = provider({ empty: true }),
    store = memory(),
    service = create(p, store),
    loaded = await service.load(date);
  const cleared = await service.save(
    input(loaded.revision, { weight: null, overallFeeling: null })
  );
  assert.equal(cleared.recordExists, false);
  assert.equal((await create(p, store).load(date)).recordExists, false);
  assert.equal(p.calls.filter((call) => call.method === "PUT").length, 0);
});

test("note-only saves preserve provider prose and hydrate their date after a context reload", async () => {
  const p = provider({ empty: true }),
    store = memory(),
    service = create(p, store),
    loaded = await service.load(date);
  const saved = await service.save(
    input(loaded.revision, {}, { note: "A note without measurements" })
  );
  assert.equal(saved.recordExists, true);
  assert.equal(p.row().comments, "A note without measurements");
  const hydrated = await create(p, store).hydrateContext(
    { athlete: {}, wellness_history: [p.row()] },
    { start: date, end: date }
  );
  assert.equal(hydrated.wellness_history[0].calendar_metrics_note, "A note without measurements");
  assert.ok(isCalendarMetricsEntries(hydrated.wellness_history[0].calendar_metrics));
});

test("hydration-only caching coalesces repeated context reads, expires, isolates accounts and invalidates on saves while revision reads stay fresh", async (t) => {
  let clock = Date.now(),
    reads = 0;
  t.mock.method(Date, "now", () => clock);
  const rows = new Map();
  const fetchImpl = async (url, options = {}) => {
    const params = new URL(url).searchParams;
    if (options.method === "POST") {
      const [row] = JSON.parse(options.body);
      rows.set(`${row.scope}:${row.name}`, row);
      return { ok: true, json: async () => [row] };
    }
    const key = `${params.get("scope").slice(3)}:${params.get("name").slice(3)}`,
      row = rows.get(key);
    if (options.method === "PATCH") {
      if (row?.updated_at !== params.get("updated_at")?.slice(3))
        return { ok: true, json: async () => [] };
      const next = JSON.parse(options.body);
      rows.set(key, next);
      return { ok: true, json: async () => [next] };
    }
    reads++;
    return { ok: true, json: async () => (row ? [row] : []) };
  };
  const p = provider(),
    config = {
      SUPABASE_URL: "https://wellness-cache-fixture.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_fixture_wellness",
      INTERVALS_API_KEY: "fixture-one",
    };
  const service = () => calendarWellnessService(config, p.request, fetchImpl);
  const context = { athlete: {}, wellness_history: [initial()] },
    bounds = { start: date, end: date };
  const loaded = await service().load(date);
  await service().save(input(loaded.revision, { overallFeeling: { value: "Best", time: null } }));
  let before = reads;
  const [one, two] = await Promise.all([
    service().hydrateContext(context, bounds),
    service().hydrateContext(context, bounds),
  ]);
  assert.equal(reads - before, 2); // one index and one date, even across service instances
  assert.equal(one.wellness_history[0].calendar_metrics.overallFeeling.value, "Best");
  one.wellness_history[0].calendar_metrics.overallFeeling.value = "Horrible";
  assert.equal(two.wellness_history[0].calendar_metrics.overallFeeling.value, "Best");
  before = reads;
  await service().hydrateContext(context, bounds);
  assert.equal(reads, before);
  await service().load(date);
  assert.equal(reads, before + 1);
  clock += 2001;
  before = reads;
  await service().hydrateContext(context, bounds);
  assert.equal(reads - before, 2);
  before = reads;
  const isolated = await calendarWellnessService(
    { ...config, INTERVALS_API_KEY: "fixture-two" },
    p.request,
    fetchImpl
  ).hydrateContext(context, bounds);
  assert.equal(reads - before, 1);
  assert.equal(isolated.wellness_history[0].calendar_metrics, undefined);
  const current = await service().load(date);
  await service().save(
    input(
      current.revision,
      { overallFeeling: { value: "Good", time: null } },
      { operationId: "second-cache-operation" }
    )
  );
  before = reads;
  const saved = await service().hydrateContext(context, bounds);
  assert.equal(reads - before, 2);
  assert.equal(saved.wellness_history[0].calendar_metrics.overallFeeling.value, "Good");
});
