import { randomBytes } from "node:crypto";
import { fastViewId } from "./fast-context.mjs";

// The capability is kept in browser memory. It only unlocks a private channel of
// version notifications; the normal authenticated API still gates every data read.
export async function createTrainingLive(
  config,
  store,
  { now = Date.now, sessionExpiresAt = Infinity } = {}
) {
  const key = config.SUPABASE_PUBLISHABLE_KEY;
  if (!store.ready || !String(key || "").startsWith("sb_publishable_")) return { available: false };
  const topic = `training:${randomBytes(32).toString("hex")}`;
  const expiresAt = Math.min(now() + 55 * 60_000, sessionExpiresAt);
  await store.registerTrainingLive(topic, fastViewId(config), new Date(expiresAt).toISOString());
  return { available: true, url: config.SUPABASE_URL, key, topic, expiresAt };
}
