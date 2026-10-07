import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveSyncScheduler, LIVE_SAFETY_MS, LIVE_FALLBACK_MS } from '../src/lib/live-sync-scheduler.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(check = async () => true) {
  let now = 0, calls = 0, allowed = true, version = 'v1', id = 0;
  const timers = new Map();
  const scheduler = createLiveSyncScheduler({ check: async () => { calls++; return check(); },
    canCheck: () => allowed, currentVersion: () => version,
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimer: id => timers.delete(id),
  });
  return { scheduler, calls: () => calls, timers,
    setAllowed: value => { allowed = value; }, setVersion: value => { version = value; },
    advance: async ms => {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await tick();
      }
      now = end;
    },
  };
}
test('one catch-up on connection then four lightweight checks per idle hour, no 30-second polling', async () => {
  const f = fixture(); f.scheduler.connection(true); await tick();
  assert.equal(f.calls(), 1);
  await f.advance(LIVE_SAFETY_MS - 1); assert.equal(f.calls(), 1);
  await f.advance(1 + 3 * LIVE_SAFETY_MS); assert.equal(f.calls(), 5);
  f.scheduler.stop(); assert.equal(f.timers.size, 0);
});
test('a push runs immediately and a duplicate already displayed version does no work', async () => {
  const f = fixture(); f.scheduler.invalidate('v1'); assert.equal(f.calls(), 0);
  f.scheduler.invalidate('v2'); assert.equal(f.calls(), 1); await tick();
});
test('events arriving during an in-flight read coalesce into one follow-up', async () => {
  const gate = Promise.withResolvers(); const f = fixture(() => gate.promise);
  f.scheduler.invalidate('v2'); f.scheduler.invalidate('v3'); f.scheduler.invalidate('v4');
  assert.equal(f.calls(), 1); gate.resolve(true); await tick(); assert.equal(f.calls(), 2);
  f.scheduler.stop();
});
test('offline or mutation-busy tabs do not query and resume pending changes when safe', async () => {
  const f = fixture(); f.setAllowed(false); f.scheduler.invalidate('v2');
  await f.advance(60_000); assert.equal(f.calls(), 0);
  f.setAllowed(true); await f.advance(1000); assert.equal(f.calls(), 1);
  f.scheduler.stop();
});
test('missed events catch up on reconnect, unavailable push uses a five-minute fallback', async () => {
  const f = fixture(); await f.advance(LIVE_FALLBACK_MS); assert.equal(f.calls(), 1);
  f.scheduler.connection(true); await tick(); assert.equal(f.calls(), 2);
  f.scheduler.connection(false); f.scheduler.connection(true); await tick(); assert.equal(f.calls(), 3);
  f.scheduler.stop();
});
test('failed requests back off and do not produce unhandled errors after logout', async () => {
  const f = fixture(async () => { throw Error('offline'); });
  f.scheduler.invalidate(); await tick(); assert.equal(f.calls(), 1);
  await f.advance(4999); assert.equal(f.calls(), 1);
  await f.advance(1); assert.equal(f.calls(), 2);
  f.scheduler.stop(); await f.advance(LIVE_SAFETY_MS); assert.equal(f.calls(), 2);
});
