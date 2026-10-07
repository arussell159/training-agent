import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrainingLive } from './training-live.mjs';
import { cachedTrainingUpdates } from './cached-training-updates.mjs';
import { changeHint, changedTrainingRange } from './intervals-change-hints.mjs';

test('an unchanged version check never reads the full snapshot', async () => {
  let reads = 0, scheduled = 0;
  const result = await cachedTrainingUpdates({ version: 'v1', readVersion: async () => 'v1',
    readView: async () => { reads++; throw Error('Must not read'); }, refresh: () => {},
    schedule: () => { scheduled++; },
  });
  assert.equal(reads, 0);
  assert.equal(scheduled, 1);
  assert.deepEqual(result, { unchanged: true, version: 'v1' });
});
test('live grants contain no service key, expire, and use independent unguessable topics', async () => {
  const writes = [];
  const config = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'secret' };
  const store = { ready: true, registerTrainingLive: async (...args) => writes.push(args) };
  const a = await createTrainingLive(config, store, { now: () => 1000 });
  const b = await createTrainingLive(config, store, { now: () => 1000 });
  assert.match(a.topic, /^training:[a-f0-9]{64}$/);
  assert.notEqual(a.topic, b.topic);
  assert.equal(a.expiresAt, 1000 + 55 * 60_000);
  assert.equal(JSON.stringify(a).includes('secret'), false);
  assert.equal(writes.length, 2);
});
test('missing live configuration falls back without database writes', async () => {
  assert.deepEqual(await createTrainingLive({}, { ready: true, registerTrainingLive() { throw Error('no'); } }), { available: false });
});
test('activity hints cover old and new dates when an activity moves; absent dates safely refresh fully', () => {
  const saved = { history: [{ activity_id: 'i1', workout_date: '2026-10-01' }] };
  const hint = changeHint({ type: 'ACTIVITY_UPDATED', activity: { id: 'i1', start_date_local: '2026-10-06T12:00:00' } });
  assert.deepEqual(changedTrainingRange(saved, [hint]), { start: '2026-09-30', end: '2026-10-07' });
  assert.deepEqual(changedTrainingRange(saved, [changeHint({ type: 'ACTIVITY_DELETED', activity_id: 'i1' })]), { start: '2026-09-30', end: '2026-10-02' });
  assert.equal(changedTrainingRange(saved, [changeHint({ type: 'ACTIVITY_UPLOADED' })]), null);
  assert.equal(changedTrainingRange(saved, [changeHint({ type: 'CALENDAR_UPDATED' })]), null);
});
