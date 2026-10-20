import test from "node:test";
import assert from "node:assert/strict";
import { createMutationQueue, freshMutationQueue } from "./mutation-queue.mjs";
import { withDirectWorkoutWrite, reconcileDirectWorkoutWrite } from "./direct-workout-write.mjs";
import { changeIntervalsEvent, moveIntervalsEvent } from "./intervals.mjs";
import { pairClaimedIntervalsWorkout } from "./workout-pairing.mjs";
import { fakeProvider, fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";
import { loadWorkoutEditor, saveWorkoutEditor, workoutRevision } from "./workout-editor.mjs";
import { savePlannedWorkoutMetrics } from "./planned-workout-metrics.mjs";

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

test("a new calendar delete recovers a lost confirmed move without replaying its PUT", async () => {
  const f = fixture();
  let event = { id: 1, start_date_local: "2026-10-12T06:30:00", category: "WORKOUT" };
  const writes = [];
  const source = async (_path, options = {}) => {
    if (options.method) writes.push(options.method);
    if (options.method === "PUT") {
      event = { ...event, ...JSON.parse(options.body) };
      throw Error("Reply lost after provider accepted move");
    }
    if (options.method === "DELETE") {
      event = null;
      return null;
    }
    if (!event) throw Object.assign(Error("Not found"), { status: 404 });
    return structuredClone(event);
  };
  await assert.rejects(
    direct(f.queue(), source, (request) => moveIntervalsEvent(request, "event:1", "2026-10-13"))
  );
  const result = await withDirectWorkoutWrite(
    {},
    "event:1",
    (request) => changeIntervalsEvent(request, "event:1", "delete"),
    {
      queue: f.queue(),
      request: source,
      replacePending: true,
    }
  );
  assert.equal(result.verified, true);
  assert.deepEqual(writes, ["PUT", "DELETE"]);
  assert.equal(Object.keys(f.state().direct_claims).length, 0);
});

test("an expired unconfirmed claim permits a fresh explicit move after read-back, never its old write", async () => {
  const f = fixture();
  await assert.rejects(
    direct(
      f.queue(),
      async () => {
        throw Error("Lost response");
      },
      (request) =>
        request("/athlete/0/events/1", {
          method: "PUT",
          body: JSON.stringify({ start_date_local: "2026-10-14T00:00:00" }),
        })
    )
  );
  f.time(10 * 60_000 + 1);
  let event = { id: 1, start_date_local: "2026-10-12T06:30:00", category: "WORKOUT" };
  const writes = [];
  const source = async (_path, options = {}) => {
    if (options.method) {
      writes.push(JSON.parse(options.body));
      event = { ...event, ...JSON.parse(options.body) };
    }
    return structuredClone(event);
  };
  const result = await withDirectWorkoutWrite(
    {},
    "event:1",
    (request) => moveIntervalsEvent(request, "event:1", "2026-10-20"),
    {
      queue: f.queue(),
      request: source,
      replacePending: true,
    }
  );
  assert.equal(result.event.start_date_local, "2026-10-20T06:30:00");
  assert.deepEqual(writes, [{ start_date_local: "2026-10-20T06:30:00" }]);
});

test("calendar recovery keeps a recent uncertain mismatch blocked and provider outages retain the claim", async () => {
  const f = fixture();
  await assert.rejects(
    direct(
      f.queue(),
      async () => {
        throw Error("Lost response");
      },
      (request) =>
        request("/athlete/0/events/1", {
          method: "PUT",
          body: JSON.stringify({ description: "wanted" }),
        })
    )
  );
  let writes = 0;
  const options = {
    queue: f.queue(),
    replacePending: true,
    request: async (_path, request = {}) => {
      if (request.method) writes++;
      return { id: 1, description: "different" };
    },
  };
  await assert.rejects(
    withDirectWorkoutWrite({}, "event:1", () => assert.fail("No new write"), options),
    (error) => error.status === 409
  );
  f.time(10 * 60_000 + 1);
  await assert.rejects(
    withDirectWorkoutWrite({}, "event:1", () => assert.fail("No new write"), {
      ...options,
      request: async () => {
        throw Error("Provider unavailable");
      },
    }),
    /Provider unavailable/
  );
  assert.equal(writes, 0);
  assert.equal(Object.keys(f.state().direct_claims).length, 1);
});

test("an explicit calendar action supersedes an unsent queued edit only for its own workout", async () => {
  const f = fixture();
  await f.queue().enqueue(mutation);
  await f
    .queue()
    .enqueue({ ...mutation, id: "event:2", operationId: "00000000-0000-4000-8000-000000000002" });
  let writes = 0;
  const result = await withDirectWorkoutWrite(
    {},
    "event:1",
    async (request) => {
      await request("/athlete/0/events/1", { method: "DELETE" });
      return { verified: true };
    },
    {
      queue: f.queue(),
      replacePending: true,
      request: async (_path, options = {}) => {
        if (options.method) writes++;
        return { id: 1, description: "provider description" };
      },
    }
  );
  assert.equal(result.verified, true);
  assert.equal(writes, 1);
  assert.equal(f.state().jobs.find((job) => job.mutation.id === "event:1").state, "superseded");
  assert.equal(f.state().jobs.find((job) => job.mutation.id === "event:2").state, "pending");
});

test("recovery cannot release a newer queued edit accepted during its provider read", async () => {
  const f = fixture();
  await f.queue().enqueue(mutation);
  const recovered = await f.queue().recoverWorkout("event:1", async () => {
    await f.queue().enqueue({
      ...mutation,
      operationId: "00000000-0000-4000-8000-000000000003",
      description: "newer",
    });
    return { releaseDirect: true, jobs: { [mutation.operationId]: "superseded" } };
  });
  assert.equal(recovered, false);
  assert.equal(f.state().jobs.find((job) => job.mutation.description === "newer").state, "pending");
});

test("an old queued job whose latest write only just failed stays protected until that attempt expires", async () => {
  const f = fixture();
  await f.queue().enqueue(mutation);
  f.time(24 * 60 * 60_000);
  await f.queue().drain(async () => {
    throw Error("Latest write outcome unknown");
  });
  let writes = 0;
  await assert.rejects(
    withDirectWorkoutWrite(
      {},
      "event:1",
      () => {
        writes++;
      },
      {
        queue: f.queue(),
        replacePending: true,
        request: async () => ({ id: 1, description: "different" }),
      }
    ),
    (error) => error.status === 409
  );
  assert.equal(writes, 0);
  f.time(24 * 60 * 60_000 + 10 * 60_000 + 1);
  await withDirectWorkoutWrite(
    {},
    "event:1",
    async () => {
      writes++;
      return { verified: true };
    },
    {
      queue: f.queue(),
      replacePending: true,
      request: async () => ({ id: 1, description: "different" }),
    }
  );
  assert.equal(writes, 1);
});

async function abandonWrite(f, body = { description: "old unconfirmed draft" }) {
  await assert.rejects(
    direct(
      f.queue(),
      async () => {
        throw Error("Transport timed out");
      },
      (request) => request("/athlete/0/events/1", { method: "PUT", body: JSON.stringify(body) })
    )
  );
}

test("refresh does not renew abandoned write age and a new swim edit saves without replaying the old intent", async () => {
  const f = fixture(),
    provider = fakeProvider({ ...fixtureEvent("Swim"), id: 1 });
  const loaded = await loadWorkoutEditor(provider.request, "event:1");
  await abandonWrite(f);
  for (const minute of [11, 12, 13]) {
    f.time(minute * 60_000);
    await f.queue().drain(() => assert.fail("Refresh must never replay a write"), {
      retryFailed: true,
      reconcileDirect: (claim) => reconcileDirectWorkoutWrite(claim, provider.request),
    });
    assert.equal(f.state().direct_claims["event:1"].writeStartedAt, 0);
    assert.equal(f.state().direct_claims["event:1"].startedAt, minute * 60_000);
  }
  const model = structuredClone(loaded.model);
  model.steps[1].recovery.end.value = 25;
  const result = await withDirectWorkoutWrite(
    {},
    "event:1",
    (request) =>
      saveWorkoutEditor(request, "event:1", { model, revision: loaded.revision, reviewed: true }),
    {
      queue: f.queue(),
      request: provider.request,
      recoverPending: true,
    }
  );
  assert.equal(result.verified, true);
  const writes = provider.calls.filter((call) => call.method);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PUT");
  assert.match(JSON.parse(writes[0].body).description, /25s/);
  assert.doesNotMatch(JSON.parse(writes[0].body).description, /old unconfirmed draft/);
  assert.equal(Object.keys(f.state().direct_claims).length, 0);
});

test("editor recovery retains revision conflicts and sends no write after an external edit", async () => {
  const f = fixture(),
    provider = fakeProvider({ ...fixtureEvent("Swim"), id: 1 });
  const loaded = await loadWorkoutEditor(provider.request, "event:1");
  await abandonWrite(f);
  f.time(11 * 60_000);
  provider.setEvent({ ...provider.event(), name: "Coach's newer title" });
  loaded.model.notes = "My still-unsaved notes";
  await assert.rejects(
    withDirectWorkoutWrite(
      {},
      "event:1",
      (request) =>
        saveWorkoutEditor(request, "event:1", { model: loaded.model, revision: loaded.revision }),
      {
        queue: f.queue(),
        request: provider.request,
        recoverPending: true,
      }
    ),
    (error) => error.code === "CONFLICT" && error.status === 409
  );
  assert.equal(provider.calls.filter((call) => call.method).length, 0);
  assert.equal(provider.event().name, "Coach's newer title");
  assert.equal(Object.keys(f.state().direct_claims).length, 0);
});

test("compact planned-value recovery also preserves its revision guard", async () => {
  const f = fixture(),
    provider = fakeProvider({ ...fixtureEvent("Swim"), id: 1 });
  const revision = workoutRevision(provider.event());
  await abandonWrite(f);
  f.time(11 * 60_000);
  const result = await withDirectWorkoutWrite(
    {},
    "event:1",
    (request) =>
      savePlannedWorkoutMetrics(request, "event:1", { revision, name: "Revised swim", values: {} }),
    {
      queue: f.queue(),
      request: provider.request,
      recoverPending: true,
    }
  );
  assert.equal(result.verified, true);
  assert.equal(result.event.name, "Revised swim");
  assert.equal(provider.calls.filter((call) => call.method).length, 1);
  const stale = workoutRevision(provider.event());
  await abandonWrite(f);
  f.time(22 * 60_000);
  provider.setEvent({ ...provider.event(), name: "New external title" });
  await assert.rejects(
    withDirectWorkoutWrite(
      {},
      "event:1",
      (request) =>
        savePlannedWorkoutMetrics(request, "event:1", {
          revision: stale,
          name: "Do not overwrite",
          values: {},
        }),
      {
        queue: f.queue(),
        request: provider.request,
        recoverPending: true,
      }
    ),
    (error) => error.code === "CONFLICT"
  );
  assert.equal(provider.calls.filter((call) => call.method).length, 1);
});

test("editor recovery cannot release a recent uncertain write or an active reconciliation lease", async () => {
  const f = fixture(),
    provider = fakeProvider({ ...fixtureEvent("Swim"), id: 1 });
  await abandonWrite(f);
  const options = { queue: f.queue(), request: provider.request, recoverPending: true };
  await assert.rejects(
    withDirectWorkoutWrite({}, "event:1", () => assert.fail("Recent write stays locked"), options),
    (error) => error.code === "WORKOUT_WRITE_BUSY"
  );
  f.time(11 * 60_000);
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  const checking = f.queue().drain(() => assert.fail("No replay"), {
    retryFailed: true,
    reconcileDirect: async () => {
      entered.resolve();
      return release.promise;
    },
  });
  await entered.promise;
  const before = provider.calls.length;
  await assert.rejects(
    withDirectWorkoutWrite({}, "event:1", () => assert.fail("Active check stays locked"), options),
    (error) => error.code === "WORKOUT_WRITE_BUSY"
  );
  assert.equal(provider.calls.length, before);
  release.resolve(false);
  await checking;
  assert.equal(f.state().direct_claims["event:1"].writeStartedAt, 0);
});

test("editor recovery does not discard unsent or rejected queued edits, even when old", async () => {
  for (const rejected of [false, true]) {
    const f = fixture();
    await f.queue().enqueue({ ...mutation, type: "move", date: "2026-11-01" });
    if (rejected)
      await f.queue().drain(async () => {
        throw Object.assign(Error("Provider rejected move"), { writeRejected: true });
      });
    f.time(24 * 60 * 60_000);
    await assert.rejects(
      withDirectWorkoutWrite({}, "event:1", () => assert.fail("Queued move remains protected"), {
        queue: f.queue(),
        request: async () => ({ id: 1, start_date_local: "2026-10-21T06:00:00" }),
        recoverPending: true,
      }),
      (error) => error.code === "WORKOUT_WRITE_BUSY"
    );
    assert.equal(f.state().jobs[0].state, rejected ? "failed" : "pending");
  }
});

test("queued reconciliation preserves transport age so an expired unknown edit can be superseded without replay", async () => {
  const f = fixture();
  await f.queue().enqueue(mutation);
  await f.queue().drain(async () => {
    throw Error("Transport outcome unknown");
  });
  for (const minute of [11, 12]) {
    f.time(minute * 60_000);
    await f
      .queue()
      .drain(() => assert.fail("No replay"), { retryFailed: true, reconcile: async () => false });
    assert.equal(f.state().jobs[0].last_write_attempt_at, 0);
    assert.equal(f.state().jobs[0].last_attempt_at, 0);
  }
  let actionCalls = 0;
  await withDirectWorkoutWrite(
    {},
    "event:1",
    async () => {
      actionCalls++;
    },
    {
      queue: f.queue(),
      request: async () => ({ id: 1, description: "unchanged provider" }),
      recoverPending: true,
    }
  );
  assert.equal(actionCalls, 1);
  assert.equal(f.state().jobs[0].state, "superseded");
});

test("linking protects both the plan and recording from concurrent moves, deletes or edits", async () => {
  const f = fixture(),
    entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  let paired = false;
  const request = async (path, options = {}) => {
    if (options.method === "PUT") {
      entered.resolve();
      await release.promise;
      paired = true;
    }
    if (path === "/athlete/0/events/1")
      return { id: 1, category: "WORKOUT", type: "Ride", start_date_local: "2026-10-19T00:00:00" };
    return {
      id: "i42",
      type: "Ride",
      start_date_local: "2026-10-19T08:00:00",
      ...(paired ? { paired_event_id: 1 } : {}),
    };
  };
  const write = (id, action) =>
    withDirectWorkoutWrite({}, id, action, { queue: f.queue(), request });
  const linking = pairClaimedIntervalsWorkout(write, "event:1", "activity:i42");
  await entered.promise;
  await assert.rejects(
    write("event:1", () => assert.fail("Plan must stay locked")),
    (error) => error.status === 409
  );
  await assert.rejects(
    write("activity:i42", () => assert.fail("Recording must stay locked")),
    (error) => error.status === 409
  );
  release.resolve();
  assert.equal((await linking).activity.paired_event_id, 1);
  assert.equal(Object.keys(f.state().direct_claims).length, 0);
});
