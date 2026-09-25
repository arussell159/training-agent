import { createHash } from "node:crypto";

// Server-local read-through cache for the large training snapshot and archived
// activity rows. Keep it short so changes made elsewhere appear promptly, and
// invalidate it immediately whenever this process writes to Supabase.
const READ_CACHE_TTL_MS = 30_000;
const READ_CACHE_MAX_ENTRIES = 160;
const readCache = new Map();
let readCacheGeneration = 0;

function clearReadCache() {
  readCacheGeneration += 1;
  readCache.clear();
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
  const account = createHash("sha256").update(`${url}\0${key || ""}`).digest("hex");
  async function request(table, options = {}) {
    if (!ready) throw new Error("Supabase project URL is not configured");
    const method = (options.method || "GET").toUpperCase();
    const cacheKey = `${account}\0${table}${options.query || ""}`;
    const cached = method === "GET" ? readCache.get(cacheKey) : null;
    if (cached && (cached.expiresAt === 0 || cached.expiresAt > Date.now())) {
      return structuredClone(await cached.promise);
    }
    if (method !== "GET") clearReadCache();
    const generation = readCacheGeneration;
    const operation = async () => {
      const response = await fetchImpl(`${url}/rest/v1/${table}${options.query || ""}`, {
        ...options,
        signal: AbortSignal.timeout(30000),
        headers: { ...jsonHeaders(key), ...options.headers },
      });
      if (!response.ok)
        throw new Error(`Supabase ${table}: ${response.status} ${await response.text()}`);
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    };
    if (method !== "GET") {
      try {
        return await operation();
      } finally {
        clearReadCache();
      }
    }
    const entry = { expiresAt: 0, promise: Promise.resolve(null) };
    entry.promise = operation()
      .then((value) => {
        if (generation === readCacheGeneration && readCache.get(cacheKey) === entry)
          entry.expiresAt = Date.now() + READ_CACHE_TTL_MS;
        return value;
      })
      .catch((error) => {
        if (readCache.get(cacheKey) === entry) readCache.delete(cacheKey);
        throw error;
      });
    readCache.delete(cacheKey);
    if (readCache.size >= READ_CACHE_MAX_ENTRIES)
      readCache.delete(readCache.keys().next().value);
    if (generation === readCacheGeneration) readCache.set(cacheKey, entry);
    return structuredClone(await entry.promise);
  }
  return {
    ready,
    async getSyncRecord(id) {
      const rows = await request("sync_state", {
        query: `?athlete_id=eq.${encodeURIComponent(id)}&limit=1&select=cursor`,
      });
      return rows?.[0]?.cursor || null;
    },
    async listSyncRecords(prefix) {
      return request("sync_state", {
        query: `?athlete_id=like.${encodeURIComponent(prefix + "*")}&cursor->>state=in.(pending,retry,failed)&order=updated_at.asc&limit=100&select=athlete_id,cursor`,
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
    async getLatestSyncState(athleteId = null) {
      const athleteFilter = athleteId ? `athlete_id=eq.${encodeURIComponent(athleteId)}&` : "";
      const rows = await request("sync_state", {
        query: `?${athleteFilter}status=eq.ready&order=updated_at.desc&limit=1&select=athlete_id,status,cursor,updated_at`,
      });
      return rows?.[0] || null;
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
