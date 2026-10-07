import { providerConnection } from "./completed-workout-store.mjs";
import { validDate } from "./intervals.mjs";
import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { createHash, randomUUID } from "node:crypto";

export function validateMutation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("A workout edit is required");
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.operationId || "")
  )
    throw Error("A valid operation ID is required");
  if (!/^(event:[1-9]\d*|activity:i?[1-9]\d*)$/.test(input.id || ""))
    throw Error("Invalid workout");
  if (input.type === "move") {
    if (!input.id.startsWith("event:")) throw Error("Only planned events can be moved");
    validDate(input.date);
  } else if (input.type === "description") {
    if (typeof input.description !== "string" || input.description.length > 30000)
      throw Error("Description must be text under 30,000 characters");
  } else throw Error("Only idempotent moves and description edits can be queued");
  return {
    operationId: input.operationId,
    id: input.id,
    type: input.type,
    ...(input.type === "move" ? { date: input.date } : { description: input.description }),
  };
}

export function mutationSyncFields(workout, mutations) {
  const edits = Object.values(mutations);
  const active = edits.filter((edit) => edit.status !== "synced");
  const latest = [...active].sort((a, b) => b.sequence - a.sequence)[0];
  return {
    sync_mutations: mutations,
    sync_sequence: Math.max(workout.sync_sequence || 0, ...edits.map((edit) => edit.sequence)),
    sync_status: active.some((edit) => edit.status === "failed")
      ? "failed"
      : active.length
        ? "pending"
        : "synced",
    sync_operation: latest?.operationId || null,
  };
}

export function pendingMutationContext(context, mutation, sequence) {
  let found = false,
    changed = false;
  const map = (workout) => {
    if (workout.id !== mutation.id) return workout;
    found = true;
    const previous = workout.sync_mutations?.[mutation.type];
    if (
      sequence != null &&
      (previous?.sequence >= sequence ||
        (!workout.sync_mutations && workout.sync_sequence >= sequence))
    )
      return workout;
    changed = true;
    const patch =
      mutation.type === "description"
        ? { details: mutation.description, goal: mutation.description }
        : {
            workout_date: mutation.date,
            day: new Date(`${mutation.date}T12:00:00Z`)
              .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
              .toUpperCase(),
            date: new Date(`${mutation.date}T12:00:00Z`).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }),
          };
    return {
      ...workout,
      ...patch,
      ...(sequence != null
        ? mutationSyncFields(workout, {
            ...workout.sync_mutations,
            [mutation.type]: { sequence, operationId: mutation.operationId, status: "pending" },
          })
        : { sync_status: "pending", sync_operation: mutation.operationId }),
      app_updated_at: new Date().toISOString(),
    };
  };
  // Keep the updated item in both collections until the projection repartitions
  // by its new date. This avoids losing an item moved across today's boundary.
  const sessions = [
    ...new Map(
      [...(context.history || []), ...(context.planned || [])].map((w) => [w.id, map(w)])
    ).values(),
  ];
  if (!found) throw Error("Workout is not in the saved calendar; refresh before editing");
  if (!changed) return context;
  return { ...context, history: sessions, planned: sessions };
}

export const freshMutationQueue = () => ({
  imported: false,
  sequence: 0,
  jobs: [],
  receipts: {},
  direct_claims: {},
});
const terminal = (job) => ["synced", "superseded"].includes(job.state);
const sameMutation = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mutationHash = (mutation) =>
  createHash("sha256").update(JSON.stringify(mutation)).digest("hex");
// Longer than the deployed handler's five-minute lifetime. An expired write is
// never released for replay: it becomes unknown and requires read-only reconciliation.
const CLAIM_TIMEOUT_MS = 10 * 60_000;
function pruneReceipts(state, now) {
  state.receipts ||= {};
  for (const [id, receipt] of Object.entries(state.receipts))
    if (now - receipt.archived_at >= CLAIM_TIMEOUT_MS) delete state.receipts[id];
}
function busyWorkout() {
  const error = Error(
    "This workout has an edit being saved or verified. Refresh to verify it before saving again. Your draft is retained."
  );
  error.status = 409;
  error.code = "WORKOUT_WRITE_BUSY";
  return error;
}
function mutationCounts(state, time, synced = 0) {
  const remaining = state.jobs.filter((job) => !terminal(job));
  const direct = Object.values(state.direct_claims || {});
  const uncertainDirect = direct.filter(
    (claim) =>
      claim.state === "unknown" || (claim.intent && time - claim.startedAt >= CLAIM_TIMEOUT_MS)
  ).length;
  const failed =
    remaining.filter((job) => ["failed", "unknown"].includes(job.state)).length + uncertainDirect;
  return {
    synced,
    failed,
    pending: remaining.length + direct.length - failed,
    unknown: remaining.filter((job) => job.state === "unknown").length + uncertainDirect,
  };
}

