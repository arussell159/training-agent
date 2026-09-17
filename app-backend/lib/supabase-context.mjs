const jsonHeaders = (key) => ({
  apikey: key,
  ...(!String(key).startsWith("sb_secret_") ? { Authorization: `Bearer ${key}` } : {}),
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=representation",
});

export function createContextStore(config, log = () => {}, fetchImpl = fetch) {
  const url = String(config.SUPABASE_URL || "").replace(/\/$/, "");
  const key = config.SUPABASE_SECRET_KEY;
  const ready = Boolean(url && key);
  async function request(table, options = {}) {
    if (!ready) throw new Error("Supabase project URL is not configured");
    const response = await fetchImpl(`${url}/rest/v1/${table}${options.query || ""}`, {
      ...options,
      signal: AbortSignal.timeout(30000),
      headers: { ...jsonHeaders(key), ...options.headers },
    });
    if (!response.ok)
      throw new Error(`Supabase ${table}: ${response.status} ${await response.text()}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
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
        query: `?${athleteFilter}status=eq.ready&order=updated_at.desc&limit=1&select=*`,
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
