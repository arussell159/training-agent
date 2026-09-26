import { randomUUID } from "node:crypto";

// Persist the requested export and its claim before returning the fast training
// response. The claim is shared by every browser and serverless instance.
export const freshSection11Sync = () => ({
  revision: 0,
  requested: null,
  active: null,
  complete: null,
  failed: null,
});

export function createSection11Sync({ store, run, waitUntil, now = Date.now }) {
  const leaseMs = 6 * 60_000;
  function status(state, revision = state.requested?.revision) {
    if (!revision) return { status: "idle" };
    if (state.complete?.revision >= revision)
      return { status: "complete", revision, commit: state.complete.commit };
    if (state.failed?.revision >= revision)
      return { status: "failed", revision, error: state.failed.error };
    return { status: state.active?.revision >= revision ? "running" : "queued", revision };
  }
  async function start(input, revision) {
    const { claim, state } = await store.update((state) => {
      if (
        input &&
        (!state.requested ||
          input.version !== state.requested.version ||
          (input.force && input.requestId !== state.requested.requestId))
      ) {
        state.requested = { ...input, revision: ++state.revision };
      }
      if (state.active && now() - state.active.startedAt >= leaseMs) {
        state.failed = {
          revision: state.active.revision,
          error: "GitHub sync timed out. Refresh to retry.",
          at: now(),
        };
        state.active = null;
      }
      const requested = state.requested;
      const retryDue = input && state.failed && now() - state.failed.at >= 60_000;
      const needsExport =
        requested &&
        requested.revision > (state.complete?.revision || 0) &&
        (requested.revision > (state.failed?.revision || 0) || retryDue);
      let claim = null;
      if (!state.active && needsExport) {
        claim = { ...requested, claimId: randomUUID(), startedAt: now() };
        state.active = claim;
        state.failed = null;
      }
      return { claim, state: structuredClone(state) };
    });
    if (claim) {
      const task = (async () => {
        try {
          const result = await run(claim);
          if (result.status !== "complete") throw Error(result.error || "GitHub export failed.");
          await store.update((state) => {
            if (state.active?.claimId !== claim.claimId) return;
            state.complete = { revision: claim.revision, commit: result.commit, at: now() };
            state.active = null;
          });
        } catch (error) {
          await store.update((state) => {
            if (state.active?.claimId !== claim.claimId) return;
            state.failed = {
              revision: claim.revision,
              error: error.message || "GitHub export failed.",
              at: now(),
            };
            state.active = null;
          });
        }
      })();
      // A platform-managed task survives the browser closing after the response.
      waitUntil(task.catch(() => {}));
    }
    return status(state, revision);
  }
  return {
    ensure: (input) => start(input),
    // A queued newer version can claim its own function lifetime after the older
    // export finishes. No second browser POST is required to start the first job.
    async progress(revision) {
      const state = await store.read();
      const active = state.active && now() - state.active.startedAt < leaseMs;
      const pending =
        state.requested?.revision >
        Math.max(state.complete?.revision || 0, state.failed?.revision || 0);
      if ((!active && pending) || (state.active && !active)) return start(null, revision);
      return status(state, revision);
    },
  };
}
