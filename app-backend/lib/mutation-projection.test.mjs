import test from "node:test";
import assert from "node:assert/strict";
import { createContextStore } from "./supabase-context.mjs";
import { createMutationProjection } from "./mutation-projection.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
import { fastViewId, saveFastView } from "./fast-context.mjs";
import { preserveQueuedSnapshot } from "./queued-snapshot.mjs";

const operation = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = (n, description, workout = "event:1") => ({
  sequence: n,
  mutation: { operationId: operation(n), id: workout, type: "description", description },
});
function fixture(name) {
  const config = {
    SUPABASE_URL: `https://projection-${name}.supabase.co`,
    SUPABASE_SECRET_KEY: "sb_secret_projection_fixture_abcdefghijklmnopqrstuvwxyz",
    INTERVALS_API_KEY: "fixture",
  };
  const initial = {
    provider: "intervals",
    provider_connection: providerConnection(config),
    athlete: { id: "1", time_zone: "America/Chicago" },
    history: [],
    planned: [1, 2].map((n) => ({
      id: `event:${n}`,
      workout_date: "2026-10-10",
      details: "original",
      completed: false,
    })),
    synced_at: "2026-10-06T12:00:00Z",
  };
  const rows = new Map([
    [
      "1",
      {
        athlete_id: "1",
        status: "ready",
        cursor: { context: initial },
        updated_at: "2026-10-06T12:00:00.000000Z",
      },
    ],
  ]);
  let beforeWrite = async () => {};
  const fetchImpl = async (url, options) => {
    const params = new URL(url).searchParams;
    const id = params.get("athlete_id")?.slice(3);
    if (!options.method || options.method === "GET") {
      const values = id
        ? [rows.get(id)].filter(Boolean)
        : [...rows.values()].filter((row) => row.status === "ready");
      return { ok: true, text: async () => JSON.stringify(structuredClone(values)) };
    }
    const incoming =
      options.method === "POST" ? JSON.parse(options.body)[0] : JSON.parse(options.body);
    await beforeWrite(incoming);
    const existing = rows.get(incoming.athlete_id);
    const accepted =
      options.method === "POST"
        ? !existing
        : existing?.updated_at === params.get("updated_at")?.slice(3);
    if (accepted) rows.set(incoming.athlete_id, incoming);
    return { ok: true, text: async () => JSON.stringify(accepted ? [incoming] : []) };
  };
  const store = () => createContextStore(config, undefined, fetchImpl);
  return {
    config,
    rows,
    store,
    projection: () => createMutationProjection(config, store()),
    hook: (value) => {
      beforeWrite = value;
    },
  };
}
const details = (row, id) =>
  [...row.cursor.context.history, ...row.cursor.context.planned].find(
    (workout) => workout.id === id
  )?.details;

test("delayed older pending projections cannot overwrite a newer edit for the same workout", async () => {
  const f = fixture("same-workout"),
    entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  let held = false;
  f.hook(async (row) => {
    if (!held && row.athlete_id === "1" && row.cursor.context.planned[0].sync_sequence === 1) {
      held = true;
      entered.resolve();
      await release.promise;
    }
  });
  const old = f.projection().pending(job(1, "older"));
  await entered.promise;
  await f.projection().pending(job(2, "latest"));
  release.resolve();
  const response = await old;
  assert.equal(details(f.rows.get("1"), "event:1"), "latest");
  assert.equal(response.planned.find((workout) => workout.id === "event:1").details, "latest");
  assert.equal(
    f.rows.get(fastViewId(f.config)).cursor.planned.find((workout) => workout.id === "event:1")
      .details,
    "latest"
  );
});

