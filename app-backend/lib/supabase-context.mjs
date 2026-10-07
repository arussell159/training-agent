import { createHash } from "node:crypto";
import { nextSyncRevision } from "./sync-record-revision.mjs";

// Server-local read-through cache for the large training snapshot and archived
// activity rows. Keep it short so changes made elsewhere appear promptly, and
// invalidate it immediately whenever this process writes to Supabase.
const READ_CACHE_TTL_MS = 30_000;
const READ_CACHE_MAX_ENTRIES = 160;
const readCache = new Map();
function clearReadCache(account) {
  const prefix = `${account}\0`;
  for (const key of readCache.keys()) if (key.startsWith(prefix)) readCache.delete(key);
}

const jsonHeaders = (key) => ({
  apikey: key,
  ...(!String(key).startsWith("sb_secret_") ? { Authorization: `Bearer ${key}` } : {}),
  "Content-Type": "application/json",
  Prefer: "return=minimal",
});

export function createContextStore(config, log = () => {}, fetchImpl = fetch) {
  const url = String(config.SUPABASE_URL || "").replace(/\/$/, "");
  const key = config.SUPABASE_SECRET_KEY;
  const ready = Boolean(url && key);
  const account = createHash("sha256")
    .update(`${url}\0${key || ""}`)
    .digest("hex");
  async function request(table, options = {}) {
    if (!ready) throw new Error("Supabase project URL is not configured");
    const method = (options.method || "GET").toUpperCase();
    const cacheKey = `${account}\0${table}${options.query || ""}`;
    const cached = method === "GET" && !options.fresh ? readCache.get(cacheKey) : null;
    if (cached && (cached.expiresAt === 0 || cached.expiresAt > Date.now())) {
      return structuredClone(await cached.promise);
    }
    if (method !== "GET") clearReadCache(account);
    const operation = async () => {
      const response = await fetchImpl(`${url}/rest/v1/${table}${options.query || ""}`, {
        ...options,
        signal: AbortSignal.timeout(30000),
        headers: { ...jsonHeaders(key), ...options.headers },
      });
      if (!response.ok)
        // Provider diagnostics can echo submitted personal data or credentials.
        throw new Error(`Supabase ${table} request failed (${response.status}).`);
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    };
    if (method !== "GET") {
      try {
        return await operation();
      } finally {
        clearReadCache(account);
      }
    }
    const entry = { expiresAt: 0, promise: Promise.resolve(null) };
    entry.promise = operation()
      .then((value) => {
        if (readCache.get(cacheKey) === entry) entry.expiresAt = Date.now() + READ_CACHE_TTL_MS;
        return value;
      })
      .catch((error) => {
        if (readCache.get(cacheKey) === entry) readCache.delete(cacheKey);
        throw error;
      });
    readCache.delete(cacheKey);
    if (readCache.size >= READ_CACHE_MAX_ENTRIES) readCache.delete(readCache.keys().next().value);
    readCache.set(cacheKey, entry);
    return structuredClone(await entry.promise);
  }
  return {
    ready,
    async registerTrainingLive(topic, viewId, expiresAt) {
      return request('rpc/register_training_live', { method: 'POST', body: JSON.stringify({
        p_topic: topic, p_view_id: viewId, p_expires_at: expiresAt,
      }) });
    },
    async getSyncVersion(id) {
      const rows = await request('sync_state', { fresh: true,
        query: `?athlete_id=eq.${encodeURIComponent(id)}&limit=1&select=view_version`,
      });
      return rows?.[0]?.view_version || null;
    },
    async getSyncRecord(id, { fresh = false } = {}) {
      const rows = await request("sync_state", {
        fresh,
        query: `?athlete_id=eq.${encodeURIComponent(id)}&limit=1&select=cursor`,
      });
      return rows?.[0]?.cursor || null;
    },
    async listSyncRecords(prefix, { offset = 0 } = {}) {
      return request("sync_state", {
        query: `?athlete_id=like.${encodeURIComponent(prefix + "*")}&cursor->>state=in.(pending,retry,failed)&order=updated_at.asc&limit=100&offset=${offset}&select=athlete_id,cursor`,
      });
    },
    async invalidateSyncState(id) {
      return request("sync_state", {
        method: "PATCH",
        query: `?athlete_id=eq.${encodeURIComponent(id)}`,
        body: JSON.stringify({ status: "stale", updated_at: new Date().toISOString() }),
      });
    },
    async deleteWorkout(id) {
      return request("workout_context", {
        method: "DELETE",
        query: `?id=eq.${encodeURIComponent(id)}`,
      });
    },
    async getLatestSyncState(athleteId = null, { fresh = false } = {}) {
      const athleteFilter = athleteId ? `athlete_id=eq.${encodeURIComponent(athleteId)}&` : "";
      const rows = await request("sync_state", {
        fresh,
        query: `?${athleteFilter}status=eq.ready&order=updated_at.desc&limit=1&select=athlete_id,status,cursor,updated_at`,
      });
      return rows?.[0] || null;
    },
    async updateSyncRecord(id, change) {
      const filter = `?athlete_id=eq.${encodeURIComponent(id)}`;
      for (let attempt = 0; attempt < 8; attempt++) {
        const current = (
          await request("sync_state", {
            fresh: true,
            query: `${filter}&limit=1&select=athlete_id,status,cursor,updated_at`,
          })
        )?.[0];
        const revision = nextSyncRevision(current?.updated_at);
        const patch = change(current ? structuredClone(current) : null, revision);
        if (!patch) return current;
        const row = { ...patch, athlete_id: id, updated_at: revision };
        const saved = current
          ? await request("sync_state", {
              method: "PATCH",
              query: `${filter}&updated_at=eq.${encodeURIComponent(current.updated_at)}`,
              body: JSON.stringify(row),
              headers: { Prefer: "return=representation" },
            })
          : await request("sync_state", {
              method: "POST",
              query: "?on_conflict=athlete_id",
              body: JSON.stringify([row]),
              headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
            });
        if (saved?.length === 1) return saved[0];
      }
      throw Error("The saved calendar changed during this edit. Refresh before retrying.");
    },
    async upsert(table, rows) {
      log(`supabase upsert ${table}: ${rows.length}`);
      return request(table, {
        method: "POST",
        body: JSON.stringify(rows),
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      });
    },
    async prune() {
      return request("rpc/prune_old_training_context", { method: "POST", body: "{}" });
    },
  };
}