export function createMutationQueue(config, store, { record, clock = Date.now } = {}) {
  const connection = providerConnection(config);
  const prefix = `mutation:v1:${connection}:`;
  const archivePrefix = `mutation:v2:${connection}:`;
  record ||= createEncryptedRecordStore(config, connection, {
    namespace: "mutation-queue",
    name: "MUTATION_QUEUE",
    fresh: freshMutationQueue,
    timestampCas: true,
  });
  const read = async () => {
    const current = await record.read();
    if (current.imported) return current;
    const legacy = [];
    for (let offset = 0; ; offset += 100) {
      const rows = await store.listSyncRecords(prefix, { offset });
      legacy.push(...rows.map((row) => row.cursor));
      if (rows.length < 100) break;
      if (legacy.length >= 1024)
        throw Error("The saved edit queue needs recovery before adding more edits.");
    }
    legacy.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return record.update((state) => {
      if (!state.imported) {
        for (const job of legacy) {
          const mutation = validateMutation(job.mutation);
          if (!state.jobs.some((item) => item.mutation.operationId === mutation.operationId))
            state.jobs.push({
              ...job,
              mutation,
              // v1 did not persist a running claim before transport. Even a
              // pending row can describe a provider write whose reply or final
              // persistence was lost, so historical edits require read-back.
              state: ["pending", "retry", "failed"].includes(job.state) ? "unknown" : job.state,
              sequence: ++state.sequence,
            });
        }
        state.imported = true;
      }
      return structuredClone(state);
    });
  };
  const compact = async (current) => {
    try {
      const completed = current.jobs.filter(terminal);
      if (!completed.length) return current;
      // Confirm archival before removing full payloads from the bounded ledger.
      // Existing v1 records are retained unchanged for historical recovery.
      await store.upsert(
        "sync_state",
        completed.map((job) => ({
          athlete_id: archivePrefix + job.mutation.operationId,
          status: "mutation",
          cursor: job,
          updated_at: new Date(clock()).toISOString(),
        }))
      );
      const ids = new Set(completed.map((job) => job.mutation.operationId));
      return await record.update((state) => {
        state.receipts ||= {};
        for (const job of state.jobs.filter(
          (job) => terminal(job) && ids.has(job.mutation.operationId)
        ))
          state.receipts[job.mutation.operationId] = {
            hash: mutationHash(job.mutation),
            state: job.state,
            sequence: job.sequence,
            archived_at: clock(),
            ...(job.synced_at ? { synced_at: job.synced_at } : {}),
          };
        pruneReceipts(state, clock());
        state.jobs = state.jobs.filter(
          (job) => !terminal(job) || !ids.has(job.mutation.operationId)
        );
        return structuredClone(state);
      });
    } catch {
      return current; /* Retain ledger entries if archival or its confirmation is unavailable. */
    }
  };
  return {
    async summary() {
      return mutationCounts(await read(), clock());
    },
    async beginDirect(id) {
      if (!/^(event:[1-9]\d*|activity:i?[1-9]\d*)$/.test(id || "")) throw Error("Invalid workout");
      await read();
      return record.update((state) => {
        state.direct_claims ||= {};
        const current = state.direct_claims[id];
        if (current && !current.intent && clock() - current.startedAt >= CLAIM_TIMEOUT_MS)
          delete state.direct_claims[id];
        if (
          state.direct_claims[id] ||
          state.jobs.some((job) => job.mutation.id === id && !terminal(job))
        )
          throw busyWorkout();
        if (Object.keys(state.direct_claims).length >= 1024)
          throw Error("The saved edit queue is full. Refresh before adding more edits.");
        const claim = {
          workoutId: id,
          token: randomUUID(),
          startedAt: clock(),
          state: "running",
          intent: null,
        };
        state.direct_claims[id] = claim;
        return structuredClone(claim);
      });
    },
    async directIntent(claim, intent) {
      const [kind, id] = claim.workoutId.split(":");
      const expectedPath = kind === "event" ? `/athlete/0/events/${id}` : `/activity/${id}`;
      if (intent.path !== expectedPath || !["PUT", "PATCH", "DELETE"].includes(intent.method))
        throw Error("The workout write does not match its saved claim.");
      return record.update((state) => {
        const current = state.direct_claims?.[claim.workoutId];
        if (current?.token !== claim.token || current.state !== "running") throw busyWorkout();
        if (current.intent)
          throw Error("This workout write has already been submitted. Refresh to verify it.");
        current.intent = structuredClone(intent);
        if (Buffer.byteLength(JSON.stringify(state)) > 1024 * 1024)
          throw Error("The saved edit queue is full. Refresh before adding more edits.");
      });
    },
    async finishDirect(claim, { unknown = false } = {}) {
      return record.update((state) => {
        const current = state.direct_claims?.[claim.workoutId];
        if (current?.token !== claim.token) throw busyWorkout();
        if (unknown) current.state = "unknown";
        else delete state.direct_claims[claim.workoutId];
      });
    },
    async enqueue(input) {
      const mutation = validateMutation(input);
      const current = await read();
      const receipt = current.receipts?.[mutation.operationId];
      if (receipt) {
        if (receipt.hash !== mutationHash(mutation))
          throw Error("Operation ID cannot be reused for a different edit");
        return { mutation, ...receipt };
      }
      const previous =
        current.jobs.find((job) => job.mutation.operationId === mutation.operationId) ||
        (await store.getSyncRecord(archivePrefix + mutation.operationId, { fresh: true })) ||
        (await store.getSyncRecord(prefix + mutation.operationId, { fresh: true }));
      if (previous) {
        if (!sameMutation(previous.mutation, mutation))
          throw Error("Operation ID cannot be reused for a different edit");
        return previous;
      }
      return record.update((state) => {
        const receipt = state.receipts?.[mutation.operationId];
        if (receipt) {
          if (receipt.hash !== mutationHash(mutation))
            throw Error("Operation ID cannot be reused for a different edit");
          return { mutation, ...receipt };
        }
        const previous = state.jobs.find(
          (job) => job.mutation.operationId === mutation.operationId
        );
        if (previous) {
          if (!sameMutation(previous.mutation, mutation))
            throw Error("Operation ID cannot be reused for a different edit");
          return structuredClone(previous);
        }
        const direct = state.direct_claims?.[mutation.id];
        if (direct && !direct.intent && clock() - direct.startedAt >= CLAIM_TIMEOUT_MS)
          delete state.direct_claims[mutation.id];
        else if (direct) throw busyWorkout();
        pruneReceipts(state, clock());
        if (state.jobs.length >= 1024 || Object.keys(state.receipts).length >= 4096)
          throw Error("The saved edit queue is full. Refresh before adding more edits.");
        for (const older of state.jobs)
          if (
            ["pending", "retry", "failed"].includes(older.state) &&
            older.mutation.id === mutation.id &&
            older.mutation.type === mutation.type
          )
            older.state = "superseded";
        const job = {
          mutation,
          state: "pending",
          attempts: 0,
          sequence: ++state.sequence,
          created_at: new Date(clock()).toISOString(),
        };
        state.jobs.push(job);
        if (Buffer.byteLength(JSON.stringify(state)) > 1024 * 1024)
          throw Error("The saved edit queue is full. Refresh before adding more edits.");
        return structuredClone(job);
      });
    },
    async drain(apply, { retryFailed = false, now, reconcile, reconcileDirect } = {}) {
      let initial = await read();
      if (!initial.jobs.length && !Object.keys(initial.direct_claims || {}).length)
        return { synced: 0, failed: 0, pending: 0, unknown: 0 };
      let synced = 0;
      for (const direct of Object.values(initial.direct_claims || {})) {
        const expired = (now ?? clock()) - direct.startedAt >= CLAIM_TIMEOUT_MS;
        if (direct.state !== "unknown" && !expired) continue;
        if (direct.intent && (!retryFailed || !reconcileDirect)) continue;
        const token = randomUUID();
        const claimed = await record.update((state) => {
          const current = state.direct_claims?.[direct.workoutId];
          if (current?.token !== direct.token) return null;
          if (!current.intent) {
            delete state.direct_claims[direct.workoutId];
            return null;
          }
          current.state = "reconciling";
          current.token = token;
          current.startedAt = now ?? clock();
          return structuredClone(current);
        });
        if (!claimed) continue;
        let confirmed = false;
        try {
          confirmed = await reconcileDirect(claimed);
        } catch {
          /* Read uncertainty never permits another write. */
        }
        await record.update((state) => {
          const current = state.direct_claims?.[claimed.workoutId];
          if (current?.token !== token) return;
          if (confirmed) delete state.direct_claims[claimed.workoutId];
          else current.state = "unknown";
        });
        if (confirmed) synced++;
      }
      initial = Object.keys(initial.direct_claims || {}).length ? await record.read() : initial;
      const attempted = new Set();
      for (let count = 0; count < 100; count++) {
        const claimId = randomUUID();
        const time = now ?? clock();
        const current = count ? await record.read() : initial;
        const blocked = new Set();
        const eligible = [...current.jobs]
          .sort((a, b) => a.sequence - b.sequence)
          .some((item) => {
            if (terminal(item)) return false;
            if (current.direct_claims?.[item.mutation.id]) return false;
            if (
              ["running", "reconciling"].includes(item.state) &&
              time - item.claim.startedAt >= CLAIM_TIMEOUT_MS
            )
              return true;
            if (blocked.has(item.mutation.id)) return false;
            blocked.add(item.mutation.id);
            if (
              attempted.has(item.mutation.operationId) ||
              ["running", "reconciling"].includes(item.state)
            )
              return false;
            if (item.state === "unknown" && (!retryFailed || !reconcile)) return false;
            if (item.state === "failed" && !retryFailed) return false;
            return !(item.next_retry_at > time && !retryFailed);
          });
        if (!eligible) break;
        const job = await record.update((state) => {
          const blocked = new Set();
          for (const item of [...state.jobs].sort((a, b) => a.sequence - b.sequence)) {
            if (
              ["running", "reconciling"].includes(item.state) &&
              time - item.claim.startedAt >= CLAIM_TIMEOUT_MS
            ) {
              item.state = "unknown";
              item.claim = null;
              item.error =
                "The previous edit could not be confirmed. Refresh to verify the provider before making another change.";
            }
            if (terminal(item)) continue;
            if (state.direct_claims?.[item.mutation.id]) continue;
            if (blocked.has(item.mutation.id)) continue;
            blocked.add(item.mutation.id);
            if (
              attempted.has(item.mutation.operationId) ||
              ["running", "reconciling"].includes(item.state)
            )
              continue;
            const verifying = item.state === "unknown";
            if (verifying && (!retryFailed || !reconcile)) continue;
            if (item.state === "failed" && !retryFailed) continue;
            if (item.next_retry_at > time && !retryFailed) continue;
            item.state = verifying ? "reconciling" : "running";
            item.claim = { id: claimId, startedAt: time };
            return structuredClone(item);
          }
          return null;
        });
        if (!job) break;
        attempted.add(job.mutation.operationId);
        try {
          const confirmed =
            job.state === "reconciling"
              ? await reconcile(job.mutation, job)
              : (await apply(job.mutation, job), true);
          const settled = await record.update((state) => {
            const current = state.jobs.find(
              (item) => item.mutation.operationId === job.mutation.operationId
            );
            if (current?.claim?.id !== claimId) return false;
            current.state = confirmed ? "synced" : "unknown";
            current.claim = null;
            current.error = confirmed
              ? null
              : "The provider has not confirmed this edit. It has not been retried.";
            if (confirmed) current.synced_at = new Date(clock()).toISOString();
            return confirmed;
          });
          if (settled) synced++;
        } catch (error) {
          await record.update((state) => {
            const current = state.jobs.find(
              (item) => item.mutation.operationId === job.mutation.operationId
            );
            if (current?.claim?.id !== claimId) return;
            const rejected =
              job.state !== "reconciling" &&
              (error.beforeWrite === true || error.writeRejected === true);
            current.state = rejected ? "failed" : "unknown";
            current.claim = null;
            current.attempts++;
            current.error = rejected
              ? error.message
              : "The edit outcome is unknown. Refresh to verify it; it has not been retried.";
          });
        }
      }
      const final = await compact(await record.read());
      return mutationCounts(final, now ?? clock(), synced);
    },
  };
}
