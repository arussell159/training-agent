import { randomUUID } from "node:crypto";
import { CoachError } from "./github-coach-source.mjs";
import { completedActivityIds } from "./report-targets.mjs";

export const freshWorkoutSync = () => ({ seen: [], pending: [], active: null, last: null });

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
    if (current.active || !current.pending.length) return;
    const claim = await store.update((state) => {
      if (state.active || !state.pending.length) return null;
      const active = {
        requestId: randomUUID(),
        ids: [...state.pending],
        startedAt: now(),
        runId: null,
        url: null,
        status: "dispatching",
      };
      state.active = active;
      state.pending = [];
      return active;
    });
    if (!claim) return;
    try {
      const run = await github(`/actions/workflows/${workflow}/dispatches`, {
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
  async function poll() {
    let state = await store.read();
    const active = state.active;
    if (active) {
      try {
        let run;
        if (active.runId) run = await github(`/actions/runs/${active.runId}`);
        else {
          const runs = await github(
            `/actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=${encodeURIComponent(config.branch)}&per_page=100`
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
        return {
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
    return state.active || state.last || { status: "idle" };
  }
  return {
    queue,
    poll,
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
