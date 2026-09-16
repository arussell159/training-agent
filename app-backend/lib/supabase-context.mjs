const jsonHeaders = key => ({
  apikey:key,
  ...(!String(key).startsWith("sb_secret_") ? { Authorization:`Bearer ${key}` } : {}),
  "Content-Type":"application/json",
  Prefer:"resolution=merge-duplicates,return=representation",
})

export function createContextStore(config, log = () => {}, fetchImpl = fetch) {
  const url = String(config.SUPABASE_URL || "").replace(/\/$/, "")
  const key = config.SUPABASE_SECRET_KEY
  const ready = Boolean(url && key)
  async function request(table, options = {}) {
    if (!ready) throw new Error("Supabase project URL is not configured")
    const response = await fetchImpl(`${url}/rest/v1/${table}${options.query || ""}`, { ...options, signal:AbortSignal.timeout(30000), headers:{ ...jsonHeaders(key), ...options.headers } })
    if (!response.ok) throw new Error(`Supabase ${table}: ${response.status} ${await response.text()}`)
    const text = await response.text(); return text ? JSON.parse(text) : null
  }
  return {
    ready,
    async getSyncRecord(id) {
      const rows = await request('sync_state', {query:`?athlete_id=eq.${encodeURIComponent(id)}&limit=1&select=cursor`});
      return rows?.[0]?.cursor || null;
    },
    async invalidateSyncState(id) {
      return request('sync_state', {method:'PATCH',query:`?athlete_id=eq.${encodeURIComponent(id)}`,body:JSON.stringify({status:'stale',updated_at:new Date().toISOString()})});
    },
    async deleteWorkout(id) {
      return request('workout_context', {method:'DELETE',query:`?id=eq.${encodeURIComponent(id)}`});
    },
    async getContext(athleteId = "default") {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString()
      const [configRows, workouts, comments] = await Promise.all([
        request("coaching_config", { query:`?athlete_id=eq.${athleteId}&select=*` }),
        request("workout_context", { query:`?athlete_id=eq.${athleteId}&workout_date=gte.${cutoff}&order=workout_date.desc&select=*` }),
        request("athlete_comments", { query:`?athlete_id=eq.${athleteId}&created_at=gte.${cutoff}&order=created_at.desc&select=*` }),
      ])
      return { coaching:configRows?.[0] || null, workouts, comments }
    },
    async getLatestSyncState(athleteId = null) {
      const athleteFilter = athleteId
        ? `athlete_id=eq.${encodeURIComponent(athleteId)}&`
        : ""
      const rows = await request("sync_state", {
        query:`?${athleteFilter}status=eq.ready&order=updated_at.desc&limit=1&select=*`,
      })
      return rows?.[0] || null
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
    async getDailyReviewByDate(athleteId, localDate) {
      const rows = await request("daily_workout_reviews", {
        query:`?athlete_id=eq.${encodeURIComponent(athleteId)}&local_date=eq.${encodeURIComponent(localDate)}&limit=1&select=*`,
      })
      return rows?.[0] || null
    },
    async getNotificationPreferences(athleteId = "default") {
      const [rows, subscriptions] = await Promise.all([
        request("workout_notification_preferences", {
          query:`?athlete_id=eq.${encodeURIComponent(athleteId)}&limit=1&select=*`,
        }),
        request("workout_push_subscriptions", {
          query:`?athlete_id=eq.${encodeURIComponent(athleteId)}&order=updated_at.desc&select=subscription`,
        }),
      ])
      const row = rows?.[0] || {}
      return {
        enabled:Boolean(row.enabled),
        review_time:String(row.review_time || "06:00").slice(0, 5),
        time_zone:row.time_zone || "America/Chicago",
        last_delivery_error:row.last_delivery_error || null,
        subscriptions:(subscriptions || []).map(item => item.subscription).filter(Boolean),
      }
    },
    async updateNotificationPreferences(athleteId = "default", patch = {}) {
      const current = await this.getNotificationPreferences(athleteId)
      const rows = await request("workout_notification_preferences", {
        method:"POST",
        body:JSON.stringify([{
          athlete_id:athleteId,
          enabled:Object.hasOwn(patch, "enabled") ? Boolean(patch.enabled) : current.enabled,
          review_time:patch.review_time || current.review_time,
          time_zone:patch.time_zone || current.time_zone,
          last_delivery_error:Object.hasOwn(patch, "last_delivery_error") ? patch.last_delivery_error : current.last_delivery_error,
          updated_at:new Date().toISOString(),
        }]),
        headers:{ Prefer:"resolution=merge-duplicates,return=representation" },
      })
      return { ...current, ...(rows?.[0] || {}), review_time:String(rows?.[0]?.review_time || current.review_time).slice(0, 5) }
    },
    async upsertPushSubscription(athleteId = "default", subscription) {
      await request("workout_push_subscriptions", {
        method:"POST",
        body:JSON.stringify([{
          endpoint:subscription.endpoint,
          athlete_id:athleteId,
          subscription,
          updated_at:new Date().toISOString(),
        }]),
        headers:{ Prefer:"resolution=merge-duplicates,return=minimal" },
      })
      return subscription
    },
    async removePushSubscription(athleteId = "default", endpoint) {
      await request("workout_push_subscriptions", {
        method:"DELETE",
        query:`?athlete_id=eq.${encodeURIComponent(athleteId)}&endpoint=eq.${encodeURIComponent(endpoint)}`,
      })
      return true
    },
    async prune() { return request("rpc/prune_old_training_context", { method:"POST", body:"{}" }) },
  }
}
