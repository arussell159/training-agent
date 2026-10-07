import { useEffect } from 'react'
import { apiFetch } from '@/lib/api-client'
import { withRequestDeadline } from '@/lib/request-deadline'
import { createLiveSyncScheduler } from '@/lib/live-sync-scheduler'
import { performanceProbe } from '@/lib/performance-probe'
import { cachedTrainingContext, rememberLiveTrainingContext, trainingMutationState, type TrainingContext } from '@/lib/training-context'

export function BackgroundSync() {
  useEffect(() => {
    let active = true, syncing = false, connecting = false, retries = 0
    let retryTimer = 0, renewalTimer = 0
    let live: { stop: () => void } | undefined
    let liveAbort: AbortController | undefined
    const controller = new AbortController()
    const visible = () => document.visibilityState !== 'hidden' && navigator.onLine
    const version = () => {
      const cached = cachedTrainingContext() as TrainingContext & { version?: string }
      return cached.context_scope === 'full' ? cached.version : undefined
    }
    const scheduler = createLiveSyncScheduler({
      canCheck: () => visible() && !trainingMutationState().busy,
      currentVersion: version,
      check: async () => {
        const started = performance.now()
        const revision = trainingMutationState().revision
        const result = await withRequestDeadline(async signal => {
          const savedVersion = version()
          const query = savedVersion ? '?' + new URLSearchParams({ version: savedVersion }) : ''
          const response = await apiFetch('/api/training-updates' + query, { signal })
          const body = await response.json() as { context?: TrainingContext; unchanged?: boolean; pending?: boolean }
          if (!response.ok || (!body.context && !body.unchanged)) throw Error('Training check failed')
          return body
        }, 20_000, controller.signal)
        if (!active) return true
        if (revision !== trainingMutationState().revision || trainingMutationState().busy) return false
        if (result.context) rememberLiveTrainingContext(result.context)
        performanceProbe('version-check', { durationMs: Math.round(performance.now() - started), unchanged: Boolean(result.unchanged) })
        return !result.pending
      },
    })
    const disconnect = () => {
      window.clearTimeout(renewalTimer)
      window.clearTimeout(retryTimer)
      liveAbort?.abort()
      live?.stop()
      live = undefined
      connecting = false
      scheduler.connection(false)
    }
    const connect = async () => {
      if (!active || !visible() || live || connecting) return
      connecting = true
      const attempt = new AbortController()
      liveAbort = attempt
      try {
        // Outside the initial JavaScript bundle and calendar render.
        const { subscribeTrainingLive } = await import('@/lib/training-live')
        const subscription = await subscribeTrainingLive(version => {
          performanceProbe('notification')
          scheduler.invalidate(version)
        }, connected => {
          performanceProbe('live-connection', { connected })
          scheduler.connection(connected)
        }, attempt.signal)
        if (!active || attempt.signal.aborted) { subscription.stop(); return }
        live = subscription
        retries = 0
        renewalTimer = window.setTimeout(() => { disconnect(); void connect() }, Math.max(1000, subscription.expiresAt - Date.now() - 60_000))
      } catch {
        if (active && !attempt.signal.aborted) {
          scheduler.connection(false)
          retryTimer = window.setTimeout(() => void connect(), Math.min(300_000, 5000 * 2 ** Math.min(retries++, 6)))
        }
      } finally { if (liveAbort === attempt) connecting = false }
    }
    const resume = () => {
      if (!visible()) { scheduler.pause(); disconnect() }
      else { scheduler.resume(); void connect() }
    }
    const edited = () => {
      if (!active || syncing || !navigator.onLine) return
      syncing = true
      void withRequestDeadline(signal => apiFetch('/api/sync?trainingOnly=1', { method: 'POST', signal }), 90_000, controller.signal)
        .then(response => { if (response.ok && active) scheduler.invalidate() })
        .catch(() => {}).finally(() => { syncing = false })
    }
    resume()
    window.addEventListener('online', resume)
    window.addEventListener('offline', resume)
    window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('request-background-sync', edited)
    return () => {
      active = false
      controller.abort()
      scheduler.stop()
      disconnect()
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', resume)
      window.removeEventListener('pageshow', resume)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('request-background-sync', edited)
    }
  }, [])
  return null
}
