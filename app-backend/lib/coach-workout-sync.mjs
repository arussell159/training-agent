import { randomUUID } from "node:crypto";
import { CoachError } from "./github-coach-source.mjs";
import { completedActivityIds } from "./report-targets.mjs";

export const freshWorkoutSync = () => ({
  seen: [],
  pending: [],
  pendingRefresh: false,
  pendingRefreshId: null,
  manualProgress: {},
  active: null,
  last: null,
});

// A durable dispatch claim covers all tabs and server instances. No model calls here.
export function createWorkoutSync({
  config,
  store,
  fetchImpl = fetch,
  now = () => Date.now(),
  onFinished = () => {},
}) {
  const base = `https://api.github.com/repos/${config.repo}`;
  const workflow = "auto-sync.yml";
  async function github(path, options = {}) {
    const response = await fetchImpl(base + path, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (!response.ok)
      throw new CoachError(
        `Training sync could not connect to GitHub (HTTP ${response.status}). Check Actions access for the training-data token.`,
        502
      );
    return response.status === 204 ? null : response.json();
  }
  async function dispatch() {
    const current = await store.read();
    if (current.active || (!current.pending.length && !current.pendingRefresh)) return;
    const claim = await store.update((state) => {
      if (state.active || (!state.pending.length && !state.pendingRefresh)) return null;
      const active = {
        requestId: state.pendingRefresh && state.pendingRefreshId
          ? state.pendingRefreshId
          : randomUUID(),
        ids: [...state.pending],
        manual: Boolean(state.pendingRefresh),
        startedAt: now(),
        runId: null,
        url: null,
        status: "dispatching",
      };
      state.active = active;
      state.pending = [];
      state.pendingRefresh = false;
      state.pendingRefreshId = null;
      return active;
    });
    if (!claim) return;
    try {
      const run = await github(`/actions/workflows/${workflow}/dispatches?return_run_details=true`, {
        method: "POST",
        body: JSON.stringify({ ref: config.branch, inputs: { request_id: claim.requestId } }),
      });
      await store.update((state) => {
        if (state.active?.requestId !== claim.requestId) return;
        state.active.status = "queued";
        state.active.runId = run?.workflow_run_id || null;
        state.active.url = run?.html_url || null;
      });
    } catch (error) {
      // A timed-out dispatch may have reached GitHub. Correlate by request ID before retrying.
      await store.update((state) => {
        if (state.active?.requestId === claim.requestId) {
          state.active.status = "checking";
          state.active.error =
            error instanceof CoachError
              ? error.message
              : "Checking whether GitHub received the sync request.";
        }
      });
    }
  }
  async function queue(ids, retry = false) {
    if (!ids.length) return;
    const existing = await store.read();
    if (!retry && ids.every((id) => existing.seen.includes(id))) return;
    await store.update((state) => {
      for (const id of ids) {
        if (!retry && state.seen.includes(id)) continue;
        if (!state.active?.ids.includes(id) && !state.pending.includes(id)) state.pending.push(id);
        if (!state.seen.includes(id)) state.seen.push(id);
      }
      state.seen = state.seen.slice(-3000);
    });
    await dispatch();
  }
  async function poll(requestId) {
    let state = await store.read();
    const active = state.active;
    let workflowProgress = null;
    if (active) {
      try {
        let run;
        if (active.runId) run = await github(`/actions/runs/${active.runId}`);
        else {
          const query = new URLSearchParams({
            event: "workflow_dispatch",
            branch: config.branch,
            created: `>=${new Date(active.startedAt - 60_000).toISOString()}`,
            per_page: "10",
          });
          const runs = await github(
            `/actions/workflows/${workflow}/runs?${query}`
          );
          run = runs.workflow_runs?.find(
            (r) => r.display_title === `section11-sync-${active.requestId}`
          );
        }
        if (
          run &&
          (run.event !== "workflow_dispatch" ||
            run.head_branch !== config.branch ||
            run.path?.split("@")[0] !== `.github/workflows/${workflow}`)
        )
          throw new CoachError("The sync run does not match the configured workflow.");
        if (run?.id) {
          try {
            const jobs = await github(`/actions/runs/${run.id}/jobs?per_page=100`);
            const steps = (jobs.jobs || []).flatMap((job) =>
              (job.steps || []).map((step) => ({ name: step.name, status: step.status }))
            );
            workflowProgress = {
              completed: steps.filter((step) => step.status === "completed").length,
              total: steps.length,
              currentStep: steps.find((step) => step.status === "in_progress")?.name || null,
            };
          } catch {
            // The run status is still useful when GitHub temporarily withholds job details.
          }
        }
        const missing = !run && now() - active.startedAt > 120000;
        const finished = run?.status === "completed";
        await store.update((current) => {
          if (current.active?.requestId !== active.requestId) return;
          if (missing || finished) {
            current.last = {
              ...current.active,
              runId: run?.id || active.runId,
              url: run?.html_url || active.url,
              status: finished && run.conclusion === "success" ? "complete" : "failed",
              finishedAt: now(),
              error: missing
                ? "GitHub did not confirm this sync request. Retry sync to check again."
                : finished && run.conclusion !== "success"
                  ? `GitHub sync finished with ${run.conclusion || "an error"}.`
                  : null,
            };
            current.active = null;
          } else if (run)
            Object.assign(current.active, {
              runId: run.id,
              url: run.html_url,
              status: run.status === "in_progress" ? "running" : "queued",
              error: null,
            });
        });
        if (finished || missing) onFinished();
      } catch (error) {
        if (requestId && active.requestId !== requestId) {
          if (state.pendingRefreshId === requestId) {
            return {
              requestId,
              manual: true,
              status: "queued",
              label: "Waiting for the current sync to finish",
            };
          }
          return null;
        }
        return {
          requestId: active.requestId,
          status: "checking",
          url: active.url,
          error:
            error instanceof CoachError
              ? error.message
              : "GitHub sync status is temporarily unavailable.",
        };
      }
    }
    await dispatch();
    state = await store.read();
    const result = state.active || state.last || { status: "idle" };
    const requestedResult = requestId
      ? state.active?.requestId === requestId
        ? state.active
        : state.last?.requestId === requestId
          ? state.last
          : state.pendingRefreshId === requestId
            ? {
                requestId,
                manual: true,
                status: "queued",
                label: "Waiting for the current sync to finish",
              }
            : null
      : result;
    if (!requestedResult) return null;
    return workflowProgress && requestedResult.requestId === active?.requestId
      ? { ...requestedResult, progress: workflowProgress }
      : requestedResult;
  }
  return {
    queue,
    poll,
    async setManualProgress(requestId, progress) {
      if (!requestId) return;
      await store.update((state) => {
        state.manualProgress ||= {};
        const cutoff = now() - 30 * 60_000;
        for (const [id, saved] of Object.entries(state.manualProgress)) {
          if (saved.updatedAt < cutoff) delete state.manualProgress[id];
        }
        state.manualProgress[requestId] = { ...progress, updatedAt: now() };
        const recent = Object.entries(state.manualProgress)
          .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
          .slice(0, 12);
        state.manualProgress = Object.fromEntries(recent);
      });
    },
    async getManualProgress(requestId) {
      const state = await store.read();
      const progress = state.manualProgress?.[requestId];
      return progress && progress.updatedAt >= now() - 30 * 60_000
        ? progress
        : null;
    },
    async refresh(requestId = randomUUID()) {
      await poll();
      const queued = await store.update((state) => {
        if (state.active?.manual) {
          return { requestId: state.active.requestId, coalesced: true };
        }
        state.pendingRefresh = true;
        state.pendingRefreshId ||= requestId;
        return { requestId: state.pendingRefreshId, coalesced: false };
      });
      await dispatch();
      const state = await store.read();
      if (state.active?.requestId === queued.requestId) return state.active;
      if (state.last?.requestId === queued.requestId) return state.last;
      if (state.pendingRefreshId === queued.requestId) {
        return {
          requestId: queued.requestId,
          manual: true,
          status: "queued",
          label: "Waiting for the current sync to finish",
        };
      }
      return state.active || state.last || { requestId: queued.requestId, status: "queued" };
    },
    async observe(previous, context) {
      const before = new Set(completedActivityIds(previous));
      const completed = completedActivityIds(context);
      // A first import is a baseline, not hundreds of completion notifications.
      if (!previous) {
        return;
      }
      await queue(completed.filter((id) => !before.has(id)));
      await poll();
    },
  };
}
