import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { createWorkoutSync, freshWorkoutSync } from "./coach-workout-sync.mjs";

// Called only by the authenticated startup lease route, never by idle hints.
// Reuse the manual-sync durable claim so open tabs cannot duplicate an
// active app-dispatched run. No report service/model is initialized here.
export async function refreshGithubOnStartup({
  config,
  bootstrap,
  createStore = createEncryptedRecordStore,
  fetchImpl = fetch,
}) {
  if (!config.githubToken || !config.repo) {
    return {
      status: "unavailable",
      error:
        "GitHub startup refresh is not configured. Use the header Refresh after checking the training-data connection.",
    };
  }
  const store = createStore(bootstrap, `${config.repo}@${config.branch}/`, {
    namespace: "coach-sync",
    name: "COACH_WORKOUT_SYNC",
    fresh: freshWorkoutSync,
    timestampCas: true,
  });
  return createWorkoutSync({ config, store, fetchImpl }).refresh();
}
