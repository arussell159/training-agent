import { projectTrainingContext } from "./fast-context.mjs";

// Browser reads never wait for provider reconciliation or optional exports.
export async function cachedTrainingUpdates({ readView, refresh, schedule, version }) {
  const view = await readView();
  schedule(refresh);
  if (!view) return { pending: true, unchanged: true };
  if (version && version === view.version) return { unchanged: true, version: view.version };
  return {
    context: projectTrainingContext(view, "full"),
    sourceChanged: false,
    version: view.version,
  };
}
