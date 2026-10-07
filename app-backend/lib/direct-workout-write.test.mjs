import test from "node:test";
import assert from "node:assert/strict";
import { createMutationQueue, freshMutationQueue } from "./mutation-queue.mjs";
import { withDirectWorkoutWrite, reconcileDirectWorkoutWrite } from "./direct-workout-write.mjs";

const mutation = {
  operationId: "00000000-0000-4000-8000-000000000001",
  type: "description",
  id: "event:1",
  description: "new instructions",
};
function fixture() {
  let state = freshMutationQueue(),
    now = 0,
    writes = 0,
    unavailable = false;
  const record = {
    read: async () => structuredClone(state),
    update: async (change) => {
      if (unavailable) throw Error("Mock storage unavailable");
      const next = structuredClone(state),
        result = change(next);
      state = next;
      writes++;
      return structuredClone(result);
    },
  };
  const store = {
    listSyncRecords: async () => [],
    getSyncRecord: async () => null,
    upsert: async () => {},
  };
  const queue = () =>
    createMutationQueue({ INTERVALS_API_KEY: "mock" }, store, { record, clock: () => now });
  return {
    queue,
    state: () => structuredClone(state),
    writes: () => writes,
    time: (value) => {
      now = value;
    },
    outage: (value) => {
      unavailable = value;
    },
  };
}
const direct = (queue, request, action) =>
  withDirectWorkoutWrite({}, "event:1", action, { queue, request });

test("direct writes and queued edits share one durable workout claim across instances", async () => {
  const f = fixture(),
    entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  let providerCalls = 0;
  const source = async (_path, options = {}) => {
    providerCalls++;
    if (options.method === "PUT") {
      entered.resolve();
      await release.promise;
    }
    return { id: 1, description: "editor definition" };
  };
  const saving = direct(f.queue(), source, async (request) => {
    await request("/athlete/0/events/1");
    await request("/athlete/0/events/1", {
      method: "PUT",
      body: JSON.stringify({ description: "editor definition" }),
    });
    await request("/athlete/0/events/1");
    return { verified: true };
  });
  await entered.promise;
  await assert.rejects(f.queue().enqueue(mutation), (error) => error.status === 409);
  await assert.rejects(
    direct(f.queue(), source, () => {}),
    (error) => error.status === 409
  );
  const before = f.writes();
  const outcome = await f
    .queue()
    .drain(() => assert.fail("A direct claim must block queued writes"));
  assert.deepEqual(outcome, { synced: 0, failed: 0, pending: 1, unknown: 0 });
  assert.equal(f.writes(), before);
  assert.equal(providerCalls, 2);
  release.resolve();
  assert.equal((await saving).verified, true);
  assert.equal(Object.keys(f.state().direct_claims).length, 0);
  await f.queue().enqueue(mutation);
  assert.equal((await f.queue().drain(async () => {})).synced, 1);
});

test("a pending queue edit prevents a direct writer before any provider request", async () => {
  const f = fixture();
  await f.queue().enqueue(mutation);
  await assert.rejects(
    direct(
      f.queue(),
      () => assert.fail("No provider call before claim"),
      () => {}
    ),
    (error) => error.status === 409
  );
});

test("numeric workout aliases cannot bypass an active canonical claim", async () => {
  const f = fixture();
  await f.queue().beginDirect("event:1");
  const before = f.writes();
  await assert.rejects(f.queue().beginDirect("event:01"), /Invalid workout/);
  await assert.rejects(f.queue().enqueue({ ...mutation, id: "event:01" }), /Invalid workout/);
  await assert.rejects(f.queue().beginDirect("activity:i01"), /Invalid workout/);
  assert.equal(f.writes(), before);
});

test("uncertain direct writes stay blocked across restart and reconcile without another write", async () => {
  const f = fixture();
  await assert.rejects(
    direct(
      f.queue(),
      async () => {
        throw Error("Transport disconnected after acceptance");
      },
      (request) =>
        request("/athlete/0/events/1", {
          method: "PUT",
          body: JSON.stringify({ description: "saved", start_date_local: "2026-10-10T00:00:00" }),
        })
    )
  );
  const before = f.writes();
  assert.deepEqual(await f.queue().summary(), { synced: 0, failed: 1, pending: 0, unknown: 1 });
  for (let count = 0; count < 2; count++)
    assert.deepEqual(await f.queue().drain(() => assert.fail("No replay")), {
      synced: 0,
      failed: 1,
      pending: 0,
      unknown: 1,
    });
  assert.equal(f.writes(), before);
  await assert.rejects(f.queue().enqueue(mutation), (error) => error.status === 409);
  const result = await f.queue().drain(() => assert.fail("No replay"), {
    retryFailed: true,
    reconcileDirect: (claim) =>
      reconcileDirectWorkoutWrite(claim, async (path, options) => {
        assert.equal(path, "/athlete/0/events/1");
        assert.equal(options, undefined);
        return {
          description: "saved",
          start_date_local: "2026-10-10T00:00:00",
          other: "provider field",
        };
      }),
  });
  assert.deepEqual(result, { synced: 1, failed: 0, pending: 0, unknown: 0 });
  await f.queue().enqueue(mutation);
});

