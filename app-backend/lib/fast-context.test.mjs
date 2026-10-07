import { test } from "node:test";
import assert from "node:assert/strict";
import { projectTrainingContext, saveFastView, fastViewId } from "./fast-context.mjs";
const context = {
  athlete: { id: "1", time_zone: "America/Chicago", sport_settings: { huge: true } },
  history: [
    {
      id: "activity:i1",
      workout_date: "2026-09-15",
      completed: true,
      raw_activity: { distance: 100 },
    },
  ],
  planned: [],
  wellness_history: [{ date: "2026-09-15", hrv: 42, sleepSecs: 0, unused: null }],
  performance: [{ workoutDay: "2026-09-15", ctl: 20, atl: 30, tsb: -10, huge: {} }],
  synced_at: "2026-09-15T12:00:00Z",
};

test('prepared views commit in one round trip; no full snapshot is read back after a successful write', async () => {
  let writes = 0;
  const store = { savePreparedViews: async rows => {
    writes++;
    assert.equal(rows.length, 2);
    return { version: rows[0].cursor.version, revision: rows[0].cursor.queue_snapshot_revision };
  }, getSyncRecord: () => { throw Error('Unexpected read'); } };
  const saved = await saveFastView({ INTERVALS_API_KEY: 'fixture' }, store, { ...context, queue_snapshot_revision: '2026-10-07T12:00:00.000001Z' });
  assert.equal(writes, 1);
  assert.equal(saved.queue_snapshot_revision, '2026-10-07T12:00:00.000001Z');
});

test('if a concurrent mutation wins, an older writer returns the newer committed view', async () => {
  const newest = { version: 'newest' };
  const store = { savePreparedViews: async () => ({ version: 'newest', revision: '2026-10-07T13:00:00Z' }),
    getSyncRecord: async (_id, options) => { assert.equal(options.fresh, true); return newest; } };
  assert.equal(await saveFastView({ INTERVALS_API_KEY: 'fixture' }, store, context), newest);
});
test("startup projection preserves data and strips unused provider payloads", () => {
  const view = projectTrainingContext(context, "week", new Date("2026-09-15T12:00:00Z"));
  assert.equal(view.history[0].raw_activity, undefined);
  assert.ok(view.history[0].activity_revision);
  assert.equal(view.athlete.sport_settings, undefined);
  assert.equal(view.wellness_history[0].sleepSecs, 0);
  assert.equal(view.wellness_history[0].unused, undefined);
  assert.equal(view.performance[0].huge, undefined);
});
test("full projection declares the complete retained window for report coverage", () => {
  const view = projectTrainingContext(context, "full", new Date("2026-09-15T12:00:00Z"));
  assert.equal(view.context_scope, "full");
  assert.equal(view.retention_days, 90);
  assert.equal(view.history.length, 1);
});
test("both startup and full views share a stable content version", async () => {
  let rows;
  const store = {
    async upsert(_, r) {
      rows = r;
    },
  };
  const config = { INTERVALS_API_KEY: "fixture" };
  const first = await saveFastView(config, store, context);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].athlete_id, fastViewId(config, "week"));
  assert.equal(rows[1].cursor.version, first.version);
  assert.ok(rows[1].cursor.cache_scope);
  const second = await saveFastView(config, store, { ...context, synced_at: "later" });
  assert.equal(first.version, second.version);
});
