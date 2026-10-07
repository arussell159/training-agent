import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMutationQueue,
  validateMutation,
  pendingMutationContext,
  freshMutationQueue,
} from "./mutation-queue.mjs";
import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
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
  let ledger = freshMutationQueue();
  const record = {
    async read() {
      return structuredClone(ledger);
    },
    async update(change) {
      const next = structuredClone(ledger);
      const result = change(next);
      ledger = next;
      return structuredClone(result);
    },
  };
  return {
    rows,
    record,
    async getSyncRecord(key) {
      return structuredClone(rows.get(key)?.cursor);
    },
    async upsert(_, items) {
      for (const row of items) rows.set(row.athlete_id, structuredClone(row));
    },
    async listSyncRecords(prefix, { offset = 0 } = {}) {
      return structuredClone(
        [...rows.values()]
          .filter(
            (r) =>
              r.athlete_id.startsWith(prefix) &&
              ["pending", "retry", "failed"].includes(r.cursor.state)
          )
          .slice(offset, offset + 100)
      );
    },
  };
}
test("queue persists before provider calls and operation IDs are idempotent", async () => {
  const store = memory(),
    queue = createMutationQueue(config, store, { record: store.record });
  await queue.enqueue(mutation(1));
  await queue.enqueue(mutation(1));
  assert.equal((await store.record.read()).jobs.length, 1);
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
    queue = createMutationQueue(config, store, { record: store.record });
  await queue.enqueue(mutation(1));
  await queue.enqueue(mutation(2, { description: "latest" }));
  const applied = [];
  await queue.drain(async (m) => applied.push(m.description));
  assert.deepEqual(applied, ["latest"]);
});
test("failed edits preserve ordering while unrelated workouts can sync", async () => {
  const store = memory(),
    queue = createMutationQueue(config, store, { record: store.record });
  await queue.enqueue(mutation(1));
  await queue.enqueue(mutation(2, { type: "move", date: "2026-09-16" }));
  await queue.enqueue(mutation(3, { id: "event:2" }));
  let calls = [];
  const result = await queue.drain(
    async (m) => {
      calls.push(m.operationId);
      if (m.operationId === id(1))
        throw Object.assign(Error("rejected"), { status: 422, writeRejected: true });
    },
    { now: 1000 }
  );
  assert.deepEqual(calls, [id(1), id(3)]);
  assert.equal(result.pending, 1);
  assert.equal(result.failed, 1);
  calls = [];
  await queue.drain(async (m) => calls.push(m.operationId), { now: 2000 });
  assert.deepEqual(calls, []);
  await queue.drain(async (m) => calls.push(m.operationId), { now: 2000, retryFailed: true });
  assert.deepEqual(calls, [id(1), id(2)]);
});
test("unsafe mutations are rejected and moving across today retains the workout", () => {
  assert.throws(() => validateMutation(null), /edit is required/);
  assert.throws(() => validateMutation(mutation(1, { type: "delete" })));
  assert.throws(() => validateMutation(mutation(1, { type: "move", date: "not-date" })));
  const context = pendingMutationContext(
    { history: [], planned: [{ id: "event:1", workout_date: "2026-09-20" }] },
    mutation(1, { type: "move", date: "2026-09-14" })
  );
  assert.equal(context.history[0].workout_date, "2026-09-14");
  assert.equal(context.planned[0].sync_status, "pending");
});

