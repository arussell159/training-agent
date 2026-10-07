import { RealtimeClient } from '@supabase/realtime-js'
import { apiFetch } from './api-client'
import { withRequestDeadline } from './request-deadline'

type Grant = { available: boolean; url: string; key: string; topic: string; expiresAt: number }
let savedGrant: Grant | undefined
if (typeof window !== 'undefined')
  for (const event of ['training-cache-reset', 'app-auth-required'])
    window.addEventListener(event, () => { savedGrant = undefined })
// Memory-only capability; normal app authentication still gates every data read.
export async function subscribeTrainingLive(
  changed: (version?: string) => void,
  connection: (connected: boolean) => void,
  signal: AbortSignal
) {
  const grant = savedGrant && savedGrant.expiresAt - Date.now() > 65_000 ? savedGrant : await withRequestDeadline(async requestSignal => {
    const response = await apiFetch('/api/training-live', { method: 'POST', signal: requestSignal })
    if (!response.ok) throw Error('Live updates unavailable')
    return await response.json() as Grant
  }, 20_000, signal)
  signal.throwIfAborted()
  if (!grant.available) throw Error('Live updates unavailable')
  savedGrant = grant
  const client = new RealtimeClient(`${grant.url}/realtime/v1`, {
    params: { apikey: grant.key }, heartbeatIntervalMs: 25_000,
  })
  const channel = client.channel(grant.topic, { config: { private: true } })
  channel.on('broadcast', { event: 'training_changed' }, ({ payload }) => {
    if (!signal.aborted) changed(typeof payload?.version === 'string' ? payload.version : undefined)
  }).subscribe(status => {
    if (!signal.aborted) connection(status === 'SUBSCRIBED')
  })
  const stop = () => { client.disconnect() }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  return { expiresAt: grant.expiresAt, stop: () => {
    signal.removeEventListener('abort', stop)
    client.disconnect()
  } }
}