test("overlapping projections for different workouts preserve both edits", async () => {
  const f = fixture("different-workouts"),
    entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  let held = false;
  f.hook(async (row) => {
    if (!held && row.athlete_id === "1" && row.cursor.context.planned[0].sync_sequence === 1) {
      held = true;
      entered.resolve();
      await release.promise;
    }
  });
  const first = f.projection().pending(job(1, "first edit"));
  await entered.promise;
  await f.projection().pending(job(2, "second edit", "event:2"));
  release.resolve();
  await first;
  assert.equal(details(f.rows.get("1"), "event:1"), "first edit");
  assert.equal(details(f.rows.get("1"), "event:2"), "second edit");
});

test("an older flush result cannot mark a newer pending edit synced", async () => {
  const f = fixture("flush-status");
  await f.projection().pending(job(1, "older"));
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  let held = false;
  f.hook(async (row) => {
    if (!held && row.athlete_id === "1" && row.cursor.context.planned[0].sync_status === "synced") {
      held = true;
      entered.resolve();
      await release.promise;
    }
  });
  const flush = f.projection().status(job(1, "older").mutation, "synced");
  await entered.promise;
  await f.projection().pending(job(2, "latest"));
  release.resolve();
  await flush;
  const workout = f.rows.get("1").cursor.context.planned[0];
  assert.equal(workout.details, "latest");
  assert.equal(workout.sync_status, "pending");
  assert.equal(workout.sync_operation, operation(2));
});

test("delayed prepared-view writes cannot replace views from a newer snapshot", async () => {
  const f = fixture("view-order"),
    entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  let held = false;
  f.hook(async (row) => {
    if (
      !held &&
      row.athlete_id === fastViewId(f.config) &&
      row.cursor.planned[0].details === "older"
    ) {
      held = true;
      entered.resolve();
      await release.promise;
    }
  });
  const old = f.projection().pending(job(1, "older"));
  await entered.promise;
  await f.projection().pending(job(2, "latest"));
  release.resolve();
  await old;
  assert.equal(f.rows.get(fastViewId(f.config)).cursor.planned[0].details, "latest");
  assert.equal(f.rows.get(fastViewId(f.config, "week")).cursor.planned[0].details, "latest");
});

test("a concurrent whole-context sync retains accepted queue edits and ordered views", async () => {
  const f = fixture("whole-sync"),
    incoming = structuredClone(f.rows.get("1").cursor.context);
  incoming.metrics = { fitness: 99 };
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  let held = false;
  f.hook(async (row) => {
    if (!held && row.athlete_id === "1" && row.cursor.context.metrics?.fitness === 99) {
      held = true;
      entered.resolve();
      await release.promise;
    }
  });
  const store = f.store();
  const sync = (async () => {
    const saved = await store.updateSyncRecord("1", (current, revision) => ({
      status: "ready",
      cursor: {
        context: {
          ...preserveQueuedSnapshot(current.cursor.context, incoming),
          queue_snapshot_revision: revision,
        },
      },
    }));
    await saveFastView(f.config, store, saved.cursor.context);
  })();
  await entered.promise;
  await f.projection().pending(job(2, "latest"));
  release.resolve();
  await sync;
  assert.equal(details(f.rows.get("1"), "event:1"), "latest");
  assert.equal(f.rows.get("1").cursor.context.metrics.fitness, 99);
  assert.equal(f.rows.get(fastViewId(f.config)).cursor.planned[0].details, "latest");
});

test("source refreshes can update settled queued workouts after their read is current", async () => {
  const f = fixture("settled-refresh");
  await f.projection().pending(job(1, "saved"));
  await f.projection().status(job(1, "saved").mutation, "synced");
  const current = structuredClone(f.rows.get("1").cursor.context),
    incoming = structuredClone(current);
  incoming.planned = incoming.planned.map((workout) => ({
    ...Object.fromEntries(Object.entries(workout).filter(([key]) => !key.startsWith("sync_"))),
    details: "provider correction",
  }));
  const merged = preserveQueuedSnapshot(current, incoming).planned[0];
  assert.equal(merged.details, "provider correction");
  assert.equal(merged.sync_sequence, 1);
  assert.equal(merged.sync_status, "synced");
});