function atomicFixture(identity) {
  const settings = new Map(),
    archive = memory();
  const faults = { unavailable: false, loseNextWrite: false };
  let now = 1000;
  const bootstrap = {
    SUPABASE_URL: "https://queue-fixture.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_queue_fixture_abcdefghijklmnopqrstuvwxyz",
  };
  const fetchImpl = async (url, options) => {
    const params = new URL(url).searchParams;
    const scope = params.get("scope")?.slice(3),
      name = params.get("name")?.slice(3);
    if (!options.method || options.method === "GET") {
      const row = settings.get(`${scope}:${name}`);
      return { ok: true, json: async () => (row ? [structuredClone(row)] : []) };
    }
    if (faults.unavailable) throw new TypeError("mock database unavailable");
    const row = options.method === "POST" ? JSON.parse(options.body)[0] : JSON.parse(options.body);
    const key = `${row.scope}:${row.name}`,
      previous = settings.get(key);
    const accepted =
      options.method === "POST"
        ? !previous
        : previous?.updated_at === params.get("updated_at")?.slice(3);
    if (accepted) settings.set(key, row);
    if (faults.loseNextWrite) {
      faults.loseNextWrite = false;
      throw new TypeError("mock response lost");
    }
    return { ok: true, json: async () => (accepted ? [row] : []) };
  };
  const newQueue = () =>
    createMutationQueue(config, archive, {
      clock: () => now,
      record: createEncryptedRecordStore(
        bootstrap,
        identity,
        {
          namespace: "mutation-queue-test",
          name: "QUEUE",
          fresh: freshMutationQueue,
          timestampCas: true,
        },
        fetchImpl
      ),
    });
  return {
    newQueue,
    faults,
    archive,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("two server instances cannot overwrite a newer edit when enqueue overlaps an older drain", async () => {
  const f = atomicFixture("overlapping-drains"),
    a = f.newQueue(),
    b = f.newQueue();
  let description = "initial";
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers(),
    applied = [];
  await a.enqueue(mutation(10, { description: "older" }));
  const oldDrain = a.drain(async (job) => {
    applied.push(job.description);
    if (job.operationId === id(10)) {
      entered.resolve();
      await release.promise;
    }
    description = job.description;
  });
  await entered.promise;
  await b.enqueue(mutation(11, { description: "latest" }));
  const blocked = await b.drain(async (job) => {
    applied.push(job.description);
    description = job.description;
  });
  assert.equal(blocked.pending, 2);
  assert.deepEqual(applied, ["older"]);
  release.resolve();
  await oldDrain;
  assert.equal(description, "latest");
  assert.deepEqual(applied, ["older", "latest"]);
  assert.equal((await b.enqueue(mutation(11, { description: "latest" }))).state, "synced");
  await assert.rejects(b.enqueue(mutation(11, { description: "different" })), /reused/);
});

test("encrypted CAS permits only one direct or queued writer for the same workout", async () => {
  const f = atomicFixture("direct-versus-queue");
  const outcomes = await Promise.allSettled([
    f.newQueue().beginDirect("event:1"),
    f.newQueue().enqueue(mutation(50)),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = outcomes.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.status, 409);
  if (outcomes[0].status === "fulfilled") {
    await f.newQueue().finishDirect(outcomes[0].value);
    await f.newQueue().enqueue(mutation(50));
  } else {
    await f.newQueue().drain(async () => {});
    await f.newQueue().beginDirect("event:1");
  }
});

test("two fresh server instances cannot both claim the same direct provider writer", async () => {
  const f = atomicFixture("direct-versus-direct");
  const outcomes = await Promise.allSettled([
    f.newQueue().beginDirect("event:1"),
    f.newQueue().beginDirect("event:1"),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((result) => result.status === "rejected").reason.status, 409);
});

test("a claim must be confirmed durably before making any provider call", async () => {
  const f = atomicFixture("unconfirmed-claim");
  await f.newQueue().enqueue(mutation(20));
  f.faults.loseNextWrite = true;
  let calls = 0;
  await assert.rejects(
    f.newQueue().drain(async () => {
      calls++;
    }),
    /response lost/
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await f.newQueue().drain(async () => {
        calls++;
      })
    ).pending,
    1
  );
  f.advance(10 * 60_000 + 1);
  const blocked = await f.newQueue().drain(
    async () => {
      calls++;
    },
    { retryFailed: true, reconcile: async () => false }
  );
  assert.equal(blocked.unknown, 1);
  assert.equal(calls, 0);
});

test("unknown writes survive restart, block successors, and manual reconciliation never replays them", async () => {
  const f = atomicFixture("uncertain-write"),
    first = f.newQueue();
  await first.enqueue(mutation(30, { description: "older" }));
  let description = "initial",
    calls = 0;
  await first.drain(async (job) => {
    calls++;
    description = job.description;
    throw new TypeError("provider response lost");
  });
  await f.newQueue().enqueue(mutation(31, { description: "latest" }));
  const blocked = await f.newQueue().drain(
    async (job) => {
      calls++;
      description = job.description;
    },
    { retryFailed: true }
  );
  assert.equal(blocked.unknown, 1);
  assert.equal(description, "older");
  assert.equal(calls, 1);
  const reconciled = await f.newQueue().drain(
    async (job) => {
      calls++;
      description = job.description;
    },
    {
      retryFailed: true,
      reconcile: async (job) => description === job.description,
    }
  );
  assert.equal(reconciled.synced, 2);
  assert.equal(description, "latest");
  assert.equal(calls, 2);
});

test("a persistence outage after provider success cannot replay the write after restart", async () => {
  const f = atomicFixture("failed-settlement");
  await f.newQueue().enqueue(mutation(40, { description: "older" }));
  let calls = 0,
    description = "initial";
  await assert.rejects(
    f.newQueue().drain(async (job) => {
      calls++;
      description = job.description;
      f.faults.unavailable = true;
    }),
    /unavailable/
  );
  f.faults.unavailable = false;
  await f.newQueue().enqueue(mutation(41, { description: "latest" }));
  await f.newQueue().drain(async (job) => {
    calls++;
    description = job.description;
  });
  assert.equal(calls, 1);
  f.advance(10 * 60_000 + 1);
  await f.newQueue().drain(
    async (job) => {
      calls++;
      description = job.description;
    },
    { retryFailed: true, reconcile: async (job) => description === job.description }
  );
  assert.equal(calls, 2);
  assert.equal(description, "latest");
});

test("legacy migration preserves all pages, keeps original rows, and never automatically retries uncertain jobs", async () => {
  const store = memory(),
    prefix = `mutation:v1:${providerConnection(config)}:`;
  for (let n = 1; n <= 105; n++) {
    const job = {
      mutation: mutation(n, { id: `event:${n}` }),
      state: n === 1 ? "retry" : n === 2 ? "failed" : "pending",
      attempts: 1,
      created_at: new Date(n * 1000).toISOString(),
    };
    store.rows.set(prefix + id(n), { athlete_id: prefix + id(n), cursor: job });
  }
  const originals = structuredClone([...store.rows]);
  const pages = [],
    list = store.listSyncRecords;
  store.listSyncRecords = async (prefix, options) => {
    pages.push(options.offset);
    return list(prefix, options);
  };
  const queue = createMutationQueue(config, store, { record: store.record });
  const applied = [];
  const initial = await queue.drain(async (job) => {
    applied.push(job.operationId);
  });
  await queue.drain(async (job) => {
    applied.push(job.operationId);
  });
  assert.deepEqual(pages, [0, 100]);
  assert.equal(applied.length, 0);
  assert.deepEqual(initial, { synced: 0, failed: 105, pending: 0, unknown: 105 });
  assert.equal(
    (await store.record.read()).jobs.filter((job) => job.state === "unknown").length,
    105
  );
  const restarted = createMutationQueue(config, store, { record: store.record }),
    reads = [];
  const options = {
    retryFailed: true,
    reconcile: async (job) => {
      reads.push(job.operationId);
      return job.operationId !== id(103);
    },
  };
  const first = await restarted.drain(
    () => assert.fail("Imported writes must never replay"),
    options
  );
  const second = await restarted.drain(
    () => assert.fail("Imported writes must never replay"),
    options
  );
  assert.equal(first.synced, 100);
  assert.equal(second.synced, 4);
  assert.equal(second.unknown, 1);
  assert.equal(reads.length, 105);
  assert.equal(new Set(reads).size, 105);
  assert.equal((await restarted.enqueue(mutation(5, { id: "event:5" }))).state, "synced");
  assert.deepEqual(
    [...store.rows].filter(([key]) => key.startsWith(prefix)),
    originals
  );
  assert.equal(store.rows.get(prefix + id(103)).cursor.state, "pending");
  assert.equal(
    (await store.record.read()).jobs.find((job) => job.mutation.operationId === id(103)).state,
    "unknown"
  );
});

test("failed archival retains settled jobs and still returns idempotent success without replay", async () => {
  const store = memory(),
    queue = createMutationQueue(config, store, { record: store.record });
  store.upsert = async () => {
    throw Error("archive unavailable");
  };
  await queue.enqueue(mutation(50));
  let calls = 0;
  await queue.drain(async () => {
    calls++;
  });
  assert.equal((await queue.enqueue(mutation(50))).state, "synced");
  await queue.drain(async () => {
    calls++;
  });
  assert.equal(calls, 1);
  assert.equal((await store.record.read()).jobs.length, 1);
});

test("an overlapping operation-ID retry cannot reenqueue a job compacted while its lookup was pending", async () => {
  const store = memory(),
    queue = createMutationQueue(config, store, { record: store.record });
  const lookup = store.getSyncRecord;
  const firstEntered = Promise.withResolvers(),
    secondEntered = Promise.withResolvers();
  const firstRead = Promise.withResolvers(),
    secondRead = Promise.withResolvers();
  let lookups = 0,
    calls = 0;
  store.getSyncRecord = async (key) => {
    if (key.includes("mutation:v2:")) {
      if (++lookups === 1) {
        firstEntered.resolve();
        return firstRead.promise;
      }
      if (lookups === 2) {
        secondEntered.resolve();
        return secondRead.promise;
      }
    }
    return lookup(key);
  };
  const first = queue.enqueue(mutation(60));
  await firstEntered.promise;
  const retry = queue.enqueue(mutation(60));
  await secondEntered.promise;
  firstRead.resolve(undefined);
  await first;
  await queue.drain(async () => {
    calls++;
  });
  secondRead.resolve(undefined);
  assert.equal((await retry).state, "synced");
  await queue.drain(async () => {
    calls++;
  });
  assert.equal(calls, 1);
});

test("an empty or blocked queue does not issue repeated database writes", async () => {
  const store = memory(),
    queue = createMutationQueue(config, store, { record: store.record });
  let writes = 0;
  const update = store.record.update;
  store.record.update = async (change) => {
    writes++;
    return update(change);
  };
  await queue.drain(async () => {});
  const migrated = writes;
  await queue.drain(async () => {});
  assert.equal(writes, migrated);
  await queue.enqueue(mutation(70));
  await queue.drain(async () => {
    throw Error("unknown provider outcome");
  });
  const uncertain = writes;
  await queue.drain(async () => {
    throw Error("must not repeat");
  });
  assert.equal(writes, uncertain);
});

test("a read-back rejection after a write remains unknown and cannot be retried as a rejected write", async () => {
  const store = memory(),
    queue = createMutationQueue(config, store, { record: store.record });
  await queue.enqueue(mutation(80));
  let calls = 0;
  await queue.drain(async () => {
    calls++;
    throw Object.assign(Error("verification rejected"), { status: 404 });
  });
  const result = await queue.drain(
    async () => {
      calls++;
    },
    { retryFailed: true }
  );
  assert.equal(result.unknown, 1);
  assert.equal(calls, 1);
});

test("large offline descriptions cannot grow the durable queue without a bound", async () => {
  const store = memory(),
    queue = createMutationQueue(config, store, { record: store.record });
  let rejected = false;
  for (let n = 100; n < 150; n++) {
    try {
      await queue.enqueue(mutation(n, { description: "x".repeat(30000), id: `event:${n}` }));
    } catch (error) {
      assert.match(error.message, /queue is full/);
      rejected = true;
      break;
    }
  }
  assert.equal(rejected, true);
  assert.ok(Buffer.byteLength(JSON.stringify(await store.record.read())) <= 1024 * 1024);
});

test("expired archival receipts cannot permanently fill an otherwise empty queue", async () => {
  const store = memory();
  await store.record.update((state) => {
    state.imported = true;
    state.receipts = Object.fromEntries(
      Array.from({ length: 4096 }, (_, index) => [id(index), { archived_at: 0, state: "synced" }])
    );
  });
  const queue = createMutationQueue(config, store, {
    record: store.record,
    clock: () => 1_000_000,
  });
  assert.equal((await queue.enqueue(mutation(5000))).state, "pending");
  assert.equal(Object.keys((await store.record.read()).receipts).length, 0);
});
