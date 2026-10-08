import { projectTrainingContext } from "./fast-context.mjs";

// Browser reads never wait for provider reconciliation or optional exports.
export async function cachedTrainingUpdates({ readVersion, readView, refresh, schedule, version }) {
  schedule(refresh);
  if (version && readVersion && (await readVersion()) === version)
    return { unchanged: true, version };
  const view = await readView();
  if (!view) return { pending: true, unchanged: true };
  if (version && version === view.version) return { unchanged: true, version: view.version };
  return {
    context: projectTrainingContext(view, "full"),
    sourceChanged: false,
    version: view.version,
  };
}
