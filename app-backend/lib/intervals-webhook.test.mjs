import test from "node:test";
import assert from "node:assert/strict";
import { createWebhookSync, freshWebhookState, secretMatches } from "./intervals-webhook.mjs";
import { cachedTrainingUpdates } from "./cached-training-updates.mjs";

function fixture(refresh = async () => {}) {
  const state = freshWebhookState();
  let time = 1_000_000,
    writes = 0;
  const store = {
    read: async () => structuredClone(state),
    update: async (change) => {
      writes++;
      return change(state);
    },
  };
  const options = { store, refresh, now: () => time };
  return {
    state,
    store,
    options,
    sync: createWebhookSync(options),
    advance: (n) => {
      time += n;
    },
    writes: () => writes,
  };
}
const event = (id = "a", athlete_id = "1") => ({
  id,
  type: "CALENDAR_UPDATED",
  athlete_id,
  timestamp: "2026-10-07T12:00:00Z",
});

test("secret comparison fails closed, including absent and non-string secrets", () => {
  for (const value of [null, undefined, {}, "", "wrong"])
    assert.equal(secretMatches(value, "secret"), false);
  assert.equal(secretMatches("secret", "secret"), true);
  assert.equal(secretMatches("secret", undefined), false);
});
test("durable inbox filters athletes, unknown events and repeated deliveries", async () => {
  let refreshed = 0;
  const f = fixture(async () => {
    refreshed++;
  });
  assert.deepEqual(
    await f.sync.accept([event("foreign", "2"), { ...event(), type: "UNKNOWN" }], "1"),
    { accepted: 0 }
  );
  assert.equal(f.state.revision, 0);
  assert.equal((await f.sync.accept([event(), event()], "1")).accepted, 1);
  assert.equal((await f.sync.accept([event()], "1")).duplicate, true);
  await f.sync.drain();
  assert.equal(refreshed, 1);
  assert.equal(f.state.completed, 1);
  const writes = f.writes();
  await f.sync.drain();
  assert.equal(f.writes(), writes, "unchanged polls must not write or refresh");
});
test("two server instances share a lease; a mid-refresh event causes a second pass", async () => {
  const gate = Promise.withResolvers();
  let refreshes = 0;
  const f = fixture(async () => {
    if (++refreshes === 1) await gate.promise;
  });
  await f.sync.accept([event()], "1");
  const job = f.sync.drain();
  await new Promise((resolve) => setImmediate(resolve));
  const second = createWebhookSync(f.options);
  await second.drain();
  assert.equal(refreshes, 1);
  await second.accept([event("later")], "1");
  gate.resolve();
  await job;
  assert.equal(refreshes, 2);
  assert.equal(f.state.completed, 2);
});
test("failed persistence retains pending work and retries after backoff", async () => {
  let attempts = 0;
  const f = fixture(async () => {
    if (++attempts === 1) throw Error("database unavailable");
  });
  await f.sync.accept([event()], "1");
  await f.sync.drain();
  assert.equal(f.state.completed, 0);
  assert.equal((await f.sync.status()).pending, true);
  await f.sync.drain();
  assert.equal(attempts, 1);
  f.advance(16_000);
  await f.sync.drain();
  assert.equal(f.state.completed, 1);
  assert.equal(f.state.lastError, null);
});
test("expired worker leases recover and missed webhooks reconcile every five minutes", async () => {
  let runs = 0;
  const f = fixture(async () => {
    runs++;
  });
  f.state.lease = { token: "dead-worker", until: 1_000_001 };
  await f.sync.drain();
  assert.equal(runs, 0);
  f.advance(2);
  await f.sync.drain();
  f.advance(299_999);
  await f.sync.drain();
  assert.equal(runs, 1);
  f.advance(1);
  await f.sync.drain();
  assert.equal(runs, 2);
});
test("snapshot reads finish while the provider is stalled; unchanged responses omit training data", async () => {
  const stalled = Promise.withResolvers();
  const tasks = [];
  const view = { athlete: {}, history: [], planned: [], version: "v1" };
  const run = (version) =>
    cachedTrainingUpdates({
      readView: async () => view,
      refresh: () => stalled.promise,
      schedule: (task) => tasks.push(task()),
      version,
    });
  const response = await run();
  assert.equal(response.context.version, "v1");
  assert.deepEqual(await run("v1"), { unchanged: true, version: "v1" });
  assert.ok(JSON.stringify(await run("v1")).length < 100);
  stalled.resolve();
  await Promise.all(tasks);
});
