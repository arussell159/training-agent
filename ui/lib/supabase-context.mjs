const jsonHeaders = key => ({ apikey:key, Authorization:`Bearer ${key}`, "Content-Type":"application/json", Prefer:"resolution=merge-duplicates,return=representation" })

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
    async prune() { return request("rpc/prune_old_training_context", { method:"POST", body:"{}" }) },
  }
}
