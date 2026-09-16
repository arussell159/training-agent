import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMutationQueue,
  validateMutation,
  pendingMutationContext,
} from "./mutation-queue.mjs";
const config = { INTERVALS_API_KEY: "fixture" };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mutation = (n, extra = {}) => ({
  operationId: id(n),
  id: "event:1",
  type: "description",
  description: "new",
  ...extra,
});
function memory() {
  const rows = new Map();
  return {
    rows,
    async getSyncRecord(key) {
      return rows.get(key)?.cursor;
    },
    async upsert(_, items) {
      for (const row of items) rows.set(row.athlete_id, row);
    },
    async listSyncRecords(prefix) {
      return [...rows.values()].filter(
        (r) =>
          r.athlete_id.startsWith(prefix) && ["pending", "retry", "failed"].includes(r.cursor.state)
      );
    },
  };
}
test("queue persists before provider calls and operation IDs are idempotent", async () => {
  const store = memory(),
    queue = createMutationQueue(config, store);
  await queue.enqueue(mutation(1));
  await queue.enqueue(mutation(1));
  assert.equal(store.rows.size, 1);
  await assert.rejects(queue.enqueue(mutation(1, { description: "different" })), /reused/);
  let calls = 0;
  assert.equal(
    (
      await queue.drain(async () => {
        calls++;
      })
    ).synced,
    1
  );
  await queue.drain(async () => {
    calls++;
  });
  assert.equal(calls, 1);
});
test("newer descriptions supersede unsent old descriptions", async () => {
  const store = memory(),
    queue = createMutationQueue(config, store);
  await queue.enqueue(mutation(1));
  await queue.enqueue(mutation(2, { description: "latest" }));
  const applied = [];
  await queue.drain(async (m) => applied.push(m.description));
  assert.deepEqual(applied, ["latest"]);
});
test("failed edits preserve ordering while unrelated workouts can sync", async () => {
  const store = memory(),
    queue = createMutationQueue(config, store);
  await queue.enqueue(mutation(1));
  await queue.enqueue(mutation(2, { type: "move", date: "2026-09-16" }));
  await queue.enqueue(mutation(3, { id: "event:2" }));
  let calls = [];
  const result = await queue.drain(
    async (m) => {
      calls.push(m.operationId);
      if (m.operationId === id(1)) throw Object.assign(Error("unavailable"), { status: 503 });
    },
    { now: 1000 }
  );
  assert.deepEqual(calls, [id(1), id(3)]);
  assert.equal(result.pending, 2);
  calls = [];
  await queue.drain(async (m) => calls.push(m.operationId), { now: 2000 });
  assert.deepEqual(calls, []);
  await queue.drain(async (m) => calls.push(m.operationId), { now: 2000, retryFailed: true });
  assert.deepEqual(calls, [id(1), id(2)]);
});
test("unsafe mutations are rejected and moving across today retains the workout", () => {
  assert.throws(() => validateMutation(mutation(1, { type: "delete" })));
  assert.throws(() => validateMutation(mutation(1, { type: "move", date: "not-date" })));
  const context = pendingMutationContext(
    { history: [], planned: [{ id: "event:1", workout_date: "2026-09-20" }] },
    mutation(1, { type: "move", date: "2026-09-14" })
  );
  assert.equal(context.history[0].workout_date, "2026-09-14");
  assert.equal(context.planned[0].sync_status, "pending");
});
