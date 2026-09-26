import test from "node:test";
import assert from "node:assert/strict";
import { createSection11Sync, freshSection11Sync } from "./section11-sync.mjs";

function fixture(run, clock = Date.now) {
  let state = freshSection11Sync();
  const tasks = [];
  const store = {
    read: async () => structuredClone(state),
    update: async (change) => change(state),
  };
  const create = () =>
    createSection11Sync({ store, run, now: clock, waitUntil: (task) => tasks.push(task) });
  return { service: create(), create, tasks, state: () => state };
}
const input = { version: "training-1", athleteId: "i123", requestId: "request-1" };

test("training response returns while GitHub continues in a platform-managed task", async () => {
  const gate = Promise.withResolvers();
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    await gate.promise;
    return { status: "complete", commit: "abc" };
  });
  const result = await f.service.ensure(input);
  assert.equal(result.status, "running");
  assert.equal(calls, 1);
  assert.equal(f.tasks.length, 1);
  // The browser can leave; a new server instance still sees the durable claim.
  assert.equal((await f.create().progress(result.revision)).status, "running");
  gate.resolve();
  await f.tasks[0];
  assert.deepEqual(await f.create().progress(result.revision), {
    status: "complete",
    revision: 1,
    commit: "abc",
  });
});

test("unchanged provider data still triggers an export when GitHub has never received that version", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return { status: "complete", commit: "abc" };
  });
  await f.service.ensure(input);
  await f.tasks[0];
  assert.equal((await f.service.ensure(input)).status, "complete");
  assert.equal(calls, 1);
  await f.service.ensure({ ...input, force: true, requestId: "manual-refresh" });
  await f.tasks[1];
  assert.equal(calls, 2);
});

test("concurrent instances share a claim and a newer version cannot complete with the older export", async () => {
  const gate = Promise.withResolvers();
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    if (calls === 1) await gate.promise;
    return { status: "complete", commit: String(calls) };
  });
  await Promise.all([f.service.ensure(input), f.create().ensure(input)]);
  assert.equal(calls, 1);
  const next = await f.create().ensure({ ...input, version: "new-sleep" });
  assert.equal(next.status, "queued");
  gate.resolve();
  await f.tasks[0];
  assert.equal((await f.create().progress(next.revision)).status, "running");
  await f.tasks[1];
  assert.equal((await f.create().progress(next.revision)).commit, "2");
});

test("failed exports remain visible and can be retried without another provider change", async () => {
  let time = 0,
    calls = 0;
  const f = fixture(
    async () => {
      if (++calls === 1) throw Error("Worker unavailable");
      return { status: "complete", commit: "retry" };
    },
    () => time
  );
  await f.service.ensure(input);
  await f.tasks[0];
  assert.equal((await f.create().progress(1)).error, "Worker unavailable");
  time = 60_001;
  await f.create().ensure(input);
  await f.tasks[1];
  assert.equal((await f.create().progress(1)).status, "complete");
});

test("a killed serverless job expires instead of showing running forever", async () => {
  let time = 0;
  const f = fixture(
    () => new Promise(() => {}),
    () => time
  );
  await f.service.ensure(input);
  time = 6 * 60_000;
  assert.equal((await f.create().progress(1)).status, "failed");
});