test("a stale whole-context writer cannot resurrect the pending status of a settled queue operation", async () => {
  const f = fixture("stale-status");
  await f.projection().pending(job(1, "saved"));
  const stale = structuredClone(f.rows.get("1").cursor.context);
  await f.projection().status(job(1, "saved").mutation, "synced");
  const current = f.rows.get("1").cursor.context;
  const merged = preserveQueuedSnapshot(current, stale);
  assert.equal(merged.planned[0].sync_status, "synced");
  assert.equal(merged.planned[0].sync_operation, null);
});

test("a delayed enqueue projection cannot reset an already settled claim to pending", async () => {
  const f = fixture("settle-before-enqueue");
  await f.projection().status(job(1, "saved").mutation, "synced", {}, 1);
  await f.projection().pending(job(1, "saved"));
  const workout = f.rows.get("1").cursor.context.planned[0];
  assert.equal(workout.details, "saved");
  assert.equal(workout.sync_status, "synced");
  assert.equal(workout.sync_operation, null);
});

test("repeated projection of an existing settled sequence remains settled", async () => {
  const f = fixture("same-sequence");
  await f.projection().pending(job(1, "saved"));
  await f.projection().status(job(1, "saved").mutation, "synced", {}, 1);
  await f.projection().pending(job(1, "saved"));
  assert.equal(f.rows.get("1").cursor.context.planned[0].sync_status, "synced");
});

test("reversed projections of independent edits preserve both fields and settle each operation", async () => {
  const f = fixture("independent-fields");
  const description = job(1, "accepted description");
  const move = {
    sequence: 2,
    mutation: { operationId: operation(2), id: "event:1", type: "move", date: "2026-10-11" },
  };
  await f.projection().pending(move);
  await f.projection().pending(description);
  let workout = f.rows.get("1").cursor.context.planned[0];
  assert.equal(workout.details, "accepted description");
  assert.equal(workout.workout_date, "2026-10-11");
  assert.equal(workout.sync_operation, operation(2));
  assert.equal(workout.sync_sequence, 2);
  await f.projection().status(description.mutation, "synced", {}, description.sequence);
  workout = f.rows.get("1").cursor.context.planned[0];
  assert.equal(workout.sync_status, "pending");
  assert.equal(workout.sync_operation, operation(2));
  await f.projection().status(move.mutation, "synced", {}, move.sequence);
  await f.projection().pending(description);
  await f.projection().pending(move);
  workout = f.rows.get("1").cursor.context.planned[0];
  assert.equal(workout.details, "accepted description");
  assert.equal(workout.workout_date, "2026-10-11");
  assert.equal(workout.sync_status, "synced");
  assert.equal(workout.sync_operation, null);
  const view = f.rows.get(fastViewId(f.config)).cursor.planned.find((row) => row.id === "event:1");
  assert.equal(view.details, "accepted description");
  assert.equal(view.workout_date, "2026-10-11");
  assert.equal(view.sync_status, "synced");
});

test("a fresh provider row retains settled watermarks against delayed original enqueue projections", async () => {
  const f = fixture("refresh-watermarks"),
    accepted = job(1, "accepted");
  await f.projection().status(accepted.mutation, "synced", {}, accepted.sequence);
  const incoming = structuredClone(f.rows.get("1").cursor.context);
  const refreshed = (workout) => ({
    ...Object.fromEntries(Object.entries(workout).filter(([key]) => !key.startsWith("sync_"))),
    details: "provider correction",
  });
  incoming.history = incoming.history.map(refreshed);
  incoming.planned = incoming.planned.map(refreshed);
  const store = f.store();
  const saved = await store.updateSyncRecord("1", (current, revision) => ({
    status: "ready",
    cursor: {
      context: {
        ...preserveQueuedSnapshot(current.cursor.context, incoming),
        queue_snapshot_revision: revision,
      },
    },
  }));
  await saveFastView(f.config, store, saved.cursor.context);
  await f.projection().pending(accepted);
  const workout = f.rows.get("1").cursor.context.planned[0];
  assert.equal(workout.details, "provider correction");
  assert.equal(workout.sync_sequence, 1);
  assert.equal(workout.sync_mutations.description.status, "synced");
  assert.equal(workout.sync_status, "synced");
  assert.equal(workout.sync_operation, null);
  assert.equal(f.rows.get(fastViewId(f.config)).cursor.planned[0].details, "provider correction");
});

