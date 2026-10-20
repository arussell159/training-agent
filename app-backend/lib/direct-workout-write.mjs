import { createContextStore } from "./supabase-context.mjs";
import { createMutationQueue } from "./mutation-queue.mjs";
import { createIntervalsClient } from "./intervals.mjs";
import { stripPlannedValues } from "./planned-workout-values.mjs";
import { DEFINITION_MARKER } from "./workout-editor-model.mjs";

// Every existing-workout write shares the queue's durable per-workout claim.
// The intent is encrypted before transport, so a lost reply can be verified by
// a different instance without sending another PUT or DELETE.
export async function withDirectWorkoutWrite(config, id, action, options = {}) {
  const store = options.store || createContextStore(config);
  const queue = options.queue || createMutationQueue(config, store);
  const source = options.request || createIntervalsClient(config);
  const [kind, value] = id.split(":");
  const workoutPath = kind === "event" ? `/athlete/0/events/${value}` : `/activity/${value}`;
  let claim;
  try {
    claim = await queue.beginDirect(id);
  } catch (error) {
    if (error.code !== "WORKOUT_WRITE_BUSY" || (!options.replacePending && !options.recoverPending))
      throw error;
    const recovered = await queue.recoverWorkout(id, async ({ direct, jobs }, age) => {
      let event,
        missing = false;
      try {
        event = await source(workoutPath);
      } catch (readError) {
        if (readError.status !== 404) throw readError;
        missing = true;
      }
      if (
        !missing &&
        (!event || typeof event !== "object" || Array.isArray(event) || String(event.id) !== value)
      )
        throw Error(
          "The previous workout edit could not be checked. Try again when Intervals.icu is available."
        );
      const readBack = async () => {
        if (missing) throw Object.assign(Error("Workout no longer exists"), { status: 404 });
        return event;
      };
      let confirmedDirect = false;
      if (direct?.intent) {
        try {
          confirmedDirect = await reconcileDirectWorkoutWrite(direct, readBack);
        } catch (readError) {
          if (readError.status !== 404) throw readError;
        }
      }
      const releaseDirect = !direct || !direct.intent || confirmedDirect || age.directExpired;
      const resolved = {};
      for (const job of jobs) {
        const mutation = job.mutation;
        const confirmed =
          !missing &&
          (mutation.type === "move"
            ? String(event.start_date_local || "").slice(0, 10) === mutation.date
            : stripPlannedValues(event.description).split(DEFINITION_MARKER)[0] ===
              mutation.description);
        if (confirmed) resolved[mutation.operationId] = "synced";
        // Explicit editor saves can recover an abandoned unknown write, but
        // cannot discard an unrelated queued edit that has not been submitted.
        else if (
          (options.replacePending && ["pending", "retry", "failed"].includes(job.state)) ||
          (["unknown", "running", "reconciling"].includes(job.state) &&
            age.expiredJobs.includes(mutation.operationId))
        )
          resolved[mutation.operationId] = "superseded";
      }
      return { releaseDirect, jobs: resolved };
    });
    if (!recovered) throw error;
    claim = await queue.beginDirect(id);
  }
  let attempted = false,
    rejected = false;
  const request = async (path, requestOptions = {}) => {
    const method = (requestOptions.method || "GET").toUpperCase();
    const writing = method !== "GET" && path === workoutPath;
    if (writing) {
      const body = requestOptions.body ? JSON.parse(requestOptions.body) : null;
      await queue.directIntent(claim, { method, path, body });
      attempted = true;
    }
    try {
      return await source(path, requestOptions);
    } catch (error) {
      if (writing && error.status >= 400 && error.status < 500) rejected = true;
      throw error;
    }
  };
  try {
    const result = await action(request);
    await queue.finishDirect(claim);
    return result;
  } catch (error) {
    await queue.finishDirect(claim, { unknown: attempted && !rejected }).catch(() => {});
    throw error;
  }
}

function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key], b[key]));
}

export async function reconcileDirectWorkoutWrite(claim, request) {
  const intent = claim.intent;
  if (!intent) return true;
  let current;
  try {
    current = await request(intent.path);
  } catch (error) {
    if (intent.method === "DELETE" && error.status === 404) return true;
    throw error;
  }
  if (intent.method === "DELETE") return false;
  if (!intent.body || typeof intent.body !== "object" || Array.isArray(intent.body)) return false;
  return Object.entries(intent.body).every(([key, value]) =>
    key === "paired_event_id" && value != null && current?.[key] != null
      ? String(current[key]) === String(value)
      : sameValue(current?.[key], value)
  );
}
