import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTrainingPeaksPlan,
  overlayTrainingPeaksSnapshot,
} from "./trainingpeaks-planned-model.mjs";
import { createTrainingPeaksPlanned, overlayTrainingPeaksPlans } from "./trainingpeaks-planned.mjs";
import { projectTrainingContext, saveFastView } from "./fast-context.mjs";
const today = "2026-10-26",
  athleteId = 123;
const config = {
  TRAININGPEAKS_AUTH_COOKIE: "fixture-secret-cookie",
  TRAININGPEAKS_ATHLETE_ID: String(athleteId),
};
const row = (patch = {}) => ({
  workoutId: 42,
  athleteId,
  workoutDay: today + "T00:00:00",
  title: "Threshold",
  workoutTypeValueId: 2,
  totalTimePlanned: 0.75,
  tssPlanned: 40,
  ifPlanned: 0.8,
  ...patch,
});
const step = (patch = {}) => ({
  name: "Work",
  length: { value: 300, unit: "second" },
  targets: [{ minValue: 87, maxValue: 94 }],
  intensityClass: "active",
  ...patch,
});
const structure = (steps) => ({
  primaryIntensityMetric: "percentOfFtp",
  structure: [{ type: "repetition", length: { value: 2, unit: "repetition" }, steps }],
});
function memory(initial) {
  let state = initial ? structuredClone(initial) : null;
  return {
    ready: true,
    getSyncRecord: async () => structuredClone(state?.cursor || null),
    updateSyncRecord: async (id, change) => {
      const patch = change(structuredClone(state));
      if (patch) state = { ...patch, athlete_id: id };
      return structuredClone(state);
    },
  };
}
function provider(rows, { fail, profileId = athleteId } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (fail) return new Response("", { status: fail });
      if (url.endsWith("/token"))
        return Response.json({
          success: true,
          token: { access_token: "fixture-bearer", expires_in: 600 },
        });
      if (url.endsWith("/user")) return Response.json({ user: { userId: profileId } });
      const [start, end] = url.split("/").slice(-2);
      return Response.json(
        rows.filter((r) => r.workoutDay.slice(0, 10) >= start && r.workoutDay.slice(0, 10) <= end)
      );
    },
  };
}
test("imports exact units, repeats, cadence and zero-target swim rests without recalculating source totals", () => {
  const bike = normalizeTrainingPeaksPlan(
    row({
      structure: structure([
        step({
          notes: "FTP",
          targets: [
            { minValue: 87, maxValue: 94 },
            { unit: "roundOrStridePerMinute", minValue: 80, maxValue: 90 },
          ],
        }),
        step({ intensityClass: "recovery", targets: [{ minValue: 50, maxValue: 50 }] }),
      ]),
    }),
    { athleteId, today }
  );
  assert.equal(bike.id, "trainingpeaks:42");
  assert.equal(bike.planned.duration_seconds, 2700);
  assert.equal(bike.load, 40);
  assert.equal(bike.editor_model.steps[0].repetitions, 2);
  assert.deepEqual(bike.editor_model.steps[0].steps[0].cadence, { start: 80, end: 90 });
  assert.equal(bike.editor_model.steps[0].steps[0].notes, "FTP");
  const swim = normalizeTrainingPeaksPlan(
    row({
      workoutTypeValueId: 1,
      structure: {
        ...structure([
          step({ length: { value: 100, unit: "yard" } }),
          step({
            intensityClass: "rest",
            length: { value: 10, unit: "second" },
            targets: [{ minValue: 0, maxValue: 0 }],
          }),
        ]),
        primaryIntensityMetric: "percentOfThresholdPace",
      },
    }),
    { athleteId, today }
  );
  assert.ok(swim.editor_model);
  assert.equal(swim.editor_model.steps[0].steps[0].end.unit, "yd");
  assert.deepEqual(swim.editor_model.steps[0].steps[1].target, { kind: "none" });
});
test("metadata-only workouts remain visible and malformed or unsupported structures never become invented charts", () => {
  const plain = normalizeTrainingPeaksPlan(row({ structure: null }), { athleteId, today });
  assert.equal(plain.editor_model, undefined);
  const unsupported = normalizeTrainingPeaksPlan(
    row({ structure: structure([step({ length: { value: 2, unit: "mystery" } })]) }),
    { athleteId, today }
  );
  assert.equal(unsupported.editor_model, undefined);
  assert.equal(unsupported.trainingpeaks_warnings.length, 1);
  for (const patch of [{ workoutDay: "2026-99-99" }, { athleteId: 999 }, { workoutId: -1 }])
    assert.throws(() => normalizeTrainingPeaksPlan(row(patch), { athleteId, today }));
  for (const patch of [
    { completed: true },
    { totalTime: 0.5 },
    { distance: 1000 },
    { workoutTypeValueId: 7 },
  ])
    assert.equal(normalizeTrainingPeaksPlan(row(patch), { athleteId, today }), null);
});
test("ramp-down direction and source scheduling time are preserved", () => {
  const workout = normalizeTrainingPeaksPlan(
    row({
      startTimePlanned: "2026-10-26T05:30:00",
      structure: {
        primaryIntensityMetric: "percentOfFtp",
        structure: [
          { type: "rampDown", steps: [step({ targets: [{ minValue: 45, maxValue: 75 }] })] },
        ],
      },
    }),
    { athleteId, today }
  );
  assert.deepEqual(workout.editor_model.steps[0].target, {
    kind: "power",
    unit: "%ftp",
    mode: "ramp",
    start: 75,
    end: 45,
  });
  assert.equal(workout.planned_time_label, "05:30");
  assert.equal(workout.scheduled_start_at, "2026-10-26T05:30:00");
});
test("a source import retains calendar notes and an explicit new app save after cutover", () => {
  const note = { id: "event:11", category: "NOTE", workout_date: today },
    saved = { id: "event:12", workout_date: today, app_updated_at: today + "T14:00:00.000Z" },
    old = { id: "event:13", workout_date: today, app_updated_at: today + "T10:00:00.000Z" };
  const context = overlayTrainingPeaksSnapshot(
    { planned: [note, saved, old] },
    { activatedDay: today, activatedAt: today + "T12:00:00.000Z", workouts: [] },
    today
  );
  assert.deepEqual(context.planned, [note, saved]);
});
test("cutover replaces future plans, retains recordings, past plans, events, wellness and metrics; refresh removes deleted or moved source rows", () => {
  const recording = {
    id: "activity:abc",
    completed: true,
    status: "completed",
    workout_date: today,
  };
  const old = { id: "event:1", workout_date: "2026-10-25" },
    future = { id: "event:2", workout_date: "2026-10-27" },
    race = { id: "event:3", calendar_event_key: "race", workout_date: "2026-10-27" };
  const base = {
    athlete: {},
    history: [recording, old],
    planned: [future, race],
    wellness: { hrv: 50 },
    metrics: { fitness: 90 },
  };
  const imported = normalizeTrainingPeaksPlan(row(), { athleteId, today }),
    snapshot = { activatedDay: today, workouts: [imported], lastSyncedAt: today };
  const result = overlayTrainingPeaksSnapshot(base, snapshot, today);
  assert.ok(result.history.includes(recording));
  assert.ok(result.history.includes(old));
  assert.ok(result.planned.includes(race));
  assert.ok(!result.planned.includes(future));
  assert.equal(result.wellness, base.wellness);
  assert.equal(result.metrics, base.metrics);
  const cleared = overlayTrainingPeaksSnapshot(result, { ...snapshot, workouts: [] }, today);
  assert.ok(![...cleared.history, ...cleared.planned].some((w) => w.id === imported.id));
  const projected = projectTrainingContext(result, "full", new Date(today + "T12:00:00Z"));
  assert.equal(projected.planned_source, "trainingpeaks");
  assert.ok(projected.planned.some((w) => w.id === imported.id));
  assert.ok(
    !projectTrainingContext(
      { ...base, planned: [{ ...imported, source: "trainingpeaks-archive" }] },
      "full",
      new Date(today + "T12:00:00Z")
    ).planned.some((w) => w.id === imported.id)
  );
});
test("read-only sync chunks the calendar, coalesces opens, keeps stable identities and throttles refreshes", async () => {
  const store = memory(),
    api = provider([row()]);
  let time = new Date(today + "T12:00:00Z");
  const service = createTrainingPeaksPlanned({
    store,
    config,
    fetchImpl: api.fetch,
    now: () => time,
  });
  const [a, b] = await Promise.all([service.refresh(), service.refresh()]);
  assert.deepEqual(a, b);
  assert.equal(a.workouts.length, 1);
  assert.equal(api.calls.length, 4);
  assert.equal((Date.parse(a.rangeEnd) - Date.parse(a.rangeStart)) / 86400000, 179);
  assert.ok(
    api.calls.every(
      (c) =>
        c.options.method === "GET" &&
        c.options.redirect === "error" &&
        new URL(c.url).origin === "https://tpapi.trainingpeaks.com"
    )
  );
  assert.ok(!JSON.stringify(await service.read()).includes("fixture-secret"));
  await service.refresh();
  assert.equal(api.calls.length, 4);
  time = new Date(time.getTime() + 300001);
  const next = await service.refresh();
  assert.equal(next.workouts[0].id, a.workouts[0].id);
  assert.equal(api.calls.length, 6);
});
test("missed imported plans remain through the retained window without importing pre-cutover history", async () => {
  const missed = row({ workoutDay: "2026-10-01" }),
    earlier = row({ workoutId: 40, workoutDay: "2026-09-20" }),
    initial = { activatedDay: "2026-09-25", workouts: [] };
  const service = createTrainingPeaksPlanned({
    store: memory({ cursor: initial }),
    config,
    fetchImpl: provider([missed, earlier]).fetch,
    now: () => new Date(today + "T12:00:00Z"),
  });
  const result = await service.refresh();
  assert.deepEqual(
    result.workouts.map((w) => w.id),
    ["trainingpeaks:42"]
  );
  assert.equal(result.rangeStart, "2026-07-28");
  assert.equal(
    normalizeTrainingPeaksPlan(row({ title: null, totalTime: 1 }), { athleteId, today }),
    null
  );
});
test("expired sessions and rate limits retain the last successful plan without overwriting activities or exposing diagnostics", async () => {
  const state = {
    activatedDay: today,
    workouts: [normalizeTrainingPeaksPlan(row(), { athleteId, today })],
    lastSyncedAt: today,
  };
  for (const status of [401, 403, 429, 500]) {
    const store = memory({ cursor: state }),
      api = provider([], { fail: status }),
      service = createTrainingPeaksPlanned({
        store,
        config,
        fetchImpl: api.fetch,
        now: () => new Date(today + "T12:00:00Z"),
      });
    const result = await service.refresh();
    assert.deepEqual(result.workouts, state.workouts);
    assert.equal(result.lastSyncedAt, today);
    assert.equal(result.reconnectRequired, [401, 403].includes(status));
    await service.refresh({ force: true });
    assert.equal(api.calls.length, 1);
  }
});
test("athlete mismatch and malformed refresh cannot replace saved plans; distributed lease prevents a second instance read", async () => {
  const state = { activatedDay: today, workouts: [{ id: "saved" }] },
    store = memory({ cursor: state }),
    api = provider([row()], { profileId: 999 });
  const service = createTrainingPeaksPlanned({
    store,
    config,
    fetchImpl: api.fetch,
    now: () => new Date(today + "T12:00:00Z"),
  });
  assert.deepEqual((await service.refresh()).workouts, state.workouts);
  const locked = memory({
      cursor: { ...state, lease: "other", leaseUntil: Date.parse(today + "T13:00:00Z") },
    }),
    p = provider([row()]);
  await createTrainingPeaksPlanned({
    store: locked,
    config,
    fetchImpl: p.fetch,
    now: () => new Date(today + "T12:00:00Z"),
  }).refresh({ force: true });
  assert.equal(p.calls.length, 0);
});
test("prepared full and startup views carry TrainingPeaks plans and a common version; disabled connector adds no reads", async (t) => {
  // Keep the fixture inside the current plan window as the real calendar advances.
  t.mock.timers.enable({ apis: ["Date"], now: new Date(today + "T12:00:00Z") });
  const imported = normalizeTrainingPeaksPlan(row(), { athleteId, today }),
    store = memory({ cursor: { activatedDay: today, workouts: [imported] } });
  let rows;
  store.savePreparedViews = async (value) => {
    rows = value;
    return { version: value[0].cursor.version, revision: value[0].cursor.queue_snapshot_revision };
  };
  const base = { athlete: {}, planned: [{ id: "event:5", workout_date: today }], history: [] };
  await saveFastView(config, store, base);
  assert.ok(rows.every((r) => r.cursor.planned_source === "trainingpeaks"));
  assert.ok(rows[0].cursor.planned.some((w) => w.id === imported.id));
  assert.equal(rows[0].cursor.version, rows[1].cursor.version);
  assert.equal(
    await overlayTrainingPeaksPlans(
      {},
      {
        ready: true,
        getSyncRecord: () => {
          throw Error("unexpected");
        },
      },
      base
    ),
    base
  );
});