test("a mismatched read-back never clears or replays an uncertain direct write", async () => {
  const f = fixture();
  await assert.rejects(
    direct(
      f.queue(),
      async () => {
        throw Error("Timed out");
      },
      (request) =>
        request("/athlete/0/events/1", {
          method: "PUT",
          body: JSON.stringify({ description: "wanted" }),
        })
    )
  );
  const result = await f.queue().drain(() => assert.fail("No replay"), {
    retryFailed: true,
    reconcileDirect: (claim) =>
      reconcileDirectWorkoutWrite(claim, async (_path, options) => {
        assert.equal(options, undefined);
        return { description: "different" };
      }),
  });
  assert.equal(result.unknown, 1);
  assert.equal(result.synced, 0);
  await assert.rejects(
    direct(
      f.queue(),
      () => assert.fail("Claim blocked"),
      () => {}
    ),
    (error) => error.status === 409
  );
});

test("abandoned claims without a write intent expire without provider traffic", async () => {
  const f = fixture();
  await f.queue().beginDirect("event:1");
  f.time(10 * 60_000 + 1);
  assert.deepEqual(await f.queue().drain(() => assert.fail("No write")), {
    synced: 0,
    failed: 0,
    pending: 0,
    unknown: 0,
  });
  const before = f.writes();
  await f.queue().drain(() => {});
  assert.equal(f.writes(), before);
  await f.queue().enqueue(mutation);
});

test("a settlement storage outage after a verified write survives restart without replay", async () => {
  const f = fixture();
  await assert.rejects(
    direct(
      f.queue(),
      async () => ({ description: "saved" }),
      async (request) => {
        await request("/athlete/0/events/1", {
          method: "PUT",
          body: JSON.stringify({ description: "saved" }),
        });
        f.outage(true);
        return { verified: true };
      }
    )
  );
  f.outage(false);
  f.time(10 * 60_000 + 1);
  const outcome = await f.queue().drain(() => assert.fail("No replay"), {
    retryFailed: true,
    reconcileDirect: (claim) =>
      reconcileDirectWorkoutWrite(claim, async () => ({ description: "saved" })),
  });
  assert.equal(outcome.synced, 1);
  assert.equal(outcome.unknown, 0);
});

test("deletion is reconciled only by a read returning404, and rejected writes release their claim", async () => {
  const f = fixture();
  await assert.rejects(
    direct(
      f.queue(),
      async () => {
        throw Error("Lost deletion response");
      },
      (request) => request("/athlete/0/events/1", { method: "DELETE" })
    )
  );
  const outcome = await f.queue().drain(() => assert.fail("No DELETE replay"), {
    retryFailed: true,
    reconcileDirect: (claim) =>
      reconcileDirectWorkoutWrite(claim, async (_path, options) => {
        assert.equal(options, undefined);
        throw Object.assign(Error("Deleted"), { status: 404 });
      }),
  });
  assert.equal(outcome.synced, 1);
  await assert.rejects(
    direct(
      f.queue(),
      async () => {
        throw Object.assign(Error("Denied"), { status: 403 });
      },
      (request) =>
        request("/athlete/0/events/1", {
          method: "PUT",
          body: JSON.stringify({ description: "denied" }),
        })
    )
  );
  assert.equal(Object.keys(f.state().direct_claims).length, 0);
});

test("pairing reconciliation accepts the same numeric ID and never sends a provider write", async () => {
  let calls = 0;
  assert.equal(
    await reconcileDirectWorkoutWrite(
      { intent: { method: "PUT", path: "/activity/i1", body: { paired_event_id: 7 } } },
      async (path, options) => {
        calls++;
        assert.equal(path, "/activity/i1");
        assert.equal(options, undefined);
        return { paired_event_id: "7" };
      }
    ),
    true
  );
  assert.equal(calls, 1);
});
