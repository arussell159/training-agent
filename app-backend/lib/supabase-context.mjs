const jsonHeaders = key => ({
  apikey:key,
  ...(!String(key).startsWith("sb_secret_") ? { Authorization:`Bearer ${key}` } : {}),
  "Content-Type":"application/json",
  Prefer:"resolution=merge-duplicates,return=representation",
})

export function createContextStore(config, log = () => {}) {
  const url = String(config.SUPABASE_URL || "").replace(/\/$/, "")
  const key = config.SUPABASE_SECRET_KEY
  const ready = Boolean(url && key)
  async function request(table, options = {}) {
    if (!ready) throw new Error("Supabase project URL is not configured")
    const response = await fetch(`${url}/rest/v1/${table}${options.query || ""}`, { ...options, headers:{ ...jsonHeaders(key), ...options.headers } })
    if (!response.ok) throw new Error(`Supabase ${table}: ${response.status} ${await response.text()}`)
    const text = await response.text(); return text ? JSON.parse(text) : null
  }
  return {
    ready,
    async getContext(athleteId = "default") {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString()
      const [configRows, workouts, comments] = await Promise.all([
        request("coaching_config", { query:`?athlete_id=eq.${athleteId}&select=*` }),
        request("workout_context", { query:`?athlete_id=eq.${athleteId}&workout_date=gte.${cutoff}&order=workout_date.desc&select=*` }),
        request("athlete_comments", { query:`?athlete_id=eq.${athleteId}&created_at=gte.${cutoff}&order=created_at.desc&select=*` }),
      ])
      return { coaching:configRows?.[0] || null, workouts, comments }
    },
    async upsert(table, rows) { log(`supabase upsert ${table}: ${rows.length}`); return request(table, { method:"POST", body:JSON.stringify(rows), headers:{ Prefer:"resolution=merge-duplicates,return=minimal" } }) },
    async listConversations(athleteId = null, limit = 500) {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString()
      const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100))
      const athleteFilter = athleteId ? `athlete_id=eq.${encodeURIComponent(athleteId)}&` : ""
      try {
        return await request("coach_conversations", {
          query:`?${athleteFilter}updated_at=gte.${encodeURIComponent(cutoff)}&deleted_at=is.null&order=pinned.desc,updated_at.desc&limit=${boundedLimit}&select=*`,
        })
      } catch {
        return request("coach_conversations", {
          query:`?${athleteFilter}updated_at=gte.${encodeURIComponent(cutoff)}&order=updated_at.desc&limit=${boundedLimit}&select=*`,
        })
      }
    },
    async getConversation(id) {
      let rows
      try {
        rows = await request("coach_conversations", {
          query:`?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&limit=1&select=*`,
        })
      } catch {
        rows = await request("coach_conversations", {
          query:`?id=eq.${encodeURIComponent(id)}&limit=1&select=*`,
        })
      }
      return rows?.[0] || null
    },
    async updateConversation(id, patch) {
      const rows = await request("coach_conversations", {
        method:"PATCH",
        query:`?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`,
        body:JSON.stringify(patch),
        headers:{ Prefer:"return=representation" },
      })
      return rows?.[0] || null
    },
    async listDailyReviews(athleteId = "default", limit = 100) {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString()
      const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 30))
      return request("daily_workout_reviews", {
        query:`?athlete_id=eq.${encodeURIComponent(athleteId)}&updated_at=gte.${encodeURIComponent(cutoff)}&order=updated_at.desc&limit=${boundedLimit}&select=*`,
      })
    },
    async getDailyReview(id) {
      const rows = await request("daily_workout_reviews", {
        query:`?id=eq.${encodeURIComponent(id)}&limit=1&select=*`,
      })
      return rows?.[0] || null
    },
    async prune() { return request("rpc/prune_old_training_context", { method:"POST", body:"{}" }) },
  }
}
