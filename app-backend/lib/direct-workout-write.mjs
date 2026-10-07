import { createContextStore } from "./supabase-context.mjs";
import { createMutationQueue } from "./mutation-queue.mjs";
import { createIntervalsClient } from "./intervals.mjs";

// Every existing-workout write shares the queue's durable per-workout claim.
// The intent is encrypted before transport, so a lost reply can be verified by
// a different instance without sending another PUT or DELETE.
export async function withDirectWorkoutWrite(config, id, action, options = {}) {
  const store = options.store || createContextStore(config);
  const queue = options.queue || createMutationQueue(config, store);
  const source = options.request || createIntervalsClient(config);
  const claim = await queue.beginDirect(id);
  const [kind, value] = id.split(":");
  const workoutPath = kind === "event" ? `/athlete/0/events/${value}` : `/activity/${value}`;
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