test("a claimed verified editor row rebases onto current unrelated edits and keeps settled watermarks", async () => {
  const f = fixture("verified-direct-rebase");
  await f.projection().status(job(1, "queued description").mutation, "synced", {}, 1);
  const stale = structuredClone(f.rows.get("1").cursor.context);
  stale.planned = stale.planned.map((row) =>
    row.id === "event:1"
      ? {
          id: row.id,
          workout_date: row.workout_date,
          details: "verified editor structure",
          workout_summary: { planned: { duration_seconds: 1800 } },
        }
      : row
  );
  await f.projection().pending(job(2, "unrelated pending description", "event:2"));
  const current = f.rows.get("1").cursor.context;
  current.metrics = { fitness: 77 };
  const merged = preserveQueuedSnapshot(current, stale, { verifiedIds: ["event:1"] });
  const target = merged.planned.find((row) => row.id === "event:1");
  assert.equal(target.details, "verified editor structure");
  assert.equal(target.workout_summary.planned.duration_seconds, 1800);
  assert.equal(target.sync_sequence, 1);
  assert.equal(target.sync_status, "synced");
  assert.equal(
    merged.planned.find((row) => row.id === "event:2").details,
    "unrelated pending description"
  );
  assert.equal(merged.metrics.fitness, 77);
  await f.store().updateSyncRecord("1", (_row, revision) => ({
    status: "ready",
    cursor: { context: { ...merged, queue_snapshot_revision: revision } },
  }));
  await f.projection().pending(job(1, "queued description"));
  assert.equal(details(f.rows.get("1"), "event:1"), "verified editor structure");
});

test("a claimed verified deletion survives a stale whole-sync CAS retry", async () => {
  const f = fixture("verified-delete-rebase"),
    store = f.store();
  const stale = structuredClone(f.rows.get("1").cursor.context);
  stale.sync_started_at = "2026-10-06T12:00:00Z";
  stale.metrics = { fitness: 88 };
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  let held = false;
  f.hook(async (row) => {
    if (!held && row.athlete_id === "1" && row.cursor.context.metrics?.fitness === 88) {
      held = true;
      entered.resolve();
      await release.promise;
    }
  });
  const sync = store.updateSyncRecord("1", (current, revision) => ({
    status: "ready",
    cursor: {
      context: {
        ...preserveQueuedSnapshot(current.cursor.context, stale),
        queue_snapshot_revision: revision,
      },
    },
  }));
  await entered.promise;
  const deleted = structuredClone(f.rows.get("1").cursor.context);
  deleted.planned = deleted.planned.filter((row) => row.id !== "event:1");
  deleted.app_deleted_workouts = { "event:1": "2026-10-06T12:00:01Z" };
  await f.store().updateSyncRecord("1", (current, revision) => ({
    status: "ready",
    cursor: {
      context: {
        ...preserveQueuedSnapshot(current.cursor.context, deleted, { verifiedIds: ["event:1"] }),
        queue_snapshot_revision: revision,
      },
    },
  }));
  release.resolve();
  const saved = await sync;
  await saveFastView(f.config, store, saved.cursor.context);
  assert.equal(
    saved.cursor.context.planned.some((row) => row.id === "event:1"),
    false
  );
  assert.equal(saved.cursor.context.app_deleted_workouts["event:1"], "2026-10-06T12:00:01Z");
  assert.equal(saved.cursor.context.metrics.fitness, 88);
  assert.equal(
    f.rows.get(fastViewId(f.config)).cursor.planned.some((row) => row.id === "event:1"),
    false
  );
});
